#!/usr/bin/env tsx
/**
 * 週次まとめ投稿システム
 *
 * 火曜日: 速報まとめ（無料note）→ VIP Discordに投稿
 * 金曜日: 実務深掘り（有料note 480円）→ VIP Discordに投稿
 */

import 'dotenv/config';
import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';
import { loadConfig } from '../utils/config.js';
import { saveWeeklySummaryToNotion } from '../services/notion.js';

const config = loadConfig();
const program = new Command();

interface CollectedTweet {
  id: string;
  authorUsername: string;
  content: string;
  createdAt: string;
  likes: number;
  retweets: number;
  category: string;
  tag: string;
  url: string;
}

interface FormattedPost {
  category: string;
  tag: string;
  title: string;
  url: string;
  metrics: {
    likes: number;
    retweets: number;
  };
  author: string;
  raw: CollectedTweet;
}

interface WeeklySummaryData {
  dateRange: string;
  totalPosts: number;
  breakingPosts: FormattedPost[];
  practicalPosts: FormattedPost[];
  starPosts: FormattedPost[];
}

program
  .name('weekly-summary')
  .description('週次まとめを生成してVIP Discordに投稿')
  .option('--tuesday', '火曜日モード: 速報まとめ（無料）')
  .option('--friday', '金曜日モード: 実務深掘り（有料480円）')
  .option('--days <n>', '過去N日分を集約', '7')
  .option('--dry-run', 'Discord投稿をスキップ')
  .option('--post-to-note', 'noteに自動投稿（金曜日のみ有料480円で公開）')
  .option('--no-notion', 'Notion保存をスキップ')
  .option('-o, --output <path>', '出力先ディレクトリ', './output/weekly-summary')
  .action(async (options) => {
    const mode = options.tuesday ? 'tuesday' : options.friday ? 'friday' : null;

    if (!mode) {
      logger.error('--tuesday または --friday を指定してください');
      process.exit(1);
    }

    logger.info('='.repeat(60));
    logger.info(`週次まとめ生成: ${mode === 'tuesday' ? '火曜日（速報・無料）' : '金曜日（実務・有料480円）'}`);
    logger.info('='.repeat(60));

    try {
      // Step 1: 過去N日分のデータを集約
      logger.info('Step 1: データを集約中...');
      const weeklyData = collectWeeklyData(parseInt(options.days, 10));
      logger.info(`  集約完了: ${weeklyData.totalPosts}件`);
      logger.info(`  速報系: ${weeklyData.breakingPosts.length}件`);
      logger.info(`  実務系: ${weeklyData.practicalPosts.length}件`);
      logger.info(`  [STAR]: ${weeklyData.starPosts.length}件`);

      if (weeklyData.totalPosts === 0) {
        logger.warn('データが見つかりません');
        return;
      }

      // Step 2: note記事を生成
      logger.info('Step 2: note記事を生成中...');
      const article = await generateWeeklyArticle(weeklyData, mode);
      logger.info(`  生成完了: ${article.wordCount}文字`);

      // Step 3: ファイルに保存
      const outputDir = options.output;
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `weekly_${mode}_${timestamp}.md`;
      const outputPath = join(outputDir, filename);
      writeFileSync(outputPath, article.content, 'utf-8');
      logger.info(`  保存完了: ${outputPath}`);

      // Step 4: VIP Discordに投稿
      if (!options.dryRun) {
        logger.info('Step 4: VIP Discordに投稿中...');
        await postToVIPDiscord(article, mode, weeklyData);
        logger.info('  Discord投稿完了');
      } else {
        logger.info('Step 4: dry-runモード - Discord投稿スキップ');
      }

      // Step 4.5: Notionに保存
      if (options.notion !== false && process.env.NOTION_API_KEY && process.env.NOTION_DATABASE_ID) {
        logger.info('Step 4.5: Notionに保存中...');
        const theme = mode === 'tuesday' ? '今週のAI速報まとめ' : '今週のAI実務・収益化ヒント';
        const notionTitle = `【${weeklyData.dateRange.split('〜')[1]?.trim() || '週次'}】${theme}`;
        const notionPageId = await saveWeeklySummaryToNotion(
          notionTitle,
          article.content,
          timestamp,
          mode
        );
        if (notionPageId) {
          logger.info(`  Notion保存完了: ${notionPageId}`);
        } else {
          logger.warn('  Notion保存に失敗しました');
        }
      } else if (options.notion === false) {
        logger.info('Step 4.5: --no-notionモード - Notion保存スキップ');
      } else {
        logger.info('Step 4.5: Notion設定なし - Notion保存スキップ');
      }

      // Step 5: noteに投稿（オプション）
      let noteUrl: string | null = null;
      const theme = mode === 'tuesday' ? '今週のAI速報まとめ' : '今週のAI実務・収益化ヒント';
      const noteTitle = `【${weeklyData.dateRange.split('〜')[1]?.trim() || '週次'}】${theme}`;

      if (options.postToNote && !options.dryRun) {
        if (mode === 'friday') {
          logger.info('Step 5: noteに有料記事を投稿中...');
          noteUrl = await postToNote(outputPath, noteTitle);
          if (noteUrl) {
            logger.info(`  note投稿完了: ${noteUrl}`);
          } else {
            logger.warn('  note投稿に失敗しました');
          }
        } else {
          logger.info('Step 5: 火曜日モードはnote自動投稿未対応（手動で公開してください）');
        }
      } else if (options.postToNote && options.dryRun) {
        logger.info('Step 5: dry-runモード - note投稿スキップ');
      }

      // 結果サマリー
      logger.info('='.repeat(60));
      logger.info('週次まとめ完了');
      logger.info(`  モード: ${mode === 'tuesday' ? '速報まとめ（無料）' : '実務深掘り（有料480円）'}`);
      logger.info(`  期間: ${weeklyData.dateRange}`);
      logger.info(`  記事文字数: ${article.wordCount}`);
      logger.info(`  出力: ${outputPath}`);
      logger.info('='.repeat(60));

      // コンソールにプレビュー表示
      console.log('\n--- 記事プレビュー ---\n');
      console.log(article.content.slice(0, 1000) + '...\n');

    } catch (error) {
      logger.error('週次まとめでエラー:', error);
      process.exit(1);
    }
  });

