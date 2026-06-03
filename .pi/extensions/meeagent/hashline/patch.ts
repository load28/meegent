import { parsePatch } from "./parse.js";
import { applyEdits } from "./apply.js";
import { computeFileHash } from "./format.js";
import { buildView } from "./view.js";

export interface PreparedFile { path: string; oldContent: string; newContent: string; newView: string; }
export type PrepareResult =
  | { ok: true; files: PreparedFile[] }
  | { ok: false; error: string };

/** Parse → validate file tag (stale rejection) → apply. Pure: file IO is injected. */
export function preparePatch(patchText: string, readFile: (path: string) => string): PrepareResult {
  let parsed;
  try {
    parsed = parsePatch(patchText);
  } catch (e) {
    return { ok: false, error: `Patch parse error: ${(e as Error).message}` };
  }

  const files: PreparedFile[] = [];
  for (const section of parsed.sections) {
    let oldContent: string;
    try {
      oldContent = readFile(section.path);
    } catch {
      return { ok: false, error: `Edit rejected (${section.path}): file not found. Use \`write\` to create new files.` };
    }

    const actual = computeFileHash(oldContent);
    if (actual !== section.tag) {
      return {
        ok: false,
        error:
          `Edit rejected (${section.path}): file changed between read and edit. ` +
          `Section is bound to #${section.tag}, but the current file hashes to #${actual}. ` +
          `Re-read the file with \`read\` to copy a current ¶path#tag header before retrying — never invent or reuse a tag.`,
      };
    }

    let newContent: string;
    try {
      newContent = applyEdits(oldContent, section.edits);
    } catch (e) {
      return { ok: false, error: `Edit rejected (${section.path}): ${(e as Error).message}` };
    }

    files.push({ path: section.path, oldContent, newContent, newView: buildView(section.path, newContent) });
  }
  return { ok: true, files };
}
