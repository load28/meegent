# meeagent Superpowers 워크플로우 + 토큰 최적화 — Implementation Plan

> **For agentic workers:** 이 플랜은 task별 `- [ ]` 체크박스로 진행한다. 순수 모듈은 TDD(실패 테스트→실패 확인→
> 최소 구현→통과 확인→커밋), pi 런타임 wiring은 `tsc --noEmit` 타입체크 게이트로 검증한다(메모리/해시라인 플랜과 동일 규율).
> 설계 근거: `docs/specs/2026-06-03-meeagent-superpowers-workflow-design.md`.

**Goal:** 코드 작업 전 `brainstorm→plan→(execute⇄review)*→verify→finish` 워크플로우를 강제하고, 실행은 저가
Haiku / 리뷰는 프리미엄 Sonnet으로 티어링하며, pi-ai 내장 프롬프트 캐싱을 명시 설정해 OpenRouter 비용을 절감한다.

**Architecture:** 순수 로직(`state`/`docs`/`tiering`/`caching`/`reviewer` 판정 파싱)은 pi 비의존 모듈로 분리해
vitest로 단위 테스트한다. pi 훅·툴·커맨드 wiring(`setup-workflow`)은 타입체크로 검증한다. 리뷰어는
`memory/llm.ts:runLLM`에 모델 오버라이드 인자를 추가해 공유하고, 별도 Sonnet `complete()`로 격리 호출한다.
실행 루프는 모델을 바꾸지 않아(Haiku 고정) 프리픽스 캐시를 유지한다.

**Tech Stack:** Bun + TypeScript, `@earendil-works/pi-coding-agent`/`pi-ai`/`pi-tui` 0.78, vitest. 신규 런타임 의존성 없음.

> **진행 상태(2026-06-03):** Task 0–10 구현 완료. 순수 모듈(state/docs/tiering/caching/reviewer/two-stage)
> 32개 단위·통합 테스트 통과, 전체 132 테스트 + `tsc --noEmit` 그린. **남은 것: Task 10.2 라이브 스모크**
> — `OPENROUTER_API_KEY`가 설정된 세션에서 Haiku 실행 + Sonnet 리뷰 + `Usage.cacheRead` 적중/비용 로그
> 실측(설계 §6). 스파이크 결과는 `docs/superpowers/specs/2026-06-03-spike-notes.md`.
>
> **토큰 최적화 배선 패스(후속):** 설계 §6의 캐싱·계측이 `caching.ts`에 만들어져 있었으나 실제
> `complete()` 호출 경로에 연결돼 있지 않던 것을 연결. (1) `runLLM`이 `cacheRetention`/`sessionId`를
> `complete()`에 전달하고 `onUsage`로 `Usage`를 노출(`memory/llm.ts`). (2) 2단계 리뷰어가 공유
> 컨텍스트(skill+spec+diff+test)를 **system 프리픽스**로 고정하고 단계별 focus만 user로 분리해
> Stage 2가 Stage 1의 캐시(cacheRead)를 재사용(`reviewer.ts`), 두 단계가 동일 `sessionId` 공유.
> (3) 설정 로더 일원화(`workflow/config.ts`)로 `cacheRetention`이 실제로 읽힘. (4) `/workflow status`에
> 누적 리뷰 비용 표시 + 리뷰마다 `Usage` 로그(`formatUsage`). (5) 메모리 distill/synthesize를 저가
> exec 모델 + 캐싱으로 라우팅(`memory/setup-memory.ts`). 전체 137 테스트 + 타입체크 그린.
> 메인 실행 루프의 `cacheRetention` 주입은 `before_provider_request` payload가 불투명하므로 라이브
> 스파이크 0.2 이후로 유지(프로바이더 기본값 "short").

---

## File Structure

```
.pi/extensions/meeagent/
  index.ts                  # setupWorkflow(pi, state) 한 줄 추가
  memory/llm.ts             # runLLM에 modelOverride? 인자 추가 (reviewer 공유)
  workflow/
    state.ts                # 순수: phase + task index 전이
    docs.ts                 # 순수: design/plan md 경로·읽기·쓰기·task 체크리스트 파싱
    tiering.ts              # 순수+ctx: 모델 resolve(find) / setModel 스왑·복원
    caching.ts              # cacheRetention 적용 + before_provider_request 보정 + Usage 비용 로깅
    reviewer.ts             # 2단계 격리 리뷰 호출 + 판정(verdict/severity) 파싱
    skills/
      brainstorming.md  writing-plans.md  tdd.md  code-review.md
    setup-workflow.ts       # wiring: /workflow(/brainstorm,/plan,/build) + 훅 오케스트레이션
test/workflow/
    state.test.ts  docs.test.ts  tiering.test.ts  caching.test.ts  reviewer.test.ts
docs/superpowers/
    specs/  plans/           # 런타임 생성물 경로(런타임에 생성, 커밋 대상 아님)
```

---

## Task 0: 스파이크 — 런타임 가정 검증 (코드 없음, 기록만)

