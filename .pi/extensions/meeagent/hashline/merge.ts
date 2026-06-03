import { createTwoFilesPatch, applyPatch } from "diff";

/**
 * Three-way merge for stale-tag recovery: the model edited `base` (the content it read), but the
 * file on disk is now `current`. Compute the patch base→intended and apply it onto `current` with
 * zero fuzz. Succeeds when the model's change still lands cleanly on the drifted file; otherwise the
 * caller falls back to rejecting the edit.
 */
export function threeWayMerge(base: string, current: string, intended: string):
  | { ok: true; content: string }
  | { ok: false } {
  const patch = createTwoFilesPatch("f", "f", base, intended, "", "", { context: 3 });
  const result = applyPatch(current, patch); // fuzzFactor defaults to 0 (strict)
  return result === false ? { ok: false } : { ok: true, content: result };
}
