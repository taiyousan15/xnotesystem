#!/usr/bin/env tsx
import 'dotenv/config';
import { Command } from 'commander';
import { TwitterApi } from 'twitter-api-v2';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { saveTweetsToNotionFromAINews } from '../services/notion.js';
import { analyzeTweetsBatch, testOllamaConnection } from '../services/ollama-analyzer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================
// 型定義
// ============================================

interface QueryConfig {
  id: string;
  name: string;
  category: Category;
  query: string;
  count: number;
  lang: string;
}

interface QueriesConfig {
  queries: {
    breaking: QueryConfig[];
    practical: QueryConfig[];
  };
  discord: {
    channels: Record<string, string>;
  };
  rateLimit: {
    delayBetweenQueries: number;
    maxRetries: number;
    backoffMultiplier: number;
    initialBackoffMs: number;
  };
}

type Category = 'NEWS' | 'RESEARCH' | 'TOOL' | 'DEV' | 'OPS' | 'BIZ' | 'POLICY' | 'SECURITY' | 'JP';
type Tag = 'STAR' | 'DEEP' | 'LIKE' | 'NONE';

interface CollectedTweet {
  id: string;
  authorId: string;
  authorUsername: string;
  content: string;
  createdAt: string;
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  url: string;
  queryId: string;
  category: Category;
  tag: Tag;
  isBreaking: boolean;
}

interface FormattedPost {
  category: Category;
  tag: Tag;
  title: string;
  summary: {
    what: string;
    why: string;
    action: string;
  };
  url: string;
  metrics: {
    likes: number;
    retweets: number;
    replies: number;
    quotes: number;
  };
  datetime: string;
  author: string;
  raw: CollectedTweet;
}

// ============================================
// メイン処理
// ============================================

const program = new Command();

