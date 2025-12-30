#!/usr/bin/env tsx
import 'dotenv/config';
import { Command } from 'commander';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { XClient } from '../collectors/x-client.js';
import { logger } from '../utils/logger.js';
import { TweetData } from '../types/index.js';

const program = new Command();

program
  .name('collect')
  .description('X（Twitter）から投稿を収集')
  .option('-d, --date <date>', '処理対象日 (YYYY-MM-DD)', new Date().toISOString().split('T')[0])
  .option('-o, --output <path>', '出力先ディレクトリ', './data')
  .option('--keywords-only', 'キーワード検索のみ実行')
  .option('--influencers-only', 'インフルエンサー取得のみ実行')
  .action(async (options) => {
    logger.info('='.repeat(50));
    logger.info('投稿収集を開始します');
    logger.info(`対象日: ${options.date}`);
    logger.info('='.repeat(50));

    const errors: string[] = [];

    try {
      const xClient = new XClient();

      let keywordTweets: TweetData[] = [];
      let influencerTweets: TweetData[] = [];

      // キーワード検索
      if (!options.influencersOnly) {
        logger.info('Step 1: キーワード検索を実行中...');
        try {
          keywordTweets = await xClient.collectByKeywords();
          logger.info(`キーワード検索: ${keywordTweets.length} 件取得`);
        } catch (error) {
          const msg = `キーワード検索エラー: ${error}`;
          logger.error(msg);
          errors.push(msg);
        }
      }

      // インフルエンサー取得
      if (!options.keywordsOnly) {
        logger.info('Step 2: インフルエンサー投稿を取得中...');
        try {
          influencerTweets = await xClient.collectFromInfluencers();
          logger.info(`インフルエンサー: ${influencerTweets.length} 件取得`);
        } catch (error) {
          const msg = `インフルエンサー取得エラー: ${error}`;
          logger.error(msg);
          errors.push(msg);
        }
      }

      // 重複排除
      logger.info('Step 3: 重複を排除中...');
      const allTweets = [...keywordTweets, ...influencerTweets];
      const uniqueTweets = removeDuplicates(allTweets);
      const duplicatesRemoved = allTweets.length - uniqueTweets.length;
      logger.info(`重複排除: ${duplicatesRemoved} 件削除 (残り ${uniqueTweets.length} 件)`);

      if (uniqueTweets.length === 0) {
        logger.warn('収集された投稿が0件です。');
        return;
      }

      // 出力
      logger.info('Step 4: ファイルに保存中...');
      const outputDir = options.output;
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      const filename = `collected_${options.date}.json`;
      const outputPath = join(outputDir, filename);

      const outputData = {
        date: options.date,
        collectedAt: new Date().toISOString(),
        totalCollected: uniqueTweets.length,
        keywordCount: keywordTweets.length,
        influencerCount: influencerTweets.length,
        duplicatesRemoved,
        tweets: uniqueTweets,
      };

      writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf-8');
      logger.info(`保存完了: ${outputPath}`);

      // 結果サマリー
      logger.info('='.repeat(50));
      logger.info('投稿収集が完了しました');
      logger.info(`総収集数: ${uniqueTweets.length} 件`);
      logger.info(`  - キーワード: ${keywordTweets.length} 件`);
      logger.info(`  - インフルエンサー: ${influencerTweets.length} 件`);
      logger.info(`  - 重複削除: ${duplicatesRemoved} 件`);
      logger.info(`出力ファイル: ${outputPath}`);
      if (errors.length > 0) {
        logger.warn(`エラー: ${errors.length} 件`);
        errors.forEach((e) => logger.warn(`  - ${e}`));
      }
      logger.info('='.repeat(50));

      // コンソール出力（次のコマンド用）
      console.log(`\n次のステップ: npm run score -- --input ${outputPath}`);
    } catch (error) {
      logger.error('投稿収集でエラーが発生しました:', error);
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
