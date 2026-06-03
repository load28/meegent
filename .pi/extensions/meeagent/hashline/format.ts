export const HL_FILE_PREFIX = "¶";
export const HL_FILE_HASH_SEP = "#";
export const HL_LINE_BODY_SEP = ":";
export const HL_FILE_HASH_LENGTH = 4;

/** Strip trailing horizontal whitespace + CR per line (CRLF-agnostic, display-trim safe). */
export function normalizeFileHashText(text: string): string {
  return text.replace(/[ \t\r]+(?=\n|$)/g, "");
}

// xxHash32 (seed 0), pure TS. The tag is internal/session-local — byte-parity with oh-my-pi
// is not required, but we replicate the algorithm for format fidelity.
const P1 = 0x9e3779b1, P2 = 0x85ebca77, P3 = 0xc2b2ae3d, P4 = 0x27d4eb2f, P5 = 0x165667b1;
const rotl = (x: number, r: number): number => (x << r) | (x >>> r);
const round = (acc: number, input: number): number =>
  Math.imul(rotl((acc + Math.imul(input, P2)) | 0, 13), P1) | 0;
const read32 = (b: Uint8Array, i: number): number =>
  (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

function xxHash32(text: string, seed = 0): number {
  const b = new TextEncoder().encode(text);
  const len = b.length;
  let i = 0;
  let h: number;
  if (len >= 16) {
    let v1 = (seed + P1 + P2) | 0;
    let v2 = (seed + P2) | 0;
    let v3 = seed | 0;
    let v4 = (seed - P1) | 0;
    for (; i <= len - 16; i += 16) {
      v1 = round(v1, read32(b, i));
      v2 = round(v2, read32(b, i + 4));
      v3 = round(v3, read32(b, i + 8));
      v4 = round(v4, read32(b, i + 12));
    }
    h = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) | 0;
  } else {
    h = (seed + P5) | 0;
  }
  h = (h + len) | 0;
  for (; i + 4 <= len; i += 4) {
    h = Math.imul(rotl((h + Math.imul(read32(b, i), P3)) | 0, 17), P4) | 0;
  }
  for (; i < len; i++) {
    h = Math.imul(rotl((h + Math.imul(b[i], P5)) | 0, 11), P1) | 0;
  }
  h ^= h >>> 15;
  h = Math.imul(h, P2);
  h ^= h >>> 13;
  h = Math.imul(h, P3);
  h ^= h >>> 16;
  return h >>> 0;
}

/** 4-hex uppercase whole-file tag over normalized text (low 16 bits of xxHash32). */
export function computeFileHash(text: string): string {
  const low16 = xxHash32(normalizeFileHashText(text), 0) & 0xffff;
  return low16.toString(16).padStart(HL_FILE_HASH_LENGTH, "0").toUpperCase();
}

/** Section header: `¶path#TAG`. */
export function formatHeader(filePath: string, fileHash: string): string {
  return `${HL_FILE_PREFIX}${filePath}${HL_FILE_HASH_SEP}${fileHash}`;
}

/** Numbered line: `LINE:TEXT`. */
export function formatLine(lineNumber: number, line: string): string {
  return `${lineNumber}${HL_LINE_BODY_SEP}${line}`;
}
