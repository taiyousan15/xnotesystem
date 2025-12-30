---
description: コンテナ最適化 - Docker/Kubernetes最適化/セキュリティ強化
---

Use the container-specialist subagent to optimize containers and enhance security.

Container scope: $ARGUMENTS

The subagent should:
1. Analyze current Dockerfile and container setup
2. Create multi-stage Dockerfile with layer caching optimization
3. Implement container security best practices (non-root, minimal images)
4. Design Kubernetes manifests (Deployment, StatefulSet, Service)
5. Configure resource limits and requests
6. Implement health checks (liveness, readiness, startup probes)
7. Set up vulnerability scanning (Trivy, Snyk)
8. Optimize build process with BuildKit

Output complete container optimization suite with:
- Multi-stage Dockerfiles (Node.js, Python, Go examples)
- Kubernetes manifests (Deployment, StatefulSet, DaemonSet, HPA)
- Security scanning scripts (Trivy automation)
- Health check implementations
- Build optimization scripts (BuildKit, cache layers)
- Resource management (CPU/Memory limits)
- Pod Security Policies
- Monitoring integration (Prometheus metrics)
