---
description: インテグレーション実装 - サードパーティAPI統合とWebhook処理
---

Use the integration-developer subagent to implement third-party integrations.

Integration requirements: $ARGUMENTS

The subagent should:
1. Analyze external API documentation
2. Implement authentication flow (OAuth 2.0, API keys)
3. Create type-safe API client classes
4. Implement retry and timeout strategies (exponential backoff)
5. Add webhook verification logic (signature validation)
6. Implement comprehensive error handling
7. Add rate limiting to respect API limits
8. Write integration tests using mock servers

Output complete integration implementation with:
- Type-safe API clients
- OAuth 2.0 / API key authentication
- Webhook handlers with signature verification
- Exponential backoff retry logic
- Rate limiting strategy
- Comprehensive error handling
- Integration tests (80%+ coverage using mocks)
