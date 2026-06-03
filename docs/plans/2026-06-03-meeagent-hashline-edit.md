# meeagent Hashline 편집 — Implementation Plan

> **For agentic workers:** 이 플랜은 task별 `- [ ]` 체크박스로 진행한다. 순수 모듈은 TDD(실패 테스트→구현→통과),
> pi 런타임 wiring은 타입체크 게이트로 검증한다(메모리 플랜과 동일 규율).

**Goal:** oh-my-pi의 hashline 편집을 meeagent에 **동일 포맷**으로 이식한다 — 모델이 `read` 시 `¶PATH#TAG`+`LINE:TEXT`
앵커 뷰를 보고, 단일 `input` 패치 DSL(`replace N..M:` / `insert before|after|head|tail:` / `delete N..M`,
본문 `+TEXT`)로 편집하며, 파일 전체 해시 태그로 stale 편집을 적용 전에 거부한다. 기본 `edit`를 `hashedit`로
교체하고 기존 plan 차단 / default diff 승인 / acceptEdits 자동적용에 편입한다.

**Architecture:** 순수 로직(`format`/`view`/`parse`/`apply`/`patch`)은 pi 비의존 모듈로 분리해 vitest로 단위
테스트한다. pi 훅·툴 wiring(`hashedit-view`/`hashedit-tool`/`setup-hashline`)은 타입체크로 검증한다.
`prepare(patchText, readFile)`(patch.ts)를 **diff 미리보기(diff-approval)와 실제 커밋(execute)이 공유**해
이중 적용 발산을 막는다. block 연산·스냅샷 3-way 복구·경계 자동수선은 **범위 외**(스펙 §7).

**Tech Stack:** Bun + TypeScript, `@earendil-works/pi-coding-agent`/`pi-tui` 0.78, `diff`(기존 의존), vitest.
신규 런타임 의존성 없음(해시는 순수 TS xxHash32).

---

## File Structure

```
.pi/extensions/meeagent/
  index.ts                  # setupHashline(pi, state) 한 줄 추가
  permission-mode.ts        # FULL_TOOLS: edit → hashedit
  diff-approval.ts          # hashedit 분기 추가(patch.prepare로 diff 산출)
  hashline/
    format.ts               # 순수: computeFileHash(xxHash32 low16, 4-hex), 정규화, 헤더/라인 포맷터
    view.ts                 # 순수: buildView(path, content, offset?, limit?) → 헤더+번호 라인
    parse.ts                # 순수: 패치 DSL → 섹션/연산
    apply.ts                # 순수: applyEdits(content, edits) 하단부터 + 경계 검사
    patch.ts                # prepare(patchText, readFile): 파싱→태그검증→적용→{newContent,newView,error}
    hashedit-tool.ts        # defineTool({name:"hashedit"}) execute = prepare+쓰기+갱신뷰
    hashedit-view.ts        # tool_result(read) 훅: 디스크 재계산 앵커 뷰로 content 교체
    setup-hashline.ts       # wiring: registerTool + tool_result 훅 (+ index/permission/diff 연결)
test/hashline/
    format.test.ts  view.test.ts  parse.test.ts  apply.test.ts  patch.test.ts
```

**경계:** `format/view/parse/apply/patch`는 pi import 없는 순수 모듈(단위 테스트). `hashedit-tool/hashedit-view/
setup-hashline`은 pi 런타임에 붙는 얇은 wiring(타입체크 게이트).

---

## Task 1: format.ts — 파일 해시 + 포맷터 (순수, TDD)

**Files:** Create `.pi/extensions/meeagent/hashline/format.ts`; Test `test/hashline/format.test.ts`.

- [ ] **Step 1: 실패하는 테스트**

```typescript
import { describe, it, expect } from "vitest";
import { computeFileHash, normalizeFileHashText, formatHeader, formatLine } from "../../.pi/extensions/meeagent/hashline/format.js";

describe("computeFileHash", () => {
  it("returns a 4-char uppercase hex tag", () => {
    expect(computeFileHash("hello\nworld\n")).toMatch(/^[0-9A-F]{4}$/);
  });
  it("is deterministic", () => {
    expect(computeFileHash("a\nb")).toBe(computeFileHash("a\nb"));
  });
  it("ignores trailing whitespace and CR (display-trim safe)", () => {
    expect(computeFileHash("a   \nb\t\n")).toBe(computeFileHash("a\nb\n"));
    expect(computeFileHash("a\r\nb\r\n")).toBe(computeFileHash("a\nb\n"));
  });
  it("changes when real content changes", () => {
    expect(computeFileHash("a\nb")).not.toBe(computeFileHash("a\nc"));
  });
});

describe("normalizeFileHashText", () => {
  it("strips only trailing horizontal ws / CR per line", () => {
    expect(normalizeFileHashText("  x  \r\n y \n")).toBe("  x\n y\n");
  });
});

describe("formatters", () => {
  it("formats the section header ¶PATH#TAG", () => {
    expect(formatHeader("src/a.ts", "A1B2")).toBe("¶src/a.ts#A1B2");
  });
  it("formats a numbered line LINE:TEXT", () => {
    expect(formatLine(2, "  msg = x")).toBe("2:  msg = x");
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun run test -- format` → FAIL.

