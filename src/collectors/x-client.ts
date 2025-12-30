import { TwitterApi, TweetV2, UserV2 } from 'twitter-api-v2';
import { TweetData } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { loadConfig } from '../utils/config.js';

export class XClient {
  private client: TwitterApi;
  private config = loadConfig();

  constructor() {
    const bearerToken = process.env.X_BEARER_TOKEN;
    if (!bearerToken) {
      throw new Error('X_BEARER_TOKEN is required');
    }
    this.client = new TwitterApi(bearerToken);
  }

  /**
   * キーワードで投稿を検索
   */
  async searchByKeyword(keyword: string, maxResults = 100): Promise<TweetData[]> {
    try {
      const tweets = await this.client.v2.search(keyword, {
        max_results: Math.min(maxResults, 100),
        'tweet.fields': ['public_metrics', 'created_at', 'author_id', 'conversation_id'],
        'user.fields': ['public_metrics', 'username', 'name'],
        expansions: ['author_id'],
      });

      const users = new Map<string, UserV2>();
      if (tweets.includes?.users) {
        for (const user of tweets.includes.users) {
          users.set(user.id, user);
        }
      }

      return this.transformTweets(tweets.data.data || [], users, false);
    } catch (error) {
      logger.error(`Failed to search keyword: ${keyword}`, error);
      throw error;
    }
  }

  /**
   * インフルエンサーの投稿を取得
   */
  async getInfluencerTweets(username: string, maxResults = 50): Promise<TweetData[]> {
    try {
      // ユーザー名からユーザーIDを取得
      const cleanUsername = username.replace('@', '');
      const user = await this.client.v2.userByUsername(cleanUsername, {
        'user.fields': ['public_metrics'],
      });

      if (!user.data) {
        logger.warn(`User not found: ${username}`);
        return [];
      }

      const userId = user.data.id;
      const followerCount = user.data.public_metrics?.followers_count || 0;

      // 過去24時間の投稿を取得
      const startTime = new Date();
      startTime.setHours(startTime.getHours() - this.config.collection.lookback_hours);

      const tweets = await this.client.v2.userTimeline(userId, {
        max_results: Math.min(maxResults, 100),
        'tweet.fields': ['public_metrics', 'created_at', 'author_id'],
        start_time: startTime.toISOString(),
      });

      const userMap = new Map<string, UserV2>();
      userMap.set(userId, {
        ...user.data,
        public_metrics: {
          ...user.data.public_metrics,
          followers_count: followerCount,
        },
      } as UserV2);

      return this.transformTweets(tweets.data.data || [], userMap, true);
    } catch (error) {
      logger.error(`Failed to get influencer tweets: ${username}`, error);
      throw error;
    }
  }

  /**
   * APIレスポンスをTweetDataに変換
   */
  private transformTweets(
    tweets: TweetV2[],
    users: Map<string, UserV2>,
    isPriority: boolean
  ): TweetData[] {
    return tweets.map((tweet) => {
      const user = users.get(tweet.author_id || '');
      const metrics = tweet.public_metrics;

      return {
        tweetId: tweet.id,
        authorId: tweet.author_id || '',
        authorUsername: user?.username || '',
        content: tweet.text,
        createdAt: new Date(tweet.created_at || Date.now()),
        likeCount: metrics?.like_count || 0,
        repostCount: metrics?.retweet_count || 0,
        replyCount: metrics?.reply_count || 0,
        impressionCount: metrics?.impression_count,
        followerCount: user?.public_metrics?.followers_count || 0,
        isPriority,
      };
    });
  }

  /**
   * 全キーワードで投稿を収集
   */
  async collectByKeywords(): Promise<TweetData[]> {
    const allTweets: TweetData[] = [];
    const keywords = this.config.collection.keywords;
    const maxPerKeyword = this.config.collection.max_tweets_per_keyword;

    for (const keyword of keywords) {
      try {
        logger.info(`Searching keyword: ${keyword}`);
        const tweets = await this.searchByKeyword(keyword, maxPerKeyword);
        allTweets.push(...tweets);

        // レート制限対策: 1秒待機
        await this.sleep(1000);
      } catch (error) {
        logger.error(`Error collecting keyword ${keyword}:`, error);
      }
    }

    return allTweets;
  }

  /**
   * 全インフルエンサーの投稿を収集
   */
  async collectFromInfluencers(): Promise<TweetData[]> {
    const allTweets: TweetData[] = [];
    const influencers = this.config.influencers;
    const maxPerInfluencer = this.config.collection.max_tweets_per_influencer;

    for (const username of influencers) {
      try {
        logger.info(`Fetching influencer: ${username}`);
        const tweets = await this.getInfluencerTweets(username, maxPerInfluencer);
        allTweets.push(...tweets);

        // レート制限対策: 1秒待機
        await this.sleep(1000);
      } catch (error) {
        logger.error(`Error collecting from ${username}:`, error);
      }
    }

    return allTweets;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const xClient = new XClient();
