# meeagent 2-tier 학습 메모리 — Design Spec

> 세션에서 얻은 지식을 **프로젝트 / 글로벌** 두 계층으로 학습·축적하고, 시작 시 시스템프롬프트에
> 주입 + 세션 중 시맨틱 recall 하여 개발을 돕는 메모리 서브시스템.

- **작성일**: 2026-06-02
- **상태**: 설계 승인됨 (스펙 검토 대기)
- **대상**: meeagent (pi `@earendil-works/pi-coding-agent` 0.78.0 extension)
- **런타임**: Bun + TypeScript

---

## 1. 목표 (What)

세션마다 쌓인 데이터를 **자체 메모리**(honcho 미사용)에 저장·학습해 유저의 자산으로 쓴다.
학습은 **2-tier**로 나뉜다:
- **프로젝트 메모리** — 그 프로젝트에서만 유효한 지식 (예: "이 repo는 Vue Router로 라우팅", "API는 GraphQL").
- **글로벌 메모리** — 프로젝트를 가로질러 일반화되는 지식 (예: "함수형 패턴", "사용자 커밋 스타일").

글로벌은 **프로젝트 메모리들로부터 합성**된다. 두 계층 모두 매 세션 시작 시 에이전트에 주입되어,
같은 프로젝트를 다룰수록·여러 프로젝트를 거칠수록 에이전트가 점점 똑똑해진다.

### 참고 아키텍처 (조사)
- **Hermes Agent (Nous)**: 큐레이션 `MEMORY.md`를 세션 시작 시 frozen snapshot으로 주입(프리픽스 캐시 보존),
  과거 대화는 SQLite+FTS5로 recall, 에이전트가 `memory` 툴로 자가관리.
- **OpenClaw (pi 기반)**: L4 벡터검색(SQLite+임베딩) · L3 큐레이션 MEMORY.md · L2 일별 raw 로그.
- meeagent는 이 패턴을 차용하되 **명시적 2-tier(프로젝트↔글로벌) + 자동 태깅 승격 + 교차합성**을 더한다.

### 비목표 (YAGNI)
- 다중 사용자/팀 동기화, 원격 저장소, 클라우드 임베딩.
- honcho 연동 (자체 구축).
- 실시간 백그라운드 데몬 (CLI라 "시작 시 도래하면" 캐디지로 대체).

---

## 2. 결정 요약 (브레인스토밍)

| 축 | 결정 |
|----|------|
| 정체 | 자체 구축 2-tier (기술지식 + 유저선호), honcho 미사용 |
| 캡처 | 하이브리드 — raw 일별 로그 자동 + 주기적 LLM distill |
| 승격 | distill이 각 fact를 `scope=project\|global` 태깅 + 주기적 교차합성 |
| 저장 | 큐레이션 MEMORY.md(주입) + raw 로그(.md) + SQLite 벡터(시맨틱 recall) |
| 임베딩 | 로컬 (transformers.js / fastembed, API·키 불필요) |
| 트리거 | distill = 시작 시 도래 캐디지(신규 N로그·X시간) 자동 / 글로벌 합성 = `/learn-global` 명령 / raw 캡처 = 세션 종료 자동 |
| 저장 위치 | **repo 밖** `~/.meeagent/` (구조 위생, pi 세션 저장 방식과 동일하게 cwd-키) |

---

## 3. 저장 레이아웃

pi가 세션을 `~/.pi/agent/sessions/--<cwd>--`로 두는 것과 동일하게, 프로젝트 메모리도 **cwd 경로를 키**로
repo 밖에 둔다. 타깃 repo에는 아무 파일도 남기지 않는다.

```
~/.meeagent/
  global/
    MEMORY.md              # 큐레이션 글로벌 (주입용, 사람도 읽음)
    memory.db              # SQLite: facts + 임베딩 (글로벌 recall)
  projects/
    <project-key>/         # project-key = sanitize(absolute cwd)  (pi 세션 키와 동일 규칙)
      MEMORY.md            # 큐레이션 프로젝트 (주입용)
      memory.db            # SQLite: facts + 임베딩 (프로젝트 recall)
      logs/
        YYYY-MM-DD.md      # raw 일별 로그 (세션 요약 append)
  state.json               # { projects: { <key>: { lastDistillTs, undistilledLogCount } }, globalLastSynthTs }
```

