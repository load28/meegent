# meeagent — Design Spec

> pi 기반 Claude Code 클론 (터미널 TUI). OpenRouter 연동 코딩 에이전트에
> Claude Code의 **플랜모드**와 **diff 승인**을 동일하게 구현한다.

- **작성일**: 2026-06-02
- **상태**: 설계 승인 대기
- **런타임**: Bun + TypeScript
- **위치**: `Downloads/source/meeagent`

---

## 1. 목표 (What)

`@mariozechner/pi-coding-agent`의 런타임을 그대로 재사용하고, pi가 의도적으로
비워둔 3가지 — 권한모드 / 플랜모드 / diff 승인 — 을 extension으로 직접 구현해
**Claude Code와 동일한 UX**를 만든다.

> pi README 인용: *"No permission popups. ... build your own confirmation flow with
> extensions."* / *"No plan mode. ... build it with extensions."*
> → 우리가 만들 3가지가 정확히 pi의 빈칸이며, extension API가 이를 채우도록 열려 있다.

### 명시적 요구사항
1. pi + OpenRouter로 직접 동작하는 코딩 에이전트
2. Claude Code와 동일한 **플랜모드**: 읽기전용 리서치 → **렌더링된 마크다운 플랜** → 승인 게이트
3. 코드 수정 시 자동수정모드가 아니면 **diff로 변경 제안** → **승인 / 거절 / 커스텀 프롬프트**

### 비목표 (YAGNI)
- 웹/GUI (터미널 TUI만)
- `bypassPermissions` 모드 (MVP 제외)
- 멀티 에이전트·서브에이전트, 슬래시커맨드 신규 추가(pi 기본만 사용)

---

## 2. 기준이 되는 Claude Code 구현 (조사 결과)

| 요소 | Claude Code 동작 | meeagent 반영 |
|------|------------------|---------------|
| 모드 순환 | `Shift+Tab`: `default → acceptEdits(⏵⏵) → plan` | **동일** |
| acceptEdits | 편집/쓰기 + 일부 fs bash 무프롬프트 자동승인, 푸터 `⏵⏵ accept edits on` | **동일** |
| plan mode | 리서치만, 편집 안 함. **단 enforcement는 시스템 프롬프트 문자열뿐** (하드 차단 없음) | 프롬프트 **+ pi 훅으로 하드 차단** (CC보다 강함) |
| 플랜 승인 | 내장 `ExitPlanMode` 툴이 사용자 프롬프트 후 모드 전환 | 커스텀 `exit_plan_mode` 툴로 미러 |
| 승인 후 모드 | CC는 `acceptEdits`로 리셋(논란 있음) | **`default`로 전환** (편집마다 diff, 더 안전) |
| diff 승인 | 기본 모드에서 edit이 diff + Yes / Yes-don't-ask / No(+feedback) | 승인 / 거절(편집만 취소) / 커스텀 프롬프트 |

출처: code.claude.com/docs/en/permission-modes, dev.to "plan mode is prompt
engineering, not hard enforcement", anthropics/claude-code#39973.

---

## 3. 아키텍처

```
meeagent/
  .env                      # OPENROUTER_API_KEY=  (키 템플릿만, 커밋)
  .env.local                # 실제 키 (gitignored)
  package.json              # bun; deps: pi-coding-agent, pi-tui, pi-ai, diff
  src/
    index.ts                # pi 앱 구성 + extension 3개 등록 + 실행 진입점
    mode-state.ts           # 공유 모드 상태 (default|acceptEdits|plan) + 전이 로직 (순수)
    extensions/
      permission-mode.ts    # Shift+Tab 순환 등록 + 푸터 인디케이터
      plan-mode.ts          # 읽기전용 하드차단 + 시스템프롬프트 주입 + exit_plan_mode 툴
      diff-approval.ts      # edit/write tool_call 가로채기 → diff 카드 → 승인/거절/커스텀
    ui/
      diff-card.ts          # pi-tui 적·녹 diff 렌더 + 3지선다 프롬프트
      plan-view.ts          # pi-tui 마크다운 렌더 + 3지선다 프롬프트
  test/
    mode-state.test.ts
    diff.test.ts
    plan-deny.test.ts
```

### 컴포넌트 책임 (단일 책임 · 독립 테스트 가능)

**`mode-state.ts`** — 현재 모드를 들고 전이만 담당하는 순수 모듈.
`cycle()`(Shift+Tab), `set(mode)`, `current()`. 세 extension이 공유 참조.
의존성 없음 → 단위 테스트로 전이표 전체 검증.

**`permission-mode.ts` (extension)**
- `Shift+Tab` 키 핸들러 등록 → `mode-state.cycle()`
- 푸터 컴포넌트로 현재 모드 배지 렌더
- 입력: 키 이벤트 / 출력: 모드 전이 + 화면 배지

