import { PrismaClient, ArticleType, ArticleStatus } from '@prisma/client';
import { ScoredTweet, TweetData } from '../types/index.js';
import { logger } from '../utils/logger.js';

// Prisma クライアント（シングルトン）
const prisma = new PrismaClient();

/**
 * データベース接続を確認
 */
export async function checkConnection(): Promise<boolean> {
  try {
    await prisma.$connect();
    logger.info('Database connection established');
    return true;
  } catch (error) {
    logger.error('Database connection failed:', error);
    return false;
  }
}

/**
 * データベース接続を切断
 */
export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}

// ================== Tweet 操作 ==================

/**
 * 投稿を保存（upsert）
 */
export async function saveTweet(tweet: ScoredTweet, isTopPick: boolean = false): Promise<void> {
  try {
    await prisma.tweet.upsert({
      where: { tweetId: tweet.tweetId },
      update: {
        likeCount: tweet.likeCount,
        repostCount: tweet.repostCount,
        replyCount: tweet.replyCount,
        impressionCount: tweet.impressionCount,
        followerCount: tweet.followerCount,
        baseScore: tweet.baseScore,
        velocityScore: tweet.velocityScore,
        efficiencyScore: tweet.efficiencyScore,
        semanticScore: tweet.semanticScore,
        finalScore: tweet.finalScore,
        isPriority: tweet.isPriority,
        isTopPick,
      },
      create: {
        tweetId: tweet.tweetId,
        authorId: tweet.authorId,
        authorUsername: tweet.authorUsername,
        content: tweet.content,
        createdAt: tweet.createdAt,
        likeCount: tweet.likeCount,
        repostCount: tweet.repostCount,
        replyCount: tweet.replyCount,
        impressionCount: tweet.impressionCount,
        followerCount: tweet.followerCount,
        baseScore: tweet.baseScore,
        velocityScore: tweet.velocityScore,
        efficiencyScore: tweet.efficiencyScore,
        semanticScore: tweet.semanticScore,
        finalScore: tweet.finalScore,
        isPriority: tweet.isPriority,
        isTopPick,
      },
    });
  } catch (error) {
    logger.error(`Failed to save tweet ${tweet.tweetId}:`, error);
    throw error;
  }
}

/**
 * 複数の投稿を一括保存
 */
export async function saveTweets(
  tweets: ScoredTweet[],
  topPickIds: string[] = []
): Promise<{ saved: number; errors: number }> {
  let saved = 0;
  let errors = 0;

  for (const tweet of tweets) {
    try {
      const isTopPick = topPickIds.includes(tweet.tweetId);
      await saveTweet(tweet, isTopPick);
      saved++;
    } catch {
      errors++;
    }
  }

  logger.info(`Saved ${saved} tweets, ${errors} errors`);
  return { saved, errors };
}

/**
 * 特定の日付の投稿を取得
 */