program
  .name('ai-news-collect')
  .description('AIニュース収集システム - 10クエリで200件取得')
  .option('-d, --date <date>', '処理対象日 (YYYY-MM-DD)', new Date().toISOString().split('T')[0])
  .option('-o, --output <path>', '出力先ディレクトリ', './data/ai-news')
  .option('--dry-run', 'Discord投稿をスキップ')
  .option('--breaking-only', '速報系クエリのみ実行')
  .option('--practical-only', '実務系クエリのみ実行')
  .option('--no-notion', 'Notion保存をスキップ')
  .option('--analyze', 'Ollamaで要点解析を実行（Why/Action生成）')
  .option('--model <name>', 'Ollamaモデル指定（デフォルト: llama3.2:3b）')
  .action(async (options) => {
    logger.info('='.repeat(60));
    logger.info('AIニュース収集システム 開始');
    logger.info(`対象日: ${options.date}`);
    logger.info('='.repeat(60));

    try {
      // 設定読み込み
      const configPath = join(__dirname, '../../config/ai-news-queries.json');
      const config: QueriesConfig = JSON.parse(readFileSync(configPath, 'utf-8'));

      // Twitter API クライアント初期化
      const bearerToken = process.env.X_BEARER_TOKEN;
      if (!bearerToken) {
        throw new Error('X_BEARER_TOKEN が設定されていません');
      }
      const client = new TwitterApi(bearerToken);

      // 実行するクエリを決定
      let queriesToRun: QueryConfig[] = [];
      if (options.breakingOnly) {
        queriesToRun = config.queries.breaking;
      } else if (options.practicalOnly) {
        queriesToRun = config.queries.practical;
      } else {
        queriesToRun = [...config.queries.breaking, ...config.queries.practical];
      }

      logger.info(`実行クエリ数: ${queriesToRun.length}`);

      // 収集実行
      const allTweets: CollectedTweet[] = [];
      const errors: string[] = [];

      for (let i = 0; i < queriesToRun.length; i++) {
        const queryConfig = queriesToRun[i];
        logger.info(`[${queryConfig.id}] ${queryConfig.name} 検索中... (${i + 1}/${queriesToRun.length})`);

        try {
          const tweets = await searchTweetsWithRetry(client, queryConfig, config);
          allTweets.push(...tweets);
          logger.info(`  -> ${tweets.length} 件取得`);
        } catch (error) {
          const msg = `[${queryConfig.id}] エラー: ${error}`;
          logger.error(msg);
          errors.push(msg);
        }

        // レート制限対策（最後のクエリ以外は待機）
        if (i < queriesToRun.length - 1) {
          logger.info(`  待機中... (${config.rateLimit.delayBetweenQueries / 1000}秒)`);
          await sleep(config.rateLimit.delayBetweenQueries);
        }
      }

      // 重複排除
      const uniqueTweets = removeDuplicates(allTweets);
      logger.info(`重複排除: ${allTweets.length} -> ${uniqueTweets.length} 件`);

      // タグ判定
      const taggedTweets = uniqueTweets.map(tweet => ({
        ...tweet,
        tag: determineTag(tweet)
      }));

      // Ollama解析（--analyze オプション時）
      let analysisResults: Map<string, { why: string; action: string }> | null = null;
      if (options.analyze) {
        const ollamaOk = await testOllamaConnection();
        if (ollamaOk) {
          logger.info('Ollama解析を開始...');
          const tweetsForAnalysis = taggedTweets.map(t => ({
            id: t.id,
            content: t.content,
            category: t.category,
            author: t.authorUsername,
          }));
          analysisResults = await analyzeTweetsBatch(tweetsForAnalysis);
        } else {
          logger.warn('Ollama未接続のため解析をスキップ');
        }
      }

      // 整形
      const formattedPosts = taggedTweets.map(tweet => formatPost(tweet, analysisResults));

      // 速報ピック（上位10件）
      const breakingPicks = selectTopPicks(
        formattedPosts.filter(p => p.raw.isBreaking),
        10,
        'breaking'
      );

      // 実務ピック（上位10件）
      const practicalPicks = selectTopPicks(
        formattedPosts.filter(p => !p.raw.isBreaking),
        10,
        'practical'
      );

      // STAR抽出
      const starPosts = formattedPosts.filter(p => p.tag === 'STAR');

      // 出力ディレクトリ作成
      const outputDir = options.output;
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      // 結果をファイルに保存
      const outputData = {
        date: options.date,
        collectedAt: new Date().toISOString(),
        stats: {
          totalCollected: uniqueTweets.length,
          breakingCount: formattedPosts.filter(p => p.raw.isBreaking).length,
          practicalCount: formattedPosts.filter(p => !p.raw.isBreaking).length,
          starCount: starPosts.length,
          deepCount: formattedPosts.filter(p => p.tag === 'DEEP').length,
          likeCount: formattedPosts.filter(p => p.tag === 'LIKE').length,
        },
        breakingPicks,
        practicalPicks,
        starPosts,
        allPosts: formattedPosts,
        errors,
      };

      const outputPath = join(outputDir, `ai-news_${options.date}.json`);
      writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf-8');
      logger.info(`保存完了: ${outputPath}`);

      // Discord投稿（dry-runでなければ）
      if (!options.dryRun) {
        logger.info('Discord投稿を実行...');
        await postToDiscord(outputData, config);
      } else {
        logger.info('dry-run モード: Discord投稿をスキップ');
      }

      // Notion保存（--no-notionでなければ）
      if (options.notion !== false && process.env.NOTION_API_KEY && process.env.NOTION_DATABASE_ID) {
        logger.info('Notion保存を実行...');
        const topPickIds = [...breakingPicks, ...practicalPicks].map(p => p.raw.id);
        const result = await saveTweetsToNotionFromAINews(formattedPosts, topPickIds, starPosts.map(p => p.raw.id));
        logger.info(`Notion保存完了: ${result.saved} 件保存, ${result.errors} 件エラー`);
      } else if (options.notion === false) {
        logger.info('--no-notion モード: Notion保存をスキップ');
      } else {
        logger.info('Notion設定なし: Notion保存をスキップ');
      }

      // コンソール出力
      printSummary(outputData);
      printFormattedPosts('#ai-raw-feed', formattedPosts.slice(0, 20));
      printFormattedPosts('#ai-news-daily', breakingPicks);
      printFormattedPosts('#ai-practice', practicalPicks);
      printStarList(starPosts);

    } catch (error) {
      logger.error('AIニュース収集でエラー:', error);
      process.exit(1);
    }
  });