/**
 * 過去N日分のai-newsデータを集約
 */
function collectWeeklyData(days: number): WeeklySummaryData {
  const dataDir = './data/ai-news';
  const breakingPosts: FormattedPost[] = [];
  const practicalPosts: FormattedPost[] = [];
  const starPosts: FormattedPost[] = [];
  const dates: string[] = [];

  if (!existsSync(dataDir)) {
    return { dateRange: '', totalPosts: 0, breakingPosts, practicalPosts, starPosts };
  }

  // 過去N日分の日付を生成
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    dates.push(date.toISOString().split('T')[0]);
  }

  // 各日のデータを読み込み
  for (const dateStr of dates) {
    const filePath = join(dataDir, `ai-news_${dateStr}.json`);
    if (!existsSync(filePath)) continue;

    try {
      const data = JSON.parse(readFileSync(filePath, 'utf-8'));

      if (data.breakingPicks) {
        breakingPosts.push(...data.breakingPicks);
      }
      if (data.practicalPicks) {
        practicalPosts.push(...data.practicalPicks);
      }
      if (data.starPosts) {
        starPosts.push(...data.starPosts);
      }
    } catch (error) {
      logger.warn(`  ${dateStr} の読み込みに失敗`);
    }
  }

  // 重複排除（URLベース）
  const uniqueBreaking = deduplicateByUrl(breakingPosts);
  const uniquePractical = deduplicateByUrl(practicalPosts);
  const uniqueStar = deduplicateByUrl(starPosts);

  const dateRange = `${dates[dates.length - 1]} 〜 ${dates[0]}`;

  return {
    dateRange,
    totalPosts: uniqueBreaking.length + uniquePractical.length,
    breakingPosts: uniqueBreaking.slice(0, 20),
    practicalPosts: uniquePractical.slice(0, 20),
    starPosts: uniqueStar.slice(0, 10),
  };
}

