# meeagent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pi(`@mariozechner/pi-coding-agent`) 런타임 위에 Claude Code와 동일한 권한모드(Shift+Tab 순환)·플랜모드(읽기전용→렌더링된 마크다운 플랜→승인)·diff 승인(승인/거절/커스텀)을 OpenRouter 연동으로 구현한다.

**Architecture:** meeagent는 별도 바이너리가 아니라 pi의 **단일 extension 프로젝트**다. `pi`를 우리 프로젝트 설정(`.pi/`)으로 실행하면 `.pi/extensions/meeagent/index.ts`가 로드되어 3가지 관심사(permission-mode / plan-mode / diff-approval)를 **하나의 공유 모드 상태**로 묶는다. 순수 로직(모드 전이·bash 안전성·diff 생성)은 import 없는 모듈로 분리해 vitest로 단위 테스트한다.

**Tech Stack:** Bun + TypeScript, `@mariozechner/pi-coding-agent` `@mariozechner/pi-tui` `@mariozechner/pi-ai` (v0.73.1), `diff` (unified diff 생성), `vitest`, OpenRouter.

> **설계 정련 메모 (스펙 대비 변경):** 스펙은 3개 extension이 모듈 전역으로 상태를 공유한다고 했으나, pi는 파일당 default export 1개를 개별 extension으로 로드하므로 가변 상태 공유가 취약하다. 따라서 **`index.ts` 하나만 extension**으로 두고, 세 관심사를 `setupPermissionMode(pi, state)` / `setupPlanMode(pi, state)` / `setupDiffApproval(pi, state)` 일반 함수로 분리해 `createModeState()` 인스턴스를 주입한다. 기능·UX는 스펙과 동일하다.

---

## File Structure

```
meeagent/
  package.json                       # type:module, scripts, deps
  tsconfig.json                      # 이미 존재(루트). 필요 시 확장
  vitest.config.ts                   # 테스트 러너
  .env                               # OPENROUTER_API_KEY=  (커밋되는 키 템플릿)
  .env.local                         # 실제 키 (gitignored)
  bin/meeagent                       # 런처 스크립트
  .pi/
    settings.json                    # 기본 모델(openrouter/...) 등
    keybindings.json                 # app.thinking.cycle 재매핑(shift+tab 해방)
    extensions/meeagent/
      index.ts                       # ← 유일한 extension. 3개 setup 함수 조립
      mode-state.ts                  # 순수: PermissionMode 상태/전이
      bash-safety.ts                 # 순수: 파괴적 bash 판별
      diff-preview.ts                # edit/write 입력 → unified diff 문자열
      permission-mode.ts             # setupPermissionMode: shift+tab 순환 + 푸터
      plan-mode.ts                   # setupPlanMode: 읽기전용+프롬프트+플랜 게이트
      diff-approval.ts               # setupDiffApproval: edit/write diff 카드
  test/
    mode-state.test.ts
    bash-safety.test.ts
    diff-preview.test.ts
```

**책임 경계:**
- `mode-state.ts` / `bash-safety.ts` / `diff-preview.ts` — pi 런타임 의존 없는 순수 로직. 단위 테스트 대상.
- `permission-mode.ts` / `plan-mode.ts` / `diff-approval.ts` — pi `ExtensionAPI`에 핸들러를 다는 wiring. 공유 `ModeState`를 주입받음.
- `index.ts` — 세 wiring을 조립하는 유일한 extension 진입점.

---

## Task 0: Spike — 위험 API 3건 사전 검증

스펙 §7의 불확실성을 코드로 먼저 확인한다. 결과에 따라 후속 태스크의 폴백이 결정된다.

**Files:**
- Create: `spike/probe.ts` (검증 후 삭제)

- [ ] **Step 1: renderDiff가 표준 unified diff를 받아들이는지 확인**

`spike/probe.ts` 작성:

```typescript
import { renderDiff } from "@mariozechner/pi-coding-agent";
import { createTwoFilesPatch } from "diff";

const patch = createTwoFilesPatch(
  "a.ts", "a.ts",
  "const x = 1;\nconst y = 2;\n",
  "const x = 1;\nconst y = 42;\n",
  "", "", { context: 3 },
);
console.log("=== raw patch ===\n" + patch);
console.log("=== renderDiff ===\n" + renderDiff(patch));
```

