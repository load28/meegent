# meeagent

pi(`@mariozechner/pi-coding-agent`) 위에 Claude Code식 플랜모드와 diff 승인을 얹은 OpenRouter 코딩 에이전트.

## 설정
1. `cp .env .env.local` 후 `.env.local`의 `OPENROUTER_API_KEY`에 실제 키 입력.
2. `bun install`

## 글로벌 CLI로 설치 (아무 프로젝트에서 실행)
`meeagent`를 전역 명령으로 만들어 **어느 프로젝트 디렉토리에서든** 그 프로젝트를 대상으로 실행한다.
타깃 프로젝트 repo에는 아무 파일도 남기지 않는다(설정·확장은 `~/.pi/agent/`, 단일 소스는 이 repo).

```bash
# 1) 전역 명령 등록 (PATH의 ~/.local/bin)
ln -sfn "$PWD/bin/meeagent" ~/.local/bin/meeagent

# 2) 확장을 전역 발견 위치에 심볼릭 링크 (repo가 단일 소스)
mkdir -p ~/.pi/agent/extensions
ln -sfn "$PWD/.pi/extensions/meeagent" ~/.pi/agent/extensions/meeagent

# 3) 전역 기본 설정 (모델 + shift+tab 재매핑)
#    ~/.pi/agent/settings.json   → { "model": "openrouter/anthropic/claude-3.5-sonnet" }
#    ~/.pi/agent/keybindings.json→ { "app.thinking.cycle": "ctrl+t" }
```

사용:
```bash
cd ~/path/to/any-project
meeagent            # 그 프로젝트를 meeagent로 작업
```
`bin/meeagent` 안의 `MEEAGENT_HOME` 경로는 이 repo의 절대 경로다(이동 시 한 줄 수정).

## repo 내부에서 바로 실행
```bash
bun start   # (= ./bin/meeagent) 현재 디렉토리를 대상으로 실행
```

## 기능
- **Shift+Tab**: 권한 모드 순환 `default → ⏵⏵ accept edits → ⏸ plan`.
- **플랜 모드**: 읽기 전용 탐색 → "Plan:" 마크다운 → Approve / Stay / Refine.
- **diff 승인**(default 모드): 파일 수정 전 적·녹 diff 카드 → `a` 승인 / `r` 거절 / `c` 피드백.
- **accept edits 모드**: diff 카드 없이 자동 적용.

## 테스트
`bun run test`
