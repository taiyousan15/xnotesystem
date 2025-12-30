---
description: モニタリングセットアップ - Prometheus/Grafana/Jaeger/Loki/SLO監視
---

Use the monitoring-specialist subagent to set up comprehensive observability.

Monitoring scope: $ARGUMENTS

The subagent should:
1. Define monitoring requirements (metrics, SLI/SLO, alert thresholds)
2. Set up Prometheus and Grafana
3. Implement custom application metrics (prom-client, OpenTelemetry)
4. Integrate distributed tracing (Jaeger, X-Ray)
5. Build log aggregation pipeline (Fluentd, Loki)
6. Define alert rules (severity levels, escalation policies)
7. Create dashboards (RED metrics, USE method, SLO tracking)
8. Implement SLO monitoring with error budget tracking

Output complete monitoring suite with:
- Prometheus configuration (scrape configs, alert rules, recording rules)
- Grafana dashboards (Application, Infrastructure, SLO monitoring)
- Application metrics implementation (Node.js, Python, Go examples)
- Distributed tracing setup (Jaeger with OpenTelemetry)
- Log aggregation (Loki + Promtail configuration)
- Alertmanager configuration (PagerDuty, Slack integration)
- SLO monitoring (Error budget calculator, SLI tracking)
- Kubernetes manifests (Prometheus, Grafana, Jaeger deployments)
