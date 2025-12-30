// Tweet関連の型定義
export interface TweetData {
  tweetId: string;
  authorId: string;
  authorUsername: string;
  content: string;
  createdAt: Date;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  impressionCount?: number;
  followerCount: number;
  isPriority: boolean;
}

export interface ScoredTweet extends TweetData {
  baseScore: number;
  velocityScore: number;
  efficiencyScore: number;
  semanticScore: number;
  finalScore: number;
}

// スコアリング設定
export interface ScoringWeights {
  base: number;
  velocity: number;
  efficiency: number;
  semantic: number;
}

export interface ScoringConfig {
  weights: ScoringWeights;
  priority_bonus: number;
  top_pick_count: number;
}

// 収集設定
export interface CollectionConfig {
  max_tweets_per_keyword: number;
  max_tweets_per_influencer: number;
  lookback_hours: number;
  keywords: string[];
}

// note設定
export interface NoteConfig {
  max_paid_per_week: number;
  price: number;
  word_counts: number[];
}

// Kindle設定
export interface KindleConfig {
  min_pages: number;
  max_pages: number;
  structure: string[];
}

// Discord設定
export interface DiscordConfig {
  daily_time: string;
  weekly_day: string;
}

// 全体設定
export interface AppConfig {
  scoring: ScoringConfig;
  collection: CollectionConfig;
  influencers: string[];
  note: NoteConfig;
  kindle: KindleConfig;
  discord: DiscordConfig;
  retry: {
    max_attempts: number;
    backoff_ms: number;
  };
}

// Semantic Score の評価項目
export interface SemanticEvaluation {
  technicalNovelty: number;    // 技術的新規性 (0-100)
  practicalValue: number;      // 実務価値 (0-100)
  topicality: number;          // 話題性 (0-100)
  archiveValue: number;        // 保存価値 (0-100)
  discussionPotential: number; // 議論性 (0-100)
}

// Discord配信タイプ
export type DiscordChannelType = 'general' | 'vip';
export type DiscordMessageType = 'daily' | 'weekly';

// 記事タイプ
export type ArticleType = 'NOTE_FREE' | 'NOTE_PAID' | 'KINDLE' | 'YOUTUBE_SCRIPT';
export type ArticleStatus = 'DRAFT' | 'REVIEW' | 'PUBLISHED';

// 日次処理結果
export interface DailyResult {
  date: Date;
  tweetsCollected: number;
  tweetsScored: number;
  topPicks: ScoredTweet[];
  discordSent: boolean;
  errors?: string[];
}

// 週次処理結果
export interface WeeklyResult {
  weekStart: Date;
  weekEnd: Date;
  notesGenerated: number;
  kindleGenerated: boolean;
  youtubeScriptGenerated: boolean;
  errors?: string[];
}
