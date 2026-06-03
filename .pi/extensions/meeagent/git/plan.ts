export type GitViewMode = "full" | "split";

export type GitViewPlan =
  | { ok: true; argv: string[] }
  | { ok: false; message: string };

/**
 * Build the tmux argv that opens lazygit, or a reason it can't run. Pure.
 *
 * pi-tui owns the terminal and exposes no way to release/suspend it, so the only
 * safe way to show a full-screen ncurses app (lazygit) is to let tmux manage a
 * separate window/pane. Both forms therefore require running inside tmux.
 */
export function planGitView(opts: {
  mode: GitViewMode;
  cwd: string;
  tmux: boolean; // inside a tmux session ($TMUX set)?
  lazygit: boolean; // lazygit binary on PATH?
}): GitViewPlan {
  if (!opts.tmux)
    return {
      ok: false,
      message: "git 화면은 tmux 안에서만 열 수 있어요. meeagent를 tmux로 실행하세요(런처가 자동 래핑).",
    };
  if (!opts.lazygit)
    return { ok: false, message: "lazygit이 설치돼 있지 않아요. (예: brew install lazygit)" };

  if (opts.mode === "split")
    // Split the current window horizontally → lazygit in a right pane, focus moves to it.
    return { ok: true, argv: ["tmux", "split-window", "-h", "-c", opts.cwd, "lazygit"] };

  // Full-screen: lazygit in a new window (auto-switched). Quitting returns to meeagent.
  return { ok: true, argv: ["tmux", "new-window", "-c", opts.cwd, "-n", "lazygit", "lazygit"] };
}