- `MEMORY.md`: 사람이 읽고 git처럼 신뢰하는 큐레이션 텍스트. 글자수 상한으로 압축 유지(Hermes식).
- `memory.db` 스키마:
  ```sql
  CREATE TABLE facts (
    id INTEGER PRIMARY KEY,
    scope TEXT NOT NULL,        -- 'project' | 'global'
    text TEXT NOT NULL,
    embedding BLOB,             -- Float32 직렬화 (recall용)
    source TEXT,                -- 'distill' | 'synthesize' | 'tool'
    created_at INTEGER NOT NULL
  );
  ```
  코사인 유사도는 **JS에서 계산**(수천 건 규모는 sqlite 벡터 확장 불필요).

---

## 4. 컴포넌트 (단일 책임 · 독립 테스트)

순수 로직(파일·DB·코사인·파싱)과 부수효과(LLM·임베딩·pi 훅)를 분리한다.

| 파일 | 책임 | 의존 |
|------|------|------|
| `memory/paths.ts` | global 디렉토리, cwd→project-key→project 디렉토리 해석 (순수) | node:path/os |
| `memory/store.ts` | MEMORY.md 읽기/쓰기, raw 로그 append, state.json 읽기/쓰기 | paths, node:fs |
| `memory/db.ts` | `bun:sqlite` 열기·스키마, fact insert/select, **JS 코사인 topK** | bun:sqlite |
| `memory/embed.ts` | 로컬 임베딩 `embed(text)→Float32Array` (모델 1회 로드 캐시) | transformers.js/fastembed |
| `memory/llm.ts` | distill/synthesize용 LLM 래퍼 `runLLM(ctx, system, user)→string` | pi-ai `complete`, modelRegistry |
| `memory/capture.ts` | `agent_end`/`session_shutdown`에 세션 요약을 오늘 raw 로그에 append | store |
| `memory/distill.ts` | 미처리 raw 로그 → LLM → `{text, scope}[]` 추출, project MEMORY+db 기록, global 태그 승격 | store, db, embed, llm |
| `memory/synthesize.ts` | `/learn-global`: 프로젝트 facts 교차 → LLM 합성 → 글로벌 MEMORY+db | store, db, embed, llm |
| `memory/recall.ts` | `memory_recall` 툴: 쿼리 임베딩 → project+global 시맨틱 topK fact 반환 | db, embed |
| `memory/inject.ts` | `session_start`에 project+global MEMORY를 **고정**, `before_agent_start`마다 동일 주입 | store |
| `memory/scheduler.ts` | `session_start`에 state 확인 → distill 도래 시 자동 실행 | store, distill |
| `memory/setup-memory.ts` | 위를 extension에 wiring(훅·`memory_recall` 툴·`/learn-global` 명령 등록) | 전부 |

`index.ts`(기존 extension 진입점)에 `setupMemory(pi)` 한 줄 추가.

---

## 5. 데이터 흐름

### 5.1 캡처 (세션 종료, 자동)
`agent_end`(또는 `session_shutdown`) → `capture`가 이번 세션의 요약(유저 요청·수정 파일·핵심 결정)을
`projects/<key>/logs/<오늘>.md`에 append. state.json의 `undistilledLogCount++`.
요약은 저비용으로: 메시지/툴결과에서 추출하거나 1회 소형 LLM 요약(설정 가능).

### 5.2 distill (세션 시작, 캐디지 자동)
`session_start` → `scheduler`가 `undistilledLogCount ≥ N` 또는 `now-lastDistillTs ≥ X` 이면 `distill` 실행:
1. 미처리 raw 로그 읽기 → `llm.runLLM`으로 **fact 추출 + 각 fact를 project/global 태깅**
   (시스템프롬프트: "이 지식이 이 프로젝트에만 유효하면 project, 언어·패러다임·일반 원칙이면 global").