// ============================================
// 検索関数（リトライ付き）
// ============================================

async function searchTweetsWithRetry(
  client: TwitterApi,
  queryConfig: QueryConfig,
  config: QueriesConfig
): Promise<CollectedTweet[]> {
  const { maxRetries, backoffMultiplier, initialBackoffMs } = config.rateLimit;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await searchTweets(client, queryConfig, config);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isRateLimit = errorMessage.includes('429') ||
                          errorMessage.toLowerCase().includes('rate') ||
                          errorMessage.toLowerCase().includes('limit');

      if (isRateLimit && attempt < maxRetries) {
        const waitTime = initialBackoffMs * Math.pow(backoffMultiplier, attempt);
        logger.warn(`[${queryConfig.id}] レート制限検出。${waitTime / 1000}秒待機後にリトライ (${attempt + 1}/${maxRetries})`);
        await sleep(waitTime);
        continue;
      }

      throw error;
    }
  }

  return [];
}

async function searchTweets(
  client: TwitterApi,
  queryConfig: QueryConfig,
  config: QueriesConfig
): Promise<CollectedTweet[]> {
  const isBreaking = config.queries.breaking.some(q => q.id === queryConfig.id);

  const result = await client.v2.search(queryConfig.query, {
    max_results: Math.min(queryConfig.count, 100),
    'tweet.fields': ['public_metrics', 'created_at', 'author_id'],
    'user.fields': ['username'],
    expansions: ['author_id'],
  });

  const users = new Map<string, string>();
  if (result.includes?.users) {
    for (const user of result.includes.users) {
      users.set(user.id, user.username);
    }
  }

  const tweets: CollectedTweet[] = [];
  for (const tweet of result.data?.data || []) {
    const username = users.get(tweet.author_id || '') || 'unknown';
    const metrics = tweet.public_metrics;

    tweets.push({
      id: tweet.id,
      authorId: tweet.author_id || '',
      authorUsername: username,
      content: tweet.text,
      createdAt: tweet.created_at || new Date().toISOString(),
      likes: metrics?.like_count || 0,
      retweets: metrics?.retweet_count || 0,
      replies: metrics?.reply_count || 0,
      quotes: metrics?.quote_count || 0,
      url: `https://x.com/${username}/status/${tweet.id}`,
      queryId: queryConfig.id,
      category: queryConfig.category,
      tag: 'NONE',
      isBreaking,
    });
  }

  return tweets;
}

// ============================================
// タグ判定
// ============================================

function determineTag(tweet: CollectedTweet): Tag {
  const content = tweet.content.toLowerCase();
  const engagement = tweet.likes + tweet.retweets * 2;

  // STAR: 再現手順・テンプレ・具体例・数字がある
  const starPatterns = [
    /\d+[%％]/, // パーセンテージ
    /\$\d+/, // 金額
    /step\s*\d|ステップ\s*\d/i, // ステップ
    /\d+\s*(minutes?|mins?|hours?|days?|分|時間|日)/i, // 時間
    /template|テンプレ|手順|方法|やり方/i,
    /github\.com|colab|notebook/i, // コード系リンク
    /before.*after|ビフォー.*アフター/i,
  ];

  if (starPatterns.some(p => p.test(content))) {
    return 'STAR';
  }

  // DEEP: 長文・複数観点・検証が必要
  const deepPatterns = [
    /research|paper|study|論文|研究/i,
    /comparison|比較|違い/i,
    /thread|スレッド|🧵/i,
    /analysis|分析|考察/i,
  ];

  if (deepPatterns.some(p => p.test(content)) || content.length > 200) {
    return 'DEEP';
  }

  // LIKE: 有益だがそれ以外
  if (engagement > 50 || tweet.content.length > 100) {
    return 'LIKE';
  }

  return 'NONE';
}

// ============================================
// 整形
// ============================================

