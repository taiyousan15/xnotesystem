---
description: データベース実装 - マイグレーション、ストアドプロシージャ、最適化
---

Use the database-developer subagent to implement database changes.

Database requirements: $ARGUMENTS

The subagent should:
1. Analyze schema design requirements
2. Generate migration scripts (forward and rollback)
3. Place indexes strategically for query performance
4. Implement stored procedures and triggers as needed
5. Optimize query performance (EXPLAIN ANALYZE)
6. Add data integrity constraints (foreign keys, checks)
7. Prepare rollback scripts for all migrations
8. Run migration tests to verify correctness

Output complete database implementation with:
- Version-controlled migrations (forward + rollback)
- Strategic index placement
- Stored procedures for complex operations
- Triggers for automated operations (audit logs, timestamps)
- Performance-optimized queries (verified with EXPLAIN ANALYZE)
- Comprehensive data integrity constraints
