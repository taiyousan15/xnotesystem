---
description: 複雑度分析 - 循環的複雑度/認知的複雑度/保守性指数計算
---

Use the complexity-analyzer subagent to perform comprehensive code complexity analysis.

Analysis scope: $ARGUMENTS

The subagent should:
1. Scan entire codebase for complexity metrics
2. Calculate cyclomatic complexity (threshold: 10)
3. Analyze cognitive complexity (threshold: 15)
4. Compute maintainability index (target: >= 65)
5. Measure nesting depth (max: 3 levels)
6. Identify complexity hotspots
7. Generate refactoring recommendations
8. Create complexity trend reports

Output complete complexity analysis suite with:
- Cyclomatic complexity calculator (McCabe method)
- Cognitive complexity analyzer (SonarSource method)
- Maintainability index calculator (Halstead + CC + LOC)
- Nesting depth analyzer
- Hotspot detection (top 10 complex functions)
- Complexity visualizations (heatmaps, trend graphs)
- CI/CD complexity gates (automated threshold enforcement)
- Refactoring recommendations based on complexity metrics