**`plan-mode.ts` (extension)**
- 모드 진입이 `plan`일 때 시스템 프롬프트에 지시 주입(CC 동일 문구):
  *"리서치만 하라. 파일을 수정하지 마라. 계획이 서면 `exit_plan_mode`를 호출하라."*
- `tool_call` 훅: `plan` 모드 중 `write`/`edit`/파괴적 `bash`(rm·mv·>· 등) → **deny + 사유**
  반환 → 모델이 자가 교정 (하드 차단)
- 커스텀 툴 `exit_plan_mode({ plan: string })`:
  1. `plan-view`로 마크다운 렌더
  2. 승인/거절/커스텀 프롬프트 대기
  3. 승인 → `mode-state.set('default')` + 빈 결과 반환(에이전트 실행 재개)
  4. 거절/커스텀 → `plan` 유지, 피드백 텍스트를 툴 결과로 반환

**`diff-approval.ts` (extension)**
- `tool_call` 훅: 대상이 `write`/`edit`일 때
  - `acceptEdits` → 통과(무프롬프트)
  - `plan` → (plan-mode가 이미 차단하므로 도달 안 함)
  - `default` → 기존 파일 내용 읽어 제안 내용과 **diff 계산** → `diff-card` 렌더 →
    - **승인** → allow (툴 실행)
    - **거절** → deny + `"User rejected this edit."` 결과 반환 (그 편집만 취소, 루프 계속)
    - **커스텀** → deny + 사용자 입력 텍스트를 결과로 반환 (루프 계속)

**`ui/diff-card.ts`** — `diff` 패키지로 unified hunk 생성, pi-tui로 적(-)·녹(+)
컬러 렌더. 하단에 `[a]승인 [r]거절 [c]커스텀` 프롬프트.

**`ui/plan-view.ts`** — pi-tui 마크다운 렌더러로 플랜 표시. 동일한 3지선다 프롬프트.

---

## 4. 데이터 흐름 (edit 한 건)

```
사용자 입력
  → Agent 루프 (pi-agent-core)
  → 모델이 tool_call(edit, {path, old, new}) 방출
  → [diff-approval] tool_call 훅 가로챔
       mode == acceptEdits ? → allow → edit 실행
       mode == default     ? → 기존파일 읽기 → diff 계산 → diff-card 렌더
                                  ├ 승인  → allow → edit 실행
                                  ├ 거절  → deny("User rejected this edit.")
                                  └ 커스텀 → deny(<사용자 텍스트>)
  → 결과를 모델에 반환 → 루프 계속
```

플랜모드 흐름:
```
Shift+Tab ×2 → plan 모드 → 시스템프롬프트 주입
  → 모델 리서치(read/grep/ls만; write/edit는 하드 deny)
  → 모델이 exit_plan_mode({plan}) 호출
  → plan-view 마크다운 렌더 → 승인 → default 모드 → 실행 재개
```

---

## 5. OpenRouter 연동

- `pi-ai`의 OpenRouter 프로바이더. 모델 예: `anthropic/claude-...`, `openai/...` 등 자유 전환.
- 키: `.env.local`의 `OPENROUTER_API_KEY` (`.env`는 키-only 템플릿, gitignored는 `.env.local`).
- `streamFn` 래퍼로 `X-Title: meeagent`, `HTTP-Referer` 어트리뷰션 헤더 추가.

---

## 6. 테스트 전략

- **유닛**: `mode-state` 전이표, diff 계산 hunk, plan-mode deny 판정(파괴적 bash 판별 포함) — 전부 순수함수.
- **통합**: 스크립트된 tool_call을 방출하는 스텁 모델(streamFn 대체)로 실제 OpenRouter 호출 없이
  승인/거절/커스텀·플랜 게이트 플로우를 end-to-end 구동.

---

## 7. 플랜 단계에서 검증할 리스크 (첫 태스크 = 스파이크)

설치된 pi 패키지의 **실제 타입**으로 다음 API 시그니처를 확정한다:
1. 키보드 단축키 등록 방식 (`Shift+Tab` 가로채기 가능 여부 / 충돌)
2. 커스텀 UI 컴포넌트(diff 카드·플랜 뷰) 마운트 방식과 입력 대기(블로킹 프롬프트) 패턴
3. `tool_call` 훅의 정확한 반환 형태 (allow / deny + 모델에 전달되는 결과 텍스트)
4. 모드별 시스템 프롬프트 동적 주입 지점
5. pi-tui 마크다운 렌더러 / diff 스타일 컴포넌트 가용성

→ 스파이크 결과에 따라 일부 기능이 pi 기본 컴포넌트로 충분한지, 직접 구현이 필요한지 확정.
