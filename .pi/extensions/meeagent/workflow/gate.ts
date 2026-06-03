/**
 * Pure decision helpers that turn three of the workflow's "trust the prompt"
 * guarantees into runtime-enforceable ones. The orchestration in
 * setup-workflow.ts wires them; keeping the logic here keeps it unit-testable.
 *
 *  - isDocPath        — the only writes the brainstorm/plan HARD-GATE permits
 *                       (design/plan docs). Every other edit is code and blocked,
 *                       so "no implementation before design approval" is enforced
 *                       by the tool gate, not merely requested in the skill text.
 *  - isTaskComplete   — task-boundary signal so review runs once per finished task
 *                       instead of after every execute turn (premature reviews).
 *  - decideReviewOutcome — caps the fix/re-review loop: a cheap implementer that
 *                       cannot satisfy the premium reviewer escalates to the human
 *                       instead of burning premium-review budget forever.
 *  - lastAssistantText — extract the latest assistant text from an agent_end
 *                       message list (shape kept loose so it stays pi-independent).
 */

/** Marker the implementer prints when the current task's TDD cycle is complete. */
export const TASK_COMPLETE_MARKER = "[[TASK-COMPLETE]]";

/** Design/plan docs the brainstorm/plan HARD-GATE may write; all other edits are code. */
export function isDocPath(path: string): boolean {
  const p = path
    .replace(/^@/, "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
  return p.startsWith("docs/superpowers/specs/") || p.startsWith("docs/superpowers/plans/");
}

/** True when the implementer signalled the current task's TDD cycle is complete. */
export function isTaskComplete(text: string): boolean {
  return text.includes(TASK_COMPLETE_MARKER);
}

export type ReviewOutcome = "advance" | "retry" | "halt";

/**
 * Decide what to do after a review verdict.
 *   - pass                              → "advance" (next task)
 *   - fail & retries left               → "retry"   (re-inject feedback)
 *   - fail & retries exhausted          → "halt"    (stop auto-loop, ask the human)
 * `retriesUsed` is how many fix attempts THIS task has already consumed.
 */
export function decideReviewOutcome(pass: boolean, retriesUsed: number, maxRetries: number): ReviewOutcome {
  if (pass) return "advance";
  return retriesUsed < maxRetries ? "retry" : "halt";
}

/** Minimal structural view of an agent message (role + text/other content parts). */
interface MessageLike {
  role?: string;
  content?: unknown;
}

/** Joined text of the most recent assistant message, or "" if there is none. */
export function lastAssistantText(messages: readonly unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as MessageLike;
    if (m?.role !== "assistant" || !Array.isArray(m.content)) continue;
    return m.content
      .filter((p): p is { type: string; text: string } => {
        const part = p as { type?: unknown; text?: unknown };
        return part?.type === "text" && typeof part.text === "string";
      })
      .map((p) => p.text)
      .join("\n");
  }
  return "";
}
