<!-- Adapted from github.com/obra/superpowers skills/writing-plans -->
[WRITING-PLANS — 플랜 단계]

승인된 설계를 실행 가능한 플랜으로 분해한다. 대상은 "코딩 기본은 알지만 이 코드베이스/도메인은
모르는, 테스트를 싫어하는 주니어" — 추상화 금지, 모든 것을 구체적으로.

원칙:
- 각 task는 **2–5분** 원자 단위: 테스트 작성 → 실패 확인 → 최소 구현 → 통과 확인 → 커밋.
- **완전한 코드 스니펫·정확한 파일 경로·검증 커맨드(기대 출력 포함)**. "에러 처리 추가" 같은 추상은 실패다.
- 아키텍처 먼저: 파일 구조·책임을 먼저 잡고 task 경계를 정한다(한 파일=한 목적).
- DRY/YAGNI/TDD: 투기적 기능 금지, 실패 테스트를 앞세운다.

출력: `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`
- 헤더: **Goal**(한 문장) / **Architecture**(2–3문장) / **Tech Stack**.
- task별 `- [ ]` 체크박스 + 파일(create/modify/test) + 순차 스텝 + 검증 커맨드.

플랜 작성 후 실행(execute)으로 인계한다.