- [ ] **Step 3: 구현**

```typescript
export const HL_FILE_PREFIX = "¶";
export const HL_FILE_HASH_SEP = "#";
export const HL_LINE_BODY_SEP = ":";
export const HL_FILE_HASH_LENGTH = 4;

/** Strip trailing horizontal whitespace + CR per line (CRLF-agnostic, display-trim safe). */
export function normalizeFileHashText(text: string): string {
  return text.replace(/[ \t\r]+(?=\n|$)/g, "");
}

// xxHash32 (seed 0), pure TS. Tag is internal/session-local — byte-parity with oh-my-pi
// is not required, but we replicate the algorithm for format fidelity.
const P1 = 0x9e3779b1, P2 = 0x85ebca77, P3 = 0xc2b2ae3d, P4 = 0x27d4eb2f, P5 = 0x165667b1;
const rotl = (x: number, r: number) => (x << r) | (x >>> r);
const round = (acc: number, input: number) => Math.imul(rotl((acc + Math.imul(input, P2)) | 0, 13), P1) | 0;
const read32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

function xxHash32(text: string, seed = 0): number {
  const b = new TextEncoder().encode(text);
  const len = b.length;
  let i = 0, h: number;
  if (len >= 16) {
    let v1 = (seed + P1 + P2) | 0, v2 = (seed + P2) | 0, v3 = seed | 0, v4 = (seed - P1) | 0;
    for (; i <= len - 16; i += 16) {
      v1 = round(v1, read32(b, i));     v2 = round(v2, read32(b, i + 4));
      v3 = round(v3, read32(b, i + 8)); v4 = round(v4, read32(b, i + 12));
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
  h ^= h >>> 15; h = Math.imul(h, P2);
  h ^= h >>> 13; h = Math.imul(h, P3);
  h ^= h >>> 16;
  return h >>> 0;
}

/** 4-hex uppercase whole-file tag over normalized text (low 16 bits). */
export function computeFileHash(text: string): string {
  const low16 = xxHash32(normalizeFileHashText(text), 0) & 0xffff;
  return low16.toString(16).padStart(HL_FILE_HASH_LENGTH, "0").toUpperCase();
}

export function formatHeader(filePath: string, fileHash: string): string {
  return `${HL_FILE_PREFIX}${filePath}${HL_FILE_HASH_SEP}${fileHash}`;
}

export function formatLine(lineNumber: number, line: string): string {
  return `${lineNumber}${HL_LINE_BODY_SEP}${line}`;
}
```

- [ ] **Step 4: 통과 확인** — Run: `bun run test -- format` → PASS. `bun run typecheck` → EXIT 0.

- [ ] **Step 5: 커밋**

```bash
git add .pi/extensions/meeagent/hashline/format.ts test/hashline/format.test.ts
git commit -F - <<'EOF'
feat(hashline): add file-hash tag and ¶PATH#TAG / LINE:TEXT formatters

후행공백 정규화 위 xxHash32 low16 4-hex 파일 태그와 섹션 헤더·번호 라인 포맷터를 추가한다.
EOF
```

---

## Task 2: view.ts — 앵커 뷰 빌더 (순수, TDD)

`read` 결과를 대체할 `¶PATH#TAG` + `LINE:TEXT` 뷰. 부분 read(offset/limit)도 **절대 라인 번호**와
**전체 파일 태그**를 유지한다(태그는 항상 파일 전체 기준).

**Files:** Create `.pi/extensions/meeagent/hashline/view.ts`; Test `test/hashline/view.test.ts`.

- [ ] **Step 1: 실패하는 테스트**

