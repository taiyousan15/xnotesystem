---
description: マイグレーション実装 - スキーマ進化とデータ移行
---

Use the migration-developer subagent to implement database migrations.

Migration requirements: $ARGUMENTS

The subagent should:
1. Analyze current and target schemas
2. Choose migration strategy (direct change vs Expand-Contract)
3. Create forward migration scripts
4. Create rollback scripts for all changes
5. Implement data transformation logic (if needed)
6. Verify with test data
7. Optimize performance (batch processing, indexing)
8. Document execution and rollback procedures

Output complete migration implementation with:
- Zero-downtime migrations (Expand-Contract pattern for production)
- Forward and rollback scripts for every change
- Idempotent execution (safe to run multiple times)
- Batch processing for large datasets
- Comprehensive testing (unit + integration)
- Execution checklist and documentation
- Performance optimization (indexing, batching)
