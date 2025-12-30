#!/usr/bin/env tsx
import 'dotenv/config';
import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { scoreTweets, selectTopPicks } from '../scoring/scorer.js';
import { logger } from '../utils/logger.js';
import { TweetData, ScoredTweet } from '../types/index.js';
import { loadConfig } from '../utils/config.js';

const config = loadConfig();
const program = new Command();

program
  .name('score')
  .description('収集した投稿をスコアリング')
  .requiredOption('-i, --input <path>', '入力ファイル (collected_*.json)')
  .option('-o, --output <path>', '出力先ディレクトリ (デフォルト: 入力と同じ)')
  .option('--skip-semantic', 'Semantic評価をスキップ（高速化）')
  .option('--top <n>', 'Top N件を選定', String(config.scoring.top_pick_count))
  .action(async (options) => {
    logger.info('='.repeat(50));
    logger.info('スコアリングを開始します');
    logger.info(`入力ファイル: ${options.input}`);
    logger.info('='.repeat(50));

    try {
      // 入力ファイルの確認
      if (!existsSync(options.input)) {
        logger.error(`入力ファイルが見つかりません: ${options.input}`);
        process.exit(1);
      }

      // データ読み込み
      logger.info('Step 1: データを読み込み中...');
      const rawData = readFileSync(options.input, 'utf-8');
      const inputData = JSON.parse(rawData);

      // 日付文字列をDateオブジェクトに変換
      const tweets: TweetData[] = inputData.tweets.map((t: TweetData & { createdAt: string }) => ({
        ...t,
        createdAt: new Date(t.createdAt),
      }));

      logger.info(`読み込み完了: ${tweets.length} 件`);

      if (tweets.length === 0) {
        logger.warn('スコアリング対象の投稿が0件です。');
        return;
      }

      // スコアリング実行
      logger.info('Step 2: スコアリング中...');
      logger.info('  (Semantic評価にはLLM APIを使用するため時間がかかります)');

      const startTime = Date.now();
      const scoredTweets = await scoreTweets(tweets);
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);

      logger.info(`スコアリング完了: ${scoredTweets.length} 件 (${duration}秒)`);

      // トップピック選出
      const topN = parseInt(options.top, 10);
      logger.info(`Step 3: トップ ${topN} 件を選出中...`);
      const topPicks = scoredTweets.slice(0, topN);

      // スコア統計を表示
      displayScoreStats(scoredTweets);

      // トップピック詳細を表示
      displayTopPicks(topPicks);

      // 出力
      logger.info('Step 4: ファイルに保存中...');
      const outputDir = options.output || dirname(options.input);
      const date = inputData.date || new Date().toISOString().split('T')[0];
      const filename = `scored_${date}.json`;
      const outputPath = join(outputDir, filename);

      const outputData = {
        date,
        scoredAt: new Date().toISOString(),
        totalScored: scoredTweets.length,
        topPickCount: topPicks.length,
        scoreStats: {
          maxFinalScore: Math.max(...scoredTweets.map((t) => t.finalScore)),
          minFinalScore: Math.min(...scoredTweets.map((t) => t.finalScore)),
          avgFinalScore: scoredTweets.reduce((sum, t) => sum + t.finalScore, 0) / scoredTweets.length,
        },
        topPicks,
        allTweets: scoredTweets,
      };

      writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf-8');
      logger.info(`保存完了: ${outputPath}`);

      // 結果サマリー
      logger.info('='.repeat(50));
      logger.info('スコアリングが完了しました');
      logger.info(`スコアリング: ${scoredTweets.length} 件`);
      logger.info(`トップピック: ${topPicks.length} 件`);
      logger.info(`処理時間: ${duration} 秒`);
      logger.info(`出力ファイル: ${outputPath}`);
      logger.info('='.repeat(50));

      // コンソール出力（次のコマンド用）
      console.log(`\n次のステップ: npm run distribute -- --input ${outputPath}`);
    } catch (error) {
      logger.error('スコアリングでエラーが発生しました:', error);
      process.exit(1);
    }
  });

/**
 * スコア統計を表示
 */
function displayScoreStats(tweets: ScoredTweet[]): void {
  const finalScores = tweets.map((t) => t.finalScore);
  const max = Math.max(...finalScores);
  const min = Math.min(...finalScores);
  const avg = finalScores.reduce((a, b) => a + b, 0) / finalScores.length;

  console.log('\n--- スコア統計 ---');
  console.log(`  最高スコア: ${max.toFixed(2)}`);
  console.log(`  最低スコア: ${min.toFixed(2)}`);
  console.log(`  平均スコア: ${avg.toFixed(2)}`);

  // 優先インフルエンサーの投稿数
  const priorityCount = tweets.filter((t) => t.isPriority).length;
  console.log(`  優先インフルエンサー投稿: ${priorityCount} 件`);
}

/**
 * トップピック詳細を表示
 */
function displayTopPicks(topPicks: ScoredTweet[]): void {
  console.log('\n--- トップピック ---');
  topPicks.forEach((tweet, index) => {
    console.log(`\n[${index + 1}] @${tweet.authorUsername} (スコア: ${tweet.finalScore.toFixed(2)})`);
    console.log(`    ${tweet.content.slice(0, 100)}${tweet.content.length > 100 ? '...' : ''}`);
    console.log(`    📊 Like: ${tweet.likeCount} | RT: ${tweet.repostCount} | Reply: ${tweet.replyCount}`);
    console.log(`    📈 Base: ${tweet.baseScore.toFixed(1)} | Velocity: ${tweet.velocityScore.toFixed(1)} | Semantic: ${tweet.semanticScore.toFixed(1)}`);
    if (tweet.isPriority) {
      console.log(`    ⭐ 優先インフルエンサー (+15 ボーナス)`);
    }
  });
}

program.parse();
