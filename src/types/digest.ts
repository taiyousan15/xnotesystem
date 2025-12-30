/**
 * AI Digest System - 型定義
 * 日次X投稿解析・Notion保存・Discord投稿のための型
 */

// ============================================
// LLM解析関連
// ============================================

/**
 * LLMカテゴリ（10種）
 */
export type LLMCategory =
  | 'LLM'
  | 'Agent'
  | 'RAG'
  | 'MCP'
  | 'Tooling'
  | 'Research'
  | 'Product'
  | 'Business'
  | 'Security'
  | 'Other';

/**
 * コンテンツタイプ（6種）
 */
export type ContentType =
  | 'News'
  | 'Tools-OSS'
  | 'Papers'
  | 'Tutorials'
  | 'Opinions'
  | 'Security';

/**
 * LLM解析結果
 */
export interface LLMAnalysisResult {
  category: LLMCategory;
  type: ContentType;
  tags: string[];           // #で始まるタグ（最大6個）
  topicHints: string[];     // トピック抽出用ヒント
  score: number;            // 0-100
  titleJa: string;          // 日本語タイトル（50文字以内）
  summaryBulletsJa: string[]; // 要約箇条書き（2-3項目）
  insightJa: string;        // 洞察（100文字以内）
  clusterKey: string;       // 重複検出用キー
}

/**
 * LLM解析入力
 */
export interface LLMAnalysisInput {
  tweet_text: string;
  author: string;
  created_at: string;
  metrics: {
    like: number;
    repost: number;
    reply: number;
    quote: number;
  };
  canonical_url: string | null;
  link_title: string | null;
  link_excerpt: string | null;
  link_extracted_text: string | null;
  hints: {
    domains: string[];
    has_github: boolean;
    has_arxiv: boolean;
  };
}

// ============================================
// ツイート関連
// ============================================

/**
 * 収集済みツイート（X APIから取得した生データ）
 */
export interface CollectedTweet {
  id: string;
  authorId: string;
  authorUsername: string;
  content: string;
  createdAt: string;
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  url: string;
  queryId: string;
  category: string;       // クエリカテゴリ（NEWS等）
  tag: string;            // 既存タグ（STAR等）
  isBreaking: boolean;
}

/**
 * 解析済みツイート
 */
export interface AnalyzedTweet {
  // 元データ
  id: string;
  authorId: string;
  authorUsername: string;
  content: string;
  createdAt: string;
  url: string;

  // エンゲージメント
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;

  // LLM解析結果
  analysis: LLMAnalysisResult;

  // リンク解析結果
  links: LinkMetadata[];

  // トピック情報（トピック抽出後に付与）
  topicKey: string;
  topicLabel: string;

  // 選定情報（Top25選定後に付与）
  isTopPick: boolean;
  whySelected?: string;

  // 統合スコア
  combinedScore: number;
}

// ============================================
// リンク解析関連
// ============================================

/**
 * リンクメタデータ
 */
export interface LinkMetadata {
  originalUrl: string;
  canonicalUrl: string;
  title: string;
  summary: string;
  domain: string;
  fetchedAt: string;
  error?: string;
}

/**
 * SQLiteキャッシュレコード
 */
export interface LinkCacheRecord {
  url_hash: string;         // SHA256(originalUrl)
  original_url: string;
  canonical_url: string;
  title: string;
  summary: string;
  domain: string;
  fetched_at: string;
  expires_at: string;       // fetched_at + 7日
}

// ============================================
// トピック関連
// ============================================

/**
 * トピック
 */
export interface Topic {
  key: string;              // 機械的に生成されたキー
  label: string;            // LLMが生成した人間可読ラベル
  summary: string;          // トピック要約
  tweetCount: number;       // 所属ツイート数
  representativeTweetIds: string[]; // 代表サンプル（最大3件）
}

/**
 * トピック抽出結果
 */
export interface TopicExtractionResult {
  topics: Topic[];
  tweetTopicMapping: Map<string, string>; // tweetId → topicKey
}

// ============================================
// ダイジェスト関連
// ============================================

/**
 * ダイジェスト統計
 */