function formatPost(
  tweet: CollectedTweet,
  analysisResults: Map<string, { why: string; action: string }> | null = null
): FormattedPost {
  const title = tweet.content.split('\n')[0].slice(0, 50);

  // Ollama解析結果があれば使用
  const analysis = analysisResults?.get(tweet.id);

  return {
    category: tweet.category,
    tag: tweet.tag,
    title,
    summary: {
      what: extractWhat(tweet.content),
      why: analysis?.why || extractWhyFallback(tweet),
      action: analysis?.action || extractActionFallback(tweet),
    },
    url: tweet.url,
    metrics: {
      likes: tweet.likes,
      retweets: tweet.retweets,
      replies: tweet.replies,
      quotes: tweet.quotes,
    },
    datetime: formatDatetime(tweet.createdAt),
    author: `@${tweet.authorUsername}`,
    raw: tweet,
  };
}

function extractWhat(content: string): string {
  // 最初の文または最初の80文字
  const firstSentence = content.split(/[。.!！\n]/)[0];
  return firstSentence.slice(0, 80) || content.slice(0, 80);
}

function extractWhyFallback(tweet: CollectedTweet): string {
  // カテゴリに基づくフォールバック
  const categoryMessages: Record<string, string> = {
    'NEWS': '最新のAI業界動向を把握するため',
    'RESEARCH': '最先端の研究成果を知るため',
    'TOOL': '新しいAIツールの活用機会を発見するため',
    'DEV': '開発効率化のヒントを得るため',
    'OPS': 'AIシステム運用の知見を得るため',
    'BIZ': 'AI収益化のアイデアを得るため',
    'POLICY': 'AI規制の動向を把握するため',
    'SECURITY': 'AIセキュリティ対策を学ぶため',
    'JP': '日本のAI活用事例を知るため',
  };
  return categoryMessages[tweet.category] || 'AI分野の最新情報として';
}

function extractActionFallback(tweet: CollectedTweet): string {
  // タグに基づくフォールバック
  if (tweet.tag === 'STAR') {
    return '手順を参考に実践してみる';
  }
  if (tweet.tag === 'DEEP') {
    return '詳細を深掘りして理解を深める';
  }
  if (tweet.content.includes('github.com') || tweet.content.includes('http')) {
    return 'リンク先をチェックする';
  }
  return '詳細を確認して活用を検討';
}

function extractAction(_content: string): string {
  return '（LLMで解析予定）';
}

function formatDatetime(isoString: string): string {
  const date = new Date(isoString);
  return date.toISOString().replace('T', ' ').slice(0, 16);
}

// ============================================
// ピック選出
// ============================================

