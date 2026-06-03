export type InsertPos =
  | { type: "before"; line: number }
  | { type: "after"; line: number }
  | { type: "head" }
  | { type: "tail" };

export type Edit =
  | { kind: "replace"; start: number; end: number; lines: string[] }
  | { kind: "insert"; pos: InsertPos; lines: string[] }
  | { kind: "delete"; start: number; end: number }
  | { kind: "replace-block"; at: number; lines: string[] }
  | { kind: "delete-block"; at: number };

export interface ParsedSection { path: string; tag: string; edits: Edit[]; }
export interface ParsedPatch { sections: ParsedSection[]; }

const HEADER = /^¶([^\s#]+)#([0-9A-F]{4})$/;
const RANGE = /^([1-9]\d*)(?:\.\.([1-9]\d*))?$/;

/** Decode a `+TEXT` body row: bare `+`→"", `++x`→"+x", `+-x`→"-x", else literal text. */
function decodeBody(row: string): string {
  if (!row.startsWith("+")) throw new Error(`Invalid body row (expected +TEXT): ${row}`);
  const rest = row.slice(1);
  if (rest === "") return "";
  if (rest[0] === "+" || rest[0] === "-") return rest; // ++x / +-x → +x / -x
  return rest;
}

function parseRange(s: string): { start: number; end: number } {
  const m = s.trim().match(RANGE);
  if (!m) throw new Error(`Invalid line range: ${s}`);
  const start = Number(m[1]);
  return { start, end: m[2] ? Number(m[2]) : start };
}

/** Parse the hashline patch DSL into sections of edits. Throws on malformed input. */
export function parsePatch(text: string): ParsedPatch {
  const lines = text.replace(/\n$/, "").split("\n");
  if (lines[0] !== "*** Begin Patch") throw new Error("Patch must start with *** Begin Patch");
  if (lines[lines.length - 1] !== "*** End Patch") throw new Error("Patch must end with *** End Patch");

  const sections: ParsedSection[] = [];
  let cur: ParsedSection | null = null;
  let i = 1;
  const collectBody = (): string[] => {
    const body: string[] = [];
    while (i < lines.length - 1 && lines[i].startsWith("+")) body.push(decodeBody(lines[i++]));
    return body;
  };

  while (i < lines.length - 1) {
    const line = lines[i];
    const h = line.match(HEADER);
    if (h) { cur = { path: h[1], tag: h[2], edits: [] }; sections.push(cur); i++; continue; }
    if (!cur) throw new Error(`Expected a ¶path#tag header before: ${line}`);

    let m: RegExpMatchArray | null;
    // Block ops are checked before the generic range ops ("block N" is not a range).
    if ((m = line.match(/^replace block ([1-9]\d*):$/))) {
      i++;
      cur.edits.push({ kind: "replace-block", at: Number(m[1]), lines: collectBody() });
    } else if ((m = line.match(/^delete block ([1-9]\d*)$/))) {
      i++;
      cur.edits.push({ kind: "delete-block", at: Number(m[1]) });
    } else if ((m = line.match(/^replace (.+):$/))) {
      const { start, end } = parseRange(m[1]); i++;
      cur.edits.push({ kind: "replace", start, end, lines: collectBody() });
    } else if ((m = line.match(/^insert (before|after) ([1-9]\d*):$/))) {
      i++;
      cur.edits.push({ kind: "insert", pos: { type: m[1] as "before" | "after", line: Number(m[2]) }, lines: collectBody() });
    } else if (/^insert (head|tail):$/.test(line)) {
      const type = line.includes("head") ? "head" : "tail"; i++;
      cur.edits.push({ kind: "insert", pos: { type } as InsertPos, lines: collectBody() });
    } else if ((m = line.match(/^delete (.+)$/))) {
      const { start, end } = parseRange(m[1]); i++;
      cur.edits.push({ kind: "delete", start, end });
    } else {
      throw new Error(`Unrecognized hashline op (or stray body row): ${line}`);
    }
  }
  return { sections };
}
