#!/usr/bin/env tsx
import 'dotenv/config';
import { Command } from 'commander';
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { sendWeeklyKindleAnnouncement } from '../services/discord.js';
import { logger } from '../utils/logger.js';
import { loadConfig } from '../utils/config.js';
import { ScoredTweet, WeeklyResult } from '../types/index.js';
import Anthropic from '@anthropic-ai/sdk';

const config = loadConfig();
const program = new Command();

program
  .name('weekly')
  .description('週次バッチ処理を実行')
  .option('--week <week>', '対象週 (YYYY-Wnn)', getCurrentWeek())
  .option('--data-dir <path>', 'データディレクトリ', './data')
  .option('-o, --output <path>', '出力先ディレクトリ', './output/weekly')
  .option('--skip-note', 'note生成をスキップ')
  .option('--skip-kindle', 'Kindle生成をスキップ')
  .option('--skip-discord', 'Discord告知をスキップ')
  .action(async (options) => {
    logger.info('='.repeat(50));
    logger.info('週次バッチ処理を開始します');
    logger.info(`対象週: ${options.week}`);
    logger.info('='.repeat(50));

    const errors: string[] = [];
    const result: WeeklyResult = {
      weekStart: getWeekStartDate(options.week),
      weekEnd: getWeekEndDate(options.week),
      notesGenerated: 0,
      kindleGenerated: false,
      youtubeScriptGenerated: false,
    };

    try {
      // 出力ディレクトリ作成
      const outputDir = join(options.output, options.week);
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      // Step 1: 週間データを集約
      logger.info('Step 1: 週間データを集約中...');
      const weeklyTweets = await collectWeeklyData(options.dataDir, options.week);
      logger.info(`集約完了: ${weeklyTweets.length} 件`);

      if (weeklyTweets.length === 0) {
        logger.warn('週間データが見つかりません');
        return;
      }

      // トップ投稿を選定
      const topTweets = weeklyTweets.slice(0, 10);

      // Step 2: note記事生成
      if (!options.skipNote) {
        logger.info('Step 2: note記事を生成中...');
        try {
          const noteCount = await generateWeeklyNotes(topTweets, outputDir, options.week);
          result.notesGenerated = noteCount;
          logger.info(`note記事生成完了: ${noteCount} 件`);
        } catch (error) {
          const msg = `note生成エラー: ${error}`;
          logger.error(msg);
          errors.push(msg);
        }
      } else {
        logger.info('Step 2: note生成をスキップ');
      }

      // Step 3: Kindle原稿生成
      if (!options.skipKindle) {
        logger.info('Step 3: Kindle原稿を生成中...');
        try {
          await generateKindleManuscript(weeklyTweets, outputDir, options.week);
          result.kindleGenerated = true;
          logger.info('Kindle原稿生成完了');
        } catch (error) {
          const msg = `Kindle生成エラー: ${error}`;
          logger.error(msg);
          errors.push(msg);
        }
      } else {
        logger.info('Step 3: Kindle生成をスキップ');
      }

      // Step 4: Discord告知
      if (!options.skipDiscord) {
        logger.info('Step 4: Discord告知を送信中...');
        try {
          const weekNumber = parseInt(options.week.split('-W')[1], 10);
          await sendWeeklyKindleAnnouncement(weekNumber);
          logger.info('Discord告知完了');
        } catch (error) {
          const msg = `Discord告知エラー: ${error}`;
          logger.error(msg);
          errors.push(msg);
        }
      } else {
        logger.info('Step 4: Discord告知をスキップ');
      }

      // 結果を保存
      result.errors = errors.length > 0 ? errors : undefined;
      const resultPath = join(outputDir, 'weekly_result.json');
      writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf-8');

      // 結果サマリー
      logger.info('='.repeat(50));
      logger.info('週次バッチ処理が完了しました');
      logger.info(`対象週: ${options.week}`);
      logger.info(`集約投稿数: ${weeklyTweets.length} 件`);
      logger.info(`note生成: ${result.notesGenerated} 件`);
      logger.info(`Kindle生成: ${result.kindleGenerated ? '完了' : 'スキップ'}`);
      if (errors.length > 0) {
        logger.warn(`エラー: ${errors.length} 件`);
        errors.forEach((e) => logger.warn(`  - ${e}`));
      }
      logger.info(`出力: ${outputDir}`);
      logger.info('='.repeat(50));
    } catch (error) {
      logger.error('週次バッチ処理でエラーが発生しました:', error);
      process.exit(1);
    }
  });

/**
 * 現在の週番号を取得
 */
function getCurrentWeek(): string {
  const now = new Date();
  const year = now.getFullYear();
  const startOfYear = new Date(year, 0, 1);
  const pastDays = Math.floor((now.getTime() - startOfYear.getTime()) / 86400000);
  const weekNumber = Math.ceil((pastDays + startOfYear.getDay() + 1) / 7);
  return `${year}-W${String(weekNumber).padStart(2, '0')}`;
}

/**
 * 週の開始日を取得
 */
function getWeekStartDate(week: string): Date {
  const [year, weekNum] = week.split('-W').map((s) => parseInt(s, 10));
  const date = new Date(year, 0, 1);
  date.setDate(date.getDate() + (weekNum - 1) * 7 - date.getDay() + 1);
  return date;
}

/**
 * 週の終了日を取得
 */
function getWeekEndDate(week: string): Date {
  const start = getWeekStartDate(week);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return end;
}

