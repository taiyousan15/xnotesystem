#!/usr/bin/env tsx
import 'dotenv/config';
import { Command } from 'commander';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';
import { ScoredTweet } from '../types/index.js';

const program = new Command();

interface YouTubeScript {
  title: string;
  description: string;
  tags: string[];
  duration: string;
  sections: ScriptSection[];
  thumbnail: ThumbnailSuggestion;
  generatedAt: string;
}

interface ScriptSection {
  name: string;
  timestamp: string;
  narration: string;
  visualNotes: string;
}

interface ThumbnailSuggestion {
  mainText: string;
  subText: string;
  style: string;
}

program
  .name('generate-youtube')
  .description('YouTube 動画台本を生成')
  .option('--week <week>', '対象週 (YYYY-Wnn)', getCurrentWeek())
  .option('--data-dir <path>', 'データディレクトリ', './data')
  .option('-o, --output <path>', '出力先ディレクトリ', './output/youtube')
  .option('--duration <minutes>', '目標動画長（分）', '10')
  .option('--style <style>', '動画スタイル (news|tutorial|discussion)', 'news')
  .option('--dry-run', 'プレビューのみ')
  .action(async (options) => {
    logger.info('='.repeat(50));
    logger.info('YouTube台本生成を開始します');
    logger.info(`対象週: ${options.week}`);
    logger.info(`目標時間: ${options.duration}分`);
    logger.info(`スタイル: ${options.style}`);
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
        displayPreview(options, weeklyTweets);
        logger.info('ドライラン完了。実際の生成は行いませんでした。');
        return;
      }

      // 出力ディレクトリ作成
      if (!existsSync(options.output)) {
        mkdirSync(options.output, { recursive: true });
      }

      // 台本を生成
      logger.info('Step 2: 台本を生成中...');
      const script = await generateScript(
        weeklyTweets,
        options.week,
        parseInt(options.duration, 10),
        options.style
      );

      // 保存
      logger.info('Step 3: ファイルに保存中...');
      const outputPath = saveScript(script, options.output, options.week);

      // 結果サマリー
      logger.info('='.repeat(50));
      logger.info('YouTube台本生成が完了しました');
      logger.info(`タイトル: ${script.title}`);
      logger.info(`セクション数: ${script.sections.length}`);
      logger.info(`推定時間: ${script.duration}`);
      logger.info(`出力: ${outputPath}`);
      logger.info('='.repeat(50));

      // コンソール出力
      console.log('\n--- 生成された台本（プレビュー） ---\n');
      console.log(`タイトル: ${script.title}`);
      console.log(`説明: ${script.description.slice(0, 100)}...`);
      console.log(`タグ: ${script.tags.join(', ')}`);
      console.log('\nサムネイル提案:');
      console.log(`  メイン: ${script.thumbnail.mainText}`);
      console.log(`  サブ: ${script.thumbnail.subText}`);
    } catch (error) {
      logger.error('YouTube台本生成でエラーが発生しました:', error);
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
function displayPreview(options: { week: string; duration: string; style: string }, tweets: ScoredTweet[]): void {
  console.log('\n=== YouTube台本プレビュー ===\n');
  console.log(`対象週: ${options.week}`);
  console.log(`目標時間: ${options.duration}分`);
  console.log(`スタイル: ${options.style}`);
  console.log(`収集投稿数: ${tweets.length}`);
  console.log('\nトップ5投稿:');
  tweets.slice(0, 5).forEach((t, i) => {
    console.log(`  ${i + 1}. @${t.authorUsername} (${t.finalScore.toFixed(1)})`);
    console.log(`     ${t.content.slice(0, 60)}...`);
  });
}

/**
 * 台本を生成
 */
async function generateScript(
  tweets: ScoredTweet[],
  week: string,
  duration: number,
  style: string
): Promise<YouTubeScript> {
  const anthropic = new Anthropic();

  const prompt = buildPrompt(tweets, week, duration, style);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
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

  // JSON形式で解析
  const jsonMatch = content.text.match(/```json\n([\s\S]*?)\n```/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[1]);
  }

  // JSONブロックがない場合はテキストから構造化
  return parseScriptFromText(content.text, week, duration);
}

/**
 * プロンプトを構築
 */