> 설계 §11 리스크를 코드 착수 전에 해소한다. 결과를 `docs/superpowers/specs/`에 메모로 남긴다.

- [ ] **0.1 pi 중첩 세션** — 설치된 `@earendil-works/pi-coding-agent` 타입에서 확장이 중첩 agent-session을
  띄울 수 있는지 확인(`agent-session.d.ts`, `ExtensionContext` actions). 가능하면 진짜 subagent, 불가하면
  **메인루프+컨텍스트 스트립**(권장안)으로 확정.
- [ ] **0.2 OpenRouter 캐시 패스스루** — Haiku로 동일 시스템 프롬프트 2회 `complete()` 후
  두 번째 응답 `Usage.cacheRead > 0` 확인. 0이면 `before_provider_request`에서 OpenRouter 캐싱 마커 주입 필요로 표시.
- [ ] **0.3 setModel 동작** — `ctx.setModel(model)` 전환 시 진행 중 컨텍스트 보존/반환값(no-key=false) 확인.
- [ ] **0.4 모델 가용성** — `ctx.modelRegistry.find("openrouter","anthropic/claude-haiku-4.5")` /
  `...claude-sonnet-4.6` 가 resolve 되는지 확인.

---

## Task 1: state.ts — 워크플로우 상태기계 (순수, TDD)

**Files:** create `workflow/state.ts`, test `test/workflow/state.test.ts`

- [ ] **1.1 RED** — 전이표 테스트 작성:
  `idle→brainstorm→plan→execute→review`, review에서 `pass`→다음 execute(또는 task 소진 시 verify),
  `fail`→execute 복귀, `verify→finish`. `nextTask()`가 index 증가, `taskIndex()` 노출.
- [ ] **1.2** 실패 확인 (`bun run test state`).
- [ ] **1.3 GREEN** — `createWorkflowState()` 구현: `phase()`, `setPhase(p)`, `taskIndex()`, `nextTask()`,
  `reset()`. `Phase = "idle"|"brainstorm"|"plan"|"execute"|"review"|"verify"|"finish"`. 의존성 없음.
- [ ] **1.4** 통과 확인. **1.5** 커밋 (`workflow: add pure workflow state machine`).

---

## Task 2: docs.ts — 설계/플랜 문서 I/O (순수, TDD)

**Files:** create `workflow/docs.ts`, test `test/workflow/docs.test.ts`

- [ ] **2.1 RED** — 테스트:
  `designPath(date, topic)` → `docs/superpowers/specs/<date>-<topic>-design.md`,
  `planPath(date, feature)` → `docs/superpowers/plans/<date>-<feature>.md`,
  `parseTasks(md)` → `{ index, title, done }[]` (`- [ ]` / `- [x]` 라인),
  `markDone(md, index)` → 해당 task 체크박스를 `[x]`로.
- [ ] **2.2** 실패 확인.
- [ ] **2.3 GREEN** — 순수 문자열/경로 함수로 구현(파일 시스템 X — 읽기/쓰기는 setup에서 주입). 슬러그 정규화 포함.
- [ ] **2.4** 통과 확인. **2.5** 커밋.

---

## Task 3: memory/llm.ts — runLLM 모델 오버라이드 (재사용 확장)

**Files:** modify `memory/llm.ts`

- [ ] **3.1** `runLLM(ctx, system, user, modelOverride?: Model<any>)` 시그니처로 확장.
  `const model = modelOverride ?? ctx.model;` 외 본문 무변경. 기존 distill/synthesize 호출은 인자 생략 → 무영향.
- [ ] **3.2** `bun run typecheck` 통과 확인. **3.3** 커밋 (`workflow: allow runLLM model override`).

---

## Task 4: tiering.ts — 모델 티어 resolve/스왑 (TDD 가능 부분 + ctx wiring)

**Files:** create `workflow/tiering.ts`, test `test/workflow/tiering.test.ts`

- [ ] **4.1 RED** — `parseModelRef("openrouter/anthropic/claude-haiku-4.5")` → `{provider, modelId}` 분해
  순수 함수 테스트(콜론/슬래시 포함 ID 주의 — 첫 `/`만 provider 경계).
- [ ] **4.2** 실패 확인 → **4.3 GREEN** 구현.
- [ ] **4.4** ctx 의존 헬퍼(테스트 X, 타입체크): `resolveModel(ctx, ref)`(= `modelRegistry.find`),
  `withExecModel(ctx)`/`withReviewModel(ctx)`(설정에서 ref 읽어 resolve), `swapTo(ctx, model)`(`setModel`).
- [ ] **4.5** 통과+타입체크. **4.6** 커밋.

---

## Task 5: caching.ts — 캐시 설정 + 비용 계측 (TDD 가능 부분)

**Files:** create `workflow/caching.ts`, test `test/workflow/caching.test.ts`

- [ ] **5.1 RED** — `summarizeUsage(usage)` → `{cacheReadTokens, cacheWriteTokens, costUSD}` 추출/합산
  순수 함수 테스트. `cacheRetentionFor(sessionLengthHint)` → `"short"|"long"` 규칙.
