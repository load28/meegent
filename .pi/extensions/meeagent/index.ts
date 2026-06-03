import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createModeState } from "./mode-state.js";
import { setupPermissionMode } from "./permission-mode.js";
import { setupPlanMode } from "./plan-mode.js";
import { setupDiffApproval } from "./diff-approval.js";
import { setupHashline } from "./hashline/setup-hashline.js";
import { setupMemory } from "./memory/setup-memory.js";
import { setupMcp } from "./mcp/setup-mcp.js";
import { setupGit } from "./git/setup-git.js";
import { setupWorkflow } from "./workflow/setup-workflow.js";

export default function meeagent(pi: ExtensionAPI): void {
  const state = createModeState();
  setupPermissionMode(pi, state);
  setupPlanMode(pi, state);
  setupDiffApproval(pi, state);
  setupHashline(pi);
  setupMcp(pi, state);
  setupMemory(pi);
  setupGit(pi);
  setupWorkflow(pi, state);

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.notify("meeagent ready", "info");
  });
}
