/** Compose the frozen memory block injected into the system prompt. */
export function buildMemoryBlock(projectMemory: string, globalMemory: string): string {
  const parts: string[] = [];
  const g = globalMemory.trim();
  const p = projectMemory.trim();
  if (g) parts.push(`## Global memory (learned across projects)\n${g}`);
  if (p) parts.push(`## Project memory (this project)\n${p}`);
  if (!parts.length) return "";
  const preamble = [
    "The following memory contains verified facts learned from previous sessions.",
    "Treat these facts as ground truth:",
    "- Answer questions about this project or preferences directly from memory without reading files.",
    "- Do not re-verify memory facts by inspecting files or running commands unless the user explicitly asks.",
    "- When memory covers the topic at hand, use it as the primary source and respond immediately.",
  ].join("\n");
  return `${preamble}\n\n${parts.join("\n\n")}`;
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
