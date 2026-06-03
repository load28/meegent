# meeagent — LSP/의미 기반 코드 탐색 설계 (Serena via MCP)

> AI가 코드를 효율적으로 탐색하도록 LSP 기반 의미 탐색을 meeagent에 추가한다.

- **작성일**: 2026-06-03
- **상태**: 1차 구현 완료(읽기/탐색 + 안전 가드), 런타임 e2e 검증은 사용자 환경에서
- **결정**: Serena를 `pi-mcp-adapter`(프록시)로 연동, meeagent는 안전 가드만 소유

---

## 1. 목표

좌표(grep→line/char) 기반의 텍스트 탐색을 넘어, **심볼 단위 의미 탐색**(정의/참조/
개요 보기)을 모델에게 제공해 큰 코드베이스에서의 탐색 효율과 토큰 효율을 높인다.

## 2. 검토한 3가지 방식

| | A. oh-my-pi식 in-process LSP | B. Serena via MCP | C. 하이브리드 |
|---|---|---|---|
| 구조 | meeagent(Node)가 language server를 직접 spawn(JSON-RPC) | Serena(별도 Python) ← pi-mcp-adapter ← meeagent | in-process LSP + Serena식 name_path 도구 표면 |
| 도구 추상화 | 좌표(filePath+line+char) | 심볼 name_path | name_path |
| 편집/리팩터 | 약함 | 강함(symbol 편집·rename·move) | 직접 설계 |
| 언어 | TS 우선(서버 설치 필요) | 40+ 언어, LSP 자동 수급 | TS 우선 |
| 런타임 부담 | 낮음(typescript-language-server만) | 높음(uv+Python+Serena) | 낮음 |
| 코드 소유 | 전부 직접(대량) | 어댑터·Serena 위임 | 직접(중간) |

### 핵심 사실
- **pi는 MCP를 내장하지 않는다**(설계상 명시). 따라서 B도 "그냥 꽂기"가 아니라
  MCP 클라이언트 확장이 필요하다. 다만 기성 어댑터(`pi-mcp-adapter`)가 있어 직접
  브리지를 짤 필요는 없다.
- meeagent의 존재 이유는 **plan 모드 + diff 승인(안전)**. 외부 프로세스가 파일을
  직접 쓰는 편집 도구는 이 보증을 우회하므로, 어느 방식이든 안전 가드 배선은 우리 몫.

## 3. 결정: B (Serena + pi-mcp-adapter)

다언어·심볼 편집·메모리 등 Serena의 성숙한 기능을 위임받고, 어댑터의 **단일 `mcp`
프록시 툴** 덕에 meeagent 쪽 배선이 최소화된다(허용목록에 `mcp` 1개).

### 트레이드오프(수용)
- uv/Python/Serena 사이드카 필요(샌드박스/web 세션에선 제약 가능).
- 프록시 방식이라 모델이 도구를 search→call로 1스텝 더 탐색.
- Serena 편집 도구는 diff "카드"를 못 만든다(서버 내부 적용) → 승인은 *확인 프롬프트*로 대체.

## 4. 구현 (이 repo가 소유하는 부분)

- `.pi/mcp.json` — Serena를 `uvx`로 lazy 기동(`--context ide-assistant`, `--project .`).
- `mcp/mcp-safety.ts` — 순수 분류. `mcp` 프록시 인자에서 대상 툴명을 뽑고
  (`{tool}` 형태만 실행, 나머지는 메타=읽기), 변경/실행 도구 여부를 패턴으로 판정
  (`bash-safety.ts`와 동일 스타일, 과차단 편향).
- `mcp/setup-mcp.ts` — `tool_call` 훅(`toolName==="mcp"`):
  - meta/read → 통과
  - mutate & plan → 차단(사유 반환)
  - mutate & default → 승인/거절/피드백 확인
  - mutate & acceptEdits → 자동 허용
- `permission-mode.ts` — `mcp`를 `READONLY_TOOLS`/`FULL_TOOLS`에 추가(가드가 따로
  변경 호출만 막으므로 plan에서도 검색·읽기엔 사용 가능).
- `index.ts` — `setupMcp(pi, state)` 등록.
- 어댑터 설치는 pi 패키지 방식(`pi install npm:pi-mcp-adapter`). 무거운 의존성을
  meeagent repo deps로 끌어오지 않기 위해 vendoring하지 않는다. 어댑터 부재 시
  배선은 무해하게 비활성.

## 5. 테스트

- `test/mcp/mcp-safety.test.ts` — 대상 툴 추출, 변경/읽기 분류, 구분자/접두사 변형,
  메타 op 처리. (순수 함수 단위 테스트)
- 가드 훅의 UI 분기(승인/거절)는 e2e 성격이라 단위 테스트 제외.

## 6. 후속(YAGNI 보류)

- `directTools` 모드 지원 시 개별 Serena 도구명을 허용목록/가드에 반영(현재는 프록시 권장).
- Serena 편집을 진짜 diff 카드로 미리보기(서버 응답의 edit 추출 필요).
- A/C(in-process LSP)와의 성능·UX 비교 PoC.
