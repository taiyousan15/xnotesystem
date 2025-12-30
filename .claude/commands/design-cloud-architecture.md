---
description: クラウドアーキテクチャ設計 - マルチクラウド/サーバーレス/コスト最適化
---

Use the cloud-architect subagent to design comprehensive cloud architecture.

Architecture scope: $ARGUMENTS

The subagent should:
1. Define business requirements and SLA (availability, performance, cost)
2. Select architecture pattern (3-tier, Microservices, Serverless)
3. Choose cloud services (Compute, Storage, Database, Network)
4. Design high availability (Multi-AZ, Multi-Region, Auto-Scaling)
5. Implement security architecture (Zero Trust, Encryption, IAM)
6. Create cost optimization strategy (RightSizing, Reserved Capacity)
7. Generate architecture diagrams (Infrastructure, Data Flow)
8. Document migration plan (Phase approach, Rollback plan)

Output complete cloud architecture suite with:
- Infrastructure diagrams (Diagrams as Code with Python)
- AWS CDK stacks (VPC, ECS, RDS, Lambda, API Gateway)
- GCP Terraform modules (VPC, GKE, Cloud SQL)
- Azure Bicep templates (VNet, AKS, Cosmos DB)
- Serverless architectures (Lambda, API Gateway, DynamoDB)
- Cost optimization scripts (RightSizing, Reserved Instances)
- Architecture Decision Records (ADR templates)
- Disaster recovery plans (Multi-Region, Backup strategies)
