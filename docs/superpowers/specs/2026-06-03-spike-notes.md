# Task 0 스파이크 결과 — Superpowers 워크플로우

설계 §11 / 구현플랜 Task 0 검증 결과 (2026-06-03, 설치된 `@earendil-works/*` 0.78 기준).

## 0.1 pi 중첩 agent-session 노출 여부
- `AgentSession`은 `dist/core/agent-session.d.ts`의 무거운 내부 클래스(`constructor(config: AgentSessionConfig)`,
  `_runAgentPrompt`는 private). 확장이 깔끔하게 중첩 서브에이전트를 띄우는 **공개 API 없음**.
- **결론: 권장안 확정** — 메인루프 = 구현자(`setModel(Haiku)` + `context` 훅 스트립으로 fresh context 모사),
  리뷰어 = 툴 없는 격리 `complete()`(Sonnet). `memory/llm.ts:runLLM` 패턴 공유.

## 0.2 OpenRouter `cache_control` 패스스루
- 라이브 검증 보류: 이 환경에 `.env.local` OPENROUTER_API_KEY 없음.
- 정적 확인: 타깃 모델 모두 `api: "openai-completions"`, `cost.cacheRead` 존재(Haiku 0.10 / Sonnet 0.30).
  pi-ai `StreamOptions.cacheRetention` 기본 "short" + Anthropic 포맷 `cache_control` 자동 부착.
- **할 일(키 있는 세션)**: 동일 시스템프롬프트 2회 호출 후 `Usage.cacheRead > 0` 확인. 0이면
  `before_provider_request`에서 OpenRouter 캐싱 마커 직접 주입.

## 0.3 `ctx.setModel`
- `ExtensionContext` actions에 `setModel(model: Model<any>): Promise<boolean>` 확인(키 없으면 false).

## 0.4 모델 가용성 (pi-ai `getModel("openrouter", id)`)
- `anthropic/claude-haiku-4.5` → OK (api openai-completions, cacheRead 0.10, input 1)
- `anthropic/claude-sonnet-4.6` → OK (cacheRead 0.30, input 3)
- `anthropic/claude-3.5-sonnet`(현행 설정) → `getModel`으로 **미resolve**. 런타임은 registry/resolveModel가
  `openrouter/...` 형식을 별도 처리. → tiering.ts는 `ctx.modelRegistry.find`/resolveModel 경로 사용,
  신규 설정엔 검증된 ID(haiku-4.5 / sonnet-4.6) 사용.
