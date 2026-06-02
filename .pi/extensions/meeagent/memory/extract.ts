interface TextBlock { type: "text"; text: string; }
interface ToolCallBlock { type: "toolCall"; name: string; input?: { path?: string } }
type Block = TextBlock | ToolCallBlock | { type: string };
export interface Msg { role: string; content?: Block[] | string; }

function textOf(content: Msg["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b): b is TextBlock => (b as Block).type === "text")
    .map((b) => b.text)
    .join(" ")
    .trim();
}

/** Build a compact raw-log summary from a finished prompt's messages. */
export function extractSessionSummary(messages: Msg[]): string {
  const lines: string[] = [];
  const edited = new Set<string>();

  for (const m of messages) {
    if (m.role === "user") {
      const t = textOf(m.content);
      if (t) lines.push(`User: ${t}`);
    }
    if (m.role === "assistant" && Array.isArray(m.content)) {
      for (const b of m.content) {
        const tc = b as ToolCallBlock;
        if (tc.type === "toolCall" && (tc.name === "edit" || tc.name === "write") && tc.input?.path) {
          edited.add(tc.input.path);
        }
      }
    }
  }
  if (edited.size > 0) lines.push(`Edited: ${[...edited].join(", ")}`);
  return lines.join("\n");
}
