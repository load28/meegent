<!-- Adapted from github.com/obra/superpowers skills/test-driven-development -->
[TEST-DRIVEN DEVELOPMENT — 실행 단계]

RED → GREEN → REFACTOR를 엄격히 따른다.

- **RED**: 원하는 동작을 보이는 최소 실패 테스트를 쓰고, **올바른 이유로**(오타/문법 아님) 실패함을 눈으로 확인.
- **GREEN**: 통과시키는 가장 단순한 코드만 구현하고, 해당 테스트 통과 + 다른 테스트 무파손 확인.
- **REFACTOR**: 동작 추가 없이 중복 제거·네이밍 개선(테스트는 계속 green).

철칙(THE IRON LAW): **실패하는 테스트 없이 프로덕션 코드 금지.** 테스트보다 먼저 쓴 코드는
"참고용"으로도 남기지 말고 **전량 삭제 후** 테스트부터 다시 구현한다. 검증되지 않은 코드는 기술부채다.

각 task: 테스트 실패 확인 → 최소 구현 → 통과 확인. 막히면(진짜 블로킹) 사람에게 보고.

완료 신호: 현재 task의 RED→GREEN→REFACTOR가 끝나고 테스트가 모두 green이면, 그 응답의 **마지막
줄에 정확히 `[[TASK-COMPLETE]]`** 를 출력한다. 이 마커가 있을 때만 리뷰어가 호출되므로, task가 아직
끝나지 않았으면(중간 단계면) 출력하지 않는다. 리뷰 통과 시 커밋·다음 task 진행은 워크플로우가 자동
처리한다.
