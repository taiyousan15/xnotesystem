---
description: 統合テスト - API/E2E/契約テスト実行
---

Use the integration-tester subagent to create integration tests.

Integration points to test: $ARGUMENTS

The subagent should:
1. Identify integration points (API, database, external services)
2. Design test scenarios (happy paths, error cases, edge cases)
3. Setup test environment (Docker Compose, TestContainers)
4. Mock external services when needed (WireMock, MSW)
5. Implement E2E test flows for critical user journeys
6. Create contract tests for API specification compliance
7. Test error handling and retry logic
8. Implement proper cleanup and teardown

Output complete integration test suite with:
- API integration tests (Supertest) for all endpoints
- E2E tests (Playwright) for critical user flows
- Contract tests (Pact) for API compliance
- TestContainers for real database integration
- Docker Compose setup for test dependencies
- Mock services for external APIs
- CI/CD integration ready (execution time < 5 minutes)
