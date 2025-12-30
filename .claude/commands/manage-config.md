---
description: 設定管理 - 環境変数、シークレット、フィーチャーフラグ
---

Use the config-manager subagent to manage application configuration.

Configuration requirements: $ARGUMENTS

The subagent should:
1. Identify required configuration items
2. Define environment variable schema with validation (Zod)
3. Implement validation logic with type safety
4. Generate .env.example template
5. Implement secure secrets management (AWS Secrets Manager/Vault)
6. Add feature flags (if needed)
7. Generate TypeScript type definitions
8. Create configuration documentation

Output complete configuration management with:
- Zod schema for type-safe validation
- .env.example template with all variables documented
- TypeScript type definitions
- Secrets manager integration (AWS/Vault)
- Feature flags with override support
- Validation tests (90%+ coverage)
- Production security checks (reject default secrets)
