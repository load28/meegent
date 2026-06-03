import { resolveBlockTS } from "./treesitter.js";

const OPEN = "([{";
const CLOSE = ")]}";

function indentOf(s: string): number {
  const m = s.match(/^[ \t]*/);
  return m ? m[0].length : 0;
}

/**
 * Resolve a block starting at `startLine` (1-indexed) to a 1-indexed inclusive line range.
 *
 * Prefers tree-sitter (when the language grammar for `path` has been loaded via `ensureLanguage`);
 * otherwise falls back to a dependency-free brace/indentation heuristic.
 */
export function resolveBlock(lines: string[], startLine: number, path?: string): { start: number; end: number } {
  if (startLine < 1 || startLine > lines.length) {
    throw new Error(`Block start ${startLine} out of bounds (1..${lines.length})`);
  }
  if (path) {
    try {
      const ts = resolveBlockTS(path, lines.join("\n"), startLine);
      if (ts) return ts;
    } catch {
      // fall through to the heuristic
    }
  }
  return resolveBlockHeuristic(lines, startLine);
}

/** Brace/indentation block resolver (fallback when tree-sitter is unavailable). */
export function resolveBlockHeuristic(lines: string[], startLine: number): { start: number; end: number } {
  const len = lines.length;
  if (startLine < 1 || startLine > len) throw new Error(`Block start ${startLine} out of bounds (1..${len})`);
  const startIdx = startLine - 1;
  const line = lines[startIdx];

  // Find the last bracket opened (net) on the start line.
  let depthOnLine = 0;
  let opener = -1;
  let openCh = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (OPEN.includes(c)) { depthOnLine++; opener = i; openCh = c; }
    else if (CLOSE.includes(c)) depthOnLine--;
  }

  if (depthOnLine > 0 && opener >= 0) {
    const want = CLOSE[OPEN.indexOf(openCh)];
    let depth = 0;
    for (let idx = startIdx; idx < len; idx++) {
      const l = lines[idx];
      const from = idx === startIdx ? opener : 0;
      for (let i = from; i < l.length; i++) {
        if (l[i] === openCh) depth++;
        else if (l[i] === want) {
          depth--;
          if (depth === 0) return { start: startLine, end: idx + 1 };
        }
      }
    }
    return { start: startLine, end: len }; // unbalanced → run to EOF
  }

  // Indentation block: start line + following more-indented (or interior blank) lines.
  const baseIndent = indentOf(line);
  let end = startIdx;
  for (let idx = startIdx + 1; idx < len; idx++) {
    if (lines[idx].trim() === "") { end = idx; continue; }
    if (indentOf(lines[idx]) > baseIndent) end = idx; else break;
  }
  while (end > startIdx && lines[end].trim() === "") end--; // trim trailing blanks
  return { start: startLine, end: end + 1 };
}
