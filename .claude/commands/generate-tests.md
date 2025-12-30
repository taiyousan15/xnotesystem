---
description: テスト生成 - ユニット/統合/E2Eテスト自動生成
---

Use the test-generator subagent to generate comprehensive tests.

Code to test: $ARGUMENTS

The subagent should:
1. Analyze the target code structure
2. Design test cases (happy path, edge cases, error handling)
3. Create test fixtures and factories
4. Implement mocks and stubs for dependencies
5. Write tests using Arrange-Act-Assert pattern
6. Cover edge cases and error scenarios
7. Ensure 80%+ code coverage
8. Generate test documentation

Output complete test suite with:
- Unit tests with comprehensive mocking (70% of tests)
- Integration tests for critical paths (20% of tests)
- E2E tests for key user flows (10% of tests)
- Test fixtures and factories
- 80%+ code coverage
- Fast execution (unit tests < 30s total)
- CI/CD integration ready
