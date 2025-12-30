#!/usr/bin/env tsx
/**
 * VIP向け週2回配信フォーマットテスト
 * 120万円VIP会員向けのプレミアム配信フォーマット
 * 配信日: 火曜・金曜
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import { logger } from '../utils/logger.js';
import { ScoredTweet } from '../types/index.js';

interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
  author?: { name: string; icon_url?: string };
}

interface DiscordWebhookPayload {
  content?: string;
  embeds?: DiscordEmbed[];
}

// プレミアムカラー
const COLORS = {
  GOLD: 0xFFD700,
  PLATINUM: 0xE5E4E2,
  ROYAL_BLUE: 0x4169E1,
  ACCENT: 0x00CED1,
};

// --general オプションで一般チャンネルにテスト送信
const useGeneralChannel = process.argv.includes('--general');

async function sendWebhook(payload: DiscordWebhookPayload): Promise<boolean> {
  const envKey = useGeneralChannel ? 'DISCORD_WEBHOOK_GENERAL' : 'DISCORD_WEBHOOK_VIP';
  const webhookUrl = process.env[envKey];
  if (!webhookUrl) {
    throw new Error(`${envKey} is not set. Use --general to test with general channel.`);
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    logger.error(`Discord webhook failed: ${response.status}`);
    return false;
  }
  return true;
}

/**
 * RTを除外したオリジナル投稿のみフィルタ
 */
function filterOriginalTweets(tweets: ScoredTweet[]): ScoredTweet[] {
  return tweets.filter(t => !t.content.startsWith('RT @'));
}

/**
 * 配信曜日を判定（火曜=前半、金曜=後半）
 */
function getDeliveryType(): '前半' | '後半' {
  const day = new Date().getDay();
  // 0=日, 1=月, 2=火, 3=水, 4=木, 5=金, 6=土
  if (day === 2) return '前半';
  if (day === 5) return '後半';
  // テスト用：それ以外の日は前半扱い
  return '前半';
}

/**
 * 日付をフォーマット
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const weekday = weekdays[date.getDay()];
  return `${year}.${month}.${day}（${weekday}）`;
}

/**
 * 週番号を取得
 */
function getWeekNumber(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = now.getTime() - start.getTime();
  const oneWeek = 604800000;
  return Math.ceil(diff / oneWeek);
}

/**
 * 編集部コメントを生成（仮実装）
 */
function generateEditorComment(tweet: ScoredTweet): string {
  const comments: string[] = [];

  if (tweet.isPriority) {
    comments.push('✦ 優先インフルエンサーからの発信');
  }

  if (tweet.semanticScore >= 80) {
    comments.push('技術的価値が高く、実務への応用が期待できます');
  } else if (tweet.semanticScore >= 60) {
    comments.push('注目度の高いトピックです');
  }

  if (tweet.likeCount >= 1000) {
    comments.push(`高エンゲージメント（${tweet.likeCount.toLocaleString()}いいね）`);
  }

  if (tweet.velocityScore >= 100) {
    comments.push('急速に拡散中の投稿です');
  }

  return comments.length > 0
    ? comments.join('。') + '。'
    : '今週の注目投稿としてピックアップしました。';
}

/**
 * 注目キーワードを抽出
 */
function extractKeywords(tweets: ScoredTweet[]): string[] {
  const keywords: Record<string, number> = {};
  const targetKeywords = [
    'GPT-4', 'GPT-5', 'Claude', 'Gemini', 'ChatGPT',
    'AI Agent', 'LLM', 'OpenAI', 'Anthropic', 'Google',
    'Sora', 'DALL-E', 'Midjourney', 'API', 'プロンプト'
  ];

  for (const tweet of tweets) {
    for (const kw of targetKeywords) {
      if (tweet.content.toLowerCase().includes(kw.toLowerCase())) {
        keywords[kw] = (keywords[kw] || 0) + 1;
      }
    }
  }

  return Object.entries(keywords)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([kw]) => kw);
}

/**
 * VIP週次レポート - ヘッダー部分
 */
