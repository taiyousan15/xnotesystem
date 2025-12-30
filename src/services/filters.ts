/**
 * コンテンツフィルタリングサービス
 * - RT重複排除
 * - ノイズ除去
 * - 品質フィルタリング
 */

import { ScoredTweet } from '../types/index.js';
import { logger } from '../utils/logger.js';

// 収集したツイートの型（スコアリング前）
export interface CollectedTweet {
  tweetId: string;
  authorId: string;
  authorUsername: string;
  content: string;
  createdAt: Date | string;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  followerCount: number;
  impressionCount?: number;
}

/**
 * RTを検出して元ツイート情報を抽出
 */
function parseRT(content: string): { isRT: boolean; originalAuthor?: string; originalContent?: string } {
  // RT @username: で始まるパターン
  const rtPattern = /^RT @(\w+):\s*(.*)$/s;
  const match = content.match(rtPattern);

  if (match) {
    return {
      isRT: true,
      originalAuthor: match[1],
      originalContent: match[2].trim(),
    };
  }

  return { isRT: false };
}

/**
 * コンテンツの正規化（比較用）
 */
function normalizeContent(content: string): string {
  return content
    .replace(/^RT @\w+:\s*/s, '') // RT prefix除去
    .replace(/https?:\/\/\S+/g, '') // URL除去
    .replace(/\s+/g, ' ') // 空白正規化
    .trim()
    .slice(0, 100) // 先頭100文字で比較
    .toLowerCase();
}

/**
 * RT重複排除フィルタ
 * 同じ元ツイートのRTは1つだけ残す（最もエンゲージメントが高いもの）
 */
export function deduplicateRTs<T extends CollectedTweet | ScoredTweet>(
  tweets: T[]
): { filtered: T[]; removed: number; rtGroups: Map<string, number> } {
  const contentGroups = new Map<string, T[]>();
  const nonRTs: T[] = [];
  const rtGroups = new Map<string, number>();

  // RTとオリジナルを分類
  for (const tweet of tweets) {
    const rtInfo = parseRT(tweet.content);

    if (rtInfo.isRT) {
      const key = normalizeContent(tweet.content);
      if (!contentGroups.has(key)) {
        contentGroups.set(key, []);
      }
      contentGroups.get(key)!.push(tweet);
    } else {
      nonRTs.push(tweet);
    }
  }

  // 各RTグループから最もエンゲージメントが高いものを選択
  const selectedRTs: T[] = [];
  for (const [key, group] of contentGroups) {
    rtGroups.set(key, group.length);

    // エンゲージメント順にソート
    const sorted = group.sort((a, b) => {
      const engA = a.likeCount + a.repostCount * 2 + a.replyCount;
      const engB = b.likeCount + b.repostCount * 2 + b.replyCount;
      return engB - engA;
    });

    // 最もエンゲージメントが高いものを選択
    selectedRTs.push(sorted[0]);
  }

  const filtered = [...nonRTs, ...selectedRTs];
  const removed = tweets.length - filtered.length;

  logger.info(`RT重複排除: ${tweets.length}件 → ${filtered.length}件 (${removed}件除去)`);

  return { filtered, removed, rtGroups };
}

/**
 * RTを完全除外（オリジナル投稿のみ）
 */
export function excludeRTs<T extends CollectedTweet | ScoredTweet>(
  tweets: T[]
): { filtered: T[]; removed: number } {
  const filtered = tweets.filter((tweet) => !parseRT(tweet.content).isRT);
  const removed = tweets.length - filtered.length;

  logger.info(`RT除外: ${tweets.length}件 → ${filtered.length}件 (${removed}件のRT除去)`);

  return { filtered, removed };
}

/**
 * 最低エンゲージメントフィルタ
 */
export function filterByMinEngagement<T extends CollectedTweet | ScoredTweet>(
  tweets: T[],
  minLikes: number = 5,
  minEngagement: number = 10
): { filtered: T[]; removed: number } {
  const filtered = tweets.filter((tweet) => {
    const totalEngagement = tweet.likeCount + tweet.repostCount + tweet.replyCount;
    return tweet.likeCount >= minLikes || totalEngagement >= minEngagement;
  });

  const removed = tweets.length - filtered.length;
  logger.info(`エンゲージメントフィルタ: ${tweets.length}件 → ${filtered.length}件 (${removed}件除去)`);

  return { filtered, removed };
}

/**
 * スパム・宣伝フィルタ
 */
export function filterSpam<T extends CollectedTweet | ScoredTweet>(
  tweets: T[]
): { filtered: T[]; removed: number } {
  const spamPatterns = [
    /無料.*配布/i,
    /プレゼント.*応募/i,
    /フォロー.*RT.*で/i,
    /抽選で.*名様/i,
    /今だけ.*無料/i,
    /line.*追加/i,
    /affiliate|アフィリエイト/i,
    /稼ぐ|稼げる|副業/i,
    /詳細はプロフ/i,
    /DMください/i,
  ];

  const filtered = tweets.filter((tweet) => {
    for (const pattern of spamPatterns) {
      if (pattern.test(tweet.content)) {
        return false;
      }
    }
    return true;
  });

  const removed = tweets.length - filtered.length;
  logger.info(`スパムフィルタ: ${tweets.length}件 → ${filtered.length}件 (${removed}件除去)`);

  return { filtered, removed };
}

