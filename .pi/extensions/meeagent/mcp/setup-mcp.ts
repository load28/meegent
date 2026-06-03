import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ModeState } from "../mode-state.js";
import { classifyMcpProxyCall } from "./mcp-safety.js";

// Name of the proxy tool registered by pi-mcp-adapter. All MCP server tools
// (Serena's find_symbol, replace_symbol_body, ...) are reached through it.
const MCP_PROXY_TOOL = "mcp";

function previewArgs(args: unknown): string {
  if (typeof args !== "string") return "";
  const oneLine = args.replace(/\s+/g, " ").trim();
  return oneLine.length > 120 ? `${oneLine.slice(0, 119)}…` : oneLine;
}

/**
 * Bring MCP proxy calls under meeagent's permission model.
 *
 * The `mcp` proxy can invoke any connected MCP server tool, including ones that
 * edit files or run shells. Those execute inside the MCP server and so bypass
 * the diff-approval hook (which only sees `edit`/`write`) and the plan-mode tool
 * allow-list. This hook re-imposes the same three-mode contract:
 *   - plan        → block mutating MCP tools (read/search still allowed)
 *   - default     → confirm mutating MCP tools (approve / reject / feedback)
 *   - acceptEdits → auto-approve
 *
 * Requires pi-mcp-adapter to be installed (`pi install npm:pi-mcp-adapter`) and
 * the `mcp` tool to be in the active tool list (see permission-mode.ts). If the
 * adapter is absent the hook simply never fires.
 */
export function setupMcp(pi: ExtensionAPI, state: ModeState): void {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== MCP_PROXY_TOOL) return;

    const decision = classifyMcpProxyCall(event.input);
    // Meta ops (search/describe/list/connect) and pure read tools always pass.
    if (decision.kind !== "mutate") return;

    const mode = state.current();
    if (mode === "acceptEdits") return; // auto-approve

    if (mode === "plan") {
      return {
        block: true,
        reason:
          `Plan mode: blocked mutating MCP tool '${decision.toolName}'. ` +
          `Plan mode is read-only — use MCP only for search/read (e.g. find_symbol, ` +
          `get_symbols_overview). Exit plan mode (Shift+Tab) to apply changes.`,
      };
    }

    // default mode: gate behind explicit confirmation, mirroring diff-approval.
    if (!ctx.hasUI) return; // non-interactive: defer to host policy

    const preview = previewArgs(event.input["args"]);
    const title = preview
      ? `MCP tool '${decision.toolName}' will modify your workspace.\nargs: ${preview}`
      : `MCP tool '${decision.toolName}' will modify your workspace.`;
    const choice = await ctx.ui.select(title, ["Approve", "Reject", "Reject with feedback"]);

    if (choice === "Approve") return; // allow

    if (choice === "Reject with feedback") {
      const feedback = await ctx.ui.editor("Feedback for the agent:", "");
      return {
        block: true,
        reason: feedback?.trim()
          ? `User rejected MCP tool '${decision.toolName}' with feedback: ${feedback.trim()}`
          : `User rejected MCP tool '${decision.toolName}'.`,
      };
    }

    return {
      block: true,
      reason: `User rejected MCP tool '${decision.toolName}'. Do not retry the same call; continue or ask how to proceed.`,
    };
  });
}
