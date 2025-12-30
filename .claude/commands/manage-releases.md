---
description: リリース管理 - SemVer/自動化/変更ログ/デプロイオーケストレーション
---

Use the release-manager subagent to implement comprehensive release management.

Release scope: $ARGUMENTS

The subagent should:
1. Define versioning strategy (SemVer, CalVer)
2. Apply Conventional Commits standard
3. Set up release automation (Release Please, Semantic Release)
4. Automate changelog generation
5. Build deployment pipeline (Staging → Production)
6. Implement release gates (Quality checks, Approvals)
7. Create rollback flow
8. Measure DORA metrics

Output complete release management suite with:
- Conventional Commits specification (commitlint configuration)
- Release Please configuration (automatic versioning, changelog)
- GitHub Actions workflows (Release, Deploy staging, Deploy production)
- Canary deployment script (Gradual rollout with health checks)
- Automated rollback script (One-command rollback)
- DORA metrics tracking (Deployment Frequency, Lead Time, MTTR, Change Failure Rate)
- Quality gates (Coverage, security, performance checks)
- Artifact signing (Cosign for container images)
