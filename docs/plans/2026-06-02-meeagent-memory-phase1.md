# meeagent 2-tier Memory — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** meeagent에 마크다운 기반 2-tier(프로젝트/글로벌) 학습 메모리의 코어를 구현한다 — 세션 종료 시 raw 로그 캡처, 시작 시 캐디지로 LLM distill(프로젝트/글로벌 태깅), 두 계층 MEMORY를 시스템프롬프트에 주입, `/learn-global` 합성.

**Architecture:** 전부 repo 밖 `~/.meeagent/`에 저장(cwd-키 프로젝트 격리). 순수 로직(경로·저장·추출·파싱·주입블록·캐디지)을 pi 의존 없는 모듈로 분리해 vitest로 단위 테스트하고, LLM 호출과 pi 훅 wiring은 의존성 주입 + 타입체크로 검증한다. **임베딩·SQLite·recall 툴은 Phase 2**로 미룬다. Phase 1에서 distill의 global-태그 fact는 (db가 없으므로) 글로벌 `MEMORY.md`로 직접 append되고, `/learn-global`이 이를 정리·합성한다.

**Tech Stack:** Bun + TypeScript, `@earendil-works/pi-coding-agent`/`pi-ai` 0.78.0 (`complete`), vitest. 신규 런타임 의존성 없음(파일 IO만).

---

## File Structure

```
.pi/extensions/meeagent/
  index.ts                  # setupMemory(pi) 한 줄 추가 (기존 진입점)
  memory/
    paths.ts                # 순수: 디렉토리/파일 경로, projectKey(cwd)
    store.ts                # MEMORY.md 읽기/쓰기, raw 로그 append, state.json IO
    extract.ts              # 순수: agent_end 메시지 → 세션 요약 텍스트
    facts.ts                # 순수: distill LLM 출력 → {text, scope}[] 파싱
    inject.ts               # 순수: project+global MEMORY → 주입 블록 문자열
    schedule.ts             # 순수: isDistillDue(state, now, cfg)
    llm.ts                  # runLLM(model, auth, system, user) — complete() 래퍼
    distill.ts              # distillProject(deps): raw 로그 → facts → MEMORY 병합
    synthesize.ts           # synthesizeGlobal(deps): 프로젝트 MEMORY들 → 글로벌 MEMORY
    setup-memory.ts         # pi wiring: 훅(capture/inject/scheduler) + /learn-global
test/memory/
    paths.test.ts
    store.test.ts
    extract.test.ts
    facts.test.ts
    inject.test.ts
    schedule.test.ts
    distill.test.ts
    synthesize.test.ts
```

**경계:** `paths/store/extract/facts/inject/schedule`는 pi import 없는 순수 모듈(단위 테스트). `distill/synthesize`는 LLM 함수를 **인자로 주입**받아 스텁으로 테스트. `llm.ts`/`setup-memory.ts`는 pi 런타임에 붙는 얇은 wiring(타입체크 게이트).

**설정 상수** (`paths.ts`에 함께 export):
- `DISTILL_LOG_THRESHOLD = 3` (미처리 로그 N개면 distill)
- `DISTILL_INTERVAL_MS = 6 * 60 * 60 * 1000` (또는 6시간 경과)
- `MEMORY_MAX_CHARS = 8000` (MEMORY.md 계층별 상한)

---

## Task 1: paths.ts — 경로/키 (순수, TDD)

**Files:** Create `.pi/extensions/meeagent/memory/paths.ts`; Test `test/memory/paths.test.ts`.

- [ ] **Step 1: 실패하는 테스트**

```typescript
import { describe, it, expect } from "vitest";
import { projectKey, globalDir, projectDir, paths, MEMORY_MAX_CHARS } from "../../.pi/extensions/meeagent/memory/paths.js";

describe("projectKey", () => {
  it("sanitizes an absolute path to a stable key", () => {
    expect(projectKey("/Users/me/Downloads/source/tooday")).toBe("Users-me-Downloads-source-tooday");
  });
  it("collapses non-alphanumerics and trims separators", () => {
    expect(projectKey("/a/b.c/d_e")).toBe("a-b-c-d-e");
  });
});

describe("paths", () => {
  it("builds global and project file paths under root", () => {
    const p = paths("/root", "/Users/me/proj");
    expect(p.globalMemory).toBe("/root/global/MEMORY.md");
    expect(p.projectMemory).toBe("/root/projects/Users-me-proj/MEMORY.md");
    expect(p.projectLogDir).toBe("/root/projects/Users-me-proj/logs");
    expect(p.state).toBe("/root/state.json");
  });
  it("exposes a memory size cap", () => {
    expect(MEMORY_MAX_CHARS).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun run test -- paths` → FAIL (모듈 없음).

