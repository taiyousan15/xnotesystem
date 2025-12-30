---
description: セキュリティスキャン - SAST/DAST/依存関係/コンテナ/シークレット/IaC
---

Use the security-scanner subagent to implement comprehensive security scanning.

Scanning scope: $ARGUMENTS

The subagent should:
1. Define security scanning requirements (scan types, severity thresholds)
2. Integrate SAST tools (Semgrep, SonarQube in CI/CD)
3. Set up dependency vulnerability scanning (Snyk, npm audit)
4. Implement container image scanning (Trivy in build pipeline)
5. Automate secret detection (TruffleHog pre-commit hooks)
6. Scan Infrastructure as Code (Checkov for Terraform)
7. Verify compliance (CIS Benchmarks)
8. Build vulnerability remediation workflow

Output complete security scanning suite with:
- SAST configuration (Semgrep custom rules, OWASP Top 10)
- Dependency scanning (Snyk configuration, npm audit scripts)
- Container scanning (Trivy with SARIF output)
- Secret scanning (TruffleHog Git history analysis)
- IaC scanning (Checkov for Terraform/CloudFormation)
- GitHub Actions workflows (Automated security pipeline)
- Vulnerability dashboard (Metrics, trends, remediation tracking)
- Compliance validation (CIS Benchmarks, PCI-DSS)
