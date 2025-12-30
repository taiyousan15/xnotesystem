---
description: コードレビュー - セキュリティと品質の包括的レビュー
---

Use the code-reviewer subagent to perform a comprehensive code review.

Files to review: $ARGUMENTS

The subagent should:
1. Read and analyze the code structure
2. Check for security vulnerabilities (OWASP Top 10)
3. Evaluate code quality (readability, maintainability)
4. Verify best practices compliance
5. Identify performance issues
6. Generate improvement suggestions
7. Calculate quality score (0-100)

Output a detailed review report with severity-classified issues and actionable fixes.