/**
 * 週間データを集約
 */
async function collectWeeklyData(dataDir: string, week: string): Promise<ScoredTweet[]> {
  const allTweets: ScoredTweet[] = [];
  const weekStart = getWeekStartDate(week);
  const weekEnd = getWeekEndDate(week);

  if (!existsSync(dataDir)) {
    return allTweets;
  }

  // scored_*.json ファイルを検索
  const files = readdirSync(dataDir).filter((f) => f.startsWith('scored_') && f.endsWith('.json'));

  for (const file of files) {
    try {
      const dateStr = file.replace('scored_', '').replace('.json', '');
      const fileDate = new Date(dateStr);

      // 対象週のデータかチェック
      if (fileDate >= weekStart && fileDate <= weekEnd) {
        const filePath = join(dataDir, file);
        const rawData = readFileSync(filePath, 'utf-8');
        const data = JSON.parse(rawData);

        const tweets = (data.allTweets || []).map((t: ScoredTweet & { createdAt: string }) => ({
          ...t,
          createdAt: new Date(t.createdAt),
        }));

        allTweets.push(...tweets);
      }
    } catch (error) {
      logger.warn(`Failed to read file ${file}:`, error);
    }
  }

  // スコア順にソート
  allTweets.sort((a, b) => b.finalScore - a.finalScore);

  // 重複を除去
  const seen = new Set<string>();
  return allTweets.filter((t) => {
    if (seen.has(t.tweetId)) return false;
    seen.add(t.tweetId);
    return true;
  });
}

/**
 * 週間note記事を生成
 */
async function generateWeeklyNotes(
  topTweets: ScoredTweet[],
  outputDir: string,
  week: string
): Promise<number> {
  // 有料記事は週最大2本
  const maxPaidNotes = config.note.max_paid_per_week;
  let generated = 0;

  const anthropic = new Anthropic();

  // トップ投稿を2グループに分割
  const group1 = topTweets.slice(0, 5);
  const group2 = topTweets.slice(5, 10);

  for (let i = 0; i < Math.min(maxPaidNotes, 2); i++) {
    const tweets = i === 0 ? group1 : group2;
    if (tweets.length === 0) continue;

    const theme = i === 0 ? '今週のAI注目トレンド' : '今週のAI実践ヒント';

    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        messages: [
          {
            role: 'user',
            content: buildNotePrompt(tweets, theme, week),
          },
        ],
      });

      const content = response.content[0];
      if (content.type === 'text') {
        const filename = `note_paid_${i + 1}_${week}.md`;
        const outputPath = join(outputDir, filename);
        writeFileSync(outputPath, content.text, 'utf-8');
        generated++;
      }
    } catch (error) {
      logger.error(`Failed to generate note ${i + 1}:`, error);
    }
  }

  return generated;
}

/**
 * note生成プロンプト
 */
function buildNotePrompt(tweets: ScoredTweet[], theme: string, week: string): string {
  const tweetContext = tweets.map((t, i) => `
${i + 1}. @${t.authorUsername}
   スコア: ${t.finalScore.toFixed(1)}
   内容: ${t.content}
`).join('\n');

  return `あなたはAIトレンドの専門ライターです。${week}の有料note記事を生成してください。

【テーマ】${theme}
【価格】${config.note.price}円

【参照投稿】
${tweetContext}

【執筆ルール】
1. WIIFM法則: 読者に「何が得られるか」を冒頭で明示
2. PASCAL型構成: Problem → Agitate → Solution → Credibility → Action → Limitation
3. 影響力6原則を適用
4. 約10,000文字で執筆

【出力形式】
- 1行目: キャッチーなタイトル（#で始める）
- 本文: Markdown形式

記事を生成してください:`;
}

/**
 * Kindle原稿を生成
 */
async function generateKindleManuscript(
  tweets: ScoredTweet[],
  outputDir: string,
  week: string
): Promise<void> {
  const anthropic = new Anthropic();

  // 要件定義の構成に従う
  const structure = config.kindle.structure;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16000,
    messages: [
      {
        role: 'user',
        content: buildKindlePrompt(tweets, structure, week),
      },
    ],
  });

  const content = response.content[0];
  if (content.type === 'text') {
    const filename = `kindle_${week}.md`;
    const outputPath = join(outputDir, filename);
    writeFileSync(outputPath, content.text, 'utf-8');
  }
}

/**
 * Kindle生成プロンプト
 */
function buildKindlePrompt(tweets: ScoredTweet[], structure: string[], week: string): string {
  const topTweets = tweets.slice(0, 20);
  const tweetContext = topTweets.map((t, i) => `
${i + 1}. @${t.authorUsername} (スコア: ${t.finalScore.toFixed(1)})
   ${t.content.slice(0, 200)}...
`).join('\n');

  const structureGuide = structure.map((s, i) => `${i + 1}. ${s}`).join('\n');

  return `あなたはAIトレンドの週刊雑誌編集者です。${week}のKindle週刊版を生成してください。

【構成】
${structureGuide}

【今週のトップ投稿】
${tweetContext}

【執筆ルール】
1. 各セクションは読者に価値を提供する内容に
2. インフルエンサーの見解を引用・解説
3. 実務で使えるヒントを必ず含める
4. 50-100ページ相当（約20,000-40,000文字）

【出力形式】
- Markdown形式
- 各章は ## で開始
- 読みやすい改行・箇条書き

週刊誌を生成してください:`;
}

program.parse();
