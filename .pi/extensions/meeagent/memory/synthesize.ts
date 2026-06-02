const SYNTH_SYSTEM = `You distill cross-project engineering wisdom for a single developer.
Given memory notes from several of their projects, output a concise bullet list of knowledge that
GENERALIZES across projects (language/paradigm patterns, recurring preferences, durable principles).
Drop project-specific details. Merge duplicates. Output only the bullet list.`;

export interface SynthDeps {
  projectMemories: string[];
  currentGlobal: string;
  maxChars: number;
  runLLM: (system: string, user: string) => Promise<string>;
  writeGlobal: (content: string) => void;
}

export interface SynthResult { updated: boolean; }

/** Synthesize the global MEMORY from the set of project memories. */
export async function synthesizeGlobal(deps: SynthDeps): Promise<SynthResult> {
  if (deps.projectMemories.length === 0) return { updated: false };

  const user = `Current global memory:\n${deps.currentGlobal || "(empty)"}\n\nProject memories:\n${deps.projectMemories.join("\n\n---\n\n")}`;
  const output = (await deps.runLLM(SYNTH_SYSTEM, user)).trim();
  if (!output) return { updated: false };

  deps.writeGlobal(output.slice(0, deps.maxChars));
  return { updated: true };
}
