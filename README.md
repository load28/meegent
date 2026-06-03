# meeagent

pi(`@mariozechner/pi-coding-agent`) 위에 Claude Code식 플랜모드와 diff 승인을 얹은 OpenRouter 코딩 에이전트.

## 설정
1. `bun install`
2. `pi`(호스트)를 전역 설치: `bun add -g @earendil-works/pi-coding-agent@0.78.0`.
   `~/.bun/bin`을 PATH에 추가(`export PATH="$HOME/.bun/bin:$PATH"`). `pi update`도 이때 가능.
3. OpenRouter 키: `pi` 실행 후 `/login` → OpenRouter 선택 → 키 입력(`~/.pi/agent/auth.json`에 저장, 1회).
4. **Shift+Tab 해방** (모드 순환용): pi는 shift+tab을 `app.thinking.cycle`에 예약하고 keybindings를
   글로벌(`~/.pi/agent/keybindings.json`)에서만 읽으므로, 그 액션을 언바인드한다:
   ```json
   { "app.thinking.cycle": [] }
   ```
   (thinking 순환 키가 필요하면 `[]` 대신 빈 키 — 예 `"ctrl+\\"` — 로 옮겨도 된다.)

> pi 패키지는 `@mariozechner/*`(≤0.73.1, 동결)에서 **`@earendil-works/*`(0.78.0~)** 스코프로 이전됐다.
> 확장은 호스트 pi가 자기 런타임을 alias로 주입하므로(extension 로더), 확장은 **호스트 pi 버전의 API**를
> 사용한다. 이 repo의 `@earendil-works/*` 의존성은 타입체크 기준일 뿐이며 호스트와 버전을 맞춰 둔다.

## repo 내부에서 실행
```bash
pi   # 이 repo의 .pi/settings.json + 확장으로 이 repo를 대상 작업
```

## 다른 프로젝트에서 개발 모드로 실행
모든 확장은 이 repo 안에만 둔다(확장 패키징은 추후). 다른 프로젝트(예: tooday)에서 그 프로젝트의
`.pi/settings.json`이 **이 repo의 확장 경로**를 가리키게 하면, 그곳에서 `pi`를 실행할 때 meeagent
에이전트가 그 프로젝트를 대상으로 동작한다. 타깃 repo의 git에는 `.pi/`를 넣지 않는다
(예: `.git/info/exclude`에 `.pi/` 추가).

`<target>/.pi/settings.json` (pi는 project-local `settings.json`은 읽지만 keybindings는 글로벌만 읽는다):
```json
{
  "model": "openrouter/anthropic/claude-3.5-sonnet",
  "extensions": ["/Users/seominyong/Downloads/source/meeagent/.pi/extensions/meeagent"]
}
```
실행:
```bash
cd <target>
pi            # 전역 pi가 위 설정으로 meeagent 확장을 로드
```

> **Serena(MCP)는 별도다.** `.pi/settings.json`은 확장(코드)만 가리킨다 — MCP 서버 설정은
> 따라가지 않는다. 어댑터의 `.pi/mcp.json`은 cwd 기준 project-local이라 `meeagent/.pi/mcp.json`은
> 다른 프로젝트에서 안 읽힌다. cross-project로 Serena를 쓰려면 **글로벌** `~/.pi/agent/mcp.json`에
> serena 설정(아래 「LSP/MCP」와 동일, `directTools` 포함)을 둔다. `--project .`가 cwd를 타겟팅하므로
> 어느 프로젝트에서 실행하든 그 프로젝트를 대상으로 동작한다(병합 우선순위상 project-local
> `.pi/mcp.json`이 글로벌을 override하므로 meeagent repo 자신은 기존 설정을 그대로 쓴다).

## 기능
- **Shift+Tab**: 권한 모드 순환 `default → ⏵⏵ accept edits → ⏸ plan`. pi가 shift+tab을
  `app.thinking.cycle`에 예약하고 keybindings는 글로벌 전용이라, 아래 글로벌 1파일이 필요하다.
