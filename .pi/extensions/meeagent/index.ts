import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createModeState } from "./mode-state.js";
import { setupPermissionMode } from "./permission-mode.js";
import { setupPlanMode } from "./plan-mode.js";
import { setupDiffApproval } from "./diff-approval.js";

export default function meeagent(pi: ExtensionAPI): void {
  const state = createModeState();
  setupPermissionMode(pi, state);
  setupPlanMode(pi, state);
  setupDiffApproval(pi, state);

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.notify("meeagent ready", "info");
  });
}
