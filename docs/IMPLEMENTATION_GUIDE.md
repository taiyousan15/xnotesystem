# 実装ガイド - フィルタリング&スコアリング改善

## 概要

本ガイドは、アーキテクチャ設計書（ARCHITECTURE.md）で提案された改善を段階的に実装するための実践的な手順書です。

## 前提条件

- Node.js 18以上
- TypeScript 5.7
- 既存システムが動作している
- 環境変数設定済み（X_BEARER_TOKEN, ANTHROPIC_API_KEY）

## 実装の全体像

```
Week 1-2: Phase 1 - フィルタリング基盤
Week 3-4: Phase 2-3 - スコアリング改善
Week 5:   Phase 4 - カテゴリ分類
Week 6:   統合・検証
```

---

## Phase 1: フィルタリング基盤（Week 1-2）

### 目標
1000件 → 300件に削減（RT除外、ノイズ除去）

### Step 1.1: フィルタインターフェース作成

```bash
# 新規ディレクトリ作成
mkdir -p src/filters
```

```typescript
// src/filters/types.ts
export interface FilterResult {
  passed: boolean;
  reason: string;
  metadata?: Record<string, any>;
}

export interface Filter {
  name: string;
  isEnabled(): boolean;
  filter(tweet: TweetData): Promise<FilterResult> | FilterResult;
}

export interface FilterConfig {
  enabled: boolean;
  [key: string]: any;
}
```

### Step 1.2: RTフィルタ実装

```typescript
// src/filters/rt-filter.ts
import { Filter, FilterResult, FilterConfig } from './types.js';
import { TweetData } from '../types/index.js';
import { loadConfig } from '../utils/config.js';

export class RTFilter implements Filter {
  name = 'RT Filter';
  private config: FilterConfig;

  constructor() {
    const appConfig = loadConfig();
    this.config = appConfig.filters?.rt_filter || { enabled: true };
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  filter(tweet: TweetData): FilterResult {
    const isRT = tweet.content.startsWith('RT @');

    // Quote RT判定（ヒューリスティック）
    const hasURL = /https:\/\/t\.co\/\w+/.test(tweet.content);
    const isQuoteRT = hasURL && !isRT;

    // Quote RTは許可
    if (this.config.allow_quote_retweet && isQuoteRT) {
      return {
        passed: true,
        reason: 'Quote RT allowed',
        metadata: { isQuoteRT: true },
      };
    }

    return {
      passed: !isRT,
      reason: isRT ? 'Retweet excluded' : 'Original tweet',
      metadata: { isRT, isQuoteRT },
    };
  }
}
```

**テスト**:
```typescript
// tests/filters/rt-filter.test.ts
import { describe, it, expect } from 'vitest';
import { RTFilter } from '../../src/filters/rt-filter.js';

describe('RTFilter', () => {
  const filter = new RTFilter();

  it('should exclude simple RT', () => {
    const result = filter.filter({
      content: 'RT @OpenAI: New model released',
    } as any);

    expect(result.passed).toBe(false);
    expect(result.reason).toBe('Retweet excluded');
  });

  it('should allow original tweet', () => {
    const result = filter.filter({
      content: 'This is my original thought on AI',
    } as any);

    expect(result.passed).toBe(true);
  });

  it('should allow Quote RT', () => {
    const result = filter.filter({
      content: 'Great insight! https://t.co/abc123',
    } as any);

    expect(result.passed).toBe(true);
    expect(result.metadata?.isQuoteRT).toBe(true);
  });
});
```

### Step 1.3: 言語フィルタ実装