- [ ] **Step 3: 구현**

```typescript
import { homedir } from "node:os";
import { join } from "node:path";

export const DISTILL_LOG_THRESHOLD = 3;
export const DISTILL_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const MEMORY_MAX_CHARS = 8000;

/** Default root for all meeagent memory (outside any project repo). */
export function defaultRoot(): string {
  return join(homedir(), ".meeagent");
}

/** Stable, readable key for a project, derived from its absolute cwd. */
export function projectKey(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function globalDir(root: string): string {
  return join(root, "global");
}

export function projectDir(root: string, cwd: string): string {
  return join(root, "projects", projectKey(cwd));
}

export interface MemoryPaths {
  globalMemory: string;
  projectMemory: string;
  projectLogDir: string;
  state: string;
}

export function paths(root: string, cwd: string): MemoryPaths {
  const pdir = projectDir(root, cwd);
  return {
    globalMemory: join(globalDir(root), "MEMORY.md"),
    projectMemory: join(pdir, "MEMORY.md"),
    projectLogDir: join(pdir, "logs"),
    state: join(root, "state.json"),
  };
}
```

- [ ] **Step 4: 통과 확인** — Run: `bun run test -- paths` → PASS. `bun run typecheck` → EXIT 0.

- [ ] **Step 5: 커밋**

```bash
git add .pi/extensions/meeagent/memory/paths.ts test/memory/paths.test.ts
git commit -F - <<'EOF'
feat(memory): add path and key resolution for 2-tier memory

프로젝트/글로벌 메모리의 디렉토리·파일 경로와 cwd 기반 프로젝트 키를 추가한다.
EOF
```

---

## Task 2: store.ts — 파일 IO (TDD, 임시 디렉토리)

**Files:** Create `.pi/extensions/meeagent/memory/store.ts`; Test `test/memory/store.test.ts`.

- [ ] **Step 1: 실패하는 테스트**

```typescript
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMemory, writeMemory, appendRawLog, readState, writeState } from "../../.pi/extensions/meeagent/memory/store.js";

function tmp() { return mkdtempSync(join(tmpdir(), "mee-store-")); }

describe("memory file IO", () => {
  it("returns empty string for a missing MEMORY file", () => {
    const dir = tmp();
    try { expect(readMemory(join(dir, "nope.md"))).toBe(""); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("writes then reads MEMORY, creating parent dirs", () => {
    const dir = tmp();
    try {
      const f = join(dir, "a/b/MEMORY.md");
      writeMemory(f, "hello");
      expect(readMemory(f)).toBe("hello");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("appends raw log lines under a dated file", () => {
    const dir = tmp();
    try {
      appendRawLog(dir, "2026-06-02", "first");
      appendRawLog(dir, "2026-06-02", "second");
      const body = readFileSync(join(dir, "2026-06-02.md"), "utf8");
      expect(body).toContain("first");
      expect(body).toContain("second");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("state IO", () => {
  it("returns a default state when file missing", () => {
    const dir = tmp();
    try { expect(readState(join(dir, "state.json"))).toEqual({ projects: {}, globalLastSynthTs: 0 }); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("round-trips state", () => {
    const dir = tmp();
    try {
      const f = join(dir, "state.json");
      writeState(f, { projects: { k: { lastDistillTs: 5, undistilledLogCount: 2 } }, globalLastSynthTs: 9 });
      expect(readState(f)).toEqual({ projects: { k: { lastDistillTs: 5, undistilledLogCount: 2 } }, globalLastSynthTs: 9 });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun run test -- store` → FAIL.

- [ ] **Step 3: 구현**

