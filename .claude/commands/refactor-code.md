---
description: コードリファクタリング - SOLID原則適用/デザインパターン/技術的負債削減
---

Use the refactor-specialist subagent to perform systematic code refactoring.

Refactoring scope: $ARGUMENTS

The subagent should:
1. Detect code smells (God Classes, Long Methods, Duplicate Code)
2. Prioritize refactoring opportunities by impact
3. Apply SOLID principles (SRP, OCP, LSP, ISP, DIP)
4. Implement design patterns (Strategy, Factory, Repository, Observer)
5. Reduce complexity (Cyclomatic < 10, Cognitive < 15)
6. Eliminate code duplication (DRY principle, < 3%)
7. Measure technical debt (SQALE method)
8. Generate before/after comparison report

Output complete refactoring suite with:
- Code smell detection scripts (ESLint, custom analyzers)
- SOLID principle refactorings (SRP, OCP, LSP examples)
- Design pattern implementations (Strategy, Factory, etc.)
- Complexity reduction techniques (Extract Method, Guard Clauses)
- Technical debt measurement (SQALE, Debt Ratio)
- Refactoring reports (Before/After metrics, HTML visualization)
- Non-breaking refactoring strategy (preserve all tests)
- Incremental migration plans
