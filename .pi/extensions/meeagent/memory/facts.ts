export type Scope = "project" | "global";
export interface Fact { scope: Scope; text: string; }

const LINE = /^\s*\[(project|global)\]\s*(.+?)\s*$/i;

/** Parse distiller output where each fact line is "[project|global] text". */
export function parseFacts(output: string): Fact[] {
  const facts: Fact[] = [];
  for (const raw of output.split("\n")) {
    const m = raw.match(LINE);
    if (!m) continue;
    const text = m[2].trim();
    if (!text) continue;
    facts.push({ scope: m[1].toLowerCase() as Scope, text });
  }
  return facts;
}