```typescript
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Read a MEMORY/markdown file, returning "" if it does not exist. */
export function readMemory(file: string): string {
  try { return readFileSync(file, "utf8"); }
  catch { return ""; }
}

/** Write a MEMORY/markdown file, creating parent directories. */
export function writeMemory(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
}

/** Append a raw log entry to <logDir>/<date>.md (date = "YYYY-MM-DD"). */
export function appendRawLog(logDir: string, date: string, entry: string): void {
  mkdirSync(logDir, { recursive: true });
  appendFileSync(join(logDir, `${date}.md`), `${entry}\n`, "utf8");
}

export interface ProjectState { lastDistillTs: number; undistilledLogCount: number; }
export interface MemoryState { projects: Record<string, ProjectState>; globalLastSynthTs: number; }

export function readState(file: string): MemoryState {
  try { return JSON.parse(readFileSync(file, "utf8")) as MemoryState; }
  catch { return { projects: {}, globalLastSynthTs: 0 }; }
}

export function writeState(file: string, state: MemoryState): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2), "utf8");
}
```

- [ ] **Step 4: 통과 확인** — Run: `bun run test -- store` → PASS. `bun run typecheck` → EXIT 0.

- [ ] **Step 5: 커밋**

```bash
git add .pi/extensions/meeagent/memory/store.ts test/memory/store.test.ts
git commit -F - <<'EOF'
feat(memory): add MEMORY/raw-log/state file IO

MEMORY.md 읽기·쓰기, 일별 raw 로그 append, state.json 입출력을 추가한다.
EOF
```

---

## Task 3: extract.ts — 세션 요약 추출 (순수, TDD)

`agent_end`의 메시지에서 raw 로그용 요약 텍스트를 만든다. LLM 없이 사용자 요청 텍스트와 수정된 파일 경로를 뽑는다.

**Files:** Create `.pi/extensions/meeagent/memory/extract.ts`; Test `test/memory/extract.test.ts`.

- [ ] **Step 1: 실패하는 테스트**

```typescript
import { describe, it, expect } from "vitest";
import { extractSessionSummary } from "../../.pi/extensions/meeagent/memory/extract.js";

describe("extractSessionSummary", () => {
  it("collects user request text and edited file paths", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "add routing to the app" }] },
      { role: "assistant", content: [
        { type: "text", text: "I'll edit the router." },
        { type: "toolCall", name: "edit", input: { path: "src/router.ts" } },
      ] },
      { role: "toolResult", toolName: "edit" },
    ];
    const out = extractSessionSummary(messages as never);
    expect(out).toContain("User: add routing to the app");
    expect(out).toContain("Edited: src/router.ts");
  });

  it("returns empty string when there is nothing to record", () => {
    expect(extractSessionSummary([] as never)).toBe("");
  });

  it("ignores non-edit/write tool calls for the edited list", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "list files" }] },
      { role: "assistant", content: [{ type: "toolCall", name: "ls", input: { path: "." } }] },
    ];
    const out = extractSessionSummary(messages as never);
    expect(out).toContain("User: list files");
    expect(out).not.toContain("Edited:");
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun run test -- extract` → FAIL.

- [ ] **Step 3: 구현**

```typescript
interface TextBlock { type: "text"; text: string; }
interface ToolCallBlock { type: "toolCall"; name: string; input?: { path?: string } }
type Block = TextBlock | ToolCallBlock | { type: string };
interface Msg { role: string; content?: Block[] | string; }

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
```

- [ ] **Step 4: 통과 확인** — Run: `bun run test -- extract` → PASS. `bun run typecheck` → EXIT 0.

- [ ] **Step 5: 커밋**

```bash
git add .pi/extensions/meeagent/memory/extract.ts test/memory/extract.test.ts
git commit -F - <<'EOF'
feat(memory): extract session summary from finished messages

사용자 요청 텍스트와 수정된 파일 경로를 raw 로그용 요약으로 추출한다.
EOF
```

---

## Task 4: facts.ts — distill 출력 파서 (순수, TDD)

distill LLM은 한 줄에 하나씩 `[project] ...` / `[global] ...` 형식으로 fact를 내보낸다. 이를 파싱한다.

