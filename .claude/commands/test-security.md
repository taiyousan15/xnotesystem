---
description: セキュリティテスト - OWASP Top 10/脆弱性スキャン/ペネトレーションテスト
---

Use the security-tester subagent to conduct comprehensive security testing.

Security scope: $ARGUMENTS

The subagent should:
1. Identify security requirements (OWASP ASVS Level 2+)
2. Perform threat modeling (STRIDE)
3. Execute automated vulnerability scans (OWASP ZAP, Snyk)
4. Test OWASP Top 10 vulnerabilities (SQL Injection, XSS, CSRF, etc.)
5. Run static code analysis (Semgrep, ESLint security)
6. Check dependency vulnerabilities (npm audit, OWASP Dependency-Check)
7. Conduct penetration testing (authentication, authorization, API security)
8. Generate security report with CVSS scores

Output complete security test suite with:
- OWASP Top 10 tests (Injection, Broken Auth, XSS, CSRF, etc.)
- Automated vulnerability scanning scripts (ZAP, Dependency-Check)
- Static analysis configuration (Semgrep rules)
- Penetration test cases (API security, auth bypass)
- Security report generation (HTML/JSON with CVSS scores)
- CI/CD integration for automated security gates
- Compliance validation (SOC 2, GDPR, PCI DSS)
