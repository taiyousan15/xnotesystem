---
description: パフォーマンステスト - 負荷/ストレス/ベンチマーク
---

Use the performance-tester subagent to conduct performance testing.

Performance requirements: $ARGUMENTS

The subagent should:
1. Define performance requirements (SLA: P95 < 500ms, P99 < 1s, Error < 1%)
2. Design test scenarios (load patterns, user behaviors)
3. Measure baseline performance
4. Execute load tests (k6/Artillery) with gradual ramp-up
5. Identify bottlenecks through profiling
6. Propose optimization strategies
7. Re-test to validate improvements
8. Generate performance report with metrics

Output complete performance test suite with:
- Load tests (k6) with realistic scenarios
- Stress tests (spike, soak) for breaking points
- Database query benchmarks (P95 < 100ms for SELECT)
- Function benchmarks for critical code paths
- SLA validation (P95 < 500ms, Error Rate < 1%)
- HTML performance reports with visualizations
- CI/CD integration for regression detection