**Files:** Create `.pi/extensions/meeagent/memory/facts.ts`; Test `test/memory/facts.test.ts`.

- [ ] **Step 1: 실패하는 테스트**

```typescript
import { describe, it, expect } from "vitest";
import { parseFacts, type Fact } from "../../.pi/extensions/meeagent/memory/facts.js";

describe("parseFacts", () => {
  it("parses [project] and [global] tagged lines", () => {
    const out = `[project] Uses Vue Router for routing
[global] Prefers functional composition over inheritance
ignored line without tag`;
    expect(parseFacts(out)).toEqual<Fact[]>([
      { scope: "project", text: "Uses Vue Router for routing" },
      { scope: "global", text: "Prefers functional composition over inheritance" },
    ]);
  });
  it("trims and skips empty facts", () => {
    expect(parseFacts("[project]   \n[global] x")).toEqual<Fact[]>([{ scope: "global", text: "x" }]);
  });
  it("is case-insensitive on the tag", () => {
    expect(parseFacts("[PROJECT] y")).toEqual<Fact[]>([{ scope: "project", text: "y" }]);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun run test -- facts` → FAIL.

- [ ] **Step 3: 구현**

```typescript
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
```

- [ ] **Step 4: 통과 확인** — Run: `bun run test -- facts` → PASS. `bun run typecheck` → EXIT 0.

- [ ] **Step 5: 커밋**

```bash
git add .pi/extensions/meeagent/memory/facts.ts test/memory/facts.test.ts
git commit -F - <<'EOF'
feat(memory): parse tagged facts from distiller output

[project]/[global] 태그 라인을 fact 목록으로 파싱한다.
EOF
```

---

## Task 5: inject.ts — 주입 블록 + MEMORY 병합 (순수, TDD)

주입 블록 생성과, 새 fact를 MEMORY.md에 병합(상한 압축 포함)하는 순수 함수.

**Files:** Create `.pi/extensions/meeagent/memory/inject.ts`; Test `test/memory/inject.test.ts`.

- [ ] **Step 1: 실패하는 테스트**

```typescript
import { describe, it, expect } from "vitest";
import { buildMemoryBlock, mergeFacts } from "../../.pi/extensions/meeagent/memory/inject.js";

describe("buildMemoryBlock", () => {
  it("includes both tiers when present", () => {
    const block = buildMemoryBlock("proj stuff", "global stuff");
    expect(block).toContain("Project memory");
    expect(block).toContain("proj stuff");
    expect(block).toContain("Global memory");
    expect(block).toContain("global stuff");
  });
  it("returns empty string when both tiers empty", () => {
    expect(buildMemoryBlock("", "")).toBe("");
  });
  it("omits an empty tier", () => {
    const block = buildMemoryBlock("", "g");
    expect(block).not.toContain("Project memory");
    expect(block).toContain("Global memory");
  });
});

describe("mergeFacts", () => {
  it("appends new bullet facts, skipping duplicates", () => {
    const out = mergeFacts("- a\n", ["a", "b"], 8000);
    expect(out).toBe("- a\n- b");
  });
  it("truncates oldest lines when over the cap", () => {
    const out = mergeFacts("- old1\n- old2\n", ["new"], 12);
    expect(out.length).toBeLessThanOrEqual(12);
    expect(out).toContain("- new");
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun run test -- inject` → FAIL.

- [ ] **Step 3: 구현**

```typescript
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
  return out;
}
```

- [ ] **Step 4: 통과 확인** — Run: `bun run test -- inject` → PASS. `bun run typecheck` → EXIT 0.

- [ ] **Step 5: 커밋**

```bash
git add .pi/extensions/meeagent/memory/inject.ts test/memory/inject.test.ts
git commit -F - <<'EOF'
feat(memory): build injection block and merge facts into MEMORY

2계층 주입 블록 생성과 중복 제거·상한 압축 fact 병합을 추가한다.
EOF
```

---

## Task 6: schedule.ts — distill 도래 판정 (순수, TDD)

**Files:** Create `.pi/extensions/meeagent/memory/schedule.ts`; Test `test/memory/schedule.test.ts`.

