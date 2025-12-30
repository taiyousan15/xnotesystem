#!/usr/bin/env tsx
import 'dotenv/config';
import { Command } from 'commander';
import { readFileSync, existsSync } from 'fs';
import {
  sendGeneralDailySummary,
  sendVipDailyPicks,
  sendWeeklyKindleAnnouncement,
  distributeDaily,
} from '../services/discord.js';
import { logger } from '../utils/logger.js';
import { ScoredTweet } from '../types/index.js';

const program = new Command();

program
  .name('distribute')
  .description('Discord への配信を実行')
  .requiredOption('-i, --input <path>', '入力ファイル (scored_*.json)')
  .option('-c, --channel <channel>', '配信先 (general|vip|all)', 'all')
  .option('-t, --type <type>', '配信タイプ (daily|weekly)', 'daily')
  .option('--kindle-url <url>', 'Kindle URL (週次配信時)')
  .option('--dry-run', '実際に送信せずプレビューのみ')
  .action(async (options) => {
    logger.info('='.repeat(50));
    logger.info('Discord配信を開始します');
    logger.info(`入力ファイル: ${options.input}`);
    logger.info(`配信先: ${options.channel}`);
    logger.info(`配信タイプ: ${options.type}`);
    logger.info('='.repeat(50));

    try {
      // 環境変数チェック
      checkEnvironmentVariables(options.channel);

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
      const topPicks: ScoredTweet[] = inputData.topPicks.map((t: ScoredTweet & { createdAt: string }) => ({
        ...t,
        createdAt: new Date(t.createdAt),
      }));

      const totalScored = inputData.totalScored || inputData.allTweets?.length || 0;

      logger.info(`読み込み完了: トップピック ${topPicks.length} 件`);

      if (topPicks.length === 0) {
        logger.warn('トップピックが0件です。配信をスキップします。');
        return;
      }

      // プレビュー表示
      if (options.dryRun) {
        displayPreview(topPicks, totalScored, options);
        logger.info('ドライラン完了。実際の配信は行いませんでした。');
        return;
      }

      // 配信実行
      logger.info('Step 2: 配信を実行中...');

      if (options.type === 'daily') {
        await executeDailyDistribution(topPicks, totalScored, options.channel);
      } else if (options.type === 'weekly') {
        await executeWeeklyDistribution(options.kindleUrl);
      }

      // 結果サマリー
      logger.info('='.repeat(50));
      logger.info('Discord配信が完了しました');
      logger.info('='.repeat(50));
    } catch (error) {
      logger.error('Discord配信でエラーが発生しました:', error);
      process.exit(1);
    }
  });

/**
 * 環境変数をチェック
 */
function checkEnvironmentVariables(channel: string): void {
  const checks: { key: string; needed: boolean }[] = [
    { key: 'DISCORD_WEBHOOK_GENERAL', needed: channel === 'general' || channel === 'all' },
    { key: 'DISCORD_WEBHOOK_VIP', needed: channel === 'vip' || channel === 'all' },
  ];

  for (const check of checks) {
    if (check.needed && !process.env[check.key]) {
      logger.error(`環境変数 ${check.key} が設定されていません`);
      logger.info('Discord Webhook URLを .env に設定してください');
      process.exit(1);
    }
  }
}

/**
 * プレビューを表示
 */
function displayPreview(
  topPicks: ScoredTweet[],
  totalScored: number,
  options: { channel: string; type: string }
): void {
  console.log('\n=== 配信プレビュー ===\n');

  if (options.channel === 'general' || options.channel === 'all') {
    console.log('--- 一般チャンネル ---');
    console.log(`📊 本日のAIトレンド要約`);
    console.log(`本日 ${totalScored} 件の投稿を収集・分析しました。\n`);
    console.log('🔥 注目トピック:');
    topPicks.slice(0, 5).forEach((t, i) => {
      console.log(`  ${i + 1}. @${t.authorUsername}: ${t.content.slice(0, 80)}...`);
    });
  }

  if (options.channel === 'vip' || options.channel === 'all') {
    console.log('\n--- VIPチャンネル ---');
    console.log(`🌟 VIP限定：本日の重要投稿`);
    console.log(`厳選された ${topPicks.length} 件の重要投稿:\n`);
    topPicks.forEach((t, i) => {
      console.log(`[${i + 1}] @${t.authorUsername} (スコア: ${t.finalScore.toFixed(2)})`);
      console.log(`    ${t.content.slice(0, 100)}${t.content.length > 100 ? '...' : ''}`);
      console.log(`    ❤️ ${t.likeCount} | 🔁 ${t.repostCount} | 💬 ${t.replyCount}`);
      console.log(`    https://x.com/${t.authorUsername}/status/${t.tweetId}\n`);
    });
  }
}

/**
 * 日次配信を実行
 */
async function executeDailyDistribution(
  topPicks: ScoredTweet[],
  totalScored: number,
  channel: string
): Promise<void> {
  let generalResult = false;
  let vipResult = false;

  if (channel === 'all') {
    const result = await distributeDaily(topPicks, totalScored);
    generalResult = result.general;
    vipResult = result.vip;
  } else if (channel === 'general') {
    generalResult = await sendGeneralDailySummary(topPicks, totalScored);
  } else if (channel === 'vip') {
    vipResult = await sendVipDailyPicks(topPicks);
  }

  // 結果を表示
  if (channel === 'general' || channel === 'all') {
    logger.info(`一般チャンネル: ${generalResult ? '✅ 成功' : '❌ 失敗'}`);
  }
  if (channel === 'vip' || channel === 'all') {
    logger.info(`VIPチャンネル: ${vipResult ? '✅ 成功' : '❌ 失敗'}`);
  }
}

/**
 * 週次配信を実行
 */
async function executeWeeklyDistribution(kindleUrl?: string): Promise<void> {
  const weekNumber = getWeekNumber(new Date());
  const result = await sendWeeklyKindleAnnouncement(weekNumber, kindleUrl);
  logger.info(`週次Kindle告知: ${result ? '✅ 成功' : '❌ 失敗'}`);
}

/**
 * 週番号を取得
 */
function getWeekNumber(date: Date): number {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const pastDays = (date.getTime() - startOfYear.getTime()) / 86400000;
  return Math.ceil((pastDays + startOfYear.getDay() + 1) / 7);
}

program.parse();
