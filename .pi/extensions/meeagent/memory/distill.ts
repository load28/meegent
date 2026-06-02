import { parseFacts } from "./facts.js";
import { mergeFacts } from "./inject.js";

const DISTILL_SYSTEM = `You extract durable, reusable engineering knowledge from a developer's work logs.
Output one fact per line, each prefixed with a scope tag:
- [project] for knowledge true only of THIS codebase (its libraries, conventions, architecture, routes).
- [global] for knowledge that generalizes across projects (language/paradigm patterns, the user's preferences and style).
Be concise. Omit anything trivial or one-off. Output only tagged lines, nothing else.`;

export interface DistillDeps {
  rawLogs: string;
  projectMemoryFile: string;
  globalMemoryFile: string;
  maxChars: number;
  runLLM: (system: string, user: string) => Promise<string>;
  read: (file: string) => string;
  write: (file: string, content: string) => void;
}

export interface DistillResult { factCount: number; }

/** Distill accumulated raw logs into tagged facts, merged into the two MEMORY tiers. */
export async function distillProject(deps: DistillDeps): Promise<DistillResult> {
  if (!deps.rawLogs.trim()) return { factCount: 0 };

  const output = await deps.runLLM(DISTILL_SYSTEM, deps.rawLogs);
  const facts = parseFacts(output);
  if (facts.length === 0) return { factCount: 0 };

  const projectFacts = facts.filter((f) => f.scope === "project").map((f) => f.text);
  const globalFacts = facts.filter((f) => f.scope === "global").map((f) => f.text);

  if (projectFacts.length > 0) {
    deps.write(deps.projectMemoryFile, mergeFacts(deps.read(deps.projectMemoryFile), projectFacts, deps.maxChars));
  }
  if (globalFacts.length > 0) {
    deps.write(deps.globalMemoryFile, mergeFacts(deps.read(deps.globalMemoryFile), globalFacts, deps.maxChars));
  }
  return { factCount: facts.length };
}
