# meeagent Superpowers 워크플로우 + 토큰 최적화 — Design Spec

> OpenRouter 종량제 비용을 줄이기 위해, 코드 작업 전 **무조건 설계 → 실행 구조**를
> [Superpowers](https://github.com/obra/superpowers)와 **동일한 방식**(문서기반 · 서브에이전트 ·
> 2단계 리뷰 · TDD)으로 강제하고, **실행은 저가 모델(Haiku) / 리뷰는 프리미엄(Sonnet)** 으로
> 티어링하며, pi-ai 내장 **프롬프트 캐싱**으로 반복 프리픽스 비용을 절감한다.

- **작성일**: 2026-06-03
- **상태**: 설계 승인 대기
- **런타임**: Bun + TypeScript, `@earendil-works/pi-*` 0.78
- **위치**: `.pi/extensions/meeagent/workflow/`

---

## 1. 목표 (What) / 비목표 (YAGNI)

### 배경 — 비용 문제
현재 meeagent는 단일 모델(`openrouter/anthropic/claude-3.5-sonnet`, `.pi/settings.json`)로
모든 턴을 처리한다. 코드 실행은 토큰을 가장 많이 소모하는데, 이를 비싼 모델로 돌리고 있어
OpenRouter 종량제에서 비용이 빠르게 누적된다. 기존 `plan-mode.ts`는 "1회 리서치 → 마크다운
플랜 → 승인"의 **단순 단발 플랜**일 뿐, 작업을 외부 문서로 분해해 단계별로 모델을 달리 쓰거나
리뷰를 끼우는 구조가 아니다.

### 명시적 요구사항
1. 코드 작업 전 **설계 → 실행 구조를 강제**한다. 그 방식은 **Superpowers와 동일** —
   브레인스토밍 → 플랜 → 서브에이전트 구현 → 2단계 리뷰, 모두 **디스크 문서 기반**.
2. **모델 티어링**: 토큰을 많이 먹는 **실제 코드 실행은 저가 Claude Haiku 4.5**,
   **각 작업의 리뷰는 프리미엄 Claude Sonnet 4.6**.
3. **프롬프트 캐싱**으로 반복되는 프리픽스(시스템 프롬프트 · 설계/플랜 문서 · skill 지시문)
   토큰 비용을 절감한다.

### 비목표
- 시각적 브라우저 연동(브라우저를 띄워 보여주는 기능) — 사용자 명시 제외.
- 멀티 프로바이더 동시 사용(OpenRouter 단일 게이트웨이 유지).
- Superpowers 14개 스킬 전량 이식 — **핵심 7단계 흐름 우선**, 나머지(parallel-agents,
  systematic-debugging, writing-skills 등)는 후속.
- bypassPermissions 모드.

---

## 2. 기준 조사 — Superpowers 실제 구조