- [ ] **5.2** 실패 확인 → **5.3 GREEN** 구현.
- [ ] **5.4** ctx wiring(타입체크): `before_provider_request` 핸들러 스텁(OpenRouter 마커 보정 자리,
  Task 0.2 결과에 따라 채움) + `after_provider_response`/`Usage` 로깅 훅.
- [ ] **5.5** 통과+타입체크. **5.6** 커밋.

---

## Task 6: reviewer.ts — 2단계 격리 리뷰 (TDD 판정 파싱 + ctx 호출)

**Files:** create `workflow/reviewer.ts`, test `test/workflow/reviewer.test.ts`

- [ ] **6.1 RED** — `parseVerdict(text)` 테스트: 리뷰 응답에서 `severity`(Critical/Important/Minor/None)와
  `issues[]`, `pass: boolean`(Critical/Important 없으면 true) 파싱.
- [ ] **6.2** 실패 확인 → **6.3 GREEN** `parseVerdict` 구현.
- [ ] **6.4** ctx wiring(타입체크): `review(ctx, {stage, taskSpec, diff, testOutput})` —
  `code-review.md` 스킬 + 최소 컨텍스트로 프롬프트 구성 → `runLLM(ctx, sys, user, reviewModel)`(Sonnet) →
  `parseVerdict`. **2단계 순서 고정**: stage1(스펙준수) pass일 때만 stage2(코드품질) 호출.
- [ ] **6.5** 통과+타입체크. **6.6** 커밋.

---

## Task 7: skills/*.md — 단계별 지시문 이식

**Files:** create `workflow/skills/{brainstorming,writing-plans,tdd,code-review}.md`

- [ ] **7.1** Superpowers 해당 스킬 요지를 meeagent 톤의 간결 지시문으로 작성(HARD-GATE, 2–5분 task,
  RED-GREEN-REFACTOR 철칙, Critical/Important/Minor 심각도). 출처 주석 명시.
- [ ] **7.2** 커밋 (`workflow: add phase skill instructions`).

---

## Task 8: setup-workflow.ts + index.ts — wiring (타입체크 게이트)

**Files:** create `workflow/setup-workflow.ts`, modify `index.ts`

- [ ] **8.1** `setupWorkflow(pi, state)` 구현:
  - `registerCommand` `/workflow`(또는 `/brainstorm` `/plan` `/build`) → phase 진입.
  - `before_agent_start`: 현재 phase의 skill md를 시스템 프롬프트에 **고정 프리픽스**로 주입
    (`memory/setup-memory.ts` frozen-block 패턴 참조). brainstorm/plan은 읽기전용(=plan-mode 차단 재사용).
  - `agent_end`(execute 완료): `reviewer.review` 2단계 호출 → pass면 `docs.markDone`+커밋, fail면
    피드백을 `sendMessage(triggerTurn)`로 Haiku 실행 루프에 재투입.
  - phase 진입/이탈 시 `tiering.swapTo`(brainstorm/plan=Sonnet, execute=Haiku) + `context` 훅 스트립.
  - `caching` 훅(before/after provider) 등록.
- [ ] **8.2** `index.ts`에 `import { setupWorkflow }` + `setupWorkflow(pi, state)` 한 줄 추가.
- [ ] **8.3** `bun run typecheck` 통과. **8.4** 커밋 (`workflow: wire phases, commands, hooks`).

---

## Task 9: settings.json — 설정 + 폴백

**Files:** modify `.pi/settings.json`

- [ ] **9.1** `model`을 `openrouter/anthropic/claude-sonnet-4.6`로(컨트롤러 기본),
  `workflow: { execModel: ".../claude-haiku-4.5", reviewModel: ".../claude-sonnet-4.6", cacheRetention: "short" }` 추가.
  설정 누락 시 현행 단일 모델 폴백 처리(setup-workflow에서 가드).
- [ ] **9.2** 커밋 (`workflow: add tiering/caching settings`).

---

## Task 10: 통합 검증

- [ ] **10.1** 스텁 모델로 brainstorm→plan→execute→review(2단계)→재투입→verify 게이트가
  OpenRouter 실호출 없이 도는 통합 테스트 추가.
- [ ] **10.2** 실제 OpenRouter 1세션 스모크: 작은 task 1건으로 Haiku 실행 + Sonnet 리뷰 + `Usage`에서
  cacheRead 적중 및 비용 로그 확인(설계 §6 절감 검증).
- [ ] **10.3** `bun run test && bun run typecheck` 그린 확인 후 최종 커밋/푸시.

---

## 진행 규율 (Superpowers 준수)

- **HARD-GATE**: 설계(brainstorm) 승인 전 어떤 구현도 금지.
- **TDD 철칙**: 실패 테스트 없이 프로덕션 코드 금지. 테스트보다 먼저 쓴 코드는 삭제 후 재구현.
- **연속 진행**: task 사이 불필요한 체크인 없이 진행, 진짜 막힐 때만 멈춤.
- **리뷰**: 각 task 후 2단계(스펙준수→코드품질), Critical/Important는 진행 차단.
