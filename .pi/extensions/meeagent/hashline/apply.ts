import type { Edit } from "./parse.js";

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

/** Sort key: process larger original positions first so indices stay stable. */
function anchorOf(e: Edit): number {
  if (e.kind === "replace" || e.kind === "delete") return e.start;
  switch (e.pos.type) {
    case "before": return e.pos.line - 0.5; // before N sits just above N
    case "after": return e.pos.line + 0.5;
    case "head": return 0.5;
    case "tail": return Number.MAX_SAFE_INTEGER;
  }
}

/** Apply hashline edits to file content. Line numbers refer to the ORIGINAL file. */
export function applyEdits(content: string, edits: Edit[]): string {
  const lines = toLines(content);
  const len = lines.length;
  // Bounds-check against the original before mutating.
  for (const e of edits) {
    if (e.kind === "replace" || e.kind === "delete") { validate(e.start, len); validate(e.end, len); }
    if (e.kind === "insert" && (e.pos.type === "before" || e.pos.type === "after")) validate(e.pos.line, len);
  }
  // Apply bottom-up so earlier edits' indices are unaffected.
  const ordered = [...edits].sort((a, b) => anchorOf(b) - anchorOf(a));
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
