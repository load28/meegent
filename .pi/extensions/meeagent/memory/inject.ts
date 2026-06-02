/** Compose the frozen memory block injected into the system prompt. */
export function buildMemoryBlock(projectMemory: string, globalMemory: string): string {
  const parts: string[] = [];
  const g = globalMemory.trim();
  const p = projectMemory.trim();
  if (g) parts.push(`## Global memory (learned across projects)\n${g}`);
  if (p) parts.push(`## Project memory (this project)\n${p}`);
  return parts.join("\n\n");
}

/** Merge new facts as bullet lines into existing MEMORY text, deduped and size-capped. */
export function mergeFacts(existing: string, newFacts: string[], maxChars: number): string {
  const lines = existing.split("\n").map((l) => l.trim()).filter(Boolean);
  const seen = new Set(lines.map((l) => l.replace(/^-\s*/, "")));
  for (const f of newFacts) {
    const t = f.trim();
    if (t && !seen.has(t)) { lines.push(`- ${t}`); seen.add(t); }
  }
  let out = lines.join("\n");
  while (out.length > maxChars && lines.length > 1) {
    lines.shift(); // drop oldest
    out = lines.join("\n");
  }
  return out.length > maxChars ? out.slice(0, maxChars) : out;
}
