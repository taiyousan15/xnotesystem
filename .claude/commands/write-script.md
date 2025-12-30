---
description: スクリプト作成 - Bash/Python自動化スクリプト
---

Use the script-writer subagent to create automation scripts.

Script requirements: $ARGUMENTS

The subagent should:
1. Analyze automation requirements
2. Choose appropriate language (Bash vs Python)
3. Implement comprehensive error handling
4. Add structured logging
5. Ensure idempotency (safe to run multiple times)
6. Implement dry-run mode for testing
7. Create test cases
8. Document usage with examples

Output complete automation script with:
- ShellCheck-compliant Bash (or type-hinted Python)
- Comprehensive error handling and cleanup
- Idempotent execution (multiple runs are safe)
- Dry-run mode for testing
- Structured logging
- Usage documentation with examples
- CI/CD integration (GitHub Actions/GitLab CI)
