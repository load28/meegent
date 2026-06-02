# meeagent

pi(`@mariozechner/pi-coding-agent`) 위에 Claude Code식 플랜모드와 diff 승인을 얹은 OpenRouter 코딩 에이전트.

## 설정
1. `bun install`
2. `pi`(호스트)를 전역 설치: `bun add -g @earendil-works/pi-coding-agent@0.78.0`.
   `~/.bun/bin`을 PATH에 추가(`export PATH="$HOME/.bun/bin:$PATH"`). `pi update`도 이때 가능.
3. OpenRouter 키: `pi` 실행 후 `/login` → OpenRouter 선택 → 키 입력(`~/.pi/agent/auth.json`에 저장, 1회).

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

## 기능
- **Ctrl+Alt+P**: 권한 모드 순환 `default → ⏵⏵ accept edits → ⏸ plan`. (pi가 shift+tab을 예약하고 keybindings가 글로벌 전용이라, 글로벌 설정 없이 쓰려고 Ctrl+Alt+P를 택함 — pi 공식 plan-mode 예제와 동일.)
- **플랜 모드**: 읽기 전용 탐색 → "Plan:" 마크다운 → Approve / Stay / Refine.
- **diff 승인**(default 모드): 파일 수정 전 적·녹 diff 카드 → `a` 승인 / `r` 거절 / `c` 피드백.
- **accept edits 모드**: diff 카드 없이 자동 적용.

## 테스트
`bun run test`
