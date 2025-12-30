---
description: ドキュメントレビュー - API仕様検証/コメント品質/README生成
---

Use the doc-reviewer subagent to perform comprehensive documentation review.

Documentation scope: $ARGUMENTS

The subagent should:
1. Measure documentation coverage (API 80%+, Code Comments 80%+)
2. Validate API specifications (OpenAPI, GraphQL Schema compliance)
3. Check code comment quality (JSDoc, TSDoc completeness)
4. Calculate readability scores (Flesch Reading Ease >= 60)
5. Verify example code executability
6. Validate style guide compliance
7. Generate improvement recommendations
8. Create documentation quality report

Output complete documentation review suite with:
- API specification validators (OpenAPI, Swagger validation)
- Code comment quality checkers (JSDoc/TSDoc validation)
- README generators (badges, examples, setup instructions)
- Documentation coverage reports (API, code comments)
- Readability analyzers (Flesch Reading Ease)
- Quality reports (HTML visualization with recommendations)
- Automated documentation pipeline
- Style guide compliance verification
