import { isToolCallEventType, Theme, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text, matchesKey, Key } from "@earendil-works/pi-tui";
import type { ModeState } from "./mode-state.js";
import { buildEditDiff, buildWriteDiff, type EditOp } from "./diff-preview.js";

type Decision = "approve" | "reject" | "custom";

/** Colorize a unified diff with the in-session theme's diff colors. */
function colorizeDiff(diffText: string, theme: Theme): string {
  return diffText
    .split("\n")
    .map((l) => {
      if (l.startsWith("+++") || l.startsWith("---")) return theme.fg("muted", l);
      if (l.startsWith("@@")) return theme.fg("accent", l);
      if (l.startsWith("+")) return theme.fg("toolDiffAdded", l);
      if (l.startsWith("-")) return theme.fg("toolDiffRemoved", l);
      return theme.fg("toolDiffContext", l);
    })
    .join("\n");
}

/** Show the colored diff and collect a/r/c decision. */
async function askDecision(ctx: ExtensionContext, diffText: string): Promise<Decision> {
  return ctx.ui.custom<Decision>((_tui, theme, _keys, done) => {
    const body = colorizeDiff(diffText, theme);
    const hint = theme.fg("muted", "\n[a] approve   [r] reject   [c] reject with feedback");
    const text = new Text(body + hint, 1, 1);
    // Text is a full Component (render + invalidate); the TUI calls handleInput(data)
    // with raw key data while this component has focus. Text doesn't declare it, so cast.
    (text as Text & { handleInput: (data: string) => void }).handleInput = (data) => {
      if (data === "a") done("approve");
      else if (data === "r") done("reject");
      else if (data === "c") done("custom");
      else if (matchesKey(data, Key.escape)) done("reject");
    };
    return text;
  });
}

export function setupDiffApproval(pi: ExtensionAPI, state: ModeState): void {
  pi.on("tool_call", async (event, ctx) => {
    // Only gate file mutations.
    if (event.toolName !== "edit" && event.toolName !== "write") return;
    // acceptEdits: auto-approve. plan: already blocked by tool allow-list. Only gate `default`.
    if (state.current() !== "default") return;
    if (!ctx.hasUI) return; // non-interactive: let host policy decide

    let diffText: string;
    if (isToolCallEventType("edit", event)) {
      diffText = await buildEditDiff(event.input.path, event.input.edits as EditOp[], ctx.cwd);
    } else if (isToolCallEventType("write", event)) {
      diffText = await buildWriteDiff(event.input.path, event.input.content, ctx.cwd);
    } else {
      return;
    }

    const decision = await askDecision(ctx, diffText);
    if (decision === "approve") return; // allow

    if (decision === "reject") {
      return {
        block: true,
        reason: "User rejected this edit. Do not retry the same change; continue with other work or ask how to proceed.",
      };
    }

    // custom: collect feedback, block this edit, feed the text back to the model.
    const feedback = await ctx.ui.editor("Feedback for the agent:", "");
    return {
      block: true,
      reason: feedback?.trim()
        ? `User rejected this edit with feedback: ${feedback.trim()}`
        : "User rejected this edit.",
    };
  });
}