/**
 * 言語フィルタ（日本語・英語のみ）
 */
export function filterByLanguage<T extends CollectedTweet | ScoredTweet>(
  tweets: T[]
): { filtered: T[]; removed: number } {
  // 日本語・英語以外を除外
  const filtered = tweets.filter((tweet) => {
    const content = tweet.content;

    // 日本語文字が含まれているか
    const hasJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(content);

    // 英語のみ（アルファベットと一般的な記号のみ）
    const isEnglish = /^[\x00-\x7F\s]+$/.test(content.replace(/https?:\/\/\S+/g, ''));

    return hasJapanese || isEnglish;
  });

  const removed = tweets.length - filtered.length;
  logger.info(`言語フィルタ: ${tweets.length}件 → ${filtered.length}件 (${removed}件除去)`);

  return { filtered, removed };
}

/**
 * 優先インフルエンサーのツイートを保護
 */
export function protectPriorityAccounts<T extends CollectedTweet | ScoredTweet>(
  tweets: T[],
  priorityAccounts: string[]
): { priority: T[]; others: T[] } {
  const prioritySet = new Set(priorityAccounts.map((a) => a.toLowerCase().replace('@', '')));

  const priority: T[] = [];
  const others: T[] = [];

  for (const tweet of tweets) {
    if (prioritySet.has(tweet.authorUsername.toLowerCase())) {
      priority.push(tweet);
    } else {
      others.push(tweet);
    }
  }

  logger.info(`優先アカウント: ${priority.length}件保護, その他: ${others.length}件`);

  return { priority, others };
}

/**
 * 完全なフィルタリングパイプライン
 */
export function applyAllFilters<T extends CollectedTweet | ScoredTweet>(
  tweets: T[],
  options: {
    priorityAccounts?: string[];
    excludeRTs?: boolean;
    deduplicateRTs?: boolean;
    minLikes?: number;
    minEngagement?: number;
    filterSpam?: boolean;
    filterLanguage?: boolean;
  } = {}
): { filtered: T[]; stats: FilterStats } {
  const stats: FilterStats = {
    input: tweets.length,
    output: 0,
    rtRemoved: 0,
    duplicateRemoved: 0,
    lowEngagementRemoved: 0,
    spamRemoved: 0,
    languageRemoved: 0,
    priorityProtected: 0,
  };

  let result = [...tweets];

  // 1. 優先アカウントを保護
  let priorityTweets: T[] = [];
  if (options.priorityAccounts && options.priorityAccounts.length > 0) {
    const { priority, others } = protectPriorityAccounts(result, options.priorityAccounts);
    priorityTweets = priority;
    result = others;
    stats.priorityProtected = priority.length;
  }

  // 2. RT処理
  if (options.excludeRTs) {
    const { filtered, removed } = excludeRTs(result);
    result = filtered;
    stats.rtRemoved = removed;
  } else if (options.deduplicateRTs !== false) {
    const { filtered, removed } = deduplicateRTs(result);
    result = filtered;
    stats.duplicateRemoved = removed;
  }

  // 3. スパムフィルタ
  if (options.filterSpam !== false) {
    const { filtered, removed } = filterSpam(result);
    result = filtered;
    stats.spamRemoved = removed;
  }

  // 4. 言語フィルタ
  if (options.filterLanguage !== false) {
    const { filtered, removed } = filterByLanguage(result);
    result = filtered;
    stats.languageRemoved = removed;
  }

  // 5. エンゲージメントフィルタ
  if (options.minLikes || options.minEngagement) {
    const { filtered, removed } = filterByMinEngagement(
      result,
      options.minLikes || 5,
      options.minEngagement || 10
    );
    result = filtered;
    stats.lowEngagementRemoved = removed;
  }

  // 優先アカウントのツイートを復元
  result = [...priorityTweets, ...result];

  stats.output = result.length;

  logger.info('=== フィルタリング結果 ===');
  logger.info(`入力: ${stats.input}件`);
  logger.info(`出力: ${stats.output}件`);
  logger.info(`優先保護: ${stats.priorityProtected}件`);
  logger.info(`RT除去: ${stats.rtRemoved}件`);
  logger.info(`重複除去: ${stats.duplicateRemoved}件`);
  logger.info(`スパム除去: ${stats.spamRemoved}件`);
  logger.info(`言語除去: ${stats.languageRemoved}件`);
  logger.info(`低エンゲージ除去: ${stats.lowEngagementRemoved}件`);

  return { filtered: result, stats };
}

export interface FilterStats {
  input: number;
  output: number;
  rtRemoved: number;
  duplicateRemoved: number;
  lowEngagementRemoved: number;
  spamRemoved: number;
  languageRemoved: number;
  priorityProtected: number;
}
