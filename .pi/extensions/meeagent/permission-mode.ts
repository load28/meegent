import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ModeState, PermissionMode } from "./mode-state.js";

// "mcp" is the pi-mcp-adapter proxy tool (Serena et al.). It stays available in
// every mode — including plan — because mutating MCP calls are gated separately
// by the mcp safety guard (see mcp/setup-mcp.ts), not by this allow-list.
export const READONLY_TOOLS = ["read", "bash", "grep", "find", "ls", "mcp"];
export const FULL_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls", "mcp"];

/** Apply the tool allow-list and footer badge for a mode. */
export function applyMode(pi: ExtensionAPI, ctx: ExtensionContext, mode: PermissionMode): void {
  if (mode === "plan") {
    pi.setActiveTools(READONLY_TOOLS);
  } else {
    pi.setActiveTools(FULL_TOOLS);
  }

  if (!ctx.hasUI) return;
  const t = ctx.ui.theme;
  if (mode === "acceptEdits") {
    ctx.ui.setStatus("meeagent-mode", t.fg("success", "⏵⏵ accept edits on"));
  } else if (mode === "plan") {
    ctx.ui.setStatus("meeagent-mode", t.fg("warning", "⏸ plan mode on"));
  } else {
    ctx.ui.setStatus("meeagent-mode", undefined);
  }
}

export function setupPermissionMode(pi: ExtensionAPI, state: ModeState): void {
  // The handler for entering/leaving plan mode (prompt injection, plan gate)
  // lives in plan-mode.ts and reacts via state.onChange there.
  // pi reserves shift+tab for app.thinking.cycle; freeing it requires a global
  // ~/.pi/agent/keybindings.json that unbinds it ({"app.thinking.cycle": []}). See README.
  pi.registerShortcut("shift+tab", {
    description: "Cycle permission mode (default → accept edits → plan)",
    handler: async (ctx) => {
      const next = state.cycle();
      applyMode(pi, ctx, next);
      ctx.ui.notify(`Mode: ${next}`, "info");
    },
  });

  // Initialize footer + tools on session start.
  pi.on("session_start", async (_event, ctx) => {
    applyMode(pi, ctx, state.current());
  });
}
