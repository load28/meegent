# meeagent — Hashline(해시 앵커 편집) 이식 설계

> oh-my-pi의 "코드 수정 시 똑똑함"의 핵심인 **hashline 편집**을 meeagent에 동일 포맷으로 이식한다.
> 모델이 라인을 다시 타이핑하지 않고 **라인 번호 앵커**를 가리켜 편집하고, **파일 전체 해시 태그**로
> stale 편집을 적용 전에 거부한다. 출력 토큰↓, "string-not-found"·공백 불일치 루프 제거.

- **작성일**: 2026-06-03
- **상태**: 설계 확정, 구현 대기(별도 플랜: `docs/plans/2026-06-03-meeagent-hashline-edit.md`)
- **결정**: 커스텀 `hashedit` 툴 + `read` 뷰 재작성(`tool_result` 훅), 기존 diff 승인·권한 모드에 편입

---

## 1. 목표

기본 `edit`(oldText/newText 정확 일치) 대신, oh-my-pi식 **hashline 편집**을 제공한다.

- **토큰 절감**: 바꾸려는 라인을 다시 적지 않고 라인 번호 범위(`replace 12..14:`)만 가리킨다.
- **실패 루프 제거**: oldText 문자열 매칭이 없으므로 공백/중복으로 인한 "not found" 재시도가 사라진다.
- **안전(stale 거부)**: read 이후 파일이 바뀌면 **파일 해시 태그**가 어긋나 편집을 적용 전에 거부한다.
- **meeagent 보증 유지**: plan 차단 / default diff 승인 / acceptEdits 자동적용에 그대로 편입된다.

## 2. 배경 — oh-my-pi의 실제 hashline (소스 기반, `can1357/oh-my-pi@main`)

블로그에 도는 "라인별 해시(`LINE:HASH|content`)·647 bigram"은 **구버전/서드파티**(`RimuruW/pi-hashline-edit`)
설계다. 현재 `main`은 다르다:

- **파일 전체 해시 태그**: `computeFileHash` = `Bun.hash.xxHash32(normalized, 0) & 0xffff` → 4자리 대문자 hex
  (`[0-9A-F]{4}`, 65,536 공간). `normalized`는 각 줄/마지막 줄의 후행 `[ \t\r]+`를 제거(`CR` 제거 → CRLF 무관,
  표시용 trim이 태그를 깨지 않음). 라인별 해시는 **없다**.
- **앵커 = 1-기반 라인 번호**(`[1-9]\d*`). 안정성은 라인 해시가 아니라 파일 태그가 보장한다.
- **read/search 뷰**: 섹션 헤더 `¶PATH#TAG` 다음에 라인들을 `LINE:TEXT`(구분자 콜론 `:`)로 보여준다.
  예:
  ```
  ¶greet.py#A1B2
  1:def greet(name):
  2:    msg = "Hello, " + name
  3:    print(msg)
  ```
- **편집 툴**: 이름 `edit`(hashline 모드). 파라미터는 단일 `{ input: string }`이고, 구조는 전부 `input`
  문자열 안의 패치 DSL이다(문법: `packages/hashline/src/grammar.lark`):
  ```
  *** Begin Patch
  ¶greet.py#A1B2
  insert after 1:
  +    if not name: name = "stranger"
  replace 2..2:
  +    greeting = "Hi"
  +    msg = f"{greeting}, {name}"
  delete 3
  *** End Patch
  ```
  - 본문 행은 오직 `+TEXT`(새 최종 내용; 선행 공백 보존). `+`만 있으면 빈 줄. 리터럴 `+`/`-`로 시작하는
    줄은 `++x`/`+-x`로 이스케이프. **`-old`/컨텍스트 행은 없다** — 범위가 삭제를 담당한다.
  - 연산: `replace N..M:`, `insert before|after N:`, `insert head|tail:`, `delete N..M`,
    (+ tree-sitter 기반 `replace block N:` / `delete block N`).
- **적용/검증**(`patcher.ts`/`apply.ts`): 라인 번호는 **원본** 기준(패치 동안 안 밀림), 적용은 **하단부터**
  버킷 처리. 경계 검사(`1..len`). stale 검증은 라인 재해시가 아니라 **현재 파일 전체 해시 == 헤더 태그**
  비교 1회. 불일치 시 `MismatchError`로 거부하되, 알던 스냅샷이면 3-way 병합 복구 시도.
- **재접지(re-ground)**: 편집이 적용되면 새 `#TAG`로 갱신·재번호되어 직전 태그/라인 번호는 무효.
  툴 응답에 새 `¶PATH#TAG`+갱신 뷰를 돌려줘 연속 편집을 가능케 한다.

## 3. 제약 — meeagent는 호스트 pi의 *확장*이다