function deduplicateByUrl(posts: FormattedPost[]): FormattedPost[] {
  const seen = new Set<string>();
  return posts.filter(p => {
    if (seen.has(p.url)) return false;
    seen.add(p.url);
    return true;
  });
}

/**
 * 週次note記事を生成
 */
async function generateWeeklyArticle(
  data: WeeklySummaryData,
  mode: 'tuesday' | 'friday'
): Promise<{ content: string; wordCount: number }> {
  const anthropic = new Anthropic();

  const posts = mode === 'tuesday' ? data.breakingPosts : data.practicalPosts;
  const theme = mode === 'tuesday'
    ? '今週のAI速報まとめ'
    : '今週のAI実務・収益化ヒント';

  const isPaid = mode === 'friday';
  const price = isPaid ? config.note.price : 0;

  const tweetContext = posts.slice(0, 15).map((p, i) => `
${i + 1}. [${p.category}] ${p.tag ? `[${p.tag}]` : ''} @${p.author}
   ${p.title || p.raw?.content?.slice(0, 100)}
   Like: ${p.metrics?.likes || 0} RT: ${p.metrics?.retweets || 0}
   ${p.url}
`).join('\n');

  const starContext = data.starPosts.length > 0
    ? `\n【有料候補[STAR]投稿】\n${data.starPosts.slice(0, 5).map(p =>
        `- ${p.title || p.raw?.content?.slice(0, 50)} ${p.url}`
      ).join('\n')}`
    : '';

  const prompt = `あなたはAIトレンドの専門ライターです。以下の条件で${isPaid ? '有料' : '無料'}note記事を生成してください。

【記事タイプ】${isPaid ? `有料販売記事（${price}円）` : '無料教育記事'}
【テーマ】${theme}
【期間】${data.dateRange}

【参照投稿（${posts.length}件）】
${tweetContext}
${starContext}

【執筆ルール】
1. WIIFM法則: 読者視点で「何が得られるか」を冒頭で明示
2. ${isPaid ? 'PASCAL型構成: Problem → Agitate → Solution → Credibility → Action → Limitation' : '教育的で信頼性の高い構成'}
3. 見出し（##）を適切に使用、箇条書きで読みやすく
4. 太字で重要ポイントを強調
5. 各トピックに「なぜ重要か」「次に取るべき行動」を含める
${isPaid ? '6. 希少性と緊急性を訴求' : '6. すぐに役立つ実践的な情報を提供'}

【出力形式】
- 1行目: キャッチーなタイトル（#で始める）
- 本文: Markdown形式
- 目標文字数: ${isPaid ? '10000' : '7000'}文字

記事を生成してください:`;

  logger.info('  Claude API呼び出し中...');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 12000,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type');
  }

  const articleContent = content.text;

  // メタデータを追加
  const metadata = `---
title: "${theme}"
type: ${isPaid ? 'paid' : 'free'}
price: ${price}
date_range: "${data.dateRange}"
generated_at: "${new Date().toISOString()}"
total_sources: ${posts.length}
---

`;

  return {
    content: metadata + articleContent,
    wordCount: articleContent.length,
  };
}

/**
 * VIP Discordに投稿（複数Webhook対応）
 */