- [ ] **Step 1: 실패하는 테스트**

```typescript
import { describe, it, expect } from "vitest";
import { isDistillDue } from "../../.pi/extensions/meeagent/memory/schedule.js";

const cfg = { threshold: 3, intervalMs: 1000 };

describe("isDistillDue", () => {
  it("is due when undistilled logs reach the threshold", () => {
    expect(isDistillDue({ lastDistillTs: 0, undistilledLogCount: 3 }, 1, cfg)).toBe(true);
  });
  it("is due when the interval has elapsed and there is at least one log", () => {
    expect(isDistillDue({ lastDistillTs: 0, undistilledLogCount: 1 }, 2000, cfg)).toBe(true);
  });
  it("is not due with no logs even past the interval", () => {
    expect(isDistillDue({ lastDistillTs: 0, undistilledLogCount: 0 }, 999999, cfg)).toBe(false);
  });
  it("is not due below threshold and within interval", () => {
    expect(isDistillDue({ lastDistillTs: 500, undistilledLogCount: 1 }, 600, cfg)).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun run test -- schedule` → FAIL.

- [ ] **Step 3: 구현**

```typescript
import type { ProjectState } from "./store.js";

export interface DistillConfig { threshold: number; intervalMs: number; }

/** Decide whether a project's raw logs should be distilled now. */
export function isDistillDue(state: ProjectState, now: number, cfg: DistillConfig): boolean {
  if (state.undistilledLogCount <= 0) return false;
  if (state.undistilledLogCount >= cfg.threshold) return true;
  return now - state.lastDistillTs >= cfg.intervalMs;
}
```

- [ ] **Step 4: 통과 확인** — Run: `bun run test -- schedule` → PASS. `bun run typecheck` → EXIT 0.

- [ ] **Step 5: 커밋**

```bash
git add .pi/extensions/meeagent/memory/schedule.ts test/memory/schedule.test.ts
git commit -F - <<'EOF'
feat(memory): add distill-due scheduling predicate

미처리 로그 수와 경과 시간으로 distill 실행 시점을 판정한다.
EOF
```

---

## Task 7: llm.ts — LLM 래퍼 (wiring, 타입체크 게이트)

distill/synthesize가 쓰는 단일 LLM 호출 함수. pi-ai `complete`를 감싼다.

**Files:** Create `.pi/extensions/meeagent/memory/llm.ts`.

- [ ] **Step 1: 구현**

```typescript
import { complete } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Run a single LLM completion with the session's model. Returns text, or "" if unavailable. */
export async function runLLM(ctx: ExtensionContext, system: string, user: string): Promise<string> {
  const model = ctx.model;
  if (!model) return "";
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) return "";

  const response = await complete(
    model,
    {
      systemPrompt: system,
      messages: [{ role: "user" as const, content: [{ type: "text" as const, text: user }], timestamp: Date.now() }],
    },
    { apiKey: auth.apiKey, headers: auth.headers, signal: ctx.signal },
  );

  return response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

export type RunLLM = (system: string, user: string) => Promise<string>;
```

- [ ] **Step 2: 타입체크** — Run: `bun run typecheck` → EXIT 0. (verifies `complete` signature, `getApiKeyAndHeaders`, `ctx.model/.signal` against 0.78 types.) 타입 에러가 나면 BLOCKED로 보고하고 정확한 에러를 전달.

- [ ] **Step 3: 커밋**

```bash
git add .pi/extensions/meeagent/memory/llm.ts
git commit -F - <<'EOF'
feat(memory): add LLM wrapper over pi-ai complete

세션 모델로 단일 completion을 실행하는 distill/synthesize용 래퍼를 추가한다.
EOF
```

---

## Task 8: distill.ts — distill 오케스트레이션 (TDD, LLM 스텁)

raw 로그를 모아 LLM으로 fact를 추출(태깅)하고, project fact는 프로젝트 MEMORY로, global fact는 글로벌 MEMORY로 병합한다. LLM은 `RunLLM` 함수로 주입받아 테스트.

**Files:** Create `.pi/extensions/meeagent/memory/distill.ts`; Test `test/memory/distill.test.ts`.