meeagent는 `@earendil-works/pi-coding-agent`(0.78) 위 확장이라, 호스트의 코어 `edit` 툴(oh-my-pi의
4-모드 `edit`)을 바꿀 수 없다. 대신 확장 API로 동등한 표면을 만든다(확인된 API):

- `registerTool(defineTool(...))` — 커스텀 `hashedit` 툴 등록.
- `on("tool_result", …)` → `{ content }` 반환으로 **`read` 출력 내용을 교체** → 앵커 뷰(`¶PATH#TAG`+`LINE:TEXT`) 주입.
- `on("tool_call", …)` → `{ block, reason }` — 기존 diff 승인/plan 가드 재사용.
- `setActiveTools([...])` — 기본 `edit`를 빼고 `hashedit`를 노출(신규 파일은 `write` 유지).

## 4. 검토한 3가지 방식

| | A. 커스텀 hashedit + read 뷰 재작성 | B. 기본 edit 위 robust 래퍼 | C. 호스트 pi 포크 |
|---|---|---|---|
| 모델이 보는 것 | `¶PATH#TAG`+`LINE:TEXT` (oh-my-pi 동일) | 변경 없음(기존 read 그대로) | 동일 |
| 편집 표면 | 라인 번호 앵커 패치 DSL | oldText/newText (공백무시·퍼지 보강) | 라인 번호 앵커 |
| 토큰 절감 | 큼(라인 재타이핑 없음) | 작음(여전히 oldText 전송) | 큼 |
| stale 안전 | 파일 태그 검증(동일) | 약함(매칭 실패로 간접) | 동일 |
| 작업량 | 중(파서·적용·뷰·툴) | 소~중 | 대(상류 포크·유지보수) |
| 원본 충실도 | 높음 | 낮음 | 최고(but 과함) |

## 5. 결정: A — 커스텀 `hashedit` + `read` 뷰 재작성

oh-my-pi의 **가시 포맷(헤더/번호/패치 DSL)을 그대로** 재현하면서, meeagent가 소유할 수 있는 확장
API 안에 담긴다. 기본 `edit`는 끄고(FULL_TOOLS에서 `edit`→`hashedit`), `write`(신규 파일)는 남긴다.
`read` 뷰는 hashedit가 항상 활성이므로 **모든 모드에서 앵커 뷰로 통일**한다(plan 포함; plan은 편집만 차단).

### 안전 모델 편입(기존 자산 재사용)
- **plan**: `hashedit`는 변경 도구이므로 tool 허용목록에서 제외(읽기/뷰는 허용).
- **default**: `diff-approval`이 `hashedit`도 게이트 — 패치를 적용 전에 파싱·적용해 **동일한 적·녹 diff 카드**를
  만들고 a/r/c 확인. 거절 시 사유 반환으로 차단.
- **acceptEdits**: 자동 적용.
- stale(태그 불일치)는 `hashedit.execute`가 **적용 전에 거부**하고, oh-my-pi와 동일 톤의 메시지로
  "현재 파일을 다시 `read`해 새 `¶path#tag`를 복사하라"고 모델에 지시.

## 6. 구현(이 repo가 소유) — 요약

순수 로직(해시/뷰/파서/적용)은 pi 비의존 모듈로 분리해 vitest 단위 테스트하고, 툴·훅 wiring은
타입체크로 검증한다(메모리/MCP 기능과 동일 패턴).

- `hashline/format.ts` — `computeFileHash`(xxHash32 low16, 4-hex)·정규화·`¶PATH#TAG`/`LINE:TEXT` 포맷터.
- `hashline/view.ts` — `buildView(path, content, offset?, limit?)` → 헤더+번호 라인(부분 read는 절대 번호 유지).
- `hashline/parse.ts` — 패치 DSL → 섹션/헌크/연산(`replace/insert/delete` + block 연산 + `+TEXT` 본문, `+`/`-` 이스케이프).
- `hashline/block.ts` — `resolveBlock(lines, startLine)`: 브레이스/들여쓰기 기반 블록 범위 해석(tree-sitter 치환).
- `hashline/apply.ts` — `applyEdits(content, edits)` 블록 해석 → 경계 자동수선(echo 제거) → 하단부터 적용 + 경계 검사.
- `hashline/merge.ts` — `threeWayMerge(base, current, intended)`: stale 복구용 zero-fuzz 3-way 병합.
- `hashline/snapshots.ts` — `path#TAG` 키 스냅샷 스토어(싱글톤): read·edit 시 기록, 복구 시 조회.
- `hashline/patch.ts` — `preparePatch(patchText, readFile, recover?)`: 파싱 → 태그 검증 → (stale면 3-way 복구
  시도) → 적용 → `{ newContent, newView, recovered }`. diff 미리보기(diff-approval)와 실제 커밋(execute)이 **공유**.
