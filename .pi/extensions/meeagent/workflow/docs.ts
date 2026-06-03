/**
 * Pure helpers for the Superpowers design/plan documents. File system access is
 * injected by the caller (setup-workflow); these functions only compute paths
 * and transform markdown strings, so they are unit-tested in isolation.
 *
 * Paths mirror the upstream Superpowers convention:
 *   docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md
 *   docs/superpowers/plans/YYYY-MM-DD-<feature>.md
 */

export interface PlanTask {
  index: number;
  title: string;
  done: boolean;
}

/** Lowercase, spaces/slashes → single dash, strip non-alphanumerics, trim dashes. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function designPath(date: string, topic: string): string {
  return `docs/superpowers/specs/${date}-${slug(topic)}-design.md`;
}

export function planPath(date: string, feature: string): string {
  return `docs/superpowers/plans/${date}-${slug(feature)}.md`;
}

const TASK_RE = /^- \[([ xX])\]\s+(.*)$/;

/** Extract `- [ ]` / `- [x]` lines as ordered tasks. */
export function parseTasks(md: string): PlanTask[] {
  const tasks: PlanTask[] = [];
  let index = 0;
  for (const line of md.split("\n")) {
    const m = TASK_RE.exec(line);
    if (!m) continue;
    tasks.push({ index: index++, title: m[2].trim(), done: m[1].toLowerCase() === "x" });
  }
  return tasks;
}

/**
 * Index of the first not-done task (resume point), or `tasks.length` when every
 * task is already checked off. Lets `/workflow build` skip completed work instead
 * of re-running task 0.
 */
export function firstUndoneIndex(tasks: PlanTask[]): number {
  const i = tasks.findIndex((t) => !t.done);
  return i === -1 ? tasks.length : i;
}

/** Mark the nth task (0-based, in document order) as done. No-op if already done or out of range. */
export function markDone(md: string, index: number): string {
  let seen = -1;
  const lines = md.split("\n").map((line) => {
    const m = TASK_RE.exec(line);
    if (!m) return line;
    seen++;
    if (seen === index && m[1].toLowerCase() !== "x") {
      return line.replace(/^- \[ \]/, "- [x]");
    }
    return line;
  });
  return lines.join("\n");
}
