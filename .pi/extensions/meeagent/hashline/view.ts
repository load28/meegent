import { computeFileHash, formatHeader, formatLine } from "./format.js";

/** Split into lines without a trailing empty element for a final newline. */
function toLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Render the hashline anchor view: header `¶path#TAG` then `LINE:TEXT` rows.
 * `offset` is a 1-indexed start line; `limit` caps the row count. The tag is always
 * the WHOLE-file hash and line numbers are absolute regardless of the window.
 */
export function buildView(path: string, content: string, offset?: number, limit?: number): string {
  const tag = computeFileHash(content);
  const lines = toLines(content);
  const start = Math.max(1, offset ?? 1);
  const end = limit != null ? Math.min(lines.length, start - 1 + limit) : lines.length;
  const rows: string[] = [formatHeader(path, tag)];
  for (let n = start; n <= end; n++) rows.push(formatLine(n, lines[n - 1]));
  return rows.join("\n");
}
