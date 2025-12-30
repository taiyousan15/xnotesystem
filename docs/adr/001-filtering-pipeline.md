# ADR 001: 段階的フィルタリングパイプラインの導入

## Status
Proposed

## Context

### 現状の問題
2025-12-19の実データ分析結果：
- 収集件数: 1003件
- Top 2スコア投稿: 両方とも「RT @OpenAI」で0 Like
- 大部分がリツイート（RT）で編集価値なし
- LLMコスト: 1003件 × $0.00025 = $0.25/日 = $7.5/月
- 処理時間: 1003件 × 500ms（LLM評価） = 約8分

### ビジネス要件
- VIP会員に届けるのは「本日の重要投稿2件」のみ
- note記事生成は週2本（有料480円）
- 情報の深さ・編集度・先行性で差別化

### 技術的制約
- Anthropic API制限: 20リクエスト/秒
- X API制限: 月間500K件
- ローカル実行（サーバーレス化は将来）

## Decision

**4段階フィルタリングパイプラインを導入する**

```
Phase 1: ノイズ除去フィルタ（ルールベース）
  Input: 1000件
  Filters:
    - RT Filter: RTを除外（Quote RTは許可）
    - Language Filter: 日本語・英語のみ
    - Spam Filter: URL過多、絵文字過多、宣伝キーワード
  Output: 300件（70%削減）

Phase 2: 品質フィルタ（軽量スコアリング）
  Input: 300件
  Scoring:
    - Engagement Score: (like*2 + repost*3 + reply*1.5) / sqrt(followers)
    - Velocity Score: engagement / sqrt(hours_since_post)
    - Quality Score: engagement*0.6 + velocity*0.4
  Filter: quality_score >= 10
  Output: 200件（33%削減）

Phase 3: LLM Semantic評価
  Input: 200件（上限200件固定）
  Model: Claude 3 Haiku
  Batch: 10件ずつ、500ms delay
  Output: 200件 with semantic_score

Phase 4: カテゴリ分類 + 最終スコアリング
  Input: 200件
  Classification: 8カテゴリ（RESEARCH, PRODUCT, NEWS, ...）
  Trend Detection: キーワード出現頻度（TF-IDF）
  Final Score:
    quality*0.4 + semantic*0.6 + priority_bonus + category_bonus + trend_bonus
  Output: Sorted by final_score
```

## Rationale

### 1. コスト削減
- LLM評価: 1000件 → 200件で80%削減
- 月額コスト: $7.5 → $1.5（$6節約）
- 年間コスト削減: $72

### 2. 処理時間短縮
- Phase 1-2（並列処理）: 5秒
- Phase 3（LLM）: 200件 × 500ms = 100秒
- Total: 105秒 < 2分（現行8分から75%削減）

### 3. 品質向上
- RT除外でオリジナル投稿のみ評価
- スパム除外で低品質投稿を排除
- Semantic評価を高品質投稿に集中

### 4. スケーラビリティ
- 10倍成長（10,000件/日）でもLLM評価200件上限維持
- コスト線形増加を抑制

## Alternatives Considered

### Alternative 1: 全件LLM評価（現行）
**Pros**:
- シンプル（フィルタロジック不要）
- 全投稿を公平に評価

**Cons**:
- コスト高（$7.5/月）
- 処理時間長（8分）
- 低品質投稿にリソースを浪費

**Rejected Reason**: コストと時間が許容範囲を超える

### Alternative 2: ルールベースのみ（LLMなし）
**Pros**:
- コストゼロ
- 処理高速（<10秒）

**Cons**:
- Semanticな価値を捉えられない
- 「技術的新規性」「実務価値」を判断不可
- VIP向け選定精度が低い

**Rejected Reason**: 要件「内容の深さで差別化」を満たせない

### Alternative 3: 2段階（フィルタ → LLM）
**Pros**:
- シンプル（Phase 2不要）

**Cons**:
- フィルタ後も500件残る場合、LLMコスト増
- 品質フィルタなしで低Engagementも評価

**Rejected Reason**: Phase 2で品質保証が必要

## Consequences

### Positive
- ✅ LLMコスト80%削減（$7.5 → $1.5/月）
- ✅ 処理時間75%短縮（8分 → 2分）
- ✅ VIP向け品質向上（RTなし、ノイズなし）
- ✅ スケーラビリティ向上（10倍成長でもコスト制御）
- ✅ 設定で調整可能（各フィルタON/OFF切り替え）

### Negative
- ⚠️ 実装複雑度増加（4フェーズのパイプライン）
- ⚠️ フィルタルールのメンテナンスコスト
  - スパムキーワード更新（月1回）
  - カテゴリボーナス調整（四半期1回）
- ❌ フィルタミスで良質投稿を除外するリスク
  - 軽減策: ホワイトリスト機能（優先アカウント保護）
  - 軽減策: 手動レビュー（週1回、除外ログ確認）

### Neutral
- 過去スコアとの互換性なし（新スコア体系）
- 初期チューニング期間必要（2週間運用後に調整）

## Implementation Plan

### Week 1-2: Phase 1実装
```typescript
// src/filters/rt-filter.ts
export class RTFilter implements Filter {
  filter(tweet: TweetData): FilterResult {
    const isRT = tweet.content.startsWith('RT @');
    const isQuoteRT = tweet.content.includes('https://t.co/') && !isRT;

    return {
      passed: !isRT || isQuoteRT,
      reason: isRT ? 'Retweet excluded' : 'Passed',
    };
  }
}

// src/filters/pipeline.ts
export class FilterPipeline {
  private filters: Filter[] = [
    new RTFilter(),
    new LanguageFilter(),
    new SpamFilter(),
    new RelevanceFilter(),
  ];

  async run(tweets: TweetData[]): Promise<TweetData[]> {
    let filtered = tweets;

    for (const filter of this.filters) {
      if (!filter.isEnabled()) continue;

      const results = await Promise.all(
        filtered.map(t => filter.filter(t))
      );

      filtered = filtered.filter((_, i) => results[i].passed);

      logger.info(`${filter.name}: ${tweets.length} → ${filtered.length}`);
    }

    return filtered;
  }
}
```

### Week 3-4: Phase 2-3実装
- Quality Scorer実装
- Semantic評価最適化（バッチ処理）

### Week 5: Phase 4実装
- カテゴリ分類
- トレンド検出

### Week 6: 統合・検証
- E2Eテスト
- パフォーマンステスト（2分以内）
- VIPレビュー

## Verification

### Success Criteria
1. RT除外率 >95%
2. 最終出力200件以内
3. 処理時間 <2分
4. LLMコスト <$2/月
5. VIP Top 2がオリジナル投稿

### Testing
```bash
# 単体テスト
npm run test:filters  # 各フィルタ90%カバレッジ

# 統合テスト
npm run test:pipeline -- --input test-data/1000tweets.json
# 期待: 200件出力、2分以内

# 本番検証
npm run daily
# 期待: VIP_Picks に RT なし
```

### Monitoring
- フィルタ通過率（日次ログ）
- LLM呼び出し回数（200件/日上限監視）
- 除外ログ（手動レビュー用）

## Related Decisions
- ADR 002: スコアリングアルゴリズム再設計
- ADR 003: カテゴリ分類システム

## References
- 要件定義書: `docs/requirements.md`
- 実データ分析: `data/scored_2025-12-19.json`
- Anthropic API料金: https://www.anthropic.com/pricing
