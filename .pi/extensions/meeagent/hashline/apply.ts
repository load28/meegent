import type { Edit } from "./parse.js";
import { resolveBlock } from "./block.js";

/** An edit with block ops already resolved to concrete line ranges. */
type ResolvedEdit = Exclude<Edit, { kind: "replace-block" } | { kind: "delete-block" }>;

function trailingNewline(content: string): boolean {
  return content.length === 0 || content.endsWith("\n");
}

function toLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function validate(line: number, len: number): void {
  if (line < 1 || line > len) throw new Error(`Line ${line} out of bounds (1..${len})`);
}

/**
 * Boundary auto-repair: a model often echoes the line just before/after a `replace` range into
 * the body (most commonly a duplicated closing brace). Strip body lines that exactly echo the
 * adjacent unchanged lines so the replacement doesn't duplicate them. Heuristic: applied only when
 * an exact adjacency echo is present. `original` is the pristine (pre-edit) line array.
 */
export function repairReplaceBody(original: string[], start: number, end: number, body: string[]): string[] {
  let b = body;
  const before = original[start - 2]; // line immediately before the range (0-based)
  const after = original[end]; // line immediately after the range (0-based)
  while (b.length > 0 && before !== undefined && b[0] === before) b = b.slice(1);
  while (b.length > 0 && after !== undefined && b[b.length - 1] === after) b = b.slice(0, -1);
  return b;
}

/** Sort key: process larger original positions first so indices stay stable. */
function anchorOf(e: Edit): number {
  if (e.kind === "replace" || e.kind === "delete") return e.start;
  if (e.kind === "replace-block" || e.kind === "delete-block") return e.at;
  switch (e.pos.type) {
    case "before": return e.pos.line - 0.5; // before N sits just above N
    case "after": return e.pos.line + 0.5;
    case "head": return 0.5;
    case "tail": return Number.MAX_SAFE_INTEGER;
  }
}

/** Apply hashline edits to file content. Line numbers refer to the ORIGINAL file. */
export function applyEdits(content: string, edits: Edit[]): string {
  const original = toLines(content);
  const lines = original.slice();
  const len = original.length;
  // Bounds-check against the original before mutating.
  for (const e of edits) {
    if (e.kind === "replace" || e.kind === "delete") { validate(e.start, len); validate(e.end, len); }
    if (e.kind === "replace-block" || e.kind === "delete-block") validate(e.at, len);
    if (e.kind === "insert" && (e.pos.type === "before" || e.pos.type === "after")) validate(e.pos.line, len);
  }
  // Resolve block ops to concrete ranges against the pristine original.
  const resolved: ResolvedEdit[] = edits.map((e): ResolvedEdit => {
    if (e.kind === "replace-block") {
      const { start, end } = resolveBlock(original, e.at);
      return { kind: "replace", start, end, lines: e.lines };
    }
    if (e.kind === "delete-block") {
      const { start, end } = resolveBlock(original, e.at);
      return { kind: "delete", start, end };
    }
    return e;
  });
  // Repair replace bodies against the pristine original (strip duplicated adjacent lines).
  const prepared: ResolvedEdit[] = resolved.map((e) =>
    e.kind === "replace" ? { ...e, lines: repairReplaceBody(original, e.start, e.end, e.lines) } : e,
  );
  // Apply bottom-up so earlier edits' indices are unaffected.
  const ordered = [...prepared].sort((a, b) => anchorOf(b) - anchorOf(a));
  for (const e of ordered) {
    if (e.kind === "replace") {
      lines.splice(e.start - 1, e.end - e.start + 1, ...e.lines);
    } else if (e.kind === "delete") {
      lines.splice(e.start - 1, e.end - e.start + 1);
    } else {
      const at =
        e.pos.type === "head" ? 0 :
        e.pos.type === "tail" ? lines.length :
        e.pos.type === "before" ? e.pos.line - 1 : e.pos.line;
      lines.splice(at, 0, ...e.lines);
    }
  }
  return lines.join("\n") + (trailingNewline(content) ? "\n" : "");
}
