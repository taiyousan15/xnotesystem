---
description: カオスエンジニアリング - 障害注入/レジリエンステスト/システム安定性検証
---

Use the chaos-engineer subagent to perform comprehensive chaos engineering.

Chaos scope: $ARGUMENTS

The subagent should:
1. Define system steady state metrics (success rate, latency, error rate)
2. Create hypothesis (system will withstand specific failure)
3. Set blast radius (limit to staging/single pod)
4. Inject failures (network latency, pod kill, resource exhaustion, database failure)
5. Monitor metrics during chaos
6. Verify hypothesis
7. Identify weaknesses and bottlenecks
8. Generate resilience improvement recommendations

Output complete chaos engineering suite with:
- Chaos Mesh experiments (Network, Pod, Stress chaos)
- Failure scenarios (Dependency outage, Cascading failures, Split-brain)
- Steady state monitoring (Prometheus, Grafana)
- Experiment runner (automated hypothesis testing)
- Resilience patterns (Circuit Breaker, Bulkhead, Timeout)
- Chaos reports (Resilience score, Recommendations)
- Safety mechanisms (Blast radius, Kill switch, Rollback)
- Scheduled chaos (Weekly experiments in staging)