Run: `bun run spike/probe.ts`
Expected: `renderDiff` 출력에 변경 라인이 색(ANSI)으로 표시됨. **만약 깨지면** diff-approval은 `renderDiff` 대신 자체 colorizer(라인 선두 `+`→녹, `-`→적)로 폴백한다 (Task 8에 기록).

- [ ] **Step 2: shift+tab 단축키가 우리 핸들러로 들어오는지 확인**

`.pi/keybindings.json` 생성:

```json
{
  "app.thinking.cycle": "ctrl+t"
}
```

`spike/probe-key.ts`:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
export default function (pi: ExtensionAPI) {
  pi.registerShortcut("shift+tab", {
    description: "probe",
    handler: async (ctx) => ctx.ui.notify("shift+tab fired", "info"),
  });
}
```

Run: `OPENROUTER_API_KEY=$(grep OPENROUTER .env.local | cut -d= -f2) bun x pi --extension ./spike/probe-key.ts`
그리고 인터랙티브 화면에서 Shift+Tab을 눌러 "shift+tab fired" 알림이 뜨는지 확인.
Expected: 알림 표시. **만약 thinking.cycle이 먼저 먹으면** keybindings.json 재매핑이 적용됐는지 확인하고, 그래도 안 되면 트리거를 `Key.ctrlAlt("p")`로 폴백(Task 6에 기록).

- [ ] **Step 3: OpenRouter 모델로 1턴 응답되는지 확인**

`.env.local`에 실제 키 작성(`OPENROUTER_API_KEY=sk-or-...`), 그리고:

Run: `bun x pi -p "say hi in one word" --model openrouter/anthropic/claude-3.5-sonnet 2>&1 | head` (키는 env에서 자동 인식)
Expected: 한 단어 응답. **실패 시** `.pi/settings.json`에 openrouter provider/baseUrl/apiKey를 명시(Task 1 Step 5에서 처리).

- [ ] **Step 4: spike 정리**

```bash
rm -rf spike
git add -A && git commit -m "chore: spike pi extension APIs (renderDiff, shift+tab, openrouter)"
```

> Task 0의 결론(폴백 여부)을 이 플랜 문서 하단 "Spike Results"에 한 줄로 적고 진행.

---

## Task 1: 프로젝트 스캐폴드

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`, `.env`, `.env.local`, `.pi/settings.json`, `.pi/keybindings.json`
- Modify: `.gitignore`

- [ ] **Step 1: package.json 스크립트/deps 정리**

`package.json`을 아래로 교체(설치는 이미 완료된 상태):

```json
{
  "name": "meeagent",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "bin": { "meeagent": "./bin/meeagent" },
  "scripts": {
    "start": "./bin/meeagent",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@mariozechner/pi-agent-core": "0.73.1",
    "@mariozechner/pi-ai": "0.73.1",
    "@mariozechner/pi-coding-agent": "0.73.1",
    "@mariozechner/pi-tui": "0.73.1",
    "diff": "^9.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "vitest": "^2.0.0"
  }
}
```

Run: `bun add -d @types/node vitest`
Expected: devDependencies 설치 완료.

- [ ] **Step 2: vitest.config.ts 생성**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 3: env 템플릿 작성**

`.env` (커밋됨, 키-only 템플릿):

```
# Copy to .env.local and fill in. .env.local is gitignored.
OPENROUTER_API_KEY=
```

`.env.local` (gitignored, 실제 키 — 플레이스홀더로 생성):

```
OPENROUTER_API_KEY=sk-or-REPLACE_ME
```

- [ ] **Step 4: .gitignore 확인**

`.gitignore`에 `.env.local`이 포함돼 있는지 확인(이미 존재). 없으면 추가.

Run: `grep -q '.env.local' .gitignore && echo OK || echo "MISSING .env.local"`
Expected: `OK`

- [ ] **Step 5: .pi/settings.json + keybindings.json**

`.pi/settings.json` (기본 모델 지정; openrouter는 내장 provider라 키는 env로 인식):

```json
{
  "model": "openrouter/anthropic/claude-3.5-sonnet"
}
```

`.pi/keybindings.json` (shift+tab을 thinking.cycle에서 떼어내 우리 모드순환에 양보):

```json
{
  "app.thinking.cycle": "ctrl+t"
}
```

> Task 0 Step 3에서 openrouter 자동 인식이 실패했다면, 여기 settings.json에 `providers.openrouter.{baseUrl,apiKey}`를 추가한다:
> ```json
> { "model": "openrouter/anthropic/claude-3.5-sonnet",
>   "providers": { "openrouter": { "baseUrl": "https://openrouter.ai/api/v1", "apiKey": "OPENROUTER_API_KEY" } } }
> ```