```typescript
import { describe, it, expect } from "vitest";
import { buildView } from "../../.pi/extensions/meeagent/hashline/view.js";

describe("buildView", () => {
  const content = "def greet(name):\n    msg = name\n    print(msg)\n";

  it("renders header + all numbered lines", () => {
    const out = buildView("greet.py", content);
    expect(out.split("\n")[0]).toMatch(/^¶greet\.py#[0-9A-F]{4}$/);
    expect(out).toContain("1:def greet(name):");
    expect(out).toContain("3:    print(msg)");
  });

  it("honors offset/limit but keeps absolute numbers and whole-file tag", () => {
    const full = buildView("greet.py", content);
    const tag = full.split("\n")[0];
    const out = buildView("greet.py", content, 2, 1); // line 2 only
    expect(out.split("\n")[0]).toBe(tag);            // same whole-file tag
    expect(out).toContain("2:    msg = name");
    expect(out).not.toContain("1:def greet");
    expect(out).not.toContain("3:    print");
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun run test -- view` → FAIL.

- [ ] **Step 3: 구현**

```typescript
import { computeFileHash, formatHeader, formatLine } from "./format.js";

/** Split into lines without a trailing empty element for a final newline. */
function toLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Render the hashline anchor view: header `¶path#TAG` then `LINE:TEXT` rows.
 * `offset` is a 1-indexed start line; `limit` caps the row count. The tag is always
 * the WHOLE-file hash and line numbers are absolute regardless of the window.
 */
export function buildView(path: string, content: string, offset?: number, limit?: number): string {
  const tag = computeFileHash(content);
  const lines = toLines(content);
  const start = Math.max(1, offset ?? 1);
  const end = limit != null ? Math.min(lines.length, start - 1 + limit) : lines.length;
  const rows: string[] = [formatHeader(path, tag)];
  for (let n = start; n <= end; n++) rows.push(formatLine(n, lines[n - 1]));
  return rows.join("\n");
}
```

- [ ] **Step 4: 통과 확인** — Run: `bun run test -- view` → PASS. `bun run typecheck` → EXIT 0.

- [ ] **Step 5: 커밋**

```bash
git add .pi/extensions/meeagent/hashline/view.ts test/hashline/view.test.ts
git commit -F - <<'EOF'
feat(hashline): render ¶PATH#TAG anchor view with absolute line numbers

read 결과를 대체할 헤더+번호 라인 뷰를 추가한다. 부분 read도 절대 번호·전체 파일 태그를 유지한다.
EOF
```

---

## Task 3: parse.ts — 패치 DSL 파서 (순수, TDD)

`*** Begin Patch` … `*** End Patch` 안의 `¶path#TAG` 섹션과 연산을 파싱한다. 본문은 `+TEXT`만(`+`만=빈 줄,
`++`/`+-` 이스케이프). 라인 번호는 원본 1-기반.

**Files:** Create `.pi/extensions/meeagent/hashline/parse.ts`; Test `test/hashline/parse.test.ts`.

- [ ] **Step 1: 실패하는 테스트**

```typescript
import { describe, it, expect } from "vitest";
import { parsePatch, type ParsedSection } from "../../.pi/extensions/meeagent/hashline/parse.js";

const wrap = (body: string) => `*** Begin Patch\n${body}\n*** End Patch\n`;

describe("parsePatch", () => {
  it("parses replace/insert/delete with +TEXT bodies", () => {
    const out = parsePatch(wrap(
      "¶a.ts#A1B2\n" +
      "insert after 1:\n+  hi\n" +
      "replace 2..3:\n+  x\n+  y\n" +
      "delete 4"
    ));
    const s = out.sections[0] as ParsedSection;
    expect(s.path).toBe("a.ts");
    expect(s.tag).toBe("A1B2");
    expect(s.edits).toEqual([
      { kind: "insert", pos: { type: "after", line: 1 }, lines: ["  hi"] },
      { kind: "replace", start: 2, end: 3, lines: ["  x", "  y"] },
      { kind: "delete", start: 4, end: 4 },
    ]);
  });

  it("treats bare + as a blank line and unescapes ++ / +-", () => {
    const out = parsePatch(wrap("¶a#0000\ninsert head:\n+\n++keep plus\n+-keep dash"));
    expect((out.sections[0].edits[0] as any).lines).toEqual(["", "+keep plus", "-keep dash"]);
  });

  it("errors on a -old / context body row", () => {
    expect(() => parsePatch(wrap("¶a#0000\nreplace 1..1:\n-old"))).toThrow(/body row/i);
  });

  it("errors without the Begin/End envelope", () => {
    expect(() => parsePatch("¶a#0000\ndelete 1")).toThrow(/Begin Patch/);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun run test -- parse` → FAIL.

- [ ] **Step 3: 구현**