```typescript
// src/filters/language-filter.ts
import { Filter, FilterResult, FilterConfig } from './types.js';
import { TweetData } from '../types/index.js';
import { loadConfig } from '../utils/config.js';

export class LanguageFilter implements Filter {
  name = 'Language Filter';
  private config: FilterConfig;
  private allowedLanguages: string[];

  // 日本語・英語判定用キーワード
  private jaKeywords = ['は', 'を', 'が', 'に', 'で', 'と', 'も', 'の'];
  private enKeywords = ['the', 'is', 'are', 'was', 'will', 'can', 'have'];

  constructor() {
    const appConfig = loadConfig();
    this.config = appConfig.filters?.language_filter || {
      enabled: true,
      allowed_languages: ['ja', 'en'],
    };
    this.allowedLanguages = this.config.allowed_languages || ['ja', 'en'];
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  filter(tweet: TweetData): FilterResult {
    const content = tweet.content.toLowerCase();

    // 日本語チェック
    const hasJapanese = this.jaKeywords.some(kw => content.includes(kw)) ||
                        /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(content);

    // 英語チェック
    const hasEnglish = this.enKeywords.some(kw => content.includes(kw)) ||
                       /[a-z]{3,}/.test(content);

    // いずれかの言語に該当すればOK
    const isAllowedLanguage =
      (this.allowedLanguages.includes('ja') && hasJapanese) ||
      (this.allowedLanguages.includes('en') && hasEnglish);

    return {
      passed: isAllowedLanguage,
      reason: isAllowedLanguage
        ? 'Language allowed'
        : 'Language not supported',
      metadata: { hasJapanese, hasEnglish },
    };
  }
}
```

### Step 1.4: スパムフィルタ実装

```typescript
// src/filters/spam-filter.ts
import { Filter, FilterResult, FilterConfig } from './types.js';
import { TweetData } from '../types/index.js';
import { loadConfig } from '../utils/config.js';

export class SpamFilter implements Filter {
  name = 'Spam Filter';
  private config: FilterConfig;
  private spamKeywords: string[];

  constructor() {
    const appConfig = loadConfig();
    this.config = appConfig.filters?.spam_filter || {
      enabled: true,
      max_urls: 3,
      max_hashtags: 5,
      max_emoji_ratio: 0.3,
      spam_keywords: ['フォロバ100%', '稼げる', 'DM送って', '詳細はプロフ'],
    };
    this.spamKeywords = this.config.spam_keywords || [];
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  filter(tweet: TweetData): FilterResult {
    const content = tweet.content;

    // URL過多チェック
    const urlCount = (content.match(/https?:\/\/\S+/g) || []).length;
    if (urlCount > this.config.max_urls) {
      return {
        passed: false,
        reason: `Too many URLs (${urlCount} > ${this.config.max_urls})`,
        metadata: { urlCount },
      };
    }

    // ハッシュタグ過多チェック
    const hashtagCount = (content.match(/#\w+/g) || []).length;
    if (hashtagCount > this.config.max_hashtags) {
      return {
        passed: false,
        reason: `Too many hashtags (${hashtagCount})`,
        metadata: { hashtagCount },
      };
    }

    // 絵文字過多チェック
    const emojiCount = (content.match(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]/gu) || []).length;
    const emojiRatio = emojiCount / content.length;
    if (emojiRatio > this.config.max_emoji_ratio) {
      return {
        passed: false,
        reason: `Too many emojis (${(emojiRatio * 100).toFixed(1)}%)`,
        metadata: { emojiCount, emojiRatio },
      };
    }

    // スパムキーワードチェック
    const foundSpamKeyword = this.spamKeywords.find(kw =>
      content.toLowerCase().includes(kw.toLowerCase())
    );
    if (foundSpamKeyword) {
      return {
        passed: false,
        reason: `Spam keyword detected: ${foundSpamKeyword}`,
        metadata: { spamKeyword: foundSpamKeyword },
      };
    }

    return {
      passed: true,
      reason: 'Not spam',
    };
  }
}
```

### Step 1.5: 関連性フィルタ実装

```typescript
// src/filters/relevance-filter.ts
import { Filter, FilterResult, FilterConfig } from './types.js';
import { TweetData } from '../types/index.js';
import { loadConfig } from '../utils/config.js';

export class RelevanceFilter implements Filter {
  name = 'Relevance Filter';
  private config: FilterConfig;
  private aiKeywords: string[];

  constructor() {
    const appConfig = loadConfig();
    this.config = appConfig.filters?.relevance_filter || {
      enabled: true,
      min_keyword_match: 1,
      ai_keywords: ['AI', 'LLM', 'ChatGPT', 'Claude', '機械学習', '深層学習', 'GPT'],
    };
    this.aiKeywords = this.config.ai_keywords || [];
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  filter(tweet: TweetData): FilterResult {
    const content = tweet.content;

    const matchedKeywords = this.aiKeywords.filter(kw =>
      content.toLowerCase().includes(kw.toLowerCase())
    );

    const isRelevant = matchedKeywords.length >= this.config.min_keyword_match;

    return {
      passed: isRelevant,
      reason: isRelevant
        ? `Relevant (${matchedKeywords.length} keywords matched)`
        : 'Not AI-related',
      metadata: { matchedKeywords, matchCount: matchedKeywords.length },
    };
  }
}
```