- [ ] **Step 6: 커밋**

```bash
git add -A && git commit -m "chore: scaffold meeagent project config and env templates"
```

---

## Task 2: mode-state.ts (순수, TDD)

권한 모드의 단일 진실 소스. `default → acceptEdits → plan → default` 순환.

**Files:**
- Create: `.pi/extensions/meeagent/mode-state.ts`
- Test: `test/mode-state.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`test/mode-state.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createModeState, type PermissionMode } from "../.pi/extensions/meeagent/mode-state.js";

describe("mode-state", () => {
  it("defaults to 'default'", () => {
    const s = createModeState();
    expect(s.current()).toBe<PermissionMode>("default");
  });

  it("cycles default -> acceptEdits -> plan -> default", () => {
    const s = createModeState();
    expect(s.cycle()).toBe("acceptEdits");
    expect(s.cycle()).toBe("plan");
    expect(s.cycle()).toBe("default");
  });

  it("set() jumps to a specific mode", () => {
    const s = createModeState();
    s.set("plan");
    expect(s.current()).toBe("plan");
  });

  it("notifies subscribers on cycle and set with (next, prev)", () => {
    const s = createModeState();
    const calls: Array<[PermissionMode, PermissionMode]> = [];
    s.onChange((next, prev) => calls.push([next, prev]));
    s.cycle();              // default -> acceptEdits
    s.set("default");       // acceptEdits -> default
    expect(calls).toEqual([
      ["acceptEdits", "default"],
      ["default", "acceptEdits"],
    ]);
  });

  it("set() to the same mode does not notify", () => {
    const s = createModeState();
    let n = 0;
    s.onChange(() => n++);
    s.set("default");
    expect(n).toBe(0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun run test -- mode-state`
Expected: FAIL — `mode-state.js`/`createModeState` 미존재.

- [ ] **Step 3: 최소 구현**

`.pi/extensions/meeagent/mode-state.ts`:

```typescript
export type PermissionMode = "default" | "acceptEdits" | "plan";

const ORDER: PermissionMode[] = ["default", "acceptEdits", "plan"];

export type ModeChangeListener = (next: PermissionMode, prev: PermissionMode) => void;

export interface ModeState {
  current(): PermissionMode;
  cycle(): PermissionMode;
  set(mode: PermissionMode): void;
  onChange(listener: ModeChangeListener): void;
}

export function createModeState(initial: PermissionMode = "default"): ModeState {
  let mode: PermissionMode = initial;
  const listeners: ModeChangeListener[] = [];

  function change(next: PermissionMode): void {
    if (next === mode) return;
    const prev = mode;
    mode = next;
    for (const l of listeners) l(next, prev);
  }

  return {
    current: () => mode,
    cycle: () => {
      const idx = ORDER.indexOf(mode);
      change(ORDER[(idx + 1) % ORDER.length]);
      return mode;
    },
    set: (next) => change(next),
    onChange: (listener) => { listeners.push(listener); },
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun run test -- mode-state`
Expected: PASS (5 tests).

- [ ] **Step 5: 커밋**

```bash
git add .pi/extensions/meeagent/mode-state.ts test/mode-state.test.ts
git commit -m "feat: add permission mode state machine"
```

---

## Task 3: bash-safety.ts (순수, TDD)

플랜모드에서 파괴적 bash 명령을 차단하기 위한 판별기. pi 공식 plan-mode 예제의 패턴을 채택한다.

**Files:**
- Create: `.pi/extensions/meeagent/bash-safety.ts`
- Test: `test/bash-safety.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`test/bash-safety.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { isDestructiveBash } from "../.pi/extensions/meeagent/bash-safety.js";

describe("isDestructiveBash", () => {
  it("flags writes/deletes", () => {
    expect(isDestructiveBash("rm -rf build")).toBe(true);
    expect(isDestructiveBash("mv a b")).toBe(true);
    expect(isDestructiveBash("echo hi > file.txt")).toBe(true);
    expect(isDestructiveBash("git commit -m x")).toBe(true);
    expect(isDestructiveBash("npm install left-pad")).toBe(true);
  });

  it("allows read-only commands", () => {
    expect(isDestructiveBash("cat file.txt")).toBe(false);
    expect(isDestructiveBash("grep -r foo src")).toBe(false);
    expect(isDestructiveBash("git status")).toBe(false);
    expect(isDestructiveBash("ls -la")).toBe(false);
    expect(isDestructiveBash("rg pattern")).toBe(false);
  });

  it("treats append redirection as destructive", () => {
    expect(isDestructiveBash("cat a >> b")).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun run test -- bash-safety`
Expected: FAIL — 모듈 미존재.

- [ ] **Step 3: 최소 구현**

`.pi/extensions/meeagent/bash-safety.ts` (plan-mode 예제 `DESTRUCTIVE_PATTERNS` 발췌):

```typescript
const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\brm\b/i, /\brmdir\b/i, /\bmv\b/i, /\bcp\b/i, /\bmkdir\b/i, /\btouch\b/i,
  /\bchmod\b/i, /\bchown\b/i, /\bchgrp\b/i, /\bln\b/i, /\btee\b/i,
  /\btruncate\b/i, /\bdd\b/i, /\bshred\b/i,
  /(^|[^<])>(?!>)/, />>/,
  /\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
  /\byarn\s+(add|remove|install|publish)/i,
  /\bpnpm\s+(add|remove|install|publish)/i,
  /\bpip\s+(install|uninstall)/i,
  /\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i,
  /\bsudo\b/i, /\bsu\b/i, /\bkill\b/i, /\bpkill\b/i, /\bkillall\b/i,
  /\breboot\b/i, /\bshutdown\b/i,
];

/** True if the command may modify the filesystem or system state. */
export function isDestructiveBash(command: string): boolean {
  return DESTRUCTIVE_PATTERNS.some((p) => p.test(command));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun run test -- bash-safety`
Expected: PASS (3 tests).

- [ ] **Step 5: 커밋**

```bash
git add .pi/extensions/meeagent/bash-safety.ts test/bash-safety.test.ts
git commit -m "feat: add destructive bash command detector for plan mode"
```

---

## Task 4: diff-preview.ts (TDD)

edit/write 도구의 입력을 받아 적용 전 unified diff 문자열을 만든다. 색칠은 호출부에서 `renderDiff`로 한다.

**Files:**
- Create: `.pi/extensions/meeagent/diff-preview.ts`
- Test: `test/diff-preview.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`test/diff-preview.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEditDiff, buildWriteDiff, applyEdits } from "../.pi/extensions/meeagent/diff-preview.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "meeagent-"));
}

describe("applyEdits", () => {
  it("applies sequential oldText->newText replacements", () => {
    const out = applyEdits("const y = 2;\n", [{ oldText: "2", newText: "42" }]);
    expect(out).toBe("const y = 42;\n");
  });
});

describe("buildEditDiff", () => {
  it("produces a unified diff for an existing file", async () => {
    const dir = tmp();
    try {
      writeFileSync(join(dir, "a.ts"), "const x = 1;\nconst y = 2;\n");
      const diff = await buildEditDiff("a.ts", [{ oldText: "2", newText: "42" }], dir);
      expect(diff).toContain("-const y = 2;");
      expect(diff).toContain("+const y = 42;");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("buildWriteDiff", () => {
  it("diffs against empty for a new file", async () => {
    const dir = tmp();
    try {
      const diff = await buildWriteDiff("new.ts", "hello\n", dir);
      expect(diff).toContain("+hello");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun run test -- diff-preview`
Expected: FAIL — 모듈 미존재.

- [ ] **Step 3: 최소 구현**

`.pi/extensions/meeagent/diff-preview.ts`:

```typescript
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createTwoFilesPatch } from "diff";

export interface EditOp {
  oldText: string;
  newText: string;
}

/** Apply sequential exact-text replacements (preview-only; pi's edit tool is authoritative). */
export function applyEdits(content: string, edits: EditOp[]): string {
  let out = content;
  for (const { oldText, newText } of edits) {
    out = out.replace(oldText, newText);
  }
  return out;
}

async function readOrEmpty(absPath: string): Promise<string> {
  try {
    return await readFile(absPath, "utf8");
  } catch {
    return "";
  }
}

/** Unified diff for an `edit` tool call, computed before applying. */
export async function buildEditDiff(path: string, edits: EditOp[], cwd: string): Promise<string> {
  const abs = resolve(cwd, path.replace(/^@/, ""));
  const before = await readOrEmpty(abs);
  const after = applyEdits(before, edits);
  return createTwoFilesPatch(path, path, before, after, "", "", { context: 3 });
}

/** Unified diff for a `write` tool call, computed before applying. */
export async function buildWriteDiff(path: string, content: string, cwd: string): Promise<string> {
  const abs = resolve(cwd, path.replace(/^@/, ""));
  const before = await readOrEmpty(abs);
  return createTwoFilesPatch(path, path, before, content, "", "", { context: 3 });
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun run test -- diff-preview`
Expected: PASS (3 tests).

- [ ] **Step 5: 커밋**

```bash
git add .pi/extensions/meeagent/diff-preview.ts test/diff-preview.test.ts
git commit -m "feat: add edit/write diff preview builder"
```

---

## Task 5: index.ts — extension 조립 진입점

세 wiring 함수를 공유 `ModeState`로 묶는다. 이 단계에서는 빈 wiring으로 로드만 검증한다.

**Files:**
- Create: `.pi/extensions/meeagent/index.ts`
- Create: `.pi/extensions/meeagent/permission-mode.ts` (stub)
- Create: `.pi/extensions/meeagent/plan-mode.ts` (stub)
- Create: `.pi/extensions/meeagent/diff-approval.ts` (stub)

- [ ] **Step 1: 빈 wiring 스텁 3개 작성**

`.pi/extensions/meeagent/permission-mode.ts`:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ModeState } from "./mode-state.js";

export function setupPermissionMode(_pi: ExtensionAPI, _state: ModeState): void {
  // filled in Task 6
}
```

`.pi/extensions/meeagent/plan-mode.ts`:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ModeState } from "./mode-state.js";

export function setupPlanMode(_pi: ExtensionAPI, _state: ModeState): void {
  // filled in Task 7
}
```

`.pi/extensions/meeagent/diff-approval.ts`:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ModeState } from "./mode-state.js";

export function setupDiffApproval(_pi: ExtensionAPI, _state: ModeState): void {
  // filled in Task 8
}
```

- [ ] **Step 2: index.ts 작성**

`.pi/extensions/meeagent/index.ts`:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createModeState } from "./mode-state.js";
import { setupPermissionMode } from "./permission-mode.js";
import { setupPlanMode } from "./plan-mode.js";
import { setupDiffApproval } from "./diff-approval.js";

export default function meeagent(pi: ExtensionAPI): void {
  const state = createModeState();
  setupPermissionMode(pi, state);
  setupPlanMode(pi, state);
  setupDiffApproval(pi, state);

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.notify("meeagent ready", "info");
  });
}
```

- [ ] **Step 3: 로드 스모크 확인**

Run: `bun x pi -p "ok" --model openrouter/anthropic/claude-3.5-sonnet 2>&1 | head`
Expected: 에러 없이 응답. (print 모드라 notify는 no-op이지만 extension 로드 자체가 검증됨. extension은 `.pi/extensions/`에서 자동 발견된다.)

- [ ] **Step 4: 커밋**

```bash
git add .pi/extensions/meeagent
git commit -m "feat: wire meeagent extension entry with shared mode state"
```

---

## Task 6: permission-mode.ts — Shift+Tab 순환 + 푸터

**Files:**
- Modify: `.pi/extensions/meeagent/permission-mode.ts`

읽기전용 도구 집합은 plan-mode와 공유하므로 상수를 여기서 export한다.

- [ ] **Step 1: 도구 집합 상수 + applyMode 구현**

`.pi/extensions/meeagent/permission-mode.ts` 전체 교체:

```typescript
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ModeState, PermissionMode } from "./mode-state.js";

export const READONLY_TOOLS = ["read", "bash", "grep", "find", "ls"];
export const FULL_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];

/** Apply the tool allow-list and footer badge for a mode. */
export function applyMode(pi: ExtensionAPI, ctx: ExtensionContext, mode: PermissionMode): void {
  if (mode === "plan") {
    pi.setActiveTools(READONLY_TOOLS);
  } else {
    pi.setActiveTools(FULL_TOOLS);
  }

  if (!ctx.hasUI) return;
  const t = ctx.ui.theme;
  if (mode === "acceptEdits") {
    ctx.ui.setStatus("meeagent-mode", t.fg("success", "⏵⏵ accept edits on"));
  } else if (mode === "plan") {
    ctx.ui.setStatus("meeagent-mode", t.fg("warning", "⏸ plan mode on"));
  } else {
    ctx.ui.setStatus("meeagent-mode", undefined);
  }
}

export function setupPermissionMode(pi: ExtensionAPI, state: ModeState): void {
  // The handler for entering/leaving plan mode (prompt injection, plan gate)
  // lives in plan-mode.ts and reacts via state.onChange there.
  pi.registerShortcut("shift+tab", {
    description: "Cycle permission mode (default → accept edits → plan)",
    handler: async (ctx) => {
      const next = state.cycle();
      applyMode(pi, ctx, next);
      ctx.ui.notify(`Mode: ${next}`, "info");
    },
  });

  // Initialize footer + tools on session start.
  pi.on("session_start", async (_event, ctx) => {
    applyMode(pi, ctx, state.current());
  });
}
```

> Task 0 Step 2에서 shift+tab이 안 먹었다면 첫 줄을 `pi.registerShortcut(Key.ctrlAlt("p"), {`로 바꾸고 `import { Key } from "@mariozechner/pi-tui";` 추가.

- [ ] **Step 2: 수동 검증 — 모드 순환**

Run: `bun x pi --model openrouter/anthropic/claude-3.5-sonnet`
인터랙티브 화면에서 Shift+Tab을 3번 눌러 푸터가 `(없음) → ⏵⏵ accept edits on → ⏸ plan mode on → (없음)`으로 도는지 확인. Esc/Ctrl+C로 종료.
Expected: 푸터 배지와 "Mode: ..." 알림이 순환.

- [ ] **Step 3: 커밋**

```bash
git add .pi/extensions/meeagent/permission-mode.ts
git commit -m "feat: cycle permission modes with shift+tab and footer badge"
```

---

## Task 7: plan-mode.ts — 읽기전용 강제 + 프롬프트 주입 + 플랜 승인 게이트

pi 공식 plan-mode 예제의 검증된 흐름을 채택하되, 트리거를 공유 `ModeState`에 연결하고 승인 후 모드를 `default`로 둔다.

**Files:**
- Modify: `.pi/extensions/meeagent/plan-mode.ts`

- [ ] **Step 1: 플랜모드 wiring 구현**

`.pi/extensions/meeagent/plan-mode.ts` 전체 교체:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ModeState } from "./mode-state.js";
import { applyMode } from "./permission-mode.js";
import { isDestructiveBash } from "./bash-safety.js";

const PLAN_PROMPT = `[PLAN MODE ACTIVE]
You are in plan mode — a read-only exploration mode for safe code analysis.

Restrictions:
- You may ONLY use: read, bash (read-only), grep, find, ls
- You may NOT use: edit, write (file modifications are disabled)

Investigate the request, then present a concrete plan as Markdown under a "Plan:" header:

Plan:
1. First step
2. Second step
...

Do NOT make changes — only describe what you would do.`;

export function setupPlanMode(pi: ExtensionAPI, state: ModeState): void {
  pi.registerFlag("plan", {
    description: "Start in plan mode (read-only exploration)",
    type: "boolean",
    default: false,
  });

  // Block destructive bash while in plan mode (hard enforcement beyond tool allow-list).
  pi.on("tool_call", async (event) => {
    if (state.current() !== "plan" || event.toolName !== "bash") return;
    const command = String(event.input.command ?? "");
    if (isDestructiveBash(command)) {
      return {
        block: true,
        reason: `Plan mode: destructive command blocked. Exit plan mode (Shift+Tab) to run it.\nCommand: ${command}`,
      };
    }
  });

  // Inject the plan-mode instruction each turn while active.
  pi.on("before_agent_start", async () => {
    if (state.current() !== "plan") return;
    return {
      message: { customType: "meeagent-plan", content: PLAN_PROMPT, display: false },
    };
  });

  // Strip stale plan-mode context once we leave plan mode.
  pi.on("context", async (event) => {
    if (state.current() === "plan") return;
    return {
      messages: event.messages.filter((m) => {
        const msg = m as { customType?: string };
        return msg.customType !== "meeagent-plan";
      }),
    };
  });

  // On plan completion, render the plan (already shown as the assistant's
  // markdown message) and present the approve/reject/custom gate.
  pi.on("agent_end", async (event, ctx) => {
    if (state.current() !== "plan" || !ctx.hasUI) return;

    const choice = await ctx.ui.select("Plan ready — what next?", [
      "Approve & execute",
      "Stay in plan mode",
      "Refine with feedback",
    ]);

    if (choice === "Approve & execute") {
      state.set("default");           // post-approval mode (per design)
      applyMode(pi, ctx, "default");
      pi.sendMessage(
        { customType: "meeagent-exec", content: "Execute the plan you just presented.", display: true },
        { triggerTurn: true },
      );
    } else if (choice === "Refine with feedback") {
      const feedback = await ctx.ui.editor("Feedback for the plan:", "");
      if (feedback?.trim()) pi.sendUserMessage(feedback.trim());
    }
    // "Stay in plan mode": do nothing — remains in plan.
  });

  // Honor --plan flag and restore tools on session start.
  pi.on("session_start", async (_event, ctx) => {
    if (pi.getFlag("plan") === true) {
      state.set("plan");
      applyMode(pi, ctx, "plan");
    }
  });
}
```

- [ ] **Step 2: 수동 검증 — 플랜 흐름**

Run: `bun x pi --model openrouter/anthropic/claude-3.5-sonnet`
1) Shift+Tab ×2로 plan 모드 진입(푸터 `⏸ plan mode on`).
2) "rename function foo to bar in src" 같은 요청 입력.
3) 모델이 편집을 시도하면 막히고, "Plan:" 마크다운이 렌더링되는지 확인.
4) 응답 종료 후 select 게이트에서 "Approve & execute" 선택 → default 모드로 전환되고 실행이 시작되는지 확인.
Expected: 플랜모드에서 edit/write 불가, 플랜 마크다운 표시, 승인 시 실행.

- [ ] **Step 3: 커밋**

```bash
git add .pi/extensions/meeagent/plan-mode.ts
git commit -m "feat: add plan mode with read-only enforcement and approval gate"
```

---

## Task 8: diff-approval.ts — edit/write diff 카드 (승인/거절/커스텀)

**Files:**
- Modify: `.pi/extensions/meeagent/diff-approval.ts`

- [ ] **Step 1: diff 승인 wiring 구현**

`.pi/extensions/meeagent/diff-approval.ts` 전체 교체:

```typescript
import { isToolCallEventType, renderDiff, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import type { ModeState } from "./mode-state.js";
import { buildEditDiff, buildWriteDiff, type EditOp } from "./diff-preview.js";

type Decision = "approve" | "reject" | "custom";

/** Show the colored diff and collect a/r/c decision. */
async function askDecision(ctx: ExtensionContext, diffText: string): Promise<Decision> {
  const body = renderDiff(diffText);
  return ctx.ui.custom<Decision>((_tui, theme, _keys, done) => {
    const hint = theme.fg("muted", "\n[a] approve   [r] reject   [c] reject with feedback");
    const text = new Text(body + hint, 1, 1);
    text.onKey = (key: string) => {
      if (key === "a") { done("approve"); return true; }
      if (key === "r") { done("reject"); return true; }
      if (key === "c") { done("custom"); return true; }
      if (key === "escape") { done("reject"); return true; }
      return true;
    };
    return text;
  });
}

export function setupDiffApproval(pi: ExtensionAPI, state: ModeState): void {
  pi.on("tool_call", async (event, ctx) => {
    // Only gate file mutations.
    if (event.toolName !== "edit" && event.toolName !== "write") return;
    // acceptEdits: auto-approve. plan: already blocked by tool allow-list. Only gate `default`.
    if (state.current() !== "default") return;
    if (!ctx.hasUI) return; // non-interactive: let host policy decide

    let diffText: string;
    if (isToolCallEventType("edit", event)) {
      diffText = await buildEditDiff(event.input.path, event.input.edits as EditOp[], ctx.cwd);
    } else if (isToolCallEventType("write", event)) {
      diffText = await buildWriteDiff(event.input.path, event.input.content, ctx.cwd);
    } else {
      return;
    }

    const decision = await askDecision(ctx, diffText);
    if (decision === "approve") return; // allow

    if (decision === "reject") {
      return {
        block: true,
        reason: "User rejected this edit. Do not retry the same change; continue with other work or ask how to proceed.",
      };
    }

    // custom: collect feedback, block this edit, feed the text back to the model.
    const feedback = await ctx.ui.editor("Feedback for the agent:", "");
    return {
      block: true,
      reason: feedback?.trim()
        ? `User rejected this edit with feedback: ${feedback.trim()}`
        : "User rejected this edit.",
    };
  });
}
```

> Task 0 Step 1에서 `renderDiff`가 표준 patch를 못 받았다면 `const body = renderDiff(diffText)`를 자체 colorizer로 교체:
> ```typescript
> const body = diffText.split("\n").map((l) =>
>   l.startsWith("+") && !l.startsWith("+++") ? theme.fg("success", l)
>   : l.startsWith("-") && !l.startsWith("---") ? theme.fg("error", l)
>   : theme.fg("dim", l)).join("\n");
> ```
> (이 경우 `askDecision`에서 `theme`를 인자로 받도록 시그니처를 조정한다.)

- [ ] **Step 2: 수동 검증 — diff 승인 3분기**

Run: `bun x pi --model openrouter/anthropic/claude-3.5-sonnet`
default 모드(푸터 배지 없음)에서 "add a console.log to the top of README handling... (편집 유발 요청)" 같이 파일 수정을 유도.
- diff 카드가 적/녹으로 뜨는지
- `a` → 편집 적용, `r` → 편집 취소 후 모델이 계속 진행, `c` → 피드백 입력 후 그 내용이 모델에 전달되는지
각각 확인. acceptEdits 모드(Shift+Tab ×1)에서는 카드 없이 자동 적용되는지도 확인.
Expected: 3분기 동작 + acceptEdits 자동승인.

- [ ] **Step 3: 전체 테스트 재실행**

Run: `bun run test`
Expected: 모든 단위 테스트 PASS.

- [ ] **Step 4: 커밋**

```bash
git add .pi/extensions/meeagent/diff-approval.ts
git commit -m "feat: add diff approval card with approve/reject/custom for edits"
```

---

## Task 9: 런처 + README + 엔드투엔드 마감

**Files:**
- Create: `bin/meeagent`
- Create: `README.md`

- [ ] **Step 1: 런처 스크립트 작성**

`bin/meeagent`:

```bash
#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
# Load secrets if present.
[ -f .env.local ] && set -a && . ./.env.local && set +a
exec bun x pi "$@"
```

Run: `chmod +x bin/meeagent`
Expected: 실행 권한 부여.

- [ ] **Step 2: README 작성**

`README.md`:

```markdown
# meeagent

pi(`@mariozechner/pi-coding-agent`) 위에 Claude Code식 플랜모드와 diff 승인을 얹은 OpenRouter 코딩 에이전트.

## 설정
1. `cp .env .env.local` 후 `.env.local`의 `OPENROUTER_API_KEY`에 실제 키 입력.
2. `bun install`
3. `bun start` (= `./bin/meeagent`)

## 기능
- **Shift+Tab**: 권한 모드 순환 `default → ⏵⏵ accept edits → ⏸ plan`.
- **플랜 모드**: 읽기 전용 탐색 → "Plan:" 마크다운 → Approve / Stay / Refine.
- **diff 승인**(default 모드): 파일 수정 전 적·녹 diff 카드 → `a` 승인 / `r` 거절 / `c` 피드백.
- **accept edits 모드**: diff 카드 없이 자동 적용.

## 테스트
`bun run test`
```

- [ ] **Step 3: 엔드투엔드 시나리오 검증**

Run: `bun start`
한 세션에서 (1) plan 모드로 계획 수립→승인→실행, (2) default 모드에서 diff 거절+커스텀 피드백, (3) acceptEdits 자동적용을 모두 통과시킨다.
Expected: 세 시나리오 모두 정상.

- [ ] **Step 4: 최종 커밋**

```bash
git add -A
git commit -m "feat: add launcher and project README"
```

---

## Testing Note (스펙 §6 대비 편차)

스펙은 "스크립트된 tool_call을 내는 스텁 모델로 승인 플로우를 end-to-end 구동"을 제안했다. 그러나 그 통합 테스트는 pi의 `AgentSession`/`streamFn` 전체를 스텁해야 해 MVP 범위를 크게 넘는다. 따라서:
- **위험 로직은 모두 순수 함수로 분리해 단위 테스트**한다 (mode-state, bash-safety, diff-preview = Task 2·3·4).
- **wiring(plan/diff 게이트)은 수동 e2e**로 검증한다 (Task 7·8·9의 검증 스텝).

스텁-모델 통합 테스트는 MVP 이후 후속 작업으로 남긴다.

## Spike Results

> Task 0 완료 후 채운다:
> - renderDiff(표준 patch): ☐ OK / ☐ 폴백 colorizer
> - shift+tab 핸들러: ☐ OK / ☐ 폴백 Ctrl+Alt+P
> - OpenRouter env 인식: ☐ OK / ☐ settings.json provider 명시
