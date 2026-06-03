import { parsePatch } from "./parse.js";
import { applyEdits } from "./apply.js";
import { computeFileHash } from "./format.js";
import { buildView } from "./view.js";
import { threeWayMerge } from "./merge.js";

export interface PreparedFile { path: string; oldContent: string; newContent: string; newView: string; recovered: boolean; }
export type PrepareResult =
  | { ok: true; files: PreparedFile[] }
  | { ok: false; error: string };

/** Look up the content a stale tag was minted from, for 3-way recovery. */
export type Recover = (path: string, tag: string) => string | undefined;

/**
 * Parse → validate file tag → apply. Pure: file IO is injected.
 * On a stale tag, if `recover` yields the snapshot the tag was minted from, attempt a 3-way merge
 * onto the current file instead of rejecting; only a failed/absent recovery rejects.
 */
export function preparePatch(patchText: string, readFile: (path: string) => string, recover?: Recover): PrepareResult {
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
    let newContent: string;
    let recovered = false;

    if (actual === section.tag) {
      // Fresh tag: apply directly.
      try {
        newContent = applyEdits(oldContent, section.edits, section.path);
      } catch (e) {
        return { ok: false, error: `Edit rejected (${section.path}): ${(e as Error).message}` };
      }
    } else {
      // Stale tag: try a 3-way merge from the snapshot the tag was minted from.
      const base = recover?.(section.path, section.tag);
      let merged: string | undefined;
      if (base !== undefined) {
        try {
          const intended = applyEdits(base, section.edits, section.path);
          const r = threeWayMerge(base, oldContent, intended);
          if (r.ok) merged = r.content;
        } catch {
          merged = undefined;
        }
      }
      if (merged === undefined) {
        return {
          ok: false,
          error:
            `Edit rejected (${section.path}): file changed between read and edit. ` +
            `Section is bound to #${section.tag}, but the current file hashes to #${actual}. ` +
            `Re-read the file with \`read\` to copy a current ¶path#tag header before retrying — never invent or reuse a tag.`,
        };
      }
      newContent = merged;
      recovered = true;
    }

    files.push({ path: section.path, oldContent, newContent, newView: buildView(section.path, newContent), recovered });
  }
  return { ok: true, files };
}