- [ ] **Step 1: 실패하는 테스트**

```typescript
import { describe, it, expect } from "vitest";
import { distillProject } from "../../.pi/extensions/meeagent/memory/distill.js";

describe("distillProject", () => {
  it("routes project facts to project memory and global facts to global memory", async () => {
    const memories: Record<string, string> = { "/proj/MEMORY.md": "", "/global/MEMORY.md": "" };
    const runLLM = async () => "[project] Uses GraphQL API\n[global] Likes testcontainers";
    const result = await distillProject({
      rawLogs: "User: add a query",
      projectMemoryFile: "/proj/MEMORY.md",
      globalMemoryFile: "/global/MEMORY.md",
      maxChars: 8000,
      runLLM,
      read: (f) => memories[f] ?? "",
      write: (f, c) => { memories[f] = c; },
    });
    expect(memories["/proj/MEMORY.md"]).toContain("Uses GraphQL API");
    expect(memories["/global/MEMORY.md"]).toContain("Likes testcontainers");
    expect(result.factCount).toBe(2);
  });

  it("does nothing and reports zero when raw logs are empty", async () => {
    let called = false;
    const result = await distillProject({
      rawLogs: "   ",
      projectMemoryFile: "/p", globalMemoryFile: "/g", maxChars: 8000,
      runLLM: async () => { called = true; return ""; },
      read: () => "", write: () => {},
    });
    expect(called).toBe(false);
    expect(result.factCount).toBe(0);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun run test -- distill` → FAIL.

- [ ] **Step 3: 구현**

```typescript
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
```

- [ ] **Step 4: 통과 확인** — Run: `bun run test -- distill` → PASS. `bun run typecheck` → EXIT 0.

- [ ] **Step 5: 커밋**

```bash
git add .pi/extensions/meeagent/memory/distill.ts test/memory/distill.test.ts
git commit -F - <<'EOF'
feat(memory): distill raw logs into tagged 2-tier facts

LLM으로 raw 로그에서 fact를 추출·태깅해 프로젝트/글로벌 MEMORY로 병합한다.
EOF
```

---

## Task 9: synthesize.ts — 글로벌 합성 (TDD, LLM 스텁)

여러 프로젝트의 MEMORY를 입력으로 LLM이 일반 원칙을 합성해 글로벌 MEMORY를 재작성한다.

**Files:** Create `.pi/extensions/meeagent/memory/synthesize.ts`; Test `test/memory/synthesize.test.ts`.

- [ ] **Step 1: 실패하는 테스트**

```typescript
import { describe, it, expect } from "vitest";
import { synthesizeGlobal } from "../../.pi/extensions/meeagent/memory/synthesize.js";

describe("synthesizeGlobal", () => {
  it("rewrites global memory from project memories via the LLM", async () => {
    let store = "old global";
    const result = await synthesizeGlobal({
      projectMemories: ["- Uses Vue Router", "- Uses React Router"],
      currentGlobal: store,
      maxChars: 8000,
      runLLM: async (_s, user) => {
        expect(user).toContain("Vue Router");
        return "- Routing approach varies per framework; learn the project's router first";
      },
      writeGlobal: (c) => { store = c; },
    });
    expect(store).toContain("Routing approach varies");
    expect(result.updated).toBe(true);
  });

  it("skips when there are no project memories", async () => {
    const result = await synthesizeGlobal({
      projectMemories: [], currentGlobal: "g", maxChars: 8000,
      runLLM: async () => "x", writeGlobal: () => {},
    });
    expect(result.updated).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun run test -- synthesize` → FAIL.

- [ ] **Step 3: 구현**

```typescript
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
```

- [ ] **Step 4: 통과 확인** — Run: `bun run test -- synthesize` → PASS. `bun run typecheck` → EXIT 0.

- [ ] **Step 5: 커밋**

```bash
git add .pi/extensions/meeagent/memory/synthesize.ts test/memory/synthesize.test.ts
git commit -F - <<'EOF'
feat(memory): synthesize global memory from project memories

여러 프로젝트 MEMORY를 LLM으로 교차 합성해 글로벌 MEMORY를 갱신한다.
EOF
```

---

