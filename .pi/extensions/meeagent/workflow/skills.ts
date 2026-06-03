/** Load the markdown skill instruction for a workflow phase (read once, from disk). */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export type SkillName = "brainstorming" | "writing-plans" | "tdd" | "code-review";

const cache = new Map<SkillName, string>();

export function loadSkill(name: SkillName): string {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  let text = "";
  try {
    text = readFileSync(join(here, "skills", `${name}.md`), "utf8");
  } catch {
    text = "";
  }
  cache.set(name, text);
  return text;
}
