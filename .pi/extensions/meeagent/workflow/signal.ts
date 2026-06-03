/**
 * The compressed reporting boundary between the implementer tier and the
 * orchestrator (section 8.2 of the cost/architecture strategy).
 *
 * The implementer closes its implement → verify → refine loop locally and surfaces
 * ONLY a fixed-schema signal to the orchestrator — never the file bodies, the
 * intermediate retries, or the passing-test logs. Constraining the boundary to
 * this schema is what structurally blocks raw-context leakage (and the token cost
 * of re-feeding it through the premium orchestrator):
 *
 *   status        — complete | blocked | failed
 *   changed_files — paths touched (the integration review's cross-file surface)
 *   summary       — 1–2 lines of what changed
 *   blockers      — what stopped progress (or none)
 *   next          — suggested next step (or none)
 *
 * `parseSignal`/`formatSignal` are pure and unit-tested; setup-workflow parses the
 * signal out of the finished task's reply and accumulates a ledger that the final
 * integration review reads instead of the transcript.
 */

export type SignalStatus = "complete" | "blocked" | "failed";

export interface TaskSignal {
  status: SignalStatus;
  changedFiles: string[];
  summary: string;
  blockers: string[];
  next: string;
}

/** Protocol text appended to the implementer's skill so it emits the schema. */
export const SIGNAL_PROTOCOL =
  "완료 보고(압축 신호)는 오케스트레이터로 넘어가는 유일한 출력이다. 파일 본문·중간 재시도·통과한\n" +
  "테스트 로그를 붙이지 말고, 마지막에 아래 고정 스키마 블록 하나만 출력한다(```signal 펜스 안):\n" +
  "```signal\n" +
  "status: complete | blocked | failed\n" +
  "changed_files:\n" +
  "- 경로/파일.ts\n" +
  "summary: 한두 줄 변경 요약 (바뀐 인터페이스/시그니처/계약이 있으면 명시)\n" +
  "blockers: none | 막힌 결정 지점\n" +
  "next: none | 다음 단계 제안\n" +
  "```";

const STATUSES: readonly SignalStatus[] = ["complete", "blocked", "failed"];

function coerceStatus(raw: string): SignalStatus {
  const s = raw.trim().toLowerCase();
  return (STATUSES as readonly string[]).includes(s) ? (s as SignalStatus) : "complete";
}

/** Items of a YAML-ish `- ` list that follows a `key:` header, until the next key/fence. */
function listItems(lines: string[], start: number): { items: string[]; end: number } {
  const items: string[] = [];
  let i = start;
  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith("- ")) items.push(t.slice(2).trim());
    else if (t === "") continue;
    else break;
  }
  return { items, end: i };
}

/** A `none`/empty value means "no entries"; anything else is a single inline item. */
function inlineList(value: string): string[] {
  const v = value.trim();
  if (v === "" || v.toLowerCase() === "none") return [];
  return [v];
}

/**
 * Parse the first ```signal fenced block (or, failing that, bare labelled lines)
 * into a TaskSignal. Returns undefined when no recognizable signal is present so
 * the caller can fall back to the plain task-complete marker.
 */
export function parseSignal(text: string): TaskSignal | undefined {
  const fence = /```signal\s*\n([\s\S]*?)```/i.exec(text);
  const body = fence ? fence[1] : text;
  const lines = body.split("\n");

  let status: SignalStatus | undefined;
  let summary = "";
  let next = "";
  let changedFiles: string[] = [];
  let blockers: string[] = [];
  let sawKey = false;

  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(status|changed_files|summary|blockers|next)\s*:(.*)$/i.exec(lines[i]);
    if (!m) continue;
    sawKey = true;
    const key = m[1].toLowerCase();
    const inline = m[2].trim();
    if (key === "status") status = coerceStatus(inline);
    else if (key === "summary") summary = inline;
    else if (key === "next") next = inline || "none";
    else if (key === "changed_files") {
      if (inline) changedFiles = inlineList(inline);
      else { const r = listItems(lines, i + 1); changedFiles = r.items; i = r.end - 1; }
    } else if (key === "blockers") {
      if (inline) blockers = inlineList(inline);
      else { const r = listItems(lines, i + 1); blockers = r.items; i = r.end - 1; }
    }
  }

  if (!sawKey || status === undefined) return undefined;
  return { status, changedFiles, summary, blockers, next: next || "none" };
}

/** Render a signal back to the canonical fenced block (for logs / the ledger). */
export function formatSignal(s: TaskSignal): string {
  const files = s.changedFiles.length ? s.changedFiles.map((f) => `- ${f}`).join("\n") : "- (none)";
  const blockers = s.blockers.length ? s.blockers.join("; ") : "none";
  return (
    "```signal\n" +
    `status: ${s.status}\n` +
    `changed_files:\n${files}\n` +
    `summary: ${s.summary}\n` +
    `blockers: ${blockers}\n` +
    `next: ${s.next}\n` +
    "```"
  );
}