async function postToVIPDiscord(
  article: { content: string; wordCount: number },
  mode: 'tuesday' | 'friday',
  data: WeeklySummaryData
): Promise<void> {
  // 複数のWebhook URLを取得
  const webhookUrls: string[] = [];
  if (process.env.DISCORD_WEBHOOK_WEEKLY_SUMMARY) {
    webhookUrls.push(process.env.DISCORD_WEBHOOK_WEEKLY_SUMMARY);
  }
  if (process.env.DISCORD_WEBHOOK_WEEKLY_SUMMARY_2) {
    webhookUrls.push(process.env.DISCORD_WEBHOOK_WEEKLY_SUMMARY_2);
  }

  if (webhookUrls.length === 0) {
    logger.warn('DISCORD_WEBHOOK_WEEKLY_SUMMARY が設定されていません');
    return;
  }

  logger.info(`  ${webhookUrls.length}個のWebhookに投稿します`);

  const isPaid = mode === 'friday';
  const theme = mode === 'tuesday' ? '速報まとめ' : '実務深掘り';

  // ヘッダーEmbed
  const headerEmbed = {
    title: `📰 週次AIトレンド: ${theme}`,
    description: `**期間**: ${data.dateRange}\n**総投稿数**: ${data.totalPosts}件\n**記事文字数**: ${article.wordCount}文字`,
    color: isPaid ? 0xFFD700 : 0x00BFFF,
    fields: [
      {
        name: isPaid ? '💰 有料note（480円）' : '📖 無料note',
        value: isPaid
          ? 'VIPメンバーは以下で全文をお読みいただけます'
          : '以下で全文をお読みいただけます',
        inline: false,
      },
    ],
    footer: { text: `AI Trend Report - ${new Date().toLocaleDateString('ja-JP')}` },
  };

  // 記事本文を分割（Discord制限: 2000文字）
  const MAX_LENGTH = 1900;
  const articleBody = article.content.replace(/^---[\s\S]*?---\n\n/, ''); // メタデータ除去

  const chunks: string[] = [];
  let current = '';

  for (const line of articleBody.split('\n')) {
    if ((current + line + '\n').length > MAX_LENGTH) {
      if (current) chunks.push(current);
      current = line + '\n';
    } else {
      current += line + '\n';
    }
  }
  if (current) chunks.push(current);

  // フッター
  const footer = isPaid
    ? `━━━━━━━━━━━━━━━━━━━━\n**【VIP特典】** この記事は一般向けには480円で販売予定です。\nVIPメンバーは無料でお読みいただけます。\n━━━━━━━━━━━━━━━━━━━━`
    : `━━━━━━━━━━━━━━━━━━━━\n次回の実務深掘り（有料版）は金曜日に配信予定です。\n━━━━━━━━━━━━━━━━━━━━`;

  // 各Webhookに投稿
  for (const webhookUrl of webhookUrls) {
    logger.info(`  投稿中: ${webhookUrl.slice(0, 50)}...`);

    // ヘッダー送信
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [headerEmbed] }),
    });
    await sleep(1000);

    // 分割送信
    for (let i = 0; i < chunks.length; i++) {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: chunks[i] }),
      });
      await sleep(1000);
    }

    // フッター送信
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: footer }),
    });

    await sleep(2000); // Webhook間の待機
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * noteに有料記事（480円）を自動投稿
 */
async function postToNote(filePath: string, title: string): Promise<string | null> {
  const scriptPath = join(process.cwd(), 'scripts', 'note_draft_poster_selenium.py');

  if (!existsSync(scriptPath)) {
    logger.error(`Pythonスクリプトが見つかりません: ${scriptPath}`);
    return null;
  }

  // 環境変数チェック
  if (!process.env.NOTE_EMAIL || !process.env.NOTE_PASSWORD) {
    logger.error('NOTE_EMAIL, NOTE_PASSWORD が設定されていません');
    return null;
  }

  try {
    // Pythonスクリプトを実行（macOSではpython3を使用）
    const command = `python3 "${scriptPath}" --title "${title}" --file "${filePath}" --headless`;
    logger.info(`  実行: ${command}`);

    const output = execSync(command, {
      encoding: 'utf-8',
      timeout: 300000, // 5分タイムアウト
      env: process.env,
      cwd: process.cwd(),
    });

    logger.info('  Pythonスクリプト出力:');
    output.split('\n').slice(-10).forEach(line => {
      if (line.trim()) logger.info(`    ${line}`);
    });

    // URLを抽出（出力から）
    const urlMatch = output.match(/https:\/\/note\.com\/[^\s]+/);
    return urlMatch ? urlMatch[0] : 'note投稿完了（URL取得失敗）';

  } catch (error: any) {
    logger.error(`note投稿エラー: ${error.message}`);
    if (error.stdout) {
      logger.error(`stdout: ${error.stdout.slice(-500)}`);
    }
    if (error.stderr) {
      logger.error(`stderr: ${error.stderr.slice(-500)}`);
    }
    return null;
  }
}

program.parse();