## Task 10: setup-memory.ts — pi wiring (타입체크 게이트)

훅(capture/inject/scheduler)과 `/learn-global` 명령을 등록하고 순수 모듈을 조립한다.

**Files:** Create `.pi/extensions/meeagent/memory/setup-memory.ts`; Modify `.pi/extensions/meeagent/index.ts`.

- [ ] **Step 1: setup-memory.ts 구현**

```typescript
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defaultRoot, paths, projectKey, DISTILL_LOG_THRESHOLD, DISTILL_INTERVAL_MS, MEMORY_MAX_CHARS } from "./paths.js";
import { readMemory, writeMemory, appendRawLog, readState, writeState } from "./store.js";
import { extractSessionSummary } from "./extract.js";
import { buildMemoryBlock } from "./inject.js";
import { isDistillDue } from "./schedule.js";
import { runLLM } from "./llm.js";
import { distillProject } from "./distill.js";
import { synthesizeGlobal } from "./synthesize.js";
import { readdirSync } from "node:fs";
import { join } from "node:path";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function setupMemory(pi: ExtensionAPI): void {
  const root = defaultRoot();
  let frozenBlock = "";

  // Freeze the memory block at session start; run distill if due.
  pi.on("session_start", async (_event, ctx) => {
    const p = paths(root, ctx.cwd);
    frozenBlock = buildMemoryBlock(readMemory(p.projectMemory), readMemory(p.globalMemory));

    const state = readState(p.state);
    const ps = state.projects[projectKey(ctx.cwd)] ?? { lastDistillTs: 0, undistilledLogCount: 0 };
    if (isDistillDue(ps, Date.now(), { threshold: DISTILL_LOG_THRESHOLD, intervalMs: DISTILL_INTERVAL_MS })) {
      await runDistill(ctx, root);
    }
  });

  // Inject the frozen block into every turn's system prompt.
  pi.on("before_agent_start", async (event) => {
    if (!frozenBlock) return;
    return { systemPrompt: `${event.systemPrompt}\n\n# Learned memory\n${frozenBlock}` };
  });

  // Capture a raw-log summary when a prompt finishes.
  pi.on("agent_end", async (event, ctx) => {
    const summary = extractSessionSummary(event.messages as never);
    if (!summary) return;
    const p = paths(root, ctx.cwd);
    appendRawLog(p.projectLogDir, today(), summary);
    const state = readState(p.state);
    const k = projectKey(ctx.cwd);
    const ps = state.projects[k] ?? { lastDistillTs: 0, undistilledLogCount: 0 };
    state.projects[k] = { ...ps, undistilledLogCount: ps.undistilledLogCount + 1 };
    writeState(p.state, state);
  });

  // /learn-global: synthesize global memory across all projects.
  pi.registerCommand("learn-global", {
    description: "Synthesize global memory from all project memories",
    handler: async (_args, ctx) => {
      const projectsDir = join(root, "projects");
      let dirs: string[] = [];
      try { dirs = readdirSync(projectsDir); } catch { dirs = []; }
      const memories = dirs
        .map((d) => readMemory(join(projectsDir, d, "MEMORY.md")))
        .filter((m) => m.trim());
      const p = paths(root, ctx.cwd);
      const res = await synthesizeGlobal({
        projectMemories: memories,
        currentGlobal: readMemory(p.globalMemory),
        maxChars: MEMORY_MAX_CHARS,
        runLLM: (s, u) => runLLM(ctx, s, u),
        writeGlobal: (c) => writeMemory(p.globalMemory, c),
      });
      ctx.ui.notify(res.updated ? "Global memory updated." : "No project memory to synthesize.", "info");
    },
  });
}

