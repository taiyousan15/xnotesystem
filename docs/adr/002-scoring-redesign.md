# ADR 002: スコアリングアルゴリズムの再設計

## Status
Proposed

## Context

### 現行スコアリングの問題

2025-12-19実データ分析：
```json
// Top 1
{
  "content": "RT @OpenAI: By popular request, GPT-4.1...",
  "likeCount": 0,
  "repostCount": 1129,
  "followerCount": 1031,
  "baseScore": 748.31,
  "velocityScore": 1870.39,
  "finalScore": 97
}
```

**問題点**:
1. **RTが最高スコア**: 0 LikeのRTが97点
2. **Velocityスコアの異常値**: Repost数で爆発的に増加
3. **Follower正規化不足**: log10(1031+10) = 3.02で小規模アカウントが有利すぎる
4. **優先インフルエンサーが埋もれる**: +15のボーナスでは不十分

### ビジネス要件
- VIPに届けるのは「オリジナル投稿」のみ
- 優先インフルエンサー7名の投稿は必ず上位に
- 内容重視（Semantic > Engagement）

## Decision

### 1. RT完全除外
```typescript
// Phase 1: フィルタで除外（スコアリング対象外）
if (tweet.content.startsWith('RT @')) {
  return null;  // スコアリング不要
}

// Quote RT（コメント付きRT）は許可
if (tweet.content.includes('https://t.co/') && !tweet.content.startsWith('RT @')) {
  // 評価対象
}
```

### 2. 正規化方法の変更: log10 → sqrt
```typescript
// Before
const normalizer = Math.log10(followerCount + 10);
// follower=1000 → log10(1010) = 3.00
// follower=10000 → log10(10010) = 4.00
// 10倍差でも1.33倍の差しかない（小規模優遇しすぎ）

// After
const normalizer = Math.sqrt(followerCount + 100);
// follower=1000 → sqrt(1100) = 33.17
// follower=10000 → sqrt(10100) = 100.5
// 10倍差で3倍の差（適正）
```

### 3. Engagement計算の改善
```typescript
// Before
engagement = like*1.0 + repost*2.0 + reply*1.5

// After（Quote RTを区別）
engagement =
  like * 2.0 +          // Likeは能動的評価
  original_repost * 3.0 + // オリジナル投稿のRepost
  quote_repost * 2.5 +    // Quote RT（コメント付き）
  reply * 1.5             // 会話性
```

### 4. 新スコア体系
```typescript
// Phase 2: Quality Score（軽量、LLM不要）
engagement_score =
  (like*2 + original_repost*3 + quote*2.5 + reply*1.5)
  / sqrt(follower_count + 100)

velocity_score =
  engagement_score / sqrt(hours_since_post + 1)

quality_score = engagement_score * 0.6 + velocity_score * 0.4

// Phase 3: Semantic Score（LLM評価）
semantic_score = average([
  technicalNovelty,    // 技術的新規性 (0-100)
  practicalValue,      // 実務価値 (0-100)
  topicality,          // 話題性 (0-100)
  archiveValue,        // 保存価値 (0-100)
  discussionPotential  // 議論性 (0-100)
])

// Phase 4: Final Score
final_score =
  quality_score * 0.4 +        // Engagement重視度低下
  semantic_score * 0.6 +       // 内容重視度増加
  (isPriority ? 25 : 0) +      // 優先ボーナス増加（15→25）
  category_bonus +             // カテゴリボーナス（0-15）
  (isTrending ? 10 : 0)        // トレンドボーナス
```

## Rationale

### 1. RT除外の理由
- RTは情報の再配信で編集価値なし
- VIPが求めるのはオリジナルの洞察・発見
- スコアリングコスト削減（RT=約70%）

### 2. sqrt正規化の理由
```
Follower数の影響を適正化:
- 小規模（1K）: sqrt(1100) = 33
- 中規模（10K）: sqrt(10100) = 100（3倍）
- 大規模（100K）: sqrt(100100) = 316（10倍）

log10だと:
- 小規模: 3.0
- 中規模: 4.0（1.33倍）← 差が小さすぎる
- 大規模: 5.0（1.67倍）
```

### 3. Semantic重視の理由
- 要件「情報の深さで差別化」
- Engagement高くても内容薄いは除外
- VIPは「学び・発見」を求める

### 4. 優先ボーナス増加の理由
- 現行+15では上位に来ない
- +25で確実にTop 10入り
- インフルエンサー=信頼性高い情報源

## Alternatives Considered

### Alternative 1: RT にペナルティ（除外せず）
```typescript
if (isRT) {
  final_score *= 0.1;  // 90%減点
}
```
**Pros**: フィルタ不要、シンプル
**Cons**: スコアリングコスト削減できない
**Rejected**: Phase 1で除外する方が効率的

### Alternative 2: Follower正規化なし
```typescript
engagement_score = like*2 + repost*3 + reply*1.5
// 正規化なし
```
**Pros**: シンプル
**Cons**: 大規模アカウントが有利すぎる（フォロワー100万 vs 1000で1000倍差）
**Rejected**: 小規模でも良質な投稿を評価したい

### Alternative 3: Engagement重視（semantic 0.25のまま）
**Pros**: LLMコスト削減（重要度低い）
**Cons**: バズ重視で「深さ」を捉えられない
**Rejected**: 要件と矛盾

## Consequences

