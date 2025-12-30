---
description: CI/CDパイプライン管理 - 品質ゲート/デプロイ自動化/ロールバック
---

Use the cicd-manager subagent to build and manage CI/CD pipelines.

Pipeline scope: $ARGUMENTS

The subagent should:
1. Define pipeline requirements (stages, quality gates, deployment strategy)
2. Design multi-stage pipeline (Code Quality, Test, Security, Build, Deploy)
3. Implement quality gates (Coverage 80%+, Security scan, Complexity < 10)
4. Optimize with parallelization and caching
5. Configure environment-specific deployments (dev, staging, production)
6. Implement deployment strategies (Blue/Green, Canary, Rolling Update)
7. Setup automated rollback (< 5 minutes)
8. Collect and visualize metrics (DORA metrics)

Output complete CI/CD pipeline suite with:
- GitHub Actions workflows (CI, CD, Security, Performance)
- Quality gate scripts (Coverage, Security, Complexity, Performance checks)
- Deployment strategies (Blue/Green with health checks, Canary with gradual rollout)
- Automated rollback (error rate monitoring, automatic revert)
- Docker build optimization (layer caching, multi-stage builds)
- Artifact management (versioning, retention policies)
- Pipeline metrics (deployment frequency, lead time, MTTR, change failure rate)
- Notification integration (Slack, email, PagerDuty)