### Step 1.6: フィルタパイプライン統合

```typescript
// src/filters/pipeline.ts
import { Filter, FilterResult } from './types.js';
import { TweetData } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { RTFilter } from './rt-filter.js';
import { LanguageFilter } from './language-filter.js';
import { SpamFilter } from './spam-filter.js';
import { RelevanceFilter } from './relevance-filter.js';
import { loadConfig } from '../utils/config.js';

export interface FilterPipelineResult {
  filtered: TweetData[];
  stats: {
    input: number;
    output: number;
    removed: number;
    removalRate: number;
    byFilter: Record<string, number>;
  };
  logs: Array<{
    tweetId: string;
    filter: string;
    result: FilterResult;
  }>;
}

export class FilterPipeline {
  private filters: Filter[];
  private whitelistAccounts: string[];

  constructor() {
    this.filters = [
      new RTFilter(),
      new LanguageFilter(),
      new SpamFilter(),
      new RelevanceFilter(),
    ];

    const config = loadConfig();
    this.whitelistAccounts = config.filters?.whitelist?.priority_accounts || [];
  }

  async run(tweets: TweetData[]): Promise<FilterPipelineResult> {
    const stats = {
      input: tweets.length,
      output: 0,
      removed: 0,
      removalRate: 0,
      byFilter: {} as Record<string, number>,
    };

    const logs: Array<{ tweetId: string; filter: string; result: FilterResult }> = [];
    let filtered = tweets;

    logger.info(`Starting filter pipeline: ${tweets.length} tweets`);

    for (const filter of this.filters) {
      if (!filter.isEnabled()) {
        logger.info(`Skipping disabled filter: ${filter.name}`);
        continue;
      }

      const beforeCount = filtered.length;

      // 並列フィルタリング
      const results = await Promise.all(
        filtered.map(async (tweet) => {
          // ホワイトリストチェック
          if (this.whitelistAccounts.includes(`@${tweet.authorUsername}`)) {
            return { tweet, result: { passed: true, reason: 'Whitelisted' } as FilterResult };
          }

          const result = await filter.filter(tweet);
          return { tweet, result };
        })
      );

      // 通過したツイートのみ残す
      filtered = results
        .filter(({ result }) => result.passed)
        .map(({ tweet }) => tweet);

      // ログ記録
      results.forEach(({ tweet, result }) => {
        if (!result.passed) {
          logs.push({
            tweetId: tweet.tweetId,
            filter: filter.name,
            result,
          });
        }
      });

      const removedCount = beforeCount - filtered.length;
      stats.byFilter[filter.name] = removedCount;

      logger.info(
        `${filter.name}: ${beforeCount} → ${filtered.length} (-${removedCount})`
      );
    }

    stats.output = filtered.length;
    stats.removed = stats.input - stats.output;
    stats.removalRate = (stats.removed / stats.input) * 100;

    logger.info(
      `Filter pipeline complete: ${stats.input} → ${stats.output} (-${stats.removed}, ${stats.removalRate.toFixed(1)}%)`
    );

    return { filtered, stats, logs };
  }
}
```

### Step 1.7: CLIコマンド作成