export interface DigestStats {
  totalCount: number;
  categoryDistribution: Record<LLMCategory, number>;
  typeDistribution: Record<ContentType, number>;
  topAuthors: Array<{ author: string; count: number }>;
  topPickCount: number;
  averageScore: number;
}

/**
 * ダイジェスト結果
 */
export interface DigestResult {
  date: string;             // YYYY-MM-DD
  collectedAt: string;      // ISO timestamp
  stats: DigestStats;
  topics: Topic[];
  topPicks: AnalyzedTweet[];
  allTweets: AnalyzedTweet[];
  digestPageId: string;     // Notion日次ダイジェストページID
  digestPageUrl: string;    // Notion日次ダイジェストURL
  errors: string[];
}

// ============================================
// Notion関連
// ============================================

/**
 * Notionプロパティ（AITweets DB）
 */
export interface NotionTweetProperties {
  Title: string;            // analysis.titleJa
  'Tweet ID': string;       // tweetId（Upsertキー）
  Author: string;           // @username
  Category: LLMCategory;    // analysis.category
  Score: number;            // analysis.score
  Date: string;             // digestDate（YYYY-MM-DD）
  Priority: boolean;        // 重要度フラグ
  'Top Pick': boolean;      // 今日の25件
  'Note Status': 'Unused' | 'Used' | 'Candidate';
  'Kindle Status': 'Unused' | 'Used' | 'Candidate';
}

/**
 * Upsert結果
 */
export interface UpsertResult {
  created: number;
  updated: number;
  errors: number;
  pageIds: Map<string, string>; // tweetId → pageId
}

/**
 * Upsertオプション
 */
export interface UpsertOptions {
  isTopPick?: boolean;
  isPriority?: boolean;
  addPageContent?: boolean;
  digestDate: string;       // YYYY-MM-DD
}

// ============================================
// Discord関連
// ============================================

/**
 * Discord投稿データ
 */
export interface DiscordDigestPost {
  title: string;            // "Daily X Digest YYYY-MM-DD"
  stats: DigestStats;
  topics: Topic[];
  topFive: AnalyzedTweet[];
  notionDigestUrl: string;
  notionDbViewUrl: string;
}

// ============================================
// 設定関連
// ============================================

/**
 * Digest設定
 */
export interface DigestConfig {
  ollama: {
    url: string;
    model: string;
    timeout: number;
    concurrency: number;
  };
  notion: {
    databaseId: string;
    dbViewUrl: string;
  };
  linkCache: {
    path: string;
    ttlDays: number;
  };
  selection: {
    topPickCount: number;           // 25
    maxPerAuthor: number;           // 2
    maxPerTopic: number;            // 6
    minCategoryDiversity: string[]; // 最低1件必要なカテゴリ
  };
}

// ============================================
// ユーティリティ型
// ============================================

/**
 * 全カテゴリリスト
 */
export const ALL_CATEGORIES: LLMCategory[] = [
  'LLM', 'Agent', 'RAG', 'MCP', 'Tooling',
  'Research', 'Product', 'Business', 'Security', 'Other'
];

/**
 * 全タイプリスト
 */
export const ALL_TYPES: ContentType[] = [
  'News', 'Tools-OSS', 'Papers', 'Tutorials', 'Opinions', 'Security'
];

/**
 * デフォルト設定
 */
export const DEFAULT_DIGEST_CONFIG: DigestConfig = {
  ollama: {
    url: 'http://localhost:11434',
    model: 'llama3.1:70b',
    timeout: 180000,
    concurrency: 1,
  },
  notion: {
    databaseId: '2d9a70028dad80588a0afb8f4a5a9f0b',
    dbViewUrl: 'https://www.notion.so/2d9a70028dad80588a0afb8f4a5a9f0b?v=2d9a70028dad80eabc3d000cd205a503',
  },
  linkCache: {
    path: './data/link-cache.sqlite',
    ttlDays: 7,
  },
  selection: {
    topPickCount: 25,
    maxPerAuthor: 2,
    maxPerTopic: 6,
    minCategoryDiversity: ['LLM', 'Agent', 'RAG', 'Product', 'Business'],
  },
};
