#!/usr/bin/env tsx
import 'dotenv/config';
import { Command } from 'commander';
import { XClient } from '../collectors/x-client.js';
import { scoreTweets, selectTopPicks } from '../scoring/scorer.js';
import { distributeDaily } from '../services/discord.js';
import { logger } from '../utils/logger.js';
import { TweetData } from '../types/index.js';

const program = new Command();

program
  .name('daily')
  .description('日次バッチ処理を実行')
  .option('-d, --date <date>', '処理対象日 (YYYY-MM-DD)', new Date().toISOString().split('T')[0])
  .option('--skip-discord', 'Discord配信をスキップ')
  .option('--skip-semantic', 'Semantic評価をスキップ')
  .action(async (options) => {
    logger.info('='.repeat(50));
    logger.info('日次バッチ処理を開始します');
    logger.info(`対象日: ${options.date}`);
    logger.info('='.repeat(50));

    const errors: string[] = [];

    try {
      // Step 1: 投稿収集
      logger.info('Step 1: 投稿を収集中...');
      const xClient = new XClient();

      let keywordTweets: TweetData[] = [];
      let influencerTweets: TweetData[] = [];

      try {
        keywordTweets = await xClient.collectByKeywords();
        logger.info(`キーワード検索: ${keywordTweets.length} 件取得`);
      } catch (error) {
        const msg = `キーワード検索エラー: ${error}`;
        logger.error(msg);
        errors.push(msg);
      }

      try {
        influencerTweets = await xClient.collectFromInfluencers();
        logger.info(`インフルエンサー: ${influencerTweets.length} 件取得`);
      } catch (error) {
        const msg = `インフルエンサー取得エラー: ${error}`;
        logger.error(msg);
        errors.push(msg);
      }

      // Step 2: 重複排除
      logger.info('Step 2: 重複を排除中...');
      const allTweets = [...keywordTweets, ...influencerTweets];
      const uniqueTweets = removeDuplicates(allTweets);
      const duplicatesRemoved = allTweets.length - uniqueTweets.length;
      logger.info(`重複排除: ${duplicatesRemoved} 件削除 (残り ${uniqueTweets.length} 件)`);

      if (uniqueTweets.length === 0) {
        logger.warn('収集された投稿が0件です。処理を終了します。');
        return;
      }

      // Step 3: スコアリング
      logger.info('Step 3: スコアリング中...');
      const scoredTweets = await scoreTweets(uniqueTweets);
      logger.info(`スコアリング完了: ${scoredTweets.length} 件`);

      // Step 4: トップピック選出
      logger.info('Step 4: トップピックを選出中...');
      const topPicks = selectTopPicks(scoredTweets);
      logger.info(`トップピック: ${topPicks.map((t) => t.tweetId).join(', ')}`);

      // Step 5: Discord配信
      if (!options.skipDiscord) {
        logger.info('Step 5: Discord配信中...');
        try {
          const result = await distributeDaily(topPicks, uniqueTweets.length);
          logger.info(`Discord配信完了 - 一般: ${result.general}, VIP: ${result.vip}`);
        } catch (error) {
          const msg = `Discord配信エラー: ${error}`;
          logger.error(msg);
          errors.push(msg);
        }
      } else {
        logger.info('Step 5: Discord配信をスキップ');
      }

      // 結果サマリー
      logger.info('='.repeat(50));
      logger.info('日次バッチ処理が完了しました');
      logger.info(`収集: ${uniqueTweets.length} 件`);
      logger.info(`スコアリング: ${scoredTweets.length} 件`);
      logger.info(`トップピック: ${topPicks.length} 件`);
      if (errors.length > 0) {
        logger.warn(`エラー: ${errors.length} 件`);
        errors.forEach((e) => logger.warn(`  - ${e}`));
      }
      logger.info('='.repeat(50));
    } catch (error) {
      logger.error('日次バッチ処理でエラーが発生しました:', error);
      process.exit(1);
    }
  });

/**
 * tweet_id で重複を排除
 */
function removeDuplicates(tweets: TweetData[]): TweetData[] {
  const seen = new Set<string>();
  return tweets.filter((tweet) => {
    if (seen.has(tweet.tweetId)) {
      return false;
    }
    seen.add(tweet.tweetId);
    return true;
  });
}

program.parse();