```typescript
export type InsertPos =
  | { type: "before"; line: number }
  | { type: "after"; line: number }
  | { type: "head" }
  | { type: "tail" };

export type Edit =
  | { kind: "replace"; start: number; end: number; lines: string[] }
  | { kind: "insert"; pos: InsertPos; lines: string[] }
  | { kind: "delete"; start: number; end: number };

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
    if ((m = line.match(/^replace (.+):$/))) {
      const { start, end } = parseRange(m[1]); i++;
      cur.edits.push({ kind: "replace", start, end, lines: collectBody() });
    } else if ((m = line.match(/^insert (before|after) ([1-9]\d*):$/))) {
      i++; cur.edits.push({ kind: "insert", pos: { type: m[1] as "before" | "after", line: Number(m[2]) }, lines: collectBody() });
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
```

- [ ] **Step 4: 통과 확인** — Run: `bun run test -- parse` → PASS. `bun run typecheck` → EXIT 0.

- [ ] **Step 5: 커밋**

```bash
git add .pi/extensions/meeagent/hashline/parse.ts test/hashline/parse.test.ts
git commit -F - <<'EOF'
feat(hashline): parse the patch DSL into replace/insert/delete edits

¶path#tag 섹션과 라인 범위 연산을 파싱한다. 본문 +TEXT(+빈줄, ++/+- 이스케이프)만 허용한다.
EOF
```

---

## Task 4: apply.ts — 편집 적용 + 경계 검사 (순수, TDD)

라인 번호는 **원본** 기준. 적용은 **하단부터** 처리해 인덱스가 안 밀린다. 범위 위반은 에러.

**Files:** Create `.pi/extensions/meeagent/hashline/apply.ts`; Test `test/hashline/apply.test.ts`.

- [ ] **Step 1: 실패하는 테스트**

```typescript
import { describe, it, expect } from "vitest";
import { applyEdits } from "../../.pi/extensions/meeagent/hashline/apply.js";
import type { Edit } from "../../.pi/extensions/meeagent/hashline/parse.js";

const c = "L1\nL2\nL3\nL4\n";

describe("applyEdits", () => {
  it("replaces a range with a body of any length (1→2)", () => {
    const edits: Edit[] = [{ kind: "replace", start: 2, end: 2, lines: ["A", "B"] }];
    expect(applyEdits(c, edits)).toBe("L1\nA\nB\nL3\nL4\n");
  });
  it("inserts before/after using ORIGINAL line numbers", () => {
    const edits: Edit[] = [
      { kind: "insert", pos: { type: "before", line: 1 }, lines: ["TOP"] },
      { kind: "insert", pos: { type: "after", line: 4 }, lines: ["BOT"] },
    ];
    expect(applyEdits(c, edits)).toBe("TOP\nL1\nL2\nL3\nL4\nBOT\n");
  });
  it("supports head/tail inserts", () => {
    expect(applyEdits(c, [{ kind: "insert", pos: { type: "head" }, lines: ["H"] }])).toBe("H\nL1\nL2\nL3\nL4\n");
    expect(applyEdits(c, [{ kind: "insert", pos: { type: "tail" }, lines: ["T"] }])).toBe("L1\nL2\nL3\nL4\nT\n");
  });
  it("deletes a range", () => {
    expect(applyEdits(c, [{ kind: "delete", start: 2, end: 3 }])).toBe("L1\nL4\n");
  });
  it("applies multiple edits anchored on original numbers (bottom-up safe)", () => {
    const edits: Edit[] = [
      { kind: "insert", pos: { type: "after", line: 1 }, lines: ["x"] },
      { kind: "delete", start: 3, end: 3 },
    ];
    expect(applyEdits(c, edits)).toBe("L1\nx\nL2\nL4\n");
  });
  it("throws on out-of-bounds line numbers", () => {
    expect(() => applyEdits(c, [{ kind: "replace", start: 9, end: 9, lines: ["z"] }])).toThrow(/bound/i);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun run test -- apply` → FAIL.

- [ ] **Step 3: 구현**

