#!/usr/bin/env tsx
import 'dotenv/config';
import { Command } from 'commander';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';
import { loadConfig } from '../utils/config.js';
import { ScoredTweet } from '../types/index.js';

const config = loadConfig();
const program = new Command();

interface KindleChapter {
  title: string;
  content: string;
}

interface KindleManuscript {
  title: string;
  week: string;
  chapters: KindleChapter[];
  wordCount: number;
  generatedAt: string;
}

program
  .name('generate-kindle')
  .description('Kindle 週刊原稿を生成')
  .option('--week <week>', '対象週 (YYYY-Wnn)', getCurrentWeek())
  .option('--data-dir <path>', 'データディレクトリ', './data')
  .option('-o, --output <path>', '出力先ディレクトリ', './output/kindle')
  .option('--dry-run', 'プレビューのみ')
  .action(async (options) => {
    logger.info('='.repeat(50));
    logger.info('Kindle原稿生成を開始します');
    logger.info(`対象週: ${options.week}`);
    logger.info('='.repeat(50));

    try {
      // Claude API キーの確認
      if (!process.env.ANTHROPIC_API_KEY) {
        logger.error('ANTHROPIC_API_KEY が設定されていません');
        process.exit(1);
      }

      // 週間データを集約
      logger.info('Step 1: 週間データを集約中...');
      const weeklyTweets = await collectWeeklyData(options.dataDir, options.week);
      logger.info(`集約完了: ${weeklyTweets.length} 件`);

      if (weeklyTweets.length === 0) {
        logger.warn('週間データが見つかりません');
        return;
      }

      // ドライラン
      if (options.dryRun) {
        displayPreview(options.week, weeklyTweets);
        logger.info('ドライラン完了。実際の生成は行いませんでした。');
        return;
      }

      // 出力ディレクトリ作成
      if (!existsSync(options.output)) {
        mkdirSync(options.output, { recursive: true });
      }

      // 各章を生成
      logger.info('Step 2: 原稿を生成中...');
      const manuscript = await generateManuscript(weeklyTweets, options.week);

      // 保存
      logger.info('Step 3: ファイルに保存中...');
      const outputPath = saveManuscript(manuscript, options.output);

      // 結果サマリー
      logger.info('='.repeat(50));
      logger.info('Kindle原稿生成が完了しました');
      logger.info(`タイトル: ${manuscript.title}`);
      logger.info(`章数: ${manuscript.chapters.length}`);
      logger.info(`総文字数: ${manuscript.wordCount}`);
      logger.info(`出力: ${outputPath}`);
      logger.info('='.repeat(50));
    } catch (error) {
      logger.error('Kindle原稿生成でエラーが発生しました:', error);
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

  const files = readdirSync(dataDir).filter((f) => f.startsWith('scored_') && f.endsWith('.json'));

  for (const file of files) {
    try {
      const dateStr = file.replace('scored_', '').replace('.json', '');
      const fileDate = new Date(dateStr);

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

  // スコア順にソート、重複除去
  allTweets.sort((a, b) => b.finalScore - a.finalScore);
  const seen = new Set<string>();
  return allTweets.filter((t) => {
    if (seen.has(t.tweetId)) return false;
    seen.add(t.tweetId);
    return true;
  });
}

/**
 * プレビューを表示
 */
function displayPreview(week: string, tweets: ScoredTweet[]): void {
  console.log('\n=== Kindle原稿プレビュー ===\n');
  console.log(`対象週: ${week}`);
  console.log(`収集投稿数: ${tweets.length}`);
  console.log('\n構成:');
  config.kindle.structure.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s}`);
  });
  console.log('\nトップ10投稿:');
  tweets.slice(0, 10).forEach((t, i) => {
    console.log(`  ${i + 1}. @${t.authorUsername} (${t.finalScore.toFixed(1)})`);
    console.log(`     ${t.content.slice(0, 60)}...`);
  });
}

/**
 * 原稿を生成
 */
async function generateManuscript(tweets: ScoredTweet[], week: string): Promise<KindleManuscript> {
  const anthropic = new Anthropic();
  const chapters: KindleChapter[] = [];
  const structure = config.kindle.structure;

  // 各章を個別に生成
  for (let i = 0; i < structure.length; i++) {
    const chapterTitle = structure[i];
    logger.info(`  章 ${i + 1}/${structure.length}: ${chapterTitle}`);

    const chapterTweets = getChapterTweets(tweets, chapterTitle, i);
    const chapter = await generateChapter(anthropic, chapterTitle, chapterTweets, week, i);
    chapters.push(chapter);

    // レート制限対策
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const fullContent = chapters.map((c) => c.content).join('\n\n');
  const wordCount = fullContent.length;

  return {
    title: `週刊AIトレンド ${week}`,
    week,
    chapters,
    wordCount,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * 章に使用する投稿を選択
 */
function getChapterTweets(tweets: ScoredTweet[], chapterTitle: string, index: number): ScoredTweet[] {
  const total = tweets.length;
  const chunkSize = Math.ceil(total / 6);

  switch (index) {
    case 0: // 巻頭言
      return tweets.slice(0, 3);
    case 1: // 最重要特集
      return tweets.slice(0, 5);
    case 2: // ニュースダイジェスト
      return tweets.slice(5, 15);
    case 3: // インフルエンサー視点
      return tweets.filter((t) => t.isPriority).slice(0, 5);
    case 4: // 実務ヒント
      return tweets.slice(10, 20);
    case 5: // 予測・CTA
      return tweets.slice(0, 5);
    default:
      return tweets.slice(index * chunkSize, (index + 1) * chunkSize);
  }
}

/**
 * 章を生成
 */
async function generateChapter(
  anthropic: Anthropic,
  title: string,
  tweets: ScoredTweet[],
  week: string,
  index: number
): Promise<KindleChapter> {
  const prompt = buildChapterPrompt(title, tweets, week, index);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type');
  }

  return {
    title,
    content: content.text,
  };
}

/**
 * 章生成プロンプト
 */
function buildChapterPrompt(
  title: string,
  tweets: ScoredTweet[],
  week: string,
  index: number
): string {
  const tweetContext = tweets.map((t, i) => `
${i + 1}. @${t.authorUsername}
   ${t.content}
`).join('\n');

  const chapterGuides: Record<number, string> = {
    0: '読者を引き込む導入。今週の見どころを簡潔に紹介。800-1000文字。',
    1: '最も重要なトピックを深掘り。背景、影響、今後の展望を詳しく解説。3000-4000文字。',
    2: '今週の主要ニュースを箇条書きで整理。各ニュースに簡潔な解説を追加。2000-3000文字。',
    3: '優先インフルエンサーの見解を紹介・分析。彼らの視点から学べることを解説。2000-3000文字。',
    4: '読者がすぐに実践できる具体的なヒントを提供。ステップバイステップで解説。2000-3000文字。',
    5: '今後のトレンド予測とまとめ。読者への行動喚起（CTA）を含める。1000-1500文字。',
  };

  return `あなたはAIトレンドの週刊雑誌編集者です。${week}号の「${title}」章を執筆してください。

【章の役割】
${chapterGuides[index] || '関連情報を読者にわかりやすく解説する。'}

【参照投稿】
${tweetContext}

【執筆ルール】
1. 読者はAI・生成AIに興味があるビジネスパーソン
2. 専門用語は必要に応じて解説
3. 具体例を豊富に使用
4. 見出し（###）を適切に使用
5. Markdown形式で執筆

章を執筆してください:`;
}

/**
 * 原稿を保存
 */
function saveManuscript(manuscript: KindleManuscript, outputDir: string): string {
  const filename = `kindle_${manuscript.week}.md`;
  const outputPath = join(outputDir, filename);

  // Markdown形式で結合
  let content = `# ${manuscript.title}\n\n`;
  content += `生成日時: ${manuscript.generatedAt}\n\n`;
  content += `---\n\n`;

  for (const chapter of manuscript.chapters) {
    content += `## ${chapter.title}\n\n`;
    content += chapter.content;
    content += '\n\n---\n\n';
  }

  writeFileSync(outputPath, content, 'utf-8');

  // JSONも保存
  const jsonPath = outputPath.replace('.md', '.json');
  writeFileSync(jsonPath, JSON.stringify(manuscript, null, 2), 'utf-8');

  return outputPath;
}

program.parse();