```typescript
// src/cli/filter.ts
#!/usr/bin/env tsx
import 'dotenv/config';
import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'fs';
import { FilterPipeline } from '../filters/pipeline.js';
import { logger } from '../utils/logger.js';
import { TweetData } from '../types/index.js';

const program = new Command();

program
  .name('filter')
  .description('投稿データをフィルタリング')
  .requiredOption('-i, --input <path>', '入力JSONファイル')
  .option('-o, --output <path>', '出力JSONファイル')
  .option('--log-removed', '除外されたツイートをログ出力')
  .action(async (options) => {
    logger.info('='.repeat(50));
    logger.info('フィルタリングを開始します');
    logger.info(`入力ファイル: ${options.input}`);
    logger.info('='.repeat(50));

    try {
      // 入力データ読み込み
      const inputData = JSON.parse(readFileSync(options.input, 'utf-8'));
      const tweets: TweetData[] = inputData.tweets || inputData;

      logger.info(`読み込み: ${tweets.length} 件`);

      // フィルタリング実行
      const pipeline = new FilterPipeline();
      const result = await pipeline.run(tweets);

      // 結果出力
      const outputPath = options.output || options.input.replace('.json', '_filtered.json');
      const outputData = {
        date: inputData.date || new Date().toISOString().split('T')[0],
        filteredAt: new Date().toISOString(),
        input: result.stats.input,
        output: result.stats.output,
        removed: result.stats.removed,
        removalRate: `${result.stats.removalRate.toFixed(1)}%`,
        byFilter: result.stats.byFilter,
        tweets: result.filtered,
      };

      writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf-8');
      logger.info(`保存完了: ${outputPath}`);

      // 除外ログ出力（オプション）
      if (options.logRemoved && result.logs.length > 0) {
        const logPath = outputPath.replace('.json', '_removed.json');
        writeFileSync(logPath, JSON.stringify(result.logs, null, 2), 'utf-8');
        logger.info(`除外ログ: ${logPath}`);
      }

      // サマリー
      logger.info('='.repeat(50));
      logger.info('フィルタリングが完了しました');
      logger.info(`入力: ${result.stats.input} 件`);
      logger.info(`出力: ${result.stats.output} 件`);
      logger.info(`除外: ${result.stats.removed} 件 (${result.stats.removalRate.toFixed(1)}%)`);
      logger.info('フィルタ別除外数:');
      Object.entries(result.stats.byFilter).forEach(([filter, count]) => {
        logger.info(`  - ${filter}: ${count} 件`);
      });
      logger.info('='.repeat(50));

      console.log(`\n次のステップ: npm run score -- --input ${outputPath}`);
    } catch (error) {
      logger.error('フィルタリングでエラーが発生しました:', error);
      process.exit(1);
    }
  });

program.parse();
```

### Step 1.8: 設定ファイル更新

```json
// config/config.json に追加
{
  "filters": {
    "rt_filter": {
      "enabled": true,
      "allow_quote_retweet": true
    },
    "language_filter": {
      "enabled": true,
      "allowed_languages": ["ja", "en"]
    },
    "spam_filter": {
      "enabled": true,
      "max_urls": 3,
      "max_hashtags": 5,
      "max_emoji_ratio": 0.3,
      "spam_keywords": ["フォロバ100%", "稼げる", "DM送って", "詳細はプロフ"]
    },
    "relevance_filter": {
      "enabled": true,
      "min_keyword_match": 1,
      "ai_keywords": ["AI", "LLM", "ChatGPT", "Claude", "GPT", "機械学習", "深層学習", "生成AI"]
    },
    "whitelist": {
      "priority_accounts": [
        "@SuguruKun_ai",
        "@taishiyade",
        "@ceo_tommy1",
        "@rute1203d",
        "@The_AGI_WAY",
        "@unikoukokun",
        "@kamui_qai"
      ],
      "bypass_all_filters": false
    }
  }
}
```

### Step 1.9: package.json更新

```json
// package.json の scripts に追加
{
  "scripts": {
    "filter": "tsx src/cli/filter.ts",
    "test:filters": "vitest run tests/filters"
  }
}
```

### Step 1.10: Phase 1検証

```bash
# 1. テスト実行
npm run test:filters

# 2. 実データでフィルタリング
npm run collect
npm run filter -- --input data/collected_2025-12-20.json --log-removed

# 3. 結果確認
# 期待:
# - 入力: 1000件前後
# - 出力: 300件前後（70%削減）
# - RT Filter: 700件除外
# - Top 2がRTでない
```

---

## Phase 2: スコアリング改善（Week 3-4）

### Step 2.1: Quality Scorer実装