function buildPrompt(
  tweets: ScoredTweet[],
  week: string,
  duration: number,
  style: string
): string {
  const topTweets = tweets.slice(0, 10);
  const tweetContext = topTweets.map((t, i) => `
${i + 1}. @${t.authorUsername} (スコア: ${t.finalScore.toFixed(1)})
   ${t.content}
`).join('\n');

  const styleGuides: Record<string, string> = {
    news: 'ニュース形式。客観的に今週のトピックを伝える。テンポよく進行。',
    tutorial: 'チュートリアル形式。視聴者が学べる内容を重視。ステップバイステップ。',
    discussion: 'ディスカッション形式。トピックについて深掘り。視聴者に問いかける。',
  };

  return `あなたはYouTube動画の台本ライターです。${week}のAIトレンド動画の台本を生成してください。

【動画設定】
- 目標時間: ${duration}分
- スタイル: ${style} - ${styleGuides[style] || styleGuides.news}

【今週のトップ投稿】
${tweetContext}

【台本要件】
1. 視聴者を引き込むフック（最初の15秒が重要）
2. 明確なセクション分け
3. 各セクションにナレーションと映像指示
4. SEO最適化されたタイトル・説明・タグ
5. サムネイル提案

【出力形式】
以下のJSON形式で出力してください:

\`\`\`json
{
  "title": "動画タイトル（SEO最適化）",
  "description": "動画説明文（500文字程度）",
  "tags": ["タグ1", "タグ2", "タグ3", ...],
  "duration": "約${duration}分",
  "sections": [
    {
      "name": "セクション名",
      "timestamp": "0:00",
      "narration": "ナレーション原稿",
      "visualNotes": "映像・テロップの指示"
    }
  ],
  "thumbnail": {
    "mainText": "サムネイルメインテキスト",
    "subText": "サブテキスト",
    "style": "スタイル提案"
  },
  "generatedAt": "${new Date().toISOString()}"
}
\`\`\`

台本を生成してください:`;
}

/**
 * テキストから台本を構造化
 */
function parseScriptFromText(text: string, week: string, duration: number): YouTubeScript {
  const lines = text.split('\n');
  const title = lines.find((l) => l.startsWith('#'))?.replace(/^#+\s*/, '') || `週刊AIトレンド ${week}`;

  return {
    title,
    description: text.slice(0, 500),
    tags: ['AI', 'ChatGPT', 'Claude', '生成AI', 'AIトレンド', 'テクノロジー'],
    duration: `約${duration}分`,
    sections: [
      {
        name: 'オープニング',
        timestamp: '0:00',
        narration: '今週のAIトレンドをお届けします。',
        visualNotes: 'タイトルアニメーション',
      },
      {
        name: '本編',
        timestamp: '0:30',
        narration: text,
        visualNotes: 'スライド表示',
      },
      {
        name: 'エンディング',
        timestamp: `${duration - 1}:00`,
        narration: 'チャンネル登録よろしくお願いします。',
        visualNotes: 'エンドカード',
      },
    ],
    thumbnail: {
      mainText: '今週のAI',
      subText: '重要ニュース',
      style: 'インパクト重視',
    },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * 台本を保存
 */
function saveScript(script: YouTubeScript, outputDir: string, week: string): string {
  const filename = `youtube_${week}.md`;
  const outputPath = join(outputDir, filename);

  // Markdown形式で保存
  let content = `# ${script.title}\n\n`;
  content += `生成日時: ${script.generatedAt}\n`;
  content += `推定時間: ${script.duration}\n\n`;
  content += `## 動画説明\n\n${script.description}\n\n`;
  content += `## タグ\n\n${script.tags.join(', ')}\n\n`;
  content += `## サムネイル提案\n\n`;
  content += `- メイン: ${script.thumbnail.mainText}\n`;
  content += `- サブ: ${script.thumbnail.subText}\n`;
  content += `- スタイル: ${script.thumbnail.style}\n\n`;
  content += `---\n\n`;
  content += `## 台本\n\n`;

  for (const section of script.sections) {
    content += `### ${section.name} (${section.timestamp})\n\n`;
    content += `**ナレーション:**\n${section.narration}\n\n`;
    content += `**映像指示:** ${section.visualNotes}\n\n`;
    content += `---\n\n`;
  }

  writeFileSync(outputPath, content, 'utf-8');

  // JSONも保存
  const jsonPath = outputPath.replace('.md', '.json');
  writeFileSync(jsonPath, JSON.stringify(script, null, 2), 'utf-8');

  return outputPath;
}

program.parse();