### Positive
- ✅ RT除外でオリジナル投稿が上位に
- ✅ 優先インフルエンサーが確実にTop 10入り
- ✅ Semantic重視で「VIPに届けるべき価値」を正確に反映
- ✅ Follower正規化適正化で小規模〜大規模を公平に評価

### Negative
- ❌ 過去スコアとの互換性なし
  - 履歴比較不可（新スコア体系のため）
  - 軽減策: 過去データを再スコアリング（オプション）
- ⚠️ 初期チューニング必要
  - カテゴリボーナス調整（運用2週間後）
  - Quality/Semantic重み調整（月次レビュー）
- ⚠️ Quote RT判定が不完全
  - X APIがQuote情報を返さない場合あり
  - 軽減策: URL含有 + "RT @"なし でヒューリスティック判定

### Neutral
- Velocityスコアは引き続き使用（時間減衰は有効）
- Efficiency Scoreは削除（Qualityに統合）

## Implementation

### Phase 2: Quality Scorer
```typescript
// src/scoring/quality-scorer.ts
export function calculateQualityScore(tweet: TweetData): number {
  const { likeCount, repostCount, replyCount, quoteCount, followerCount, createdAt } = tweet;

  // Engagement Score
  const engagement =
    likeCount * 2.0 +
    repostCount * 3.0 +
    (quoteCount || 0) * 2.5 +  // Quote RTボーナス
    replyCount * 1.5;

  const normalizer = Math.sqrt(followerCount + 100);
  const engagementScore = engagement / normalizer;

  // Velocity Score
  const hoursSincePost = Math.max(
    (Date.now() - createdAt.getTime()) / (1000 * 60 * 60),
    0.1
  );
  const velocityScore = engagementScore / Math.sqrt(hoursSincePost + 1);

  // Combined
  return engagementScore * 0.6 + velocityScore * 0.4;
}
```

### Phase 3: Semantic Scorer（変更なし）
```typescript
// src/scoring/semantic.ts
// 既存実装を維持（5次元評価）
```

### Phase 4: Final Scorer
```typescript
// src/scoring/final-scorer.ts
export function calculateFinalScore(
  qualityScore: number,
  semanticScore: number,
  isPriority: boolean,
  category: string,
  isTrending: boolean
): number {
  const categoryBonus = CATEGORY_BONUS[category] || 0;
  const priorityBonus = isPriority ? 25 : 0;
  const trendBonus = isTrending ? 10 : 0;

  return (
    qualityScore * 0.4 +
    semanticScore * 0.6 +
    priorityBonus +
    categoryBonus +
    trendBonus
  );
}

const CATEGORY_BONUS = {
  RESEARCH: 15,
  PRODUCT: 12,
  NEWS: 10,
  TOOL: 8,
  TUTORIAL: 5,
  SHOWCASE: 5,
  OPINION: 3,
  EVENT: 2,
};
```

## Verification

### Success Criteria
1. Top 2がオリジナル投稿（RT除外）
2. 優先インフルエンサーがTop 10に3名以上
3. Semantic高スコアが上位に（technicalNovelty >80の投稿がTop 5内）

### Testing
```typescript
// tests/scoring/quality-scorer.test.ts
describe('Quality Scorer', () => {
  it('sqrt正規化が正しく動作', () => {
    const score1 = calculateQualityScore({ followerCount: 1000, ... });
    const score10 = calculateQualityScore({ followerCount: 10000, ... });

    // 10倍差で約3倍の差
    expect(score10 / score1).toBeCloseTo(3, 0.5);
  });

  it('Quote RTがボーナス', () => {
    const normal = calculateQualityScore({ repostCount: 10, quoteCount: 0 });
    const quote = calculateQualityScore({ repostCount: 0, quoteCount: 10 });

    expect(quote).toBeGreaterThan(normal * 0.8);  // 2.5 vs 3.0
  });
});
```

### Monitoring
```typescript
// 日次ログ
logger.info({
  date: today,
  topPick1: {
    content: tweet.content.slice(0, 50),
    isRT: tweet.content.startsWith('RT @'),
    isPriority: tweet.isPriority,
    qualityScore: tweet.qualityScore,
    semanticScore: tweet.semanticScore,
    finalScore: tweet.finalScore,
  },
  stats: {
    avgQuality: avg(allTweets.map(t => t.qualityScore)),
    avgSemantic: avg(allTweets.map(t => t.semanticScore)),
    priorityInTop10: top10.filter(t => t.isPriority).length,
  },
});
```

## Migration Plan

### Week 3: 新スコア実装
- Quality Scorer実装
- Final Scorer実装
- 単体テスト

### Week 4: 並行実行（比較検証）
```typescript
// 既存スコアと新スコアを両方計算
const oldScore = calculateOldFinalScore(tweet);
const newScore = calculateFinalScore(tweet);

tweet.oldFinalScore = oldScore;
tweet.finalScore = newScore;

// Top 10の差分を分析
logger.info({
  oldTop10: oldTopPicks.map(t => t.tweetId),
  newTop10: newTopPicks.map(t => t.tweetId),
  overlap: intersection(oldTop10, newTop10).length,
});
```

### Week 5: 完全移行
- 新スコアのみ使用
- oldFinalScoreフィールド削除

## Related Decisions
- ADR 001: フィルタリングパイプライン（RTフィルタ）
- ADR 003: カテゴリ分類システム（category_bonus）

## References
- 実データ分析: `data/scored_2025-12-19.json`
- 要件定義: `docs/requirements.md` Section 6.2-6.3