- `hashedit-tool.ts` — `defineTool({ name:"hashedit", parameters:{input}, execute })`: `prepare`+쓰기, 응답에
  **새 `¶PATH#TAG`+갱신 뷰** 반환(재접지).
- `hashedit-view.ts` — `tool_result`(read) 훅: 디스크에서 재계산한 앵커 뷰로 `content` 교체(텍스트 파일만).
- 기존 파일 수정:
  - `permission-mode.ts` — `FULL_TOOLS`에서 `edit`→`hashedit`. `READONLY_TOOLS`엔 read만(뷰는 훅이 처리).
  - `diff-approval.ts` — `hashedit` 분기 추가: `patch.prepare`로 before/after 산출 → 기존 colorize diff 카드.
  - `index.ts` — `setupHashline(pi, state)` 등록.

## 7. 원본과의 차이 — 포함/치환/제외

oh-my-pi의 견고성 기능을 모두 이식하되, 일부는 의존성을 줄여 동등 기능으로 치환한다.

**포함(동등 구현됨)**
- **스냅샷 3-way 복구** (`snapshots.ts`+`merge.ts`): read·성공 edit 시점 내용을 태그로 저장하고,
  stale 편집은 그냥 거부하는 대신 스냅샷→현재 파일 3-way 병합(zero-fuzz)으로 자동 복구. 병합 실패 시만 거부.
- **경계 자동수선** (`apply.ts`): `replace` 본문이 범위 바로 앞/뒤 미변경 줄을 중복 echo하면 적용 전 제거.
- **block 연산**: `replace block N:` / `delete block N` 제공.

**치환(의존성 최소화, 모델-대면 기능은 동일)**
- block 경계 해석은 **tree-sitter 대신 브레이스/들여쓰기 리졸버**(`block.ts`). 끝줄 없이 블록 지정은
  동일하게 되나, 매크로·문자열 내 중괄호 등 엣지에서 tree-sitter만큼 정밀하진 않다(이 repo의 무거운
  의존성 회피 철학과 일치 — LSP 스펙에서 Serena 위임을 택한 것과 동일한 트레이드오프).
- 경계 자동수선은 oh-my-pi의 **echo 제거** 부분을 충실 구현하고, 주석/문자열 인식 델리미터 밸런서(누락
  닫는 괄호 자동 보강)는 단순화/보류(echo 제거가 안전·고가치 부분).

**제외(차이 아님/불요)**
- `patch`/`replace`/`apply_patch` 대체 편집 모드 — hashline과 *대안* 관계라 빼도 hashline 기능엔 영향 없음.
- 해시 함수 바이트 일치 불요(상호운용 없음; 태그는 세션-로컬, read마다 재생성). 포맷 충실을 위해 xxHash32
  low16/4-hex만 재현.

## 8. 테스트

- `format.test.ts` — 해시 결정성·4-hex 형식·후행공백 정규화 불변, 헤더/라인 포맷터.
- `view.test.ts` — 전체/부분(offset+limit) 뷰의 절대 번호·헤더 태그.
- `parse.test.ts` — 각 연산 파싱(블록 포함), `+`/`-` 이스케이프, 잘못된 문법 에러.
- `apply.test.ts` — replace 길이 무관(1→N), insert before/after/head/tail, delete, 하단부터 적용,
  경계 위반 에러, **경계 자동수선(echo 제거)**, **block 적용**.
- `block.test.ts` — 브레이스/중첩/들여쓰기 블록 해석, 경계.
- `merge.test.ts` — 드리프트 영역 밖 편집 안착 / 겹치면 실패.
- `snapshots.test.ts` — 태그 키 기록·조회·LRU 축출.
- `patch.test.ts` — 태그 일치 적용·갱신뷰, stale 단순 거부, **스냅샷 3-way 복구 성공/실패**.
- `roundtrip.test.ts` — read뷰 태그→패치 적용→옛 태그 stale 재거부 계약.
- 훅/툴 UI 분기(승인/거절, registerTool 시그니처)는 e2e 성격 → 타입체크 게이트.

## 9. 후속(YAGNI 보류)

- block 경계의 tree-sitter 정밀화(현재 브레이스/들여쓰기 리졸버) — 필요 언어에서 오해석이 잦으면 도입.
- 경계 자동수선에 주석/문자열 인식 델리미터 밸런서(누락 닫는 괄호 보강) 추가.
- `grep`/`find` 결과에도 태그 노출(현재는 `read`만; 모델은 edit 전 `read`로 접지).
- 토큰 절감 실측(A/B: 기본 edit vs hashedit) PoC.
