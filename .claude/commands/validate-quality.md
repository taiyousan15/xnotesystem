---
description: 品質検証 - カバレッジ/品質ゲート/リリース準備度チェック
---

Use the qa-validator subagent to perform comprehensive quality validation.

Validation scope: $ARGUMENTS

The subagent should:
1. Define quality standards (Coverage 80%+, Complexity < 10, Zero Critical vulnerabilities)
2. Measure test coverage (lines, functions, branches, statements)
3. Analyze code quality metrics (complexity, code smells, duplications)
4. Validate quality gates (coverage, security, performance, accessibility)
5. Detect regressions (visual, functional, API)
6. Verify accessibility compliance (WCAG 2.1 AA, Lighthouse 90+)
7. Generate release readiness report
8. Build automated quality check pipeline

Output complete QA validation suite with:
- Coverage validation scripts (Istanbul, nyc, c8)
- Quality gate validator (SonarQube integration)
- Regression testing (Visual, Snapshot, API)
- Accessibility audits (axe-core, Pa11y, Lighthouse)
- Code quality metrics (Complexity, Code Smells, Technical Debt)
- Release readiness report generator
- CI/CD quality gate integration
- Automated quality checks (< 10 minutes execution)
