#!/usr/bin/env tsx
/**
 * フィルタリングCLI
 * 収集データにフィルタを適用してノイズを除去
 */

import 'dotenv/config';
import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'fs';
import { logger } from '../utils/logger.js';
import { applyAllFilters } from '../services/filters.js';
import { ScoredTweet } from '../types/index.js';

// 優先インフルエンサー
const PRIORITY_ACCOUNTS = [
  'SuguruKun_ai',
  'taishiyade',
  'ceo_tommy1',
  'rute1203d',
  'The_AGI_WAY',
  'unikoukokun',
  'kamui_qai',
];

const program = new Command();

program
  .name('filter')
  .description('収集データにフィルタを適用')
  .option('-i, --input <path>', '入力ファイル (collected_*.json または scored_*.json)')
  .option('-o, --output <path>', '出力ファイル')
  .option('--exclude-rt', 'RTを完全除外（デフォルトはRT重複排除のみ）')
  .option('--no-spam-filter', 'スパムフィルタを無効化')
  .option('--no-language-filter', '言語フィルタを無効化')
  .option('--min-likes <count>', '最低いいね数', '0')
  .option('--min-engagement <count>', '最低エンゲージメント数', '0')
  .option('--dry-run', 'フィルタ結果のプレビューのみ')
  .action(async (options) => {
    logger.info('==================================================');
    logger.info('フィルタリングを開始します');
    logger.info(`入力ファイル: ${options.input}`);
    logger.info('==================================================');

    if (!options.input) {
      logger.error('入力ファイルを指定してください (--input)');
      process.exit(1);
    }

    // データ読み込み
    logger.info('Step 1: データを読み込み中...');
    const rawData = JSON.parse(readFileSync(options.input, 'utf-8'));

    // scored_*.json または collected_*.json に対応
    let tweets: ScoredTweet[];
    if (rawData.allTweets) {
      tweets = rawData.allTweets;
    } else if (Array.isArray(rawData)) {
      tweets = rawData;
    } else {
      logger.error('不明なデータ形式です');
      process.exit(1);
    }

    logger.info(`読み込み完了: ${tweets.length}件`);

    // フィルタリング適用
    logger.info('');
    logger.info('Step 2: フィルタリングを適用中...');
    const { filtered, stats } = applyAllFilters(tweets, {
      priorityAccounts: PRIORITY_ACCOUNTS,
      excludeRTs: options.excludeRt,
      deduplicateRTs: !options.excludeRt,
      minLikes: parseInt(options.minLikes, 10),
      minEngagement: parseInt(options.minEngagement, 10),
      filterSpam: options.spamFilter,
      filterLanguage: options.languageFilter,
    });

    // 結果表示
    logger.info('');
    logger.info('=== フィルタリング統計 ===');
    console.log(`
  入力:         ${stats.input.toLocaleString()}件
  出力:         ${stats.output.toLocaleString()}件
  削減率:       ${((1 - stats.output / stats.input) * 100).toFixed(1)}%

  --- 除去内訳 ---
  優先保護:     ${stats.priorityProtected}件 (フィルタ対象外)
  RT除去:       ${stats.rtRemoved}件
  重複除去:     ${stats.duplicateRemoved}件
  スパム除去:   ${stats.spamRemoved}件
  言語除去:     ${stats.languageRemoved}件
  低エンゲージ: ${stats.lowEngagementRemoved}件
`);

    // サンプル表示
    logger.info('--- フィルタ後のTop 5 ---');
    const sorted = [...filtered].sort((a, b) => {
      const scoreA = 'finalScore' in a ? (a as ScoredTweet).finalScore : 0;
      const scoreB = 'finalScore' in b ? (b as ScoredTweet).finalScore : 0;
      return scoreB - scoreA;
    });

    sorted.slice(0, 5).forEach((t, i) => {
      const score = 'finalScore' in t ? (t as ScoredTweet).finalScore.toFixed(1) : 'N/A';
      const isRT = t.content.startsWith('RT @') ? '[RT]' : '';
      console.log(`
[${i + 1}] @${t.authorUsername} ${isRT} (スコア: ${score})
    ${t.content.slice(0, 100)}...
    Like: ${t.likeCount} | RT: ${t.repostCount} | Reply: ${t.replyCount}
`);
    });

    // ファイル出力
    if (!options.dryRun && options.output) {
      logger.info(`Step 3: 結果を保存中...`);

      const outputData = {
        filteredAt: new Date().toISOString(),
        stats,
        allTweets: filtered,
        topPicks: sorted.slice(0, 2),
      };

      writeFileSync(options.output, JSON.stringify(outputData, null, 2));
      logger.info(`保存完了: ${options.output}`);
    } else if (!options.dryRun) {
      // 入力ファイルを上書き（filtered_ プレフィックス）
      const outputPath = options.input.replace(/\/(collected|scored)_/, '/filtered_');
      const outputData = {
        filteredAt: new Date().toISOString(),
        stats,
        allTweets: filtered,
        topPicks: sorted.slice(0, 2),
      };

      writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
      logger.info(`保存完了: ${outputPath}`);
    }

    logger.info('==================================================');
    logger.info('フィルタリングが完了しました');
    logger.info('==================================================');
  });

program.parse();