function selectTopPicks(
  posts: FormattedPost[],
  count: number,
  type: 'breaking' | 'practical'
): FormattedPost[] {
  const scored = posts.map(post => {
    let score = 0;

    if (type === 'breaking') {
      // 速報: 公式性・影響範囲・具体性・反応
      if (post.author.includes('OpenAI') || post.author.includes('Anthropic')) {
        score += 100;
      }
      score += post.metrics.likes * 0.5;
      score += post.metrics.retweets * 2;
      if (post.tag === 'STAR') score += 30;
    } else {
      // 実務: 再現性・省力化・差分作りやすさ
      if (post.tag === 'STAR') score += 100;
      if (post.tag === 'DEEP') score += 50;
      score += post.metrics.likes * 0.3;
      score += post.metrics.retweets * 1;
    }

    return { post, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map(item => item.post);
}

// ============================================
// Discord投稿
// ============================================

async function postToDiscord(
  data: {
    allPosts: FormattedPost[];
    breakingPicks: FormattedPost[];
    practicalPicks: FormattedPost[];
    starPosts: FormattedPost[];
  },
  _config: QueriesConfig
): Promise<void> {
  // #ai-raw-feed: 全件（最大50件ずつ分割）
  const rawWebhook = process.env.DISCORD_WEBHOOK_RAW;
  if (rawWebhook) {
    for (const post of data.allPosts.slice(0, 50)) {
      await sendDiscordPost(rawWebhook, post);
      await sleep(500);
    }
  }

  // #ai-news-daily: 速報ピック
  const newsWebhook = process.env.DISCORD_WEBHOOK_NEWS;
  if (newsWebhook) {
    for (const post of data.breakingPicks) {
      await sendDiscordPost(newsWebhook, post);
      await sleep(500);
    }
  }

  // #ai-practice: 実務ピック
  const practiceWebhook = process.env.DISCORD_WEBHOOK_PRACTICE;
  if (practiceWebhook) {
    for (const post of data.practicalPicks) {
      await sendDiscordPost(practiceWebhook, post);
      await sleep(500);
    }
  }

  // #note-paid-ideas: STARのみ
  const paidWebhook = process.env.DISCORD_WEBHOOK_NOTE_PAID;
  if (paidWebhook && data.starPosts.length > 0) {
    const starSummary = data.starPosts
      .map(p => `- **${p.title}** | ${p.author}\n  ${p.url}`)
      .join('\n');

    await sendDiscordEmbed(paidWebhook, {
      title: '[STAR] 有料note候補',
      description: starSummary,
      color: 0xffd700,
    });
  }
}

async function sendDiscordPost(webhookUrl: string, post: FormattedPost): Promise<void> {
  const tagEmoji = post.tag === 'STAR' ? '⭐' : post.tag === 'DEEP' ? '🔍' : post.tag === 'LIKE' ? '👍' : '';

  const content = `[${post.category}] ${tagEmoji}[${post.tag}] ${post.title}
**要点:**
• ${post.summary.what}
• ${post.summary.why}
• ${post.summary.action}
出典: ${post.url}
指標: like=${post.metrics.likes} rt=${post.metrics.retweets} reply=${post.metrics.replies} quote=${post.metrics.quotes}
日時: ${post.datetime}  著者: ${post.author}`;

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

async function sendDiscordEmbed(
  webhookUrl: string,
  embed: { title: string; description: string; color: number }
): Promise<void> {
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });
}

// ============================================
// ユーティリティ
// ============================================

function removeDuplicates(tweets: CollectedTweet[]): CollectedTweet[] {
  const seen = new Set<string>();
  return tweets.filter(tweet => {
    if (seen.has(tweet.id)) return false;
    seen.add(tweet.id);
    return true;
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// コンソール出力
// ============================================

function printSummary(data: { stats: Record<string, number>; errors: string[] }): void {
  logger.info('='.repeat(60));
  logger.info('収集完了サマリー');
  logger.info(`  総件数: ${data.stats.totalCollected}`);
  logger.info(`  速報系: ${data.stats.breakingCount}`);
  logger.info(`  実務系: ${data.stats.practicalCount}`);
  logger.info(`  [STAR]: ${data.stats.starCount}`);
  logger.info(`  [DEEP]: ${data.stats.deepCount}`);
  logger.info(`  [LIKE]: ${data.stats.likeCount}`);
  if (data.errors.length > 0) {
    logger.warn(`  エラー: ${data.errors.length} 件`);
  }
  logger.info('='.repeat(60));
}

function printFormattedPosts(channel: string, posts: FormattedPost[]): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${channel} 用出力 (${posts.length}件)`);
  console.log('='.repeat(60));

  for (const post of posts) {
    const tagEmoji = post.tag === 'STAR' ? '⭐' : post.tag === 'DEEP' ? '🔍' : post.tag === 'LIKE' ? '👍' : '';
    console.log(`
[${post.category}] ${tagEmoji}[${post.tag}] ${post.title}
要点:
• ${post.summary.what}
• ${post.summary.why}
• ${post.summary.action}
出典: ${post.url}
指標: like=${post.metrics.likes} rt=${post.metrics.retweets} reply=${post.metrics.replies} quote=${post.metrics.quotes}
日時: ${post.datetime}  著者: ${post.author}
${'─'.repeat(40)}`);
  }
}

function printStarList(posts: FormattedPost[]): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`#note-paid-ideas 用 [STAR] 一覧 (${posts.length}件)`);
  console.log('='.repeat(60));

  for (const post of posts) {
    console.log(`• ${post.title}`);
    console.log(`  ${post.url}`);
    console.log(`  理由: ${post.tag === 'STAR' ? '再現手順/テンプレ/具体例/数字あり' : ''}`);
    console.log();
  }
}

program.parse();