- **플랜 모드**: 읽기 전용 탐색 → "Plan:" 마크다운 → Approve / Stay / Refine.
- **diff 승인**(default 모드): 파일 수정 전 적·녹 diff 카드 → `a` 승인 / `r` 거절 / `c` 피드백.
- **accept edits 모드**: diff 카드 없이 자동 적용.
- **lazygit git 화면(`/git`)**: git CLI 대신 [lazygit](https://github.com/jesseduffield/lazygit) TUI로
  git을 관리한다. `/git`은 lazygit을 **풀스크린으로 전환**(새 tmux window, lazygit 종료 시 복귀),
  `/git split`은 **터미널 오른편 pane**에 lazygit을 띄우고 왼편 meeagent는 유지한다.
  pi-tui가 터미널 점유를 양보하지 못하므로 화면 전환·분할은 **tmux**로 처리한다 —
  `bin/meeagent` 런처가 대화형 실행을 tmux 세션으로 자동 래핑하므로 별도 설정 없이 동작한다
  (lazygit은 직접 설치 필요: 예 `brew install lazygit`). tmux 밖에서 `pi`를 직접 실행한 경우엔
  안내 메시지로 알린다.
- **hashline 편집(`hashedit`)**: oh-my-pi식 해시 앵커 편집을 이식했다. `read`가 파일을
  `¶path#TAG`(파일 전체 4-hex 해시) 헤더 + `LINE:TEXT` 번호 라인으로 보여주고, 모델은 라인을
  다시 타이핑하지 않고 패치 DSL(`replace N..M:` / `insert before|after|head|tail:` / `delete N..M`,
  본문 `+TEXT`)로 편집한다. `replace block N:` / `delete block N`은 **tree-sitter**(web-tree-sitter)로
  블록 경계를 정밀 해석한다(미지원 언어는 브레이스/들여쓰기 폴백). 기본 `edit`를 대체하며(신규 파일은
  `write`), `read` 이후 파일이 바뀌어 태그가 어긋나면 스냅샷 **3-way 병합으로 자동 복구**하고, 실패할
  때만 거부한다. diff 승인·plan·accept edits에 그대로 편입된다. 설계·구현은 `docs/specs`·`docs/plans`의
  hashline 문서 참고.
- **LSP/의미 기반 코드 탐색 (Serena MCP)**: [Serena](https://github.com/oraios/serena)를
  pi-mcp-adapter로 붙여 심볼 단위 탐색(`find_symbol`, `get_symbols_overview`,
  `find_referencing_symbols` 등)을 제공한다. 좌표 대신 심볼 이름으로 코드를 탐색해
  토큰을 아낀다. meeagent는 MCP 호출을 권한 모드에 편입한다(아래).

## LSP/MCP (Serena) 연동
pi는 MCP를 내장하지 않으므로(설계상), 범용 MCP 클라이언트 확장
[`pi-mcp-adapter`](https://github.com/nicobailon/pi-mcp-adapter)로 Serena를 붙인다.

1. 어댑터 설치(1회): `pi install npm:pi-mcp-adapter` 후 pi 재시작.
2. Serena 런타임: `uv`(Python) 필요. 이 repo의 `.pi/mcp.json`이 `uvx`로 Serena를
   lazy 기동하도록 설정돼 있다(첫 MCP 호출 시 연결).
   - **cross-project**: 다른 프로젝트에서도 Serena를 쓰려면 같은 serena 블록을 **글로벌**
     `~/.pi/agent/mcp.json`에 둔다(project-local `.pi/mcp.json`은 cwd 밖에선 안 읽히므로).
3. 사용: 읽기 전용 **탐색 툴은 `directTools`로 직접 노출**돼 `serena_*` 이름으로 툴 목록에 바로 뜬다
   (`serena_find_symbol`, `serena_get_symbols_overview`, `serena_find_referencing_symbols`,
   `serena_find_implementations`, `serena_find_declaration`). 모델이 grep 대신 심볼 탐색을 쓰게
   하려는 의도다 — `permission-mode.ts`의 화이트리스트와 plan 프롬프트도 이 이름을 우대한다.
   *수정/실행* 도구는 directTools에서 제외해 단일 프록시 툴 `mcp`로만 호출된다(아래 안전 모델).
   `mcp({ search: "..." })` → `mcp({ tool: "serena_replace_symbol_body", args: "{...}" })`.
   - directTools는 `mcp-cache.json`에서 등록된다. config 변경 후 안 보이면 `/mcp reconnect serena`.

**안전 모델 편입** (`mcp/setup-mcp.ts`): `mcp` 프록시로 호출되는 Serena의 *편집/실행*
도구(`replace_symbol_body`, `execute_shell_command` 등)는 MCP 서버 안에서 실행돼
diff 승인·plan 차단을 우회한다. 그래서 meeagent는 `tool_call` 훅으로 이를 가로채:
- **plan**: 변경/실행 도구 차단(검색·읽기 도구는 허용)
- **default**: 변경 도구 호출 전 승인/거절/피드백 확인
- **accept edits**: 자동 승인

읽기/탐색 도구와 메타 op(search/describe/list)는 모든 모드에서 그대로 통과한다.
어댑터가 없으면 `mcp` 툴이 없으니 이 배선은 무해하게 비활성된다.

## 테스트
`bun run test`
