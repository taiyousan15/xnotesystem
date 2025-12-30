#!/usr/bin/env tsx
import 'dotenv/config';
import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';
import { loadConfig } from '../utils/config.js';
import { ScoredTweet } from '../types/index.js';

const config = loadConfig();
const program = new Command();

// 記事タイプ
type ArticleType = 'paid' | 'free' | 'guide';

interface GeneratedArticle {
  type: ArticleType;
  title: string;
  body: string;
  wordCount: number;
  price?: number;
  sourceTweets: string[];
}

program
  .name('generate-note')
  .description('note 記事を生成')
  .option('-i, --input <path>', 'スコア済みデータファイル (scored_*.json)')
  .option('-t, --type <type>', '記事タイプ (paid|free|guide)', 'free')
  .option('-w, --word-count <count>', '目標文字数', '7000')
  .option('--theme <theme>', '記事テーマ')
  .option('--target <target>', 'ターゲット読者')
  .option('-o, --output <path>', '出力先ディレクトリ', './output/notes')
  .option('--dry-run', 'LLM呼び出しをスキップしてプレビューのみ')
  .action(async (options) => {
    logger.info('='.repeat(50));
    logger.info('note記事生成を開始します');
    logger.info(`記事タイプ: ${options.type}`);
    logger.info(`目標文字数: ${options.wordCount}`);
    logger.info('='.repeat(50));

    try {
      // Claude API キーの確認
      if (!process.env.ANTHROPIC_API_KEY) {
        logger.error('ANTHROPIC_API_KEY が設定されていません');
        process.exit(1);
      }

      // トップ投稿を取得
      let topTweets: ScoredTweet[] = [];

      if (options.input && existsSync(options.input)) {
        logger.info('Step 1: データを読み込み中...');
        const rawData = readFileSync(options.input, 'utf-8');
        const inputData = JSON.parse(rawData);
        topTweets = inputData.topPicks || inputData.allTweets?.slice(0, 5) || [];
      }

      if (topTweets.length === 0 && !options.theme) {
        logger.warn('入力データまたはテーマが必要です');
        logger.info('使用例: npm run generate:note -- --theme "今週のAIトレンド"');
        return;
      }

      // ドライラン
      if (options.dryRun) {
        displayPreview(options, topTweets);
        logger.info('ドライラン完了。実際の生成は行いませんでした。');
        return;
      }

      // 記事生成
      logger.info('Step 2: 記事を生成中...');
      const article = await generateArticle(
        options.type as ArticleType,
        parseInt(options.wordCount, 10),
        topTweets,
        options.theme,
        options.target
      );

      // 出力
      logger.info('Step 3: ファイルに保存中...');
      const outputDir = options.output;
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `note_${options.type}_${timestamp}.md`;
      const outputPath = join(outputDir, filename);

      // Markdown形式で保存
      const markdown = formatAsMarkdown(article);
      writeFileSync(outputPath, markdown, 'utf-8');
      logger.info(`保存完了: ${outputPath}`);

      // JSONも保存
      const jsonPath = outputPath.replace('.md', '.json');
      writeFileSync(jsonPath, JSON.stringify(article, null, 2), 'utf-8');

      // 結果サマリー
      logger.info('='.repeat(50));
      logger.info('note記事生成が完了しました');
      logger.info(`タイトル: ${article.title}`);
      logger.info(`文字数: ${article.wordCount}`);
      logger.info(`タイプ: ${article.type}`);
      if (article.price) {
        logger.info(`価格: ${article.price}円`);
      }
      logger.info(`出力: ${outputPath}`);
      logger.info('='.repeat(50));

      // コンソール出力
      console.log('\n--- 生成された記事（プレビュー） ---\n');
      console.log(article.title);
      console.log('-'.repeat(40));
      console.log(article.body.slice(0, 500) + '...\n');
    } catch (error) {
      logger.error('note記事生成でエラーが発生しました:', error);
      process.exit(1);
    }
  });

/**
 * プレビューを表示
 */
function displayPreview(options: { type: string; wordCount: string; theme?: string; target?: string }, tweets: ScoredTweet[]): void {
  console.log('\n=== 記事生成プレビュー ===\n');
  console.log(`タイプ: ${options.type}`);
  console.log(`目標文字数: ${options.wordCount}`);
  if (options.theme) console.log(`テーマ: ${options.theme}`);
  if (options.target) console.log(`ターゲット: ${options.target}`);

  if (tweets.length > 0) {
    console.log('\n参照投稿:');
    tweets.forEach((t, i) => {
      console.log(`  ${i + 1}. @${t.authorUsername}: ${t.content.slice(0, 80)}...`);
    });
  }
}