```typescript
// src/scoring/quality-scorer.ts
import { TweetData } from '../types/index.js';
import { loadConfig } from '../utils/config.js';

export interface QualityScoreBreakdown {
  engagementScore: number;
  velocityScore: number;
  qualityScore: number;
}

export function calculateQualityScore(tweet: TweetData): QualityScoreBreakdown {
  const { likeCount, repostCount, replyCount, followerCount, createdAt } = tweet;

  // Quote RT推定（metadata拡張が必要）
  const quoteCount = (tweet as any).quoteCount || 0;

  // Engagement Score（新方式: sqrt正規化）
  const engagement =
    likeCount * 2.0 +
    repostCount * 3.0 +
    quoteCount * 2.5 +
    replyCount * 1.5;

  const normalizer = Math.sqrt(followerCount + 100);
  const engagementScore = engagement / normalizer;

  // Velocity Score（時間減衰: sqrt）
  const hoursSincePost = Math.max(
    (Date.now() - createdAt.getTime()) / (1000 * 60 * 60),
    0.1
  );
  const velocityScore = engagementScore / Math.sqrt(hoursSincePost + 1);

  // Quality Score（統合）
  const config = loadConfig();
  const weights = config.scoring?.quality_weights || { engagement: 0.6, velocity: 0.4 };
  const qualityScore = engagementScore * weights.engagement + velocityScore * weights.velocity;

  return {
    engagementScore,
    velocityScore,
    qualityScore,
  };
}
```

### Step 2.2: Final Scorer実装

```typescript
// src/scoring/final-scorer.ts
import { loadConfig } from '../utils/config.js';

export interface FinalScoreInput {
  qualityScore: number;
  semanticScore: number;
  isPriority: boolean;
  category?: string;
  isTrending?: boolean;
}

export function calculateFinalScore(input: FinalScoreInput): number {
  const config = loadConfig();

  // 重み
  const weights = config.scoring?.final_weights || {
    quality: 0.4,
    semantic: 0.6,
  };

  // ボーナス
  const priorityBonus = input.isPriority ? (config.scoring?.priority_bonus || 25) : 0;

  const categoryBonus = input.category
    ? (config.scoring?.category_bonus?.[input.category] || 0)
    : 0;

  const trendBonus = input.isTrending ? 10 : 0;

  const finalScore =
    input.qualityScore * weights.quality +
    input.semanticScore * weights.semantic +
    priorityBonus +
    categoryBonus +
    trendBonus;

  return Math.round(finalScore);
}
```

### Step 2.3: Scorer統合更新

```typescript
// src/scoring/scorer.ts（既存を更新）
import { TweetData, ScoredTweet } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { evaluateSemantic } from './semantic.js';
import { calculateQualityScore } from './quality-scorer.js';
import { calculateFinalScore } from './final-scorer.js';

export async function scoreTweet(tweet: TweetData, category?: string, isTrending?: boolean): Promise<ScoredTweet> {
  // Phase 2: Quality Score
  const { engagementScore, velocityScore, qualityScore } = calculateQualityScore(tweet);

  // Phase 3: Semantic Score
  const semanticScore = await evaluateSemantic(tweet.content);

  // Phase 4: Final Score
  const finalScore = calculateFinalScore({
    qualityScore,
    semanticScore,
    isPriority: tweet.isPriority,
    category,
    isTrending,
  });

  return {
    ...tweet,
    baseScore: engagementScore,  // 互換性のため
    velocityScore,
    efficiencyScore: qualityScore,  // 互換性のため
    semanticScore,
    finalScore,
    // 新フィールド
    qualityScore,
    category,
    isTrending,
  } as ScoredTweet;
}

export async function scoreTweets(tweets: TweetData[]): Promise<ScoredTweet[]> {
  logger.info(`Scoring ${tweets.length} tweets...`);

  // 上限200件
  const maxSemantic = 200;
  const tweetsToScore = tweets.slice(0, maxSemantic);

  if (tweets.length > maxSemantic) {
    logger.warn(`Limiting semantic evaluation to ${maxSemantic} tweets (was ${tweets.length})`);
  }

  const scoredTweets: ScoredTweet[] = [];

  // バッチ処理（10件ずつ、500ms delay）
  const batchSize = 10;
  for (let i = 0; i < tweetsToScore.length; i += batchSize) {
    const batch = tweetsToScore.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map(tweet => scoreTweet(tweet).catch(err => {
        logger.error(`Failed to score tweet ${tweet.tweetId}:`, err);
        return null;
      }))
    );

    scoredTweets.push(...batchResults.filter(Boolean) as ScoredTweet[]);

    // レート制限対策
    if (i + batchSize < tweetsToScore.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    logger.info(`Scored batch ${i / batchSize + 1}/${Math.ceil(tweetsToScore.length / batchSize)}`);
  }

  // スコア順にソート
  scoredTweets.sort((a, b) => b.finalScore - a.finalScore);

  logger.info(`Scored ${scoredTweets.length} tweets successfully`);
  return scoredTweets;
}
```