출처: [`github.com/obra/superpowers`](https://github.com/obra/superpowers) `skills/` 디렉터리
(WebFetch로 직접 확인, 2026-06-03).

### 14개 스킬
`brainstorming` · `writing-plans` · `using-git-worktrees` · `subagent-driven-development` ·
`executing-plans` · `test-driven-development` · `requesting-code-review` · `receiving-code-review` ·
`verification-before-completion` · `finishing-a-development-branch` · `dispatching-parallel-agents` ·
`systematic-debugging` · `using-superpowers` · `writing-skills`.

### 7단계 흐름
브레인스토밍 → 깃 워크트리 → 플랜작성 → 서브에이전트 구현(또는 인라인) → TDD → 코드리뷰 → 브랜치 마무리.

### 핵심 스킬 요지 (meeagent에 반영할 부분)

| 스킬 | 핵심 동작 | meeagent 반영 |
|------|-----------|---------------|
| **brainstorming** | 9스텝, **HARD-GATE**(설계 승인 전 어떤 구현·코드·스캐폴딩도 금지), 한 번에 한 질문, 2–3안+권장안, 설계문서를 `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`에 저장, self-review 후 `writing-plans`로만 인계 | plan-mode 읽기전용 차단 재사용 + 설계문서 디스크 기록 |
| **writing-plans** | task당 **2–5분** 원자 단위(테스트→실패확인→구현→통과확인→커밋), **완전한 코드·정확한 파일경로·검증 커맨드 포함**(추상화 금지), `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`에 헤더(Goal/Architecture/Tech Stack)+`- [ ]` 체크박스 | 동일 포맷으로 플랜 문서 생성 (기존 `docs/plans/*` 관습과 일치) |
| **subagent-driven-development** | task마다 **fresh subagent**(세션 히스토리 상속 X, 정밀 구성된 task 스펙만) → **2단계 리뷰** ①스펙준수(over/under-build 방지) ②코드품질, **순서 고정**. 리뷰 피드백은 **원래 구현 subagent가** 수정·재제출, 승인까지 반복. task 사이 멈춤 없이 연속 진행, 전체 완료 후 최종 리뷰 | 구현=Haiku, 리뷰 2단계=Sonnet 격리 호출 |
| **requesting-code-review** | 리뷰어에게 **"세션 히스토리가 아닌 정밀 구성 컨텍스트"**(설명+요구사항+커밋 SHA, `code-reviewer.md` 템플릿) 제공. 심각도 **Critical(즉시·진행차단)/Important(다음 task 전 해결)/Minor(나중)**. 각 task 후·머지 전 필수 | reviewer.ts가 최소 컨텍스트만 구성 → 프리미엄 토큰 최소화 |
| **test-driven-development** | **RED**(실패 테스트→올바른 이유로 실패 확인) → **GREEN**(최소 구현→통과) → **REFACTOR**. 철칙: 실패 테스트 없이 프로덕션 코드 금지, **테스트보다 먼저 쓴 코드는 전량 삭제 후 재구현** | execute 단계 Haiku에 TDD 지시문 주입 |

### 기존 `plan-mode.ts`와의 차이
| | 기존 plan-mode | 본 워크플로우 |
|---|---|---|
| 구조 | 1회 리서치 → 마크다운 플랜 → 승인 → 실행 | brainstorm→plan→(execute⇄review)*→verify→finish 다단계 |
| 상태 외부화 | 없음(대화 안에만 존재) | 설계/플랜을 디스크 문서로 외부화 |
| 모델 | 단일 | 단계별 티어링(Haiku/Sonnet) |
| 리뷰 | 없음 | task별 2단계 격리 리뷰 |

> **핵심 통찰**: Superpowers의 "fresh subagent + 정밀 컨텍스트(히스토리 X)" 원칙은 그 자체가
> 토큰 절감 장치다. 여기에 역할별 모델을 얹으면 — **토큰 大 구현 = Haiku**, **짧은 리뷰 = Sonnet** —
> 비용 구조가 그대로 최적화된다.

---

## 3. 모델 티어 매핑

검증된 OpenRouter 모델 ID·비용 (per 1M tokens, `@earendil-works/pi-ai` `models.generated`):

| Superpowers 역할 | meeagent/pi 적응 | 모델 | input | output | cacheRead |
|------------------|------------------|------|------:|------:|---------:|
| brainstorming / writing-plans / 컨트롤러 | 프리미엄 오케스트레이션(짧은 턴) | `openrouter/anthropic/claude-sonnet-4.6` | $3 | $15 | $0.30 |
| 구현 subagent + TDD | **토큰 大 — 저가** | `openrouter/anthropic/claude-haiku-4.5` | $1 | $5 | $0.10 |
| 리뷰 ①스펙준수 ②코드품질 + 최종검증 | 격리 프리미엄 리뷰어 | `openrouter/anthropic/claude-sonnet-4.6` | $3 | $15 | $0.30 |

현행 단일 `anthropic/claude-3.5-sonnet`($3/$15) 대비:
- 실행을 **Haiku로 이전** → input/output 약 **3배↓**.
- 프롬프트 **캐시 적중 시 입력 토큰 약 10배↓**(Haiku cacheRead $0.10 vs input $1; Sonnet $0.30 vs $3).
- 프리미엄은 **짧은 brainstorm/plan/review 턴에만** 사용.

---

## 4. 워크플로우 상태기계

```
idle → brainstorm → plan → (execute ⇄ review)*  → verify → finish
        Sonnet       Sonnet   Haiku     Sonnet      Sonnet
        (읽기전용)            (TDD)    (2단계 격리)
        HARD-GATE
```

- **brainstorm** (Sonnet, 읽기전용 = `plan-mode.ts` 차단 재사용, **HARD-GATE**)
  → 한 번에 한 질문 · 2–3안+권장안 → 승인 시 설계문서를
  `docs/superpowers/specs/<date>-<topic>-design.md`에 기록(Superpowers 원본 경로 그대로).
- **writing-plans** (Sonnet) → 설계를 **2–5분 task**로 분해,
  `docs/superpowers/plans/<date>-<feature>.md`에 `- [ ]` 체크박스 + 완전한 코드/경로/검증.
- **execute** (**Haiku**) → task별 **TDD**(RED→GREEN→REFACTOR), 기존
  diff-approval / hashline / bash-safety 게이트 그대로 통과.
- **review** (**Sonnet**, 격리) → **2단계** ①스펙준수 ②코드품질. 입력은
  **task 스펙 + diff + 테스트 결과 + 커밋 SHA만**(세션 히스토리 X). 심각도 Critical/Important/Minor.
  Critical/Important면 **원 구현(Haiku)** 에 피드백 재투입 → 재구현 → 재리뷰(승인까지 반복).
  Minor는 기록만.
- **verify / finish** → 전체 완료 후 최종 리뷰(Sonnet) → `verification-before-completion` →
  머지/PR 옵션(기존 `/git`, `git/setup-git.ts`).

각 단계 전이는 순수 `state.ts`가 담당(phase + 현재 task index). 단계 진입 시 해당 skill 지시문을
`before_agent_start`로 주입하고, 이탈 시 `context` 훅으로 스트립(`plan-mode.ts`의 meeagent-plan
주입/스트립 패턴과 동일).

---

## 5. subagent의 pi 적응 (핵심 결정 + 스파이크)

pi에는 Claude Code의 `Task` 서브에이전트 툴이 없다. 두 가지 적응안:

### (권장) 메인루프 = 구현자 + 격리 리뷰어
- **execute 동안 메인 루프를 구현자로 사용**: `ctx.setModel(Haiku)`로 모델을 내리고, task 진입 시
  `context` 훅으로 직전 task의 잡음을 스트립해 Superpowers의 "fresh context"를 모사한다.
- **리뷰어는 툴 없는 격리 `complete()`(Sonnet)** 호출: diff·테스트 결과만 받아 판정.
  메모리 서브시스템(`memory/llm.ts:runLLM`)이 이미 쓰는 `complete(model, ctx, {apiKey, headers})`
  패턴을 그대로 따른다(여기에 모델 오버라이드 인자만 추가).
- 장점: 단순하고, **실행 루프가 모델을 바꾸지 않으므로 프리픽스 캐시가 유지**된다.

### (대안) 진짜 중첩 서브에이전트
- pi가 확장에 중첩 agent-session을 노출한다면, task마다 독립 세션을 띄워 Superpowers와 동일한
  완전 격리 디스패치가 가능하다. → **리스크 §10의 1순위 스파이크로 검증**.

> 결정 근거: 리뷰는 빈번(task마다 2회)하므로 `setModel` 스왑으로 메인 루프를 왕복시키면 Haiku 캐시가
> 매번 깨진다. 따라서 **실행 루프는 Haiku 고정, 리뷰는 별도 Sonnet `complete()`** 로 분리한다.

---

## 6. 토큰 절감 메커니즘 (정량 근거)

1. **티어링** — 토큰의 대부분을 차지하는 실행을 Haiku로 옮겨 input/output 약 3배↓. 프리미엄은
   짧은 brainstorm/plan/review 턴에만.
2. **격리 리뷰어** — 리뷰어가 최소 컨텍스트(task 스펙 + diff + 테스트 결과)만 보므로 프리미엄
   토큰을 최소화. (Superpowers "정밀 구성 컨텍스트, 히스토리 X" 원칙.)
3. **프롬프트 캐싱** — skill 지시문 + 설계문서 + 플랜문서를 **고정 프리픽스**로 주입
   (`memory/setup-memory.ts`의 per-session frozen-block 패턴). pi-ai `StreamOptions.cacheRetention`
   (기본 `"short"`)을 명시 설정하고, Anthropic 포맷 `cache_control` 자동 부착으로 cacheRead 적중
   → 입력 약 10배↓. OpenRouter(openai-completions 경로) 패스스루는 `before_provider_request`로 보정.
4. **문서 외부화** — 설계·플랜이 디스크에 있으므로 각 execute 턴은 전체 대화가 아닌 현재 task
   슬라이스만 컨텍스트로 필요 → 턴당 입력 토큰 감소.
5. **계측** — `complete()` 응답의 `Usage`(cacheRead/cacheWrite/cost)와 `after_provider_response`
   훅으로 단계별 토큰·비용을 로깅해 절감 효과를 검증한다.

---

## 7. 아키텍처

```
.pi/extensions/meeagent/
  index.ts                 # setupWorkflow(pi, state) 등록 (한 줄 추가)
  workflow/
    state.ts               # 순수: phase(idle|brainstorm|plan|execute|review|verify|finish)
                           #        + task index 전이. vitest 단위.
    docs.ts                # 순수: design/plan md 읽기·쓰기·경로 산출·task 체크리스트 파싱. vitest.
    skills/                # SKILL.md 이식(brainstorming/writing-plans/tdd/requesting-code-review …)
                           #   → 단계별 주입 지시문. Superpowers 텍스트를 meeagent 톤으로 적응.
    tiering.ts             # ctx.modelRegistry.find(provider, id)로 exec/review 모델 resolve,
                           #   ctx.setModel 스왑/복원.
    reviewer.ts            # 2단계 격리 리뷰 complete()(Sonnet) → {stage, severity, issues, verdict}
    caching.ts             # cacheRetention 설정 + before_provider_request 보정 + Usage 비용 로깅
    setup-workflow.ts      # wiring: /workflow(/brainstorm,/plan,/build) 커맨드 + 훅 오케스트레이션
test/workflow/
    state.test.ts  docs.test.ts  tiering.test.ts  reviewer.test.ts
```

### 재사용 (신규 코드 최소화)
- `plan-mode.ts` — 읽기전용 하드 차단 · 시스템 프롬프트 주입/스트립 패턴 · HARD-GATE 게이트.
- `diff-approval.ts` · `hashline/` · `bash-safety.ts` — execute 단계 편집/안전 게이트 그대로.
- `memory/llm.ts:runLLM` — **모델 오버라이드 인자 추가**(`runLLM(ctx, system, user, modelOverride?)`)
  하여 reviewer가 공유. 기존 distill/synthesize 호출은 인자 생략으로 무변경.
- `mode-state.ts` — 모드 상태 공유 참조.
- `git/setup-git.ts` — finish 단계 머지/PR.

---

## 8. 설정

`.pi/settings.json`(또는 워크플로우 전용 키):

```jsonc
{
  "model": "openrouter/anthropic/claude-sonnet-4.6",   // 컨트롤러/brainstorm/plan 기본
  "workflow": {
    "execModel":   "openrouter/anthropic/claude-haiku-4.5",
    "reviewModel": "openrouter/anthropic/claude-sonnet-4.6",
    "cacheRetention": "short"                            // 긴 세션은 "long"
  }
}
```

모델 미설정 시 현행 단일 모델로 폴백(점진 도입).

---

## 9. 데이터 흐름 (task 1건 end-to-end)

```
writing-plans 문서에서 다음 task pop
  → state: execute, ctx.setModel(Haiku), context 훅으로 컨텍스트 슬림
  → skills/tdd 지시문 주입
  → 모델: RED(실패 테스트) → 실행 확인 → GREEN(최소 구현) → REFACTOR
       └ edit/write 시 기존 diff-approval(default) 또는 acceptEdits 게이트
  → 테스트 통과 + 베이스라인 커밋 SHA 확보
  → state: review, reviewer.ts 격리 complete()(Sonnet) 2단계
       ① 스펙준수: task 스펙 vs diff → {Critical|Important|Minor}
       ② 코드품질: diff + 테스트 → {Critical|Important|Minor}   (①가 ✅일 때만)
  → Critical/Important?
       ├ 예 → 피드백을 Haiku 실행 루프에 재투입 → 재구현 → 재리뷰 (승인까지 반복)
       └ 아니오 → 플랜 문서 task `[x]` 마킹 + 커밋 → 다음 task pop
  → 모든 task 완료 → verify(최종 Sonnet 리뷰) → finish(/git 머지/PR)
```

---

## 10. 테스트 전략

- **유닛(vitest)**: `state` 전이표 · `docs` 파서(헤더/체크박스/경로) · `tiering` 모델 resolve ·
  `caching` 페이로드 보정 · `reviewer` 판정 파싱 — 전부 pi 비의존 순수 함수.
- **통합**: 스크립트된 tool_call/응답을 내는 **스텁 모델**로 brainstorm→plan→execute→review
  게이트와 2단계 리뷰 재투입 루프를 OpenRouter 실호출 없이 end-to-end 구동.
- **wiring**: pi 훅·커맨드 등록은 `tsc --noEmit` 타입체크 게이트(기존 메모리/해시라인 규율 동일).

---

## 11. 리스크 / 플랜 단계 스파이크

1. **pi 중첩 agent-session 노출 여부** — 진짜 subagent 디스패치(§5 대안) 가능한지, 불가하면
   메인루프+컨텍스트 스트립(권장안)으로 확정. → **1순위 스파이크**.
2. **OpenRouter `cache_control` 패스스루** — openai-completions 경로에서 Anthropic식
   `cache_control`이 실제 적용되는지 1회 호출로 `Usage.cacheRead > 0` 확인. 미적용이면
   `before_provider_request`에서 OpenRouter 캐싱 마커를 직접 주입.
3. **Haiku의 DSL/TDD 준수율** — Haiku가 hashline 패치 DSL과 RED-GREEN-REFACTOR를 안정적으로
   지키는지. 낮으면 execute에 가드/재시도 또는 일부 task만 상위 모델로 에스컬레이션.
4. **리뷰어 격리 컨텍스트 정확도** — diff+테스트만으로 충분한 판정이 나오는지, 부족하면 관련
   파일 스니펫을 최소 추가하는 규칙 정의.

---

## 12. 다음 단계

본 설계 승인 후 → `docs/plans/2026-06-03-meeagent-superpowers-workflow.md`(구현 플랜, task별
`- [ ]` TDD)를 작성하고, §11 스파이크부터 착수한다.

---

## 13. 부록 — 비용·아키텍처 전략 §8 토폴로지 재정렬 (2026-06-03)

본 설계(§3–§5)는 *메인루프=구현자(Haiku) / 매 task 리뷰=Sonnet* 토폴로지였다. 비용·프라이버시·
아키텍처 전략 문서의 **결말(§8)** 은 토폴로지를 뒤집는다 — 그쪽 구조로 구현을 재정렬했다.

### 13.1 역할 재배치

```
[오케스트레이터 / Sonnet]  brainstorm · plan · 최종 통합 cross-file 교차검증(verify 1회)
        │  좁은 task 스펙 위임
        ▼
[구현자 / Qwen3-Coder-Next]  좁은 구현 + 검증 + 정제 루프 (루프를 구현 tier에서 닫음)
        │  압축 신호만 반환
        └── status / changed_files / summary / blockers / next
```

- **구현 tier = `qwen/qwen3-coder-next`**(계획 중인 로컬 Qwen3-Coder-Next의 OpenRouter stand-in;
  cacheRead $0.07로 캐싱 유지). 구 exec tier(Haiku)는 아카이브.
- **검증·정제 루프(토큰의 ~59%)를 프리미엄에서 내림**: per-task self-review =
  `selfReviewModel`(기본 = `execModel`). 리뷰 실패 피드백 재투입도 구현 tier 안에서 닫는다.
- **Sonnet은 오케스트레이션 + 최종 통합 교차검증만**: 모든 task 통과 후 verify 단계에서 전체
  diff(`buildBaseSha..HEAD`) + 누적 압축 신호로 cross-file 통합 버그를 1회 점검(좁은 분할의 약점 보완).

### 13.2 압축 신호 경계 (전략문서 §8.2)

구현자→오케스트레이터로 넘어가는 유일한 출력은 고정 스키마(`workflow/signal.ts`):
`status / changed_files / summary / blockers / next`. 파일 본문·중간 재시도·통과 테스트 로그는
넘기지 않는다(원본 누수·재과금 구조적 차단). 통합 교차검증은 이 신호 ledger + diff를 보고, 구현자
트랜스크립트는 보지 않는다. TDD 스킬이 완료 시 `[[TASK-COMPLETE]]` + ```signal 블록을 출력하도록
프로토콜(`SIGNAL_PROTOCOL`)을 execute 단계 프리픽스로 주입한다.

### 13.3 설정 (`.pi/settings.json`)

```jsonc
{
  "model": "openrouter/anthropic/claude-sonnet-4.6",       // 오케스트레이터
  "workflow": {
    "execModel":       "openrouter/qwen/qwen3-coder-next",  // 구현 tier(로컬 stand-in)
    "selfReviewModel": "openrouter/qwen/qwen3-coder-next",  // 검증·정제 루프(구현 tier에서 닫음)
    "reviewModel":     "openrouter/anthropic/claude-sonnet-4.6", // 최종 통합 교차검증(오케스트레이터)
    "cacheRetention": "short",
    "maxReviewRetries": 3
  }
}
```

### 13.4 명령

`/workflow brainstorm | plan | build | review | verify | status | off`. `build`는 미완료 task부터
재개하며 첫 커밋 전 HEAD를 통합-diff 베이스로 고정한다. 모든 task 통과 시 자동으로 `verify`(통합
교차검증)로 넘어가고, 수동으로는 `/workflow verify`로 호출한다.

> 라이브 토큰·비용은 OpenRouter 대시보드에서 직접 확인한다(측정 하네스는 이 repo에 두지 않음).