/**
 * 記事を生成
 */
async function generateArticle(
  type: ArticleType,
  wordCount: number,
  tweets: ScoredTweet[],
  theme?: string,
  target?: string
): Promise<GeneratedArticle> {
  const anthropic = new Anthropic();

  // プロンプトを構築
  const prompt = buildPrompt(type, wordCount, tweets, theme, target);

  logger.info('Claude APIを呼び出し中...');

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

  const generatedText = content.text;

  // タイトルと本文を分離
  const lines = generatedText.split('\n');
  const title = lines[0].replace(/^#\s*/, '').trim();
  const body = lines.slice(1).join('\n').trim();

  return {
    type,
    title,
    body,
    wordCount: body.length,
    price: type === 'paid' ? config.note.price : undefined,
    sourceTweets: tweets.map((t) => t.tweetId),
  };
}

/**
 * プロンプトを構築
 */
function buildPrompt(
  type: ArticleType,
  wordCount: number,
  tweets: ScoredTweet[],
  theme?: string,
  target?: string
): string {
  const articleTypeDescriptions: Record<ArticleType, string> = {
    paid: `
【有料販売記事】
- 販売フック・コピーを重視
- 読者が「買わないと損をする」と感じる構成
- 希少性と緊急性を訴求
- 価格: ${config.note.price}円`,
    free: `
【無料教育記事】
- 信頼・教育・価値提供を重視
- 読者にすぐに役立つ情報を提供
- 次のアクションを明確に示す`,
    guide: `
【誘導記事】
- 共感・メリット・行動喚起を重視
- 明確なCTAを含める
- 読者の悩みに寄り添う構成`,
  };

  const tweetContext = tweets.length > 0
    ? `
【参照する投稿データ】
${tweets.map((t, i) => `
${i + 1}. @${t.authorUsername}
   スコア: ${t.finalScore.toFixed(1)}
   内容: ${t.content}
   エンゲージメント: Like ${t.likeCount}, RT ${t.repostCount}
`).join('\n')}`
    : '';

  const themeContext = theme ? `\n【記事テーマ】\n${theme}` : '';
  const targetContext = target ? `\n【ターゲット読者】\n${target}` : '\n【ターゲット読者】\nAI・生成AIに興味がある20-40代のビジネスパーソン';

  return `あなたはAIトレンドの専門ライターです。以下の条件でnote記事を生成してください。

${articleTypeDescriptions[type]}
${themeContext}
${targetContext}
${tweetContext}

【執筆ルール】
1. WIIFM法則: 読者視点で「何が得られるか」を冒頭で明示
2. PASCAL型構成:
   - P (Problem): 読者の悩み・問題を提示
   - A (Agitate): 問題を深掘り、共感を得る
   - S (Solution): 解決策を提示
   - C (Credibility): 信頼性・実績を示す
   - A (Action): 具体的な行動を促す
   - L (Limitation): 希少性・緊急性を訴求（有料記事の場合）

3. 影響力6原則を適用:
   - 社会的証明: 他の人も選んでいることを示す
   - 権威性: 専門家の見解や実績を引用
   - 希少性: 限定感を演出
   - 一貫性: 読者の行動を促す
   - 好意: 親しみやすい文体
   - 返報性: 先に価値を与える

4. フォーマット:
   - 見出し（##）を適切に使用
   - 箇条書きで読みやすく
   - 太字で重要ポイントを強調
   - 改行を多用してスマホでも読みやすく

【出力形式】
- 1行目: タイトル（#で始める、キャッチーで具体的なもの）
- 2行目以降: 本文（Markdown形式）
- 目標文字数: 約${wordCount}文字

記事を生成してください:`;
}

/**
 * Markdown形式でフォーマット
 */
function formatAsMarkdown(article: GeneratedArticle): string {
  const header = `---
title: "${article.title}"
type: ${article.type}
word_count: ${article.wordCount}
${article.price ? `price: ${article.price}` : ''}
generated_at: ${new Date().toISOString()}
source_tweets: ${JSON.stringify(article.sourceTweets)}
---

`;

  return header + `# ${article.title}\n\n${article.body}`;
}

program.parse();