2. project fact → 프로젝트 `MEMORY.md` 병합(중복/모순 정리, 상한 압축) + `memory.db` insert(+임베딩).
3. global 태그 fact → 글로벌 `MEMORY.db`로 **승격** insert(+임베딩). (글로벌 MEMORY.md 본문 갱신은 5.4 합성에서)
4. state 갱신(lastDistillTs, count=0).

### 5.3 주입 (frozen snapshot)
`session_start`에 project `MEMORY.md` + global `MEMORY.md`를 읽어 **메모리 블록을 1회 고정**.
이후 매 `before_agent_start`가 동일 블록을 시스템프롬프트에 주입 → 프리픽스 캐시 안정(Hermes 방식).

### 5.4 글로벌 합성 (`/learn-global`, 명령)
여러 `projects/*/memory.db`의 facts(특히 global 태그 + 반복 등장 project fact)를 모아 LLM이 교차 합성 →
중복·프로젝트 특수성을 걷어낸 **일반 원칙**을 글로벌 `MEMORY.md` 본문 + `global/memory.db`에 기록.

### 5.5 recall (세션 중, 툴)
LLM이 `memory_recall(query)` 호출 → 쿼리 임베딩 → project+global db에서 코사인 topK fact 반환.
주입된 MEMORY에 없는 세부를 끌어오는 on-demand 채널.

---

## 6. 빌드 단계 (phase)

- **Phase 1 — 마크다운 2-tier 코어**: `paths·store·llm·capture·distill(태깅)·inject` + `/learn-global` 골격.
  검색 DB 없이도 **프로젝트/글로벌 MEMORY 주입 + 학습**이 동작. (가장 큰 가치를 먼저)
- **Phase 2 — 시맨틱 레이어**: `embed·db·recall 툴` + `scheduler` 자동 캐디지 + 합성의 db 활용.

각 phase는 독립적으로 동작·테스트 가능하다.

---

## 7. pi API 근거 (0.78, 설치본 검증)

- **LLM 호출**: `import { complete } from "@earendil-works/pi-ai"` (qna.ts·summarize.ts 0.78 예제 사용),
  인증은 `ctx.modelRegistry.getApiKeyAndHeaders(ctx.model)` (model-registry.d.ts:71). 세션의 OpenRouter 모델 재사용.
- **주입**: `pi.on("before_agent_start", () => ({ systemPrompt }))`, 고정은 `pi.on("session_start", ...)`에서 캡처.
- **캡처**: `pi.on("agent_end" | "session_shutdown", ...)`.
- **툴/명령**: `pi.registerTool({ name: "memory_recall", ... })`, `pi.registerCommand("learn-global", ...)`.
- **SQLite**: `import { Database } from "bun:sqlite"` (런타임 검증 OK).
- **임베딩**: pi-ai에 embed export 없음 → 로컬 라이브러리(transformers.js / fastembed). Phase 2 첫 태스크 스파이크로 확정.

---

## 8. 테스트 전략

- **유닛(순수)**: `paths`(키 생성), `store`(MEMORY 병합/상한 압축, state 입출력), `db`(insert/select, **JS 코사인 topK**), distill 출력 파서(태그 분류).
- **통합**: `bun:sqlite` 실제 임시 DB로 db 라운드트립(testcontainers 불필요 — 파일 SQLite). LLM·임베딩은 스텁(스크립트된 fact 반환)으로 distill/synthesize/recall 플로우 구동.
- LLM/임베딩 실호출 검증은 사용자 수동.

---

## 9. 리스크 / 스파이크 (Phase 2 첫 태스크)

1. 로컬 임베딩 라이브러리 선택·Bun 동작(`@huggingface/transformers` v3 vs `fastembed`), 최초 모델 다운로드 크기/시간.
2. `complete()` 정확한 0.78 시그니처(context·options 형태) — qna.ts 패턴 복제로 확정.
3. raw 로그 요약 비용(세션 종료마다 LLM 호출 여부) — 기본은 비-LLM 추출, 옵션으로 LLM.
4. MEMORY.md 상한 압축 정책(글자수 한도 도달 시 LLM 압축 vs 오래된 항목 제거).