```typescript
import type { Edit } from "./parse.js";

function trailingNewline(content: string): boolean {
  return content.length === 0 || content.endsWith("\n");
}
function toLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
function validate(line: number, len: number): void {
  if (line < 1 || line > len) throw new Error(`Line ${line} out of bounds (1..${len})`);
}

/** Sort key: process larger original positions first so indices stay stable. */
function anchorOf(e: Edit): number {
  if (e.kind === "replace" || e.kind === "delete") return e.start;
  switch (e.pos.type) {
    case "before": return e.pos.line - 0.5; // before N sits just above N
    case "after": return e.pos.line + 0.5;
    case "head": return 0.5;
    case "tail": return Number.MAX_SAFE_INTEGER;
  }
}

/** Apply hashline edits to file content. Line numbers refer to the ORIGINAL file. */
export function applyEdits(content: string, edits: Edit[]): string {
  const lines = toLines(content);
  const len = lines.length;
  // Bounds-check against the original before mutating.
  for (const e of edits) {
    if (e.kind === "replace" || e.kind === "delete") { validate(e.start, len); validate(e.end, len); }
    if (e.kind === "insert" && (e.pos.type === "before" || e.pos.type === "after")) validate(e.pos.line, len);
  }
  // Apply bottom-up so earlier edits' indices are unaffected.
  const ordered = [...edits].sort((a, b) => anchorOf(b) - anchorOf(a));
  for (const e of ordered) {
    if (e.kind === "replace") {
      lines.splice(e.start - 1, e.end - e.start + 1, ...e.lines);
    } else if (e.kind === "delete") {
      lines.splice(e.start - 1, e.end - e.start + 1);
    } else {
      const at =
        e.pos.type === "head" ? 0 :
        e.pos.type === "tail" ? lines.length :
        e.pos.type === "before" ? e.pos.line - 1 : e.pos.line;
      lines.splice(at, 0, ...e.lines);
    }
  }
  return lines.join("\n") + (trailingNewline(content) ? "\n" : "");
}
```

- [ ] **Step 4: 통과 확인** — Run: `bun run test -- apply` → PASS. `bun run typecheck` → EXIT 0.

- [ ] **Step 5: 커밋**

```bash
git add .pi/extensions/meeagent/hashline/apply.ts test/hashline/apply.test.ts
git commit -F - <<'EOF'
feat(hashline): apply edits bottom-up against original line numbers

원본 라인 번호 기준으로 하단부터 replace/insert/delete를 적용하고 범위 위반을 거부한다.
EOF
```

---

## Task 5: patch.ts — 준비/검증(stale)/적용 통합 (TDD, readFile 주입)

파싱 → **파일 태그 검증(stale 거부)** → 적용. diff 미리보기와 실제 커밋이 공유하는 단일 진입점.
`readFile`을 주입해 순수 테스트한다.

**Files:** Create `.pi/extensions/meeagent/hashline/patch.ts`; Test `test/hashline/patch.test.ts`.

- [ ] **Step 1: 실패하는 테스트**

