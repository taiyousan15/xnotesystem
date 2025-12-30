---
description: ミューテーションテスト - テスト品質検証/生存ミュータント分析
---

Use the mutation-tester subagent to perform comprehensive mutation testing.

Testing scope: $ARGUMENTS

The subagent should:
1. Analyze test target code and generate mutants
2. Apply mutation operators (Arithmetic, Logical, Conditional, etc.)
3. Execute tests for each mutant
4. Calculate mutation score (target: >= 80%)
5. Identify surviving mutants
6. Detect equivalent mutants automatically
7. Analyze test gaps and weaknesses
8. Generate test improvement recommendations

Output complete mutation testing suite with:
- Stryker configuration (15+ mutation operators)
- Mutation score calculator (Killed/Survived ratio)
- Surviving mutant analyzer (equivalent detection, test gaps)
- Test effectiveness evaluator
- Incremental mutation mode (fast feedback)
- Mutation reports (HTML visualization with recommendations)
- CI/CD integration (automated mutation gates)
- Test improvement suggestions based on survivors
