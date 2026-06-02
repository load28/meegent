# meeagent

pi(`@mariozechner/pi-coding-agent`) 위에 Claude Code식 플랜모드와 diff 승인을 얹은 OpenRouter 코딩 에이전트.

## 설정
1. `cp .env .env.local` 후 `.env.local`의 `OPENROUTER_API_KEY`에 실제 키 입력.
2. `bun install`

## repo 내부에서 실행
```bash
bun start   # (= ./bin/meeagent) 이 repo를 대상으로 pinned pi 실행
```

## 다른 프로젝트에서 개발 모드로 실행
모든 확장은 이 repo 안에만 둔다(전역 설치 없음 — 패키징은 추후). 다른 프로젝트(예: tooday)에서
그 프로젝트의 `.pi/settings.json`이 **이 repo의 확장 경로**를 가리키게 하면, 그곳에서 pi를 실행할 때
meeagent 에이전트가 그 프로젝트를 대상으로 동작한다. 타깃 repo의 git에는 `.pi/`를 넣지 않는다
(예: `.git/info/exclude`에 `.pi/` 추가).

`<target>/.pi/settings.json`:
```json
{
  "model": "openrouter/anthropic/claude-3.5-sonnet",
  "extensions": ["/Users/seominyong/Downloads/source/meeagent/.pi/extensions/meeagent"]
}
```
`<target>/.pi/keybindings.json`:
```json
{ "app.thinking.cycle": "ctrl+t" }
```
실행 (이 repo의 pinned pi 사용, OpenRouter 키는 이 repo의 `.env.local`에서 로드):
```bash
cd <target>
set -a; . /Users/seominyong/Downloads/source/meeagent/.env.local; set +a
/Users/seominyong/Downloads/source/meeagent/node_modules/.bin/pi
```

## 기능
- **Shift+Tab**: 권한 모드 순환 `default → ⏵⏵ accept edits → ⏸ plan`.
- **플랜 모드**: 읽기 전용 탐색 → "Plan:" 마크다운 → Approve / Stay / Refine.
- **diff 승인**(default 모드): 파일 수정 전 적·녹 diff 카드 → `a` 승인 / `r` 거절 / `c` 피드백.
- **accept edits 모드**: diff 카드 없이 자동 적용.

## 테스트
`bun run test`