async function sendHeader(
  totalCollected: number,
  topKeywords: string[],
  deliveryType: string,
  weekNumber: number
): Promise<void> {
  const today = formatDate(new Date());

  const payload: DiscordWebhookPayload = {
    embeds: [
      {
        title: `🔷 VIP限定 AIトレンドレポート`,
        description: [
          `**Vol.${weekNumber} ｜ ${today}**`,
          `━━━━━━━━━━━━━━━━━━━━━━━━`,
          ``,
          `📊 **今週${deliveryType}の概況**`,
          `• 収集: **${totalCollected}件** → 厳選: **5件**`,
          `• 注目キーワード: ${topKeywords.join(', ') || 'なし'}`,
        ].join('\n'),
        color: COLORS.GOLD,
        footer: { text: 'VIP Exclusive Report' },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  await sendWebhook(payload);
}

/**
 * VIP週次レポート - 厳選ピックアップ
 */
async function sendPickups(tweets: ScoredTweet[]): Promise<void> {
  const embeds: DiscordEmbed[] = [
    {
      title: '🏆 厳選ピックアップ',
      description: '編集部が選んだ今週の重要投稿',
      color: COLORS.PLATINUM,
    },
  ];

  for (let i = 0; i < Math.min(tweets.length, 5); i++) {
    const tweet = tweets[i];
    const link = `https://x.com/${tweet.authorUsername}/status/${tweet.tweetId}`;
    const editorComment = generateEditorComment(tweet);

    // 投稿内容を適切な長さに
    const content = tweet.content.length > 200
      ? tweet.content.slice(0, 200) + '...'
      : tweet.content;

    embeds.push({
      author: {
        name: `【${i + 1}】@${tweet.authorUsername}${tweet.isPriority ? ' ⭐' : ''}`,
      },
      description: [
        `>>> ${content}`,
        ``,
        `💡 **編集部コメント**`,
        editorComment,
        ``,
        `❤️ ${tweet.likeCount.toLocaleString()} | 🔁 ${tweet.repostCount.toLocaleString()} | 💬 ${tweet.replyCount.toLocaleString()}`,
        `📊 スコア: **${tweet.finalScore.toFixed(1)}**`,
        `🔗 [投稿を見る](${link})`,
      ].join('\n'),
      color: tweet.isPriority ? COLORS.GOLD : COLORS.ROYAL_BLUE,
    });
  }

  // Discordは10 embeds/メッセージまで
  const payload: DiscordWebhookPayload = { embeds };
  await sendWebhook(payload);
}

/**
 * VIP週次レポート - 編集部の見解
 */
async function sendEditorInsight(tweets: ScoredTweet[], topKeywords: string[]): Promise<void> {
  // 統計情報
  const avgScore = tweets.slice(0, 20).reduce((sum, t) => sum + t.finalScore, 0) / 20;
  const priorityCount = tweets.filter(t => t.isPriority).length;

  // 見解を生成（実際はLLMで生成するが、ここではテンプレート）
  const insight = topKeywords.length > 0
    ? `今週は**${topKeywords[0]}**関連の情報が集中しています。` +
      `上位投稿の平均スコアは${avgScore.toFixed(1)}と${avgScore >= 70 ? '高水準' : '標準的'}で、` +
      `優先インフルエンサーからの投稿は${priorityCount}件ありました。` +
      `引き続き動向を注視していきます。`
    : `今週の動向をまとめてお届けしました。`;

  const payload: DiscordWebhookPayload = {
    embeds: [
      {
        title: '📝 編集部の見解',
        description: insight,
        color: COLORS.ACCENT,
        footer: { text: '次回配信をお楽しみに' },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  await sendWebhook(payload);
}

/**
 * メイン実行
 */
async function main() {
  // 引数からオプションを除外してファイルパスを取得
  const args = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
  const inputPath = args[0] || 'data/scored_2025-12-19.json';

  logger.info('═══════════════════════════════════════');
  logger.info('VIP週次レポート配信テスト');
  logger.info('═══════════════════════════════════════');
  logger.info(`入力ファイル: ${inputPath}`);

  // データ読み込み
  const data = JSON.parse(readFileSync(inputPath, 'utf-8'));
  const allTweets: ScoredTweet[] = data.allTweets || [];
  const totalCollected = allTweets.length;

  // RTを除外してスコア順ソート
  const originalTweets = filterOriginalTweets(allTweets);
  const sortedTweets = [...originalTweets].sort((a, b) => b.finalScore - a.finalScore);

  logger.info(`総収集数: ${totalCollected}件`);
  logger.info(`オリジナル投稿: ${originalTweets.length}件（RT除外後）`);
  logger.info('');

  // 配信情報
  const deliveryType = getDeliveryType();
  const weekNumber = getWeekNumber();
  const topKeywords = extractKeywords(sortedTweets.slice(0, 50));

  logger.info(`配信タイプ: 今週${deliveryType}`);
  logger.info(`週番号: Vol.${weekNumber}`);
  logger.info(`注目キーワード: ${topKeywords.join(', ')}`);
  logger.info('');

  // 順次送信
  logger.info('1/3 ヘッダー送信中...');
  await sendHeader(totalCollected, topKeywords, deliveryType, weekNumber);
  await new Promise(r => setTimeout(r, 1500));

  logger.info('2/3 厳選ピックアップ送信中...');
  await sendPickups(sortedTweets);
  await new Promise(r => setTimeout(r, 1500));

  logger.info('3/3 編集部の見解送信中...');
  await sendEditorInsight(sortedTweets, topKeywords);

  logger.info('');
  logger.info('═══════════════════════════════════════');
  logger.info('✅ VIP週次レポート配信完了！');
  logger.info('   Discordを確認してください。');
  logger.info('═══════════════════════════════════════');
}

main().catch(console.error);
