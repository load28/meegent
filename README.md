# meeagent

pi(`@mariozechner/pi-coding-agent`) 위에 Claude Code식 플랜모드와 diff 승인을 얹은 OpenRouter 코딩 에이전트.

## 설정
1. `cp .env .env.local` 후 `.env.local`의 `OPENROUTER_API_KEY`에 실제 키 입력.
2. `bun install`
3. `bun start` (= `./bin/meeagent`)

## 기능
- **Shift+Tab**: 권한 모드 순환 `default → ⏵⏵ accept edits → ⏸ plan`.
- **플랜 모드**: 읽기 전용 탐색 → "Plan:" 마크다운 → Approve / Stay / Refine.
- **diff 승인**(default 모드): 파일 수정 전 적·녹 diff 카드 → `a` 승인 / `r` 거절 / `c` 피드백.
- **accept edits 모드**: diff 카드 없이 자동 적용.

## 테스트
`bun run test`
