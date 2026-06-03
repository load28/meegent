import { describe, it, expect } from "vitest";
import { planGitView } from "../../.pi/extensions/meeagent/git/plan.js";

describe("planGitView", () => {
  const cwd = "/home/user/proj";

  it("full mode opens lazygit in a new tmux window", () => {
    const p = planGitView({ mode: "full", cwd, tmux: true, lazygit: true });
    expect(p).toEqual({
      ok: true,
      argv: ["tmux", "new-window", "-c", cwd, "-n", "lazygit", "lazygit"],
    });
  });

  it("split mode opens lazygit in a right-hand tmux pane", () => {
    const p = planGitView({ mode: "split", cwd, tmux: true, lazygit: true });
    expect(p).toEqual({
      ok: true,
      argv: ["tmux", "split-window", "-h", "-c", cwd, "lazygit"],
    });
  });

  it("passes cwd straight after the -c flag", () => {
    const weird = "/tmp/a b/repo";
    const full = planGitView({ mode: "full", cwd: weird, tmux: true, lazygit: true });
    const split = planGitView({ mode: "split", cwd: weird, tmux: true, lazygit: true });
    if (!full.ok || !split.ok) throw new Error("expected ok");
    expect(full.argv[full.argv.indexOf("-c") + 1]).toBe(weird);
    expect(split.argv[split.argv.indexOf("-c") + 1]).toBe(weird);
  });

  it("fails when not inside tmux", () => {
    const p = planGitView({ mode: "full", cwd, tmux: false, lazygit: true });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.message).toContain("tmux");
  });

  it("fails when lazygit is not installed", () => {
    const p = planGitView({ mode: "split", cwd, tmux: true, lazygit: false });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.message).toContain("lazygit");
  });

  it("checks tmux before lazygit", () => {
    // Both missing → tmux message wins (tmux is the prerequisite).
    const p = planGitView({ mode: "full", cwd, tmux: false, lazygit: false });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.message).toContain("tmux");
  });
});