async function runDistill(ctx: ExtensionContext, root: string): Promise<void> {
  const p = paths(root, ctx.cwd);
  let raw = "";
  try {
    for (const f of readdirSync(p.projectLogDir)) raw += `${readMemory(join(p.projectLogDir, f))}\n`;
  } catch { return; }

  const result = await distillProject({
    rawLogs: raw,
    projectMemoryFile: p.projectMemory,
    globalMemoryFile: p.globalMemory,
    maxChars: MEMORY_MAX_CHARS,
    runLLM: (s, u) => runLLM(ctx, s, u),
    read: readMemory,
    write: writeMemory,
  });

  const state = readState(p.state);
  state.projects[projectKey(ctx.cwd)] = { lastDistillTs: Date.now(), undistilledLogCount: 0 };
  writeState(p.state, state);
  if (ctx.hasUI && result.factCount > 0) ctx.ui.notify(`Learned ${result.factCount} facts.`, "info");
}
```

- [ ] **Step 2: index.ts wiring**

`.pi/extensions/meeagent/index.ts`에 import와 호출 추가:

```typescript
import { setupMemory } from "./memory/setup-memory.js";
```
그리고 `meeagent(pi)` 본문 안, 기존 `setupDiffApproval(pi, state);` 다음 줄에:
```typescript
  setupMemory(pi);
```

- [ ] **Step 3: 타입체크 + 전체 테스트**

Run: `bun run typecheck` → EXIT 0. Run: `bun run test` → 기존 12 + 신규 메모리 유닛 모두 PASS.
타입 에러(특히 `before_agent_start` event.systemPrompt, `agent_end` event.messages, `registerCommand` 시그니처)가 나면 BLOCKED로 정확한 에러 보고.

- [ ] **Step 4: 커밋**

```bash
git add .pi/extensions/meeagent/memory/setup-memory.ts .pi/extensions/meeagent/index.ts
git commit -F - <<'EOF'
feat(memory): wire capture, inject, scheduler, and /learn-global

세션 캡처·메모리 주입·distill 캐디지·글로벌 합성 명령을 extension에 연결한다.
EOF
```

---

## Task 11: 엔드투엔드 수동 검증 (Phase 1 마감)

**Files:** none (검증).

- [ ] **Step 1: 로드 확인**

Run: `cd /Users/seominyong/Downloads/source/tooday && pi --help 2>&1 | grep -i "learn-global"` (글로벌 pi가 확장 로드 → 명령 노출).
Expected: `/learn-global` 또는 관련 명령 표시. (커맨드가 --help에 안 보이면 정상일 수 있음 — 인터랙티브에서 `/help`로 확인.)

- [ ] **Step 2: 학습 루프 수동 확인 (실키 필요)**

`pi`를 tooday에서 실행 → `/login` 후, 파일 수정을 유발하는 요청 몇 번 → 종료. `~/.meeagent/projects/<key>/logs/<오늘>.md`에 raw 로그가 쌓이는지 확인. 임계치(3) 도달 후 재시작 → distill 실행되어 `projects/<key>/MEMORY.md`에 fact가 생기는지, 다음 세션 시작 시 시스템프롬프트에 주입되는지(에이전트가 프로젝트 지식을 기억하는지) 확인. `/learn-global` 실행 후 `~/.meeagent/global/MEMORY.md` 생성 확인.
Expected: raw 로그 → MEMORY 학습 → 주입 → 글로벌 합성 동작.

- [ ] **Step 3: 커밋 (있으면)** — 검증만이면 생략.

---

## Phase 2 (후속 플랜 예고 — 본 플랜 범위 아님)

`embed.ts`(로컬 임베딩 스파이크) · `db.ts`(`bun:sqlite` + JS 코사인) · `recall.ts`(`memory_recall` 툴) + distill/synthesize의 db 연동. Phase 1 완료·검증 후 별도 플랜으로 상세화한다.

---

## Self-Review (작성자 체크)

- 스펙 §3 저장 레이아웃 → Task 1(paths) ✓ / §5.1 캡처 → Task 3,10 ✓ / §5.2 distill+태깅 → Task 4,8 ✓ /
  §5.3 주입(frozen) → Task 5,10 ✓ / §5.4 합성 → Task 9,10 ✓ / §6 Phase 분리 → 본 플랜=Phase 1 ✓.
- §5.5 recall, §3 db/임베딩 → Phase 2 (명시적 제외).
- 타입 일관성: `MemoryState/ProjectState`(store) ↔ schedule/setup, `Fact/Scope`(facts) ↔ distill,
  `RunLLM` 시그니처 `(system,user)=>Promise<string>` ↔ distill/synthesize/llm 일치.