```typescript
import { describe, it, expect } from "vitest";
import { preparePatch } from "../../.pi/extensions/meeagent/hashline/patch.js";
import { computeFileHash } from "../../.pi/extensions/meeagent/hashline/format.js";

const file = "L1\nL2\nL3\n";
const tag = computeFileHash(file);

describe("preparePatch", () => {
  it("applies when the tag matches and returns new content + refreshed view", () => {
    const patch = `*** Begin Patch\n¶a.ts#${tag}\nreplace 2..2:\n+X\n*** End Patch\n`;
    const res = preparePatch(patch, () => file);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.files[0].newContent).toBe("L1\nX\nL3\n");
      expect(res.files[0].newView.split("\n")[0]).toMatch(/^¶a\.ts#[0-9A-F]{4}$/);
      expect(res.files[0].newView).toContain("2:X");
    }
  });

  it("rejects a stale tag before applying", () => {
    const patch = `*** Begin Patch\n¶a.ts#0000\ndelete 1\n*** End Patch\n`;
    const res = preparePatch(patch, () => file);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/changed|stale|hash|re-read/i);
  });

  it("reports a parse error", () => {
    const res = preparePatch("garbage", () => file);
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun run test -- patch` → FAIL.

- [ ] **Step 3: 구현**

```typescript
import { parsePatch } from "./parse.js";
import { applyEdits } from "./apply.js";
import { computeFileHash } from "./format.js";
import { buildView } from "./view.js";

export interface PreparedFile { path: string; oldContent: string; newContent: string; newView: string; }
export type PrepareResult =
  | { ok: true; files: PreparedFile[] }
  | { ok: false; error: string };

/** Parse → validate file tag (stale rejection) → apply. Pure: file IO is injected. */
export function preparePatch(patchText: string, readFile: (path: string) => string): PrepareResult {
  let parsed;
  try { parsed = parsePatch(patchText); }
  catch (e) { return { ok: false, error: `Patch parse error: ${(e as Error).message}` }; }

  const files: PreparedFile[] = [];
  for (const section of parsed.sections) {
    let oldContent: string;
    try { oldContent = readFile(section.path); }
    catch { return { ok: false, error: `Edit rejected (${section.path}): file not found. Use \`write\` to create new files.` }; }

    const actual = computeFileHash(oldContent);
    if (actual !== section.tag) {
      return {
        ok: false,
        error:
          `Edit rejected (${section.path}): file changed between read and edit. ` +
          `Section is bound to #${section.tag}, but the current file hashes to #${actual}. ` +
          `Re-read the file with \`read\` to copy a current ¶path#tag header before retrying — never invent or reuse a tag.`,
      };
    }

    let newContent: string;
    try { newContent = applyEdits(oldContent, section.edits); }
    catch (e) { return { ok: false, error: `Edit rejected (${section.path}): ${(e as Error).message}` }; }

    files.push({ path: section.path, oldContent, newContent, newView: buildView(section.path, newContent) });
  }
  return { ok: true, files };
}
```

- [ ] **Step 4: 통과 확인** — Run: `bun run test -- patch` → PASS. `bun run typecheck` → EXIT 0.

- [ ] **Step 5: 커밋**

```bash
git add .pi/extensions/meeagent/hashline/patch.ts test/hashline/patch.test.ts
git commit -F - <<'EOF'
feat(hashline): prepare patches with stale-tag rejection and refreshed view

파싱→파일 태그 검증(불일치 시 적용 전 거부)→적용을 묶고 새 ¶path#tag 뷰를 돌려준다.
EOF
```

---

## Task 6: hashedit-view.ts — read 결과를 앵커 뷰로 교체 (wiring, 타입체크 게이트)

`tool_result`(read) 훅에서 디스크 내용을 재계산해 `¶PATH#TAG`+`LINE:TEXT`로 `content`를 교체한다.
바이너리/이미지·읽기 실패는 건드리지 않는다.

**Files:** Create `.pi/extensions/meeagent/hashline/hashedit-view.ts`.

> **타입 확인 필요(게이트):** `ReadToolCallEvent`/read `tool_result`의 정확한 필드(입력 `path`,
> 선택적 `offset`/`limit`, 결과 텍스트 접근). 0.78 타입에 맞춰 조정하고, 안 맞으면 BLOCKED로 정확한 에러 보고.

- [ ] **Step 1: 구현**

```typescript
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildView } from "./view.js";

function looksBinary(s: string): boolean {
  return s.includes(" ");
}

/** Replace `read` output with the hashline anchor view so the model can author patches. */
export function setupHashlineView(pi: ExtensionAPI): void {
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "read") return;
    const input = event.input as { path?: string; offset?: number; limit?: number };
    if (!input?.path) return;
    let content: string;
    try { content = readFileSync(resolve(ctx.cwd, input.path.replace(/^@/, "")), "utf8"); }
    catch { return; } // unreadable → leave host output untouched
    if (looksBinary(content)) return;
    const view = buildView(input.path, content, input.offset, input.limit);
    return { content: [{ type: "text", text: view }] };
  });
}
```

- [ ] **Step 2: 타입체크** — Run: `bun run typecheck` → EXIT 0. (`tool_result` 핸들러 반환 `{content}`,
  read event `input` 형태 검증.) 에러 시 BLOCKED 보고.

- [ ] **Step 3: 커밋**

```bash
git add .pi/extensions/meeagent/hashline/hashedit-view.ts
git commit -F - <<'EOF'
feat(hashline): rewrite read output as the ¶PATH#TAG anchor view

tool_result(read) 훅에서 파일을 재계산해 헤더+번호 라인 뷰로 교체한다(텍스트 파일만).
EOF
```

---

## Task 7: hashedit-tool.ts — hashedit 툴 + 모델 안내문 (wiring, 타입체크 게이트)

`defineTool`로 `hashedit`를 정의한다. `execute`는 `preparePatch`로 적용해 디스크에 쓰고, 응답에 **새
`¶PATH#TAG`+갱신 뷰**(재접지)를 돌려준다. 툴 `description`/`promptGuidelines`에 oh-my-pi `prompt.md`를
요약한 사용 규칙을 싣는다.

**Files:** Create `.pi/extensions/meeagent/hashline/hashedit-tool.ts`.

> **타입 확인 필요(게이트):** `defineTool`의 `parameters`는 TypeBox `TSchema`다 — `{ input: string }`를
> 만들 `Type.Object({ input: Type.String() })`의 import 출처(pi 재노출 or `@sinclair/typebox`),
> `execute(toolCallId, params, signal, onUpdate, ctx)` 시그니처, `AgentToolResult` 반환 형태를
> 0.78 타입으로 확정. 안 맞으면 BLOCKED 보고.

- [ ] **Step 1: 구현(초안 — 타입은 게이트에서 확정)**

```typescript
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Type } from "@sinclair/typebox"; // ← import 출처는 타입체크에서 확정
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { preparePatch } from "./patch.js";

const DESCRIPTION = [
  "Edit existing files via hashline patches. Anchor on the `¶PATH#TAG` header and 1-indexed line",
  "numbers from your most recent `read`. The whole patch goes in `input`:",
  "",
  "*** Begin Patch",
  "¶path/to/file#TAG",
  "replace 12..14:",
  "+  new line content",
  "insert after 20:",
  "+  appended line",
  "delete 30..31",
  "*** End Patch",
  "",
  "Body rows are ONLY `+TEXT` (the final content, verbatim; `+` alone = blank line; `++x`/`+-x` to",
  "emit a literal leading +/-). Never write `-old` or context rows — the range does the deleting.",
  "RE-GROUND after every edit: each applied edit mints a fresh #TAG and renumbers the file, so the",
  "tag/line numbers you just used are dead — use the ¶path#TAG and lines from the edit response or",
  "re-`read`. To create a NEW file use `write`, not hashedit.",
].join("\n");

export function setupHashlineTool(pi: ExtensionAPI): void {
  pi.registerTool(defineTool({
    name: "hashedit",
    label: "Edit",
    description: DESCRIPTION,
    parameters: Type.Object({ input: Type.String() }),
    execute: async (_id, params, _signal, _onUpdate, ctx) => {
      const res = preparePatch(params.input, (p) => readFileSync(resolve(ctx.cwd, p.replace(/^@/, "")), "utf8"));
      if (!res.ok) {
        return { isError: true, content: [{ type: "text", text: res.error }] };
      }
      for (const f of res.files) writeFileSync(resolve(ctx.cwd, f.path.replace(/^@/, "")), f.newContent, "utf8");
      // Re-ground: hand back the fresh tag + renumbered view for each edited file.
      const text = res.files.map((f) => `Edited ${f.path}.\n${f.newView}`).join("\n\n");
      return { content: [{ type: "text", text }] };
    },
  }));
}
```

- [ ] **Step 2: 타입체크** — Run: `bun run typecheck` → EXIT 0. (`defineTool`/`parameters`/`execute`/반환
  형태, `Type` import.) 에러 시 정확한 메시지로 BLOCKED 보고 후, 시그니처에 맞춰 수정.

- [ ] **Step 3: 커밋**

```bash
git add .pi/extensions/meeagent/hashline/hashedit-tool.ts
git commit -F - <<'EOF'
feat(hashline): register the hashedit tool with re-grounding result

preparePatch로 적용·쓰기 후 새 ¶path#tag 뷰를 반환하는 hashedit 툴과 사용 규칙 안내문을 추가한다.
EOF
```

---

## Task 8: 권한·diff 승인·진입점 wiring (타입체크 게이트)

기본 `edit`를 `hashedit`로 교체하고, `diff-approval`에 `hashedit` 분기를 추가하며, `index.ts`에 연결한다.

**Files:** Modify `permission-mode.ts`, `diff-approval.ts`, `index.ts`; Create `hashline/setup-hashline.ts`.

- [ ] **Step 1: permission-mode.ts — edit→hashedit**

```typescript
export const READONLY_TOOLS = ["read", "bash", "grep", "find", "ls", "mcp"];
export const FULL_TOOLS = ["read", "bash", "hashedit", "write", "grep", "find", "ls", "mcp"];
```

- [ ] **Step 2: diff-approval.ts — hashedit 분기**

`tool_call` 가드의 게이트 조건과 diff 산출에 `hashedit`를 추가한다. 패치는 `preparePatch`로 before/after를
구해 기존 `colorizeDiff`/`createTwoFilesPatch`로 카드를 만든다. stale/parse 에러면 그 사유로 차단.

```typescript
import { preparePatch } from "./hashline/patch.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createTwoFilesPatch } from "diff";

// in setupDiffApproval's tool_call handler:
//   if (event.toolName !== "edit" && event.toolName !== "write" && event.toolName !== "hashedit") return;
//   ...
//   if (event.toolName === "hashedit") {
//     const res = preparePatch((event.input as { input: string }).input,
//       (p) => readFileSync(resolve(ctx.cwd, p.replace(/^@/, "")), "utf8"));
//     if (!res.ok) return { block: true, reason: res.error };
//     diffText = res.files.map((f) =>
//       stripPreamble(createTwoFilesPatch(f.path, f.path, f.oldContent, f.newContent, "", "", { context: 3 }))
//     ).join("\n");
//   } else if (isToolCallEventType("edit", event)) { ... existing ... }
```

> 주: `stripPreamble`은 현재 `diff-preview.ts` 내부 함수다 — 재사용을 위해 export하거나, hashedit용 diff
> 빌더(`buildHasheditDiff`)를 `diff-preview.ts`에 추가해 거기서 `preparePatch`를 부르는 편이 깔끔하다.
> 구현 시 `diff-preview.ts`에 `buildHasheditDiff(patchInput, cwd)`를 추가하고 diff-approval은 그걸 호출.

- [ ] **Step 3: setup-hashline.ts — 묶음 등록**

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setupHashlineView } from "./hashedit-view.js";
import { setupHashlineTool } from "./hashedit-tool.js";

/** Register the hashedit tool and the read→anchor-view rewrite. */
export function setupHashline(pi: ExtensionAPI): void {
  setupHashlineTool(pi);
  setupHashlineView(pi);
}
```

- [ ] **Step 4: index.ts — 연결**

`import { setupHashline } from "./hashline/setup-hashline.js";` 추가하고, `setupDiffApproval(pi, state);`
다음 줄에 `setupHashline(pi);`. (diff-approval은 setupHashline보다 먼저/나중 무관 — 훅은 독립.)

- [ ] **Step 5: 타입체크 + 전체 테스트**

Run: `bun run typecheck` → EXIT 0. Run: `bun run test` → 기존 + 신규 hashline 유닛 전부 PASS.
(특히 diff-approval의 hashedit 분기, FULL_TOOLS 변경이 타입·테스트에 영향 없는지.) 에러 시 BLOCKED 보고.

- [ ] **Step 6: 커밋**

```bash
git add .pi/extensions/meeagent/permission-mode.ts .pi/extensions/meeagent/diff-approval.ts \
        .pi/extensions/meeagent/diff-preview.ts .pi/extensions/meeagent/index.ts \
        .pi/extensions/meeagent/hashline/setup-hashline.ts
git commit -F - <<'EOF'
feat(hashline): swap edit→hashedit and gate it through diff approval

FULL_TOOLS에서 edit를 hashedit로 교체하고, diff 승인 가드가 hashedit 패치도 diff 카드로 확인하도록 배선한다.
EOF
```

---

## Task 9: README 갱신 + 엔드투엔드 수동 검증 (마감)

**Files:** Modify `README.md` (기능 섹션에 hashline 한 항목 추가); 검증.

- [ ] **Step 1: README** — "기능"에 hashedit(해시 앵커 편집) 항목 추가: read가 `¶PATH#TAG`+번호 뷰를
  보여주고, `replace/insert/delete` 패치 DSL로 편집하며, 파일 태그 불일치 시 적용 전 거부됨을 1~2줄로.

- [ ] **Step 2: 로드/타입 확인** — Run: `bun run typecheck` → EXIT 0; `bun run test` → 전체 PASS.

- [ ] **Step 3: 수동 e2e(실키 필요)** — 타깃 repo에서 `pi` 실행:
  - `read` 한 파일이 `¶path#TAG` 헤더+`LINE:TEXT`로 보이는지.
  - default 모드: `hashedit`가 적·녹 diff 카드 후 적용되는지(a/r/c).
  - 파일을 외부에서 바꾼 뒤 옛 태그로 편집 → **stale 거부** 메시지가 뜨고, 재`read` 후 성공하는지.
  - plan 모드: `hashedit` 미노출(편집 차단), read 뷰는 정상.
  - acceptEdits: 카드 없이 자동 적용.
  - Expected: oh-my-pi식 앵커 뷰·패치 편집·stale 안전이 meeagent 안전 모델 위에서 동작.

- [ ] **Step 4: 커밋(있으면)**

```bash
git add README.md
git commit -F - <<'EOF'
docs: document hashline (hashedit) editing in README
EOF
```

---

## Self-Review (작성자 체크)

- 스펙 §2 포맷(파일 태그/번호 앵커/패치 DSL) → Task 1(format)·2(view)·3(parse) ✓
- 스펙 §5 결정(hashedit + read 뷰) → Task 6(view 훅)·7(tool)·8(wiring) ✓
- 스펙 §5 안전 편입(plan 차단/default 승인/acceptEdits) → Task 8(permission·diff-approval) ✓
- 스펙 §2 stale 거부 + 재접지 → Task 5(patch)·7(execute 갱신 뷰) ✓
- 스펙 §7 제외(block/3-way/auto-repair/대체모드) → 본 플랜 전 task에서 미포함(의도적) ✓
- 타입 일관성: `Edit`/`InsertPos`(parse) ↔ apply/patch, `PrepareResult`(patch) ↔ tool/diff-approval,
  `buildView`(view) ↔ patch/hashedit-view 일치.
- 게이트(타입 미확정) 명시: read `tool_result` 입력 필드(Task 6), `defineTool`/TypeBox `Type` import·
  `execute` 시그니처·`AgentToolResult` 반환(Task 7), diff-approval 분기(Task 8). 각 게이트는 typecheck로 확정.
