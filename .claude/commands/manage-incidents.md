---
description: インシデント管理 - トリアージ/RCA/ポストモーテム/Runbook作成
---

Use the incident-responder subagent to manage incident response and postmortems.

Incident scope: $ARGUMENTS

The subagent should:
1. Define incident classification criteria (SEV1-4, impact matrix)
2. Design on-call rotation and escalation policies
3. Create runbooks for common incidents (troubleshooting, rollback)
4. Build incident response flowcharts
5. Prepare postmortem templates (blameless, 5 Whys analysis)
6. Implement root cause analysis frameworks
7. Set up action item tracking system
8. Create incident metrics dashboard (MTTA, MTTR)

Output complete incident response suite with:
- Incident severity matrix (SEV1-4 with response times)
- Runbooks (High latency, Database outage, Service down scenarios)
- Postmortem templates (Timeline, RCA, Action items)
- Communication plans (Internal Slack, External status page)
- PagerDuty/Opsgenie integration
- Incident tracking tool (TypeScript implementation)
- Metrics calculation (MTTA, MTTR, incident frequency)
- Escalation procedures and on-call schedules
