import { TweetData, ScoredTweet, SemanticEvaluation } from '../types/index.js';
import { loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { evaluateSemantic } from './semantic.js';

const config = loadConfig();

/**
 * Base Score を計算
 * (like*1.0 + repost*2.0 + reply*1.5) / log10(follower_count + 10)
 */
export function calculateBaseScore(tweet: TweetData): number {
  const { likeCount, repostCount, replyCount, followerCount } = tweet;
  const engagement = likeCount * 1.0 + repostCount * 2.0 + replyCount * 1.5;
  const normalizer = Math.log10(followerCount + 10);
  return engagement / normalizer;
}

/**
 * Velocity Score を計算
 * (like + repost*2) / hours_since_post / log10(follower_count + 10)
 */
export function calculateVelocityScore(tweet: TweetData): number {
  const { likeCount, repostCount, followerCount, createdAt } = tweet;
  const hoursSincePost = Math.max(
    (Date.now() - createdAt.getTime()) / (1000 * 60 * 60),
    0.1 // 最小値を設定して0除算を防ぐ
  );
  const engagement = likeCount + repostCount * 2;
  const normalizer = Math.log10(followerCount + 10);
  return engagement / hoursSincePost / normalizer;
}

/**
 * Efficiency Score を計算
 * impressions / follower_count (代替: 反応数 / follower)
 */
export function calculateEfficiencyScore(tweet: TweetData): number {
  const { likeCount, repostCount, replyCount, impressionCount, followerCount } = tweet;

  if (impressionCount && impressionCount > 0) {
    return impressionCount / Math.max(followerCount, 1);
  }

  // 代替: 反応数 / フォロワー数
  const totalEngagement = likeCount + repostCount + replyCount;
  return totalEngagement / Math.max(followerCount, 1) * 100; // スケール調整
}

/**
 * Final Score を計算
 */
export function calculateFinalScore(
  baseScore: number,
  velocityScore: number,
  efficiencyScore: number,
  semanticScore: number,
  isPriority: boolean
): number {
  const { weights, priority_bonus } = config.scoring;

  // 各スコアを正規化（0-100）
  const normalizedBase = Math.min(baseScore, 100);
  const normalizedVelocity = Math.min(velocityScore * 10, 100);
  const normalizedEfficiency = Math.min(efficiencyScore * 10, 100);

  const weightedScore =
    normalizedBase * weights.base +
    normalizedVelocity * weights.velocity +
    normalizedEfficiency * weights.efficiency +
    semanticScore * weights.semantic;

  return isPriority ? weightedScore + priority_bonus : weightedScore;
}

/**
 * 単一の投稿をスコアリング
 */
export async function scoreTweet(tweet: TweetData): Promise<ScoredTweet> {
  const baseScore = calculateBaseScore(tweet);
  const velocityScore = calculateVelocityScore(tweet);
  const efficiencyScore = calculateEfficiencyScore(tweet);

  // Semantic Score を LLM で評価
  const semanticScore = await evaluateSemantic(tweet.content);

  const finalScore = calculateFinalScore(
    baseScore,
    velocityScore,
    efficiencyScore,
    semanticScore,
    tweet.isPriority
  );

  return {
    ...tweet,
    baseScore,
    velocityScore,
    efficiencyScore,
    semanticScore,
    finalScore,
  };
}

/**
 * 複数の投稿をスコアリング
 */
export async function scoreTweets(tweets: TweetData[]): Promise<ScoredTweet[]> {
  logger.info(`Scoring ${tweets.length} tweets...`);

  const scoredTweets: ScoredTweet[] = [];

  for (const tweet of tweets) {
    try {
      const scored = await scoreTweet(tweet);
      scoredTweets.push(scored);
    } catch (error) {
      logger.error(`Failed to score tweet ${tweet.tweetId}:`, error);
    }
  }

  // スコア順にソート
  scoredTweets.sort((a, b) => b.finalScore - a.finalScore);

  logger.info(`Scored ${scoredTweets.length} tweets successfully`);
  return scoredTweets;
}

/**
 * トップピックを選出
 */
export function selectTopPicks(scoredTweets: ScoredTweet[]): ScoredTweet[] {
  const topPickCount = config.scoring.top_pick_count;
  return scoredTweets.slice(0, topPickCount);
}
