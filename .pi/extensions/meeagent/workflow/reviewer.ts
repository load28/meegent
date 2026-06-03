/**
 * Two-stage isolated code review (Superpowers requesting-code-review).
 *
 * The reviewer runs on a premium model via a separate completion and receives a
 * precisely constructed context — task spec + diff + test output — NEVER the
 * session history. Stage 1 (spec compliance) gates Stage 2 (code quality): code
 * quality is only assessed once spec compliance passes.
 *
 * `parseVerdict` is pure and unit-tested; `review`/`reviewTwoStage` call runLLM
 * with the review model and are typecheck-gated.
 */

import type { Model, Api, Usage, CacheRetention } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runLLM } from "../memory/llm.js";

export type Severity = "Critical" | "Important" | "Minor" | "None";
export type ReviewStage = "spec-compliance" | "code-quality";

export interface ReviewIssue {
  severity: Exclude<Severity, "None">;
  text: string;
}

export interface Verdict {
  pass: boolean;
  severity: Severity;
  issues: ReviewIssue[];
}

const RANK: Record<Severity, number> = { None: 0, Minor: 1, Important: 2, Critical: 3 };
const TAG_RE = /\[(critical|important|minor)\]\s*(.*)$/i;

function normalizeSeverity(raw: string): Exclude<Severity, "None"> {
  const s = raw.toLowerCase();
  return s === "critical" ? "Critical" : s === "important" ? "Important" : "Minor";
}

/**
 * Parse a reviewer response into a verdict. Issues are `[Critical|Important|Minor]`
 * tagged lines; pass = no Critical and no Important issues.
 */
export function parseVerdict(text: string): Verdict {
  const issues: ReviewIssue[] = [];
  for (const line of text.split("\n")) {
    const m = TAG_RE.exec(line.trim());
    if (!m) continue;
    issues.push({ severity: normalizeSeverity(m[1]), text: m[2].trim() });
  }
  const severity = issues.reduce<Severity>(
    (acc, i) => (RANK[i.severity] > RANK[acc] ? i.severity : acc),
    "None",
  );
  return { pass: RANK[severity] <= RANK.Minor, severity, issues };
}

export interface ReviewInput {
  taskSpec: string;
  diff: string;
  testOutput: string;
}

/**
 * The shared review context (skill + spec + diff + test output + report format) is
 * the SYSTEM prompt and is byte-identical across both stages. Only the per-stage
 * focus varies, and it goes in the small USER message. This keeps the large,
 * expensive prefix stable so Stage 2 reuses Stage 1's prompt cache (cacheRead)
 * instead of re-billing the whole diff at full input price.
 */
function buildSystem(skill: string, input: ReviewInput): string {
  return (
    `${skill}\n\n` +
    `## Task spec\n${input.taskSpec}\n\n` +
    `## Diff under review\n${input.diff}\n\n` +
    `## Test output\n${input.testOutput}\n\n` +
    `Report issues one per line, each tagged [Critical], [Important], or [Minor]. ` +
    `End with "VERDICT: PASS" if there are no Critical/Important issues, else "VERDICT: FAIL".`
  );
}

function stageFocus(stage: ReviewStage): string {
  return stage === "spec-compliance"
    ? "Stage 1 — SPEC COMPLIANCE: does the diff implement exactly the task spec? Flag over/under-building."
    : "Stage 2 — CODE QUALITY: patterns, edge cases, test coverage, maintainability.";
}

export interface ReviewOptions {
  cacheRetention?: CacheRetention;
  sessionId?: string;
  onUsage?: (usage: Usage) => void;
}

/** Run one review stage on the premium model with isolated, cache-friendly context. */
export async function review(
  ctx: ExtensionContext,
  reviewModel: Model<Api>,
  skill: string,
  stage: ReviewStage,
  input: ReviewInput,
  opts: ReviewOptions = {},
): Promise<Verdict> {
  const text = await runLLM(ctx, buildSystem(skill, input), stageFocus(stage), {
    model: reviewModel,
    ...opts,
  });
  return parseVerdict(text);
}

export interface TwoStageResult {
  pass: boolean;
  stages: { stage: ReviewStage; verdict: Verdict }[];
}

export type StageRunner = (stage: ReviewStage, input: ReviewInput) => Promise<Verdict>;

/**
 * Pure two-stage ordering: spec-compliance gates code-quality (Superpowers red
 * flag — never start code quality before spec compliance passes). Independent of
 * pi/LLM via the injected `runStage`, so it is unit-testable.
 */
export async function orchestrateTwoStage(input: ReviewInput, runStage: StageRunner): Promise<TwoStageResult> {
  const stages: { stage: ReviewStage; verdict: Verdict }[] = [];

  const spec = await runStage("spec-compliance", input);
  stages.push({ stage: "spec-compliance", verdict: spec });
  if (!spec.pass) return { pass: false, stages };

  const quality = await runStage("code-quality", input);
  stages.push({ stage: "code-quality", verdict: quality });
  return { pass: quality.pass, stages };
}

/**
 * Stage 1 gates Stage 2, running each stage on the premium model via runLLM. Both
 * stages share `opts` (same sessionId + cacheRetention), so Stage 2 hits the cache
 * written by Stage 1 for the identical system prefix.
 */
export function reviewTwoStage(
  ctx: ExtensionContext,
  reviewModel: Model<Api>,
  skill: string,
  input: ReviewInput,
  opts: ReviewOptions = {},
): Promise<TwoStageResult> {
  return orchestrateTwoStage(input, (stage, inp) => review(ctx, reviewModel, skill, stage, inp, opts));
}