export async function getTweetsByDate(date: Date): Promise<ScoredTweet[]> {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const tweets = await prisma.tweet.findMany({
    where: {
      collectedAt: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
    orderBy: {
      finalScore: 'desc',
    },
  });

  return tweets.map((t) => ({
    tweetId: t.tweetId,
    authorId: t.authorId,
    authorUsername: t.authorUsername,
    content: t.content,
    createdAt: t.createdAt,
    likeCount: t.likeCount,
    repostCount: t.repostCount,
    replyCount: t.replyCount,
    impressionCount: t.impressionCount ?? undefined,
    followerCount: t.followerCount,
    baseScore: t.baseScore ?? 0,
    velocityScore: t.velocityScore ?? 0,
    efficiencyScore: t.efficiencyScore ?? 0,
    semanticScore: t.semanticScore ?? 0,
    finalScore: t.finalScore ?? 0,
    isPriority: t.isPriority,
  }));
}

/**
 * トップピックを取得
 */
export async function getTopPicks(date: Date): Promise<ScoredTweet[]> {
  const tweets = await getTweetsByDate(date);
  return tweets.filter((t) => {
    // 上位2件または isTopPick フラグが true のもの
    return tweets.indexOf(t) < 2;
  });
}

/**
 * 投稿のフラグを更新
 */
export async function updateTweetFlags(
  tweetId: string,
  flags: { usedInNote?: boolean; usedInKindle?: boolean; isTopPick?: boolean }
): Promise<void> {
  await prisma.tweet.update({
    where: { tweetId },
    data: flags,
  });
}

/**
 * 未使用の投稿を取得（note/Kindle用）
 */
export async function getUnusedTweets(
  type: 'note' | 'kindle',
  limit: number = 10
): Promise<ScoredTweet[]> {
  const whereClause = type === 'note'
    ? { usedInNote: false }
    : { usedInKindle: false };

  const tweets = await prisma.tweet.findMany({
    where: whereClause,
    orderBy: { finalScore: 'desc' },
    take: limit,
  });

  return tweets.map((t) => ({
    tweetId: t.tweetId,
    authorId: t.authorId,
    authorUsername: t.authorUsername,
    content: t.content,
    createdAt: t.createdAt,
    likeCount: t.likeCount,
    repostCount: t.repostCount,
    replyCount: t.replyCount,
    impressionCount: t.impressionCount ?? undefined,
    followerCount: t.followerCount,
    baseScore: t.baseScore ?? 0,
    velocityScore: t.velocityScore ?? 0,
    efficiencyScore: t.efficiencyScore ?? 0,
    semanticScore: t.semanticScore ?? 0,
    finalScore: t.finalScore ?? 0,
    isPriority: t.isPriority,
  }));
}

// ================== DailyLog 操作 ==================

/**
 * 日次ログを保存
 */
export async function saveDailyLog(
  date: Date,
  data: {
    tweetsCollected: number;
    tweetsScored: number;
    topPickIds: string[];
    discordSent: boolean;
    errors?: string;
  }
): Promise<void> {
  const dateOnly = new Date(date);
  dateOnly.setHours(0, 0, 0, 0);

  await prisma.dailyLog.upsert({
    where: { date: dateOnly },
    update: {
      tweetsCollected: data.tweetsCollected,
      tweetsScored: data.tweetsScored,
      topPickIds: data.topPickIds,
      discordSent: data.discordSent,
      errors: data.errors,
    },
    create: {
      date: dateOnly,
      tweetsCollected: data.tweetsCollected,
      tweetsScored: data.tweetsScored,
      topPickIds: data.topPickIds,
      discordSent: data.discordSent,
      errors: data.errors,
    },
  });

  logger.info(`Saved daily log for ${dateOnly.toISOString().split('T')[0]}`);
}

/**
 * 日次ログが存在するか確認（二重処理防止）
 */
export async function hasProcessedDate(date: Date): Promise<boolean> {
  const dateOnly = new Date(date);
  dateOnly.setHours(0, 0, 0, 0);

  const log = await prisma.dailyLog.findUnique({
    where: { date: dateOnly },
  });

  return log !== null;
}

// ================== Article 操作 ==================

/**
 * 記事を保存
 */
export async function saveArticle(
  data: {
    type: 'NOTE_FREE' | 'NOTE_PAID' | 'KINDLE' | 'YOUTUBE_SCRIPT';
    title: string;
    body: string;
    wordCount: number;
    price?: number;
    tweetIds?: string[];
  }
): Promise<string> {
  const article = await prisma.article.create({
    data: {
      type: data.type as ArticleType,
      title: data.title,
      body: data.body,
      wordCount: data.wordCount,
      price: data.price,
      status: 'DRAFT' as ArticleStatus,
    },
  });

  // 投稿との関連付け
  if (data.tweetIds && data.tweetIds.length > 0) {
    for (const tweetId of data.tweetIds) {
      try {
        const tweet = await prisma.tweet.findUnique({ where: { tweetId } });
        if (tweet) {
          await prisma.articleTweet.create({
            data: {
              articleId: article.id,
              tweetId: tweet.id,
            },
          });

          // 使用済みフラグを更新
          if (data.type === 'NOTE_FREE' || data.type === 'NOTE_PAID') {
            await prisma.tweet.update({
              where: { tweetId },
              data: { usedInNote: true },
            });
          } else if (data.type === 'KINDLE') {
            await prisma.tweet.update({
              where: { tweetId },
              data: { usedInKindle: true },
            });
          }
        }
      } catch (error) {
        logger.warn(`Failed to link tweet ${tweetId} to article:`, error);
      }
    }
  }

  logger.info(`Saved article: ${article.id} (${data.type})`);
  return article.id;
}

/**
 * 記事のステータスを更新
 */
export async function updateArticleStatus(
  articleId: string,
  status: 'DRAFT' | 'REVIEW' | 'PUBLISHED'
): Promise<void> {
  await prisma.article.update({
    where: { id: articleId },
    data: {
      status: status as ArticleStatus,
      publishedAt: status === 'PUBLISHED' ? new Date() : undefined,
    },
  });
}

/**
 * 週間の記事数を取得
 */
export async function getWeeklyArticleCount(
  weekStart: Date,
  type: 'NOTE_PAID'
): Promise<number> {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const count = await prisma.article.count({
    where: {
      type: type as ArticleType,
      createdAt: {
        gte: weekStart,
        lt: weekEnd,
      },
    },
  });

  return count;
}

// ================== Influencer 操作 ==================

/**
 * インフルエンサーを取得
 */
export async function getActiveInfluencers(): Promise<string[]> {
  const influencers = await prisma.influencer.findMany({
    where: { isActive: true },
  });

  return influencers.map((i) => `@${i.username}`);
}

/**
 * インフルエンサーを追加
 */
export async function addInfluencer(
  userId: string,
  username: string,
  name: string
): Promise<void> {
  await prisma.influencer.upsert({
    where: { username },
    update: { name, isActive: true },
    create: { userId, username, name },
  });
}

// ================== Keyword 操作 ==================

/**
 * アクティブなキーワードを取得
 */
export async function getActiveKeywords(): Promise<string[]> {
  const keywords = await prisma.keyword.findMany({
    where: { isActive: true },
  });

  return keywords.map((k) => k.keyword);
}

/**
 * キーワードを追加
 */
export async function addKeyword(keyword: string, weight: number = 1.0): Promise<void> {
  await prisma.keyword.upsert({
    where: { keyword },
    update: { weight, isActive: true },
    create: { keyword, weight },
  });
}

export { prisma };
