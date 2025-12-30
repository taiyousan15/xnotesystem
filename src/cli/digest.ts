#!/usr/bin/env node
/**
 * AI Digest CLI
 * 日次AIダイジェスト生成コマンド
 *
 * Usage:
 *   npm run digest                           # 本日分を実行
 *   npm run digest -- --date=2025-12-31      # 指定日
 *   npm run digest -- --dry-run              # Notion/Discord投稿なし
 *   npm run digest -- --no-notion            # Notion保存スキップ
 *   npm run digest -- --no-discord           # Discord投稿スキップ
 */

import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';
import { Command } from 'commander';
import { format } from 'date-fns';
import { CollectedTweet } from '../types/digest.js';
import { buildDailyDigest, prepareDiscordPost, serializeDigestResult } from '../services/digest-builder.js';
import { logger } from '../utils/logger.js';

// 環境変数読み込み
config();

// Discord Webhook送信
async function sendDiscordWebhook(webhookUrl: string, content: string): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });

  if (!response.ok) {
    throw new Error(`Discord webhook failed: ${response.status}`);
  }
}

// 収集済みデータを読み込み
function loadCollectedData(date: string): CollectedTweet[] {
  const dataDir = path.join(process.cwd(), 'data', 'ai-news');
  const filename = `ai-news_${date}.json`;
  const filepath = path.join(dataDir, filename);

  if (!fs.existsSync(filepath)) {
    throw new Error(`Data file not found: ${filepath}`);
  }

  const rawData = JSON.parse(fs.readFileSync(filepath, 'utf-8'));

  // 既存のai-news形式からCollectedTweet形式に変換
  if (Array.isArray(rawData)) {
    return rawData.map((item: any) => ({
      id: item.raw?.id || item.id || '',
      authorId: item.raw?.authorId || '',
      authorUsername: item.raw?.authorUsername || item.author?.replace('@', '') || '',
      content: item.raw?.content || item.title || '',
      createdAt: item.raw?.createdAt || item.datetime || '',
      likes: item.metrics?.likes || 0,
      retweets: item.metrics?.retweets || 0,
      replies: item.metrics?.replies || 0,
      quotes: item.metrics?.quotes || 0,
      url: item.url || '',
      queryId: item.queryId || '',
      category: item.category || 'OTHER',
      tag: item.tag || '',
      isBreaking: item.raw?.isBreaking || false,
    }));
  }

  // 既にCollectedTweet形式の場合
  if (rawData.tweets) {
    return rawData.tweets;
  }

  throw new Error('Unknown data format');
}

// 結果を保存
function saveDigestResult(date: string, result: any): void {
  const outputDir = path.join(process.cwd(), 'output', 'digest');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const filename = `digest_${date}.json`;
  const filepath = path.join(outputDir, filename);

  fs.writeFileSync(filepath, serializeDigestResult(result), 'utf-8');
  logger.info(`Digest result saved: ${filepath}`);
}

// メイン処理
async function main() {
  const program = new Command();

  program
    .name('digest')
    .description('AI Digest: X投稿解析・Notion保存・Discord投稿')
    .option('--date <date>', '処理日（YYYY-MM-DD）', format(new Date(), 'yyyy-MM-dd'))
    .option('--dry-run', 'Notion/Discord投稿なし（テスト実行）', false)
    .option('--no-notion', 'Notion保存スキップ')
    .option('--no-discord', 'Discord投稿スキップ')
    .option('--input <file>', '入力ファイルを指定（デフォルト: data/ai-news/ai-news_DATE.json）')
    .option('--verbose', '詳細ログ出力', false);

  program.parse();
  const opts = program.opts();

  const digestDate = opts.date;
  const isDryRun = opts.dryRun;
  const skipNotion = !opts.notion || isDryRun;
  const skipDiscord = !opts.discord || isDryRun;

  logger.info(`=== AI Digest CLI ===`);
  logger.info(`Date: ${digestDate}`);
  logger.info(`Options: dryRun=${isDryRun}, notion=${!skipNotion}, discord=${!skipDiscord}`);

  try {
    // Step 1: データ読み込み
    logger.info('Step 1: Loading collected data...');
    let collectedTweets: CollectedTweet[];

    if (opts.input) {
      const rawData = JSON.parse(fs.readFileSync(opts.input, 'utf-8'));
      collectedTweets = Array.isArray(rawData) ? rawData : rawData.tweets || [];
    } else {
      collectedTweets = loadCollectedData(digestDate);
    }

    logger.info(`Loaded ${collectedTweets.length} tweets`);

    if (collectedTweets.length === 0) {
      logger.warn('No tweets to process');
      return;
    }

    // Step 2: ダイジェスト構築
    logger.info('Step 2: Building digest...');
    const result = await buildDailyDigest(collectedTweets, digestDate, {
      skipNotion,
      skipDiscord,
      dryRun: isDryRun,
    });

    // Step 3: 結果保存
    logger.info('Step 3: Saving results...');
    saveDigestResult(digestDate, result);

    // Step 4: Discord投稿
    if (!skipDiscord) {
      logger.info('Step 4: Posting to Discord...');
      const discordData = prepareDiscordPost(result);

      const webhookUrl = process.env.DISCORD_WEBHOOK_NEWS;
      if (!webhookUrl) {
        logger.warn('DISCORD_WEBHOOK_NEWS not set, skipping Discord post');
      } else {
        // 統計投稿
        await sendDiscordWebhook(webhookUrl, discordData.statsEmbed);
        await new Promise(r => setTimeout(r, 1000));

        // トピック投稿
        await sendDiscordWebhook(webhookUrl, discordData.topicsEmbed);
        await new Promise(r => setTimeout(r, 1000));

        // Top Picks投稿（分割）
        for (const embed of discordData.topPicksEmbeds) {
          await sendDiscordWebhook(webhookUrl, embed);
          await new Promise(r => setTimeout(r, 1000));
        }

        // Notionリンク
        await sendDiscordWebhook(
          webhookUrl,
          `📁 **全件データ:** ${discordData.notionUrl}`
        );

        logger.info('Discord posts completed');
      }
    }

    // 完了サマリー
    logger.info('=== Digest Complete ===');
    logger.info(`Total tweets: ${result.stats.totalCount}`);
    logger.info(`Top picks: ${result.stats.topPickCount}`);
    logger.info(`Topics: ${result.topics.length}`);
    logger.info(`Average score: ${result.stats.averageScore}`);
    logger.info(`Errors: ${result.errors.length}`);

    if (result.digestPageUrl) {
      logger.info(`Notion digest: ${result.digestPageUrl}`);
    }

    if (result.errors.length > 0) {
      logger.warn('Errors encountered:');
      for (const error of result.errors.slice(0, 10)) {
        logger.warn(`  - ${error}`);
      }
      if (result.errors.length > 10) {
        logger.warn(`  ... and ${result.errors.length - 10} more`);
      }
    }

  } catch (error) {
    logger.error('Digest failed:', error);
    process.exit(1);
  }
}

main().catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