### Step 2.4: 設定更新

```json
// config/config.json に追加
{
  "scoring": {
    "quality_weights": {
      "engagement": 0.6,
      "velocity": 0.4
    },
    "final_weights": {
      "quality": 0.4,
      "semantic": 0.6
    },
    "priority_bonus": 25,
    "category_bonus": {
      "RESEARCH": 15,
      "PRODUCT": 12,
      "NEWS": 10,
      "TOOL": 8,
      "TUTORIAL": 5,
      "SHOWCASE": 5,
      "OPINION": 3,
      "EVENT": 2
    }
  }
}
```

### Step 2.5: Phase 2検証

```bash
# 1. フィルタ済みデータをスコアリング
npm run score -- --input data/collected_2025-12-20_filtered.json

# 2. 結果確認
# 期待:
# - Top 2がオリジナル投稿（RTなし）
# - 優先インフルエンサーがTop 10に3名以上
# - 処理時間 <2分
```

---

## Phase 3: 日次フロー統合（Week 5）

### Step 3.1: daily.ts更新

```typescript
// src/cli/daily.ts（既存を更新）
import { FilterPipeline } from '../filters/pipeline.js';
import { scoreTweets } from '../scoring/scorer.js';

async function runDaily() {
  // Phase 1: 収集
  const collected = await xClient.collectByKeywords();
  const influencerTweets = await xClient.collectFromInfluencers();
  const allTweets = removeDuplicates([...collected, ...influencerTweets]);

  logger.info(`Collected: ${allTweets.length} tweets`);

  // Phase 2: フィルタリング（新規）
  const pipeline = new FilterPipeline();
  const filterResult = await pipeline.run(allTweets);

  logger.info(`Filtered: ${filterResult.filtered.length} tweets`);

  // Phase 3: スコアリング
  const scoredTweets = await scoreTweets(filterResult.filtered);

  logger.info(`Scored: ${scoredTweets.length} tweets`);

  // Phase 4: Top 2選定
  const topPicks = scoredTweets.slice(0, 2);

  // 保存
  await saveToSheets(scoredTweets, topPicks);
  await saveToNotion(scoredTweets);

  // Discord配信
  await sendToDiscord(topPicks, 'vip');
  await sendToDiscord(generateTrendSummary(scoredTweets), 'general');
}
```

---

## トラブルシューティング

### 問題: フィルタで300件に減らない（500件残る）

**原因**: スパムフィルタのしきい値が緩い

**対処**:
```json
// config/config.json
{
  "spam_filter": {
    "max_urls": 2,  // 3 → 2
    "max_hashtags": 3  // 5 → 3
  }
}
```

### 問題: Top 2に優先インフルエンサーが入らない

**原因**: priority_bonusが不足

**対処**:
```json
{
  "scoring": {
    "priority_bonus": 30  // 25 → 30
  }
}
```

### 問題: LLM評価が2分超える

**原因**: バッチサイズが小さい

**対処**:
```typescript
// src/scoring/scorer.ts
const batchSize = 20;  // 10 → 20
const delay = 300;     // 500 → 300
```

---

## 次のステップ

Phase 1-2完了後、以下を実施：

1. **1週間運用**: 日次実行してデータ収集
2. **スコア調整**: Top 10の内容を確認、category_bonus調整
3. **Phase 4実装**: カテゴリ分類（Week 5）
4. **VIPレビュー**: 「重要2件」が価値あるか確認

---

## 完了チェックリスト

### Phase 1
- [ ] RTフィルタ実装・テスト
- [ ] 言語フィルタ実装・テスト
- [ ] スパムフィルタ実装・テスト
- [ ] 関連性フィルタ実装・テスト
- [ ] パイプライン統合
- [ ] CLI実装
- [ ] 実データで300件削減確認

### Phase 2
- [ ] Quality Scorer実装・テスト
- [ ] Final Scorer実装・テスト
- [ ] Scorer統合更新
- [ ] 実データでTop 2がオリジナル投稿確認
- [ ] 優先インフルエンサーTop 10入り確認

### Phase 3
- [ ] daily.ts統合
- [ ] E2Eテスト（collect → filter → score → distribute）
- [ ] 処理時間2分以内確認
- [ ] VIPレビュー完了
