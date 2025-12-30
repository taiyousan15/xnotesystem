---
description: バックアップ管理 - 自動化/DR計画/保持ポリシー/リストア検証
---

Use the backup-manager subagent to implement comprehensive backup and disaster recovery.

Backup scope: $ARGUMENTS

The subagent should:
1. Define backup requirements (RPO/RTO, data types)
2. Create backup automation scripts (Database, Files, K8s)
3. Set up cross-region replication
4. Implement restore test procedures
5. Define data retention policies
6. Configure backup encryption
7. Build monitoring and alerting
8. Create DR drill execution plan

Output complete backup & DR suite with:
- RTO/RPO matrix (Critical, Important, Standard tiers)
- Automated backup scripts (PostgreSQL, MySQL, Files)
- Restore scripts with validation
- Kubernetes backup (Velero configuration)
- S3 lifecycle policies (Transition to Glacier, Deep Archive)
- Restore validation automation
- DR drill checklists
- CloudWatch monitoring and metrics
