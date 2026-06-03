import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawnSync } from "node:child_process";
import { planGitView, type GitViewMode } from "./plan.js";

/** True if `name` resolves on PATH (POSIX `command -v`). */
function hasBinary(name: string): boolean {
  return spawnSync("command", ["-v", name], { shell: "/bin/sh", stdio: "ignore" }).status === 0;
}

/**
 * `/git` — open lazygit instead of the git CLI.
 *   `/git`        → full-screen lazygit (new tmux window, screen switches)
 *   `/git split`  → lazygit in a right-hand tmux pane (meeagent stays on the left)
 * Requires running inside tmux (the launcher auto-wraps interactive sessions).
 */
export function setupGit(pi: ExtensionAPI): void {
  pi.registerCommand("git", {
    description: "lazygit 열기 — '/git' 풀스크린 전환, '/git split' 오른쪽 분할 (tmux 필요)",
    handler: async (args, ctx) => {
      const mode: GitViewMode = args.trim() === "split" ? "split" : "full";
      const plan = planGitView({
        mode,
        cwd: ctx.cwd,
        tmux: !!process.env.TMUX,
        lazygit: hasBinary("lazygit"),
      });
      if (!plan.ok) {
        if (ctx.hasUI) ctx.ui.notify(plan.message, "warning");
        return;
      }
      // tmux returns immediately after creating the window/pane, so this never blocks
      // and never fights pi-tui for the terminal.
      const res = spawnSync(plan.argv[0], plan.argv.slice(1), { stdio: "ignore" });
      if ((res.status ?? 1) !== 0 && ctx.hasUI)
        ctx.ui.notify(`git 화면 열기 실패: ${res.error?.message ?? `exit ${res.status}`}`, "error");
    },
  });
}
