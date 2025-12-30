#!/usr/bin/env tsx
/**
 * Discord表示形式テスト
 * A: トップ10件表示
 * B: カテゴリ別分類
 * C: レポート形式
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
}

interface DiscordWebhookPayload {
  content?: string;
  embeds?: DiscordEmbed[];
}

async function sendWebhook(payload: DiscordWebhookPayload): Promise<boolean> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_GENERAL;
  if (!webhookUrl) {
    throw new Error('DISCORD_WEBHOOK_GENERAL is not set');
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
 * パターンA: トップ10件をシンプルに表示
 */
async function sendPatternA(tweets: ScoredTweet[]): Promise<void> {
  const top10 = tweets.slice(0, 10);

  const tweetList = top10
    .map((t, i) => {
      const link = `https://x.com/${t.authorUsername}/status/${t.tweetId}`;
      const score = t.finalScore.toFixed(0);
      return `**${i + 1}.** [@${t.authorUsername}](${link}) (スコア: ${score})\n${t.content.slice(0, 100)}...`;
    })
    .join('\n\n');

  const payload: DiscordWebhookPayload = {
    embeds: [
      {
        title: '【パターンA】トップ10件表示',
        description: `本日の注目投稿トップ10をお届けします。\n\n${tweetList}`,
        color: 0x1da1f2,
        footer: { text: 'AI Trend Collector - Pattern A Test' },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  await sendWebhook(payload);
  logger.info('パターンA送信完了');
}

/**
 * パターンB: カテゴリ別分類
 */
async function sendPatternB(tweets: ScoredTweet[]): Promise<void> {
  // キーワードでカテゴリ分類
  const categories: Record<string, ScoredTweet[]> = {
    '🤖 AI製品・サービス': [],
    '🔬 研究・論文': [],
    '🛠️ ツール・API': [],
    '💡 Tips・ノウハウ': [],
    '📰 ニュース・発表': [],
  };

  const top20 = tweets.slice(0, 20);

  for (const tweet of top20) {
    const content = tweet.content.toLowerCase();
    if (content.includes('paper') || content.includes('research') || content.includes('論文')) {
      categories['🔬 研究・論文'].push(tweet);
    } else if (content.includes('api') || content.includes('tool') || content.includes('sdk')) {
      categories['🛠️ ツール・API'].push(tweet);
    } else if (content.includes('tip') || content.includes('how to') || content.includes('方法')) {
      categories['💡 Tips・ノウハウ'].push(tweet);
    } else if (content.includes('release') || content.includes('announce') || content.includes('launch') || content.includes('発表')) {
      categories['📰 ニュース・発表'].push(tweet);
    } else {
      categories['🤖 AI製品・サービス'].push(tweet);
    }
  }

  const fields = Object.entries(categories)
    .filter(([_, tweets]) => tweets.length > 0)
    .map(([category, categoryTweets]) => {
      const list = categoryTweets.slice(0, 3).map(t => {
        const link = `https://x.com/${t.authorUsername}/status/${t.tweetId}`;
        return `• [@${t.authorUsername}](${link}): ${t.content.slice(0, 60)}...`;
      }).join('\n');
      return { name: `${category} (${categoryTweets.length}件)`, value: list || 'なし' };
    });

  const payload: DiscordWebhookPayload = {
    embeds: [
      {
        title: '【パターンB】カテゴリ別分類',
        description: '本日のAI関連投稿をカテゴリ別に整理しました。',
        color: 0x00ff00,
        fields,
        footer: { text: 'AI Trend Collector - Pattern B Test' },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  await sendWebhook(payload);
  logger.info('パターンB送信完了');
}

/**
 * パターンC: レポート形式
 */
async function sendPatternC(tweets: ScoredTweet[], totalCollected: number): Promise<void> {
  const top5 = tweets.slice(0, 5);

  // 統計情報
  const avgScore = tweets.reduce((sum, t) => sum + t.finalScore, 0) / tweets.length;
  const highScoreCount = tweets.filter(t => t.finalScore >= 80).length;
  const priorityCount = tweets.filter(t => t.isPriority).length;

  // トップアカウント
  const authorCounts: Record<string, number> = {};
  for (const t of tweets.slice(0, 50)) {
    authorCounts[t.authorUsername] = (authorCounts[t.authorUsername] || 0) + 1;
  }
  const topAuthors = Object.entries(authorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => `@${name} (${count}件)`)
    .join(', ');

  // 注目投稿リスト
  const highlights = top5.map((t, i) => {
    const link = `https://x.com/${t.authorUsername}/status/${t.tweetId}`;
    return `${i + 1}. [@${t.authorUsername}](${link})\n   ${t.content.slice(0, 80)}...`;
  }).join('\n\n');

  const payload: DiscordWebhookPayload = {
    embeds: [
      {
        title: '【パターンC】📊 日次AIトレンドレポート',
        description: `**収集概要**\n本日 **${totalCollected}件** の投稿を収集・分析しました。`,
        color: 0xff9900,
        fields: [
          {
            name: '📈 統計サマリー',
            value: `• 平均スコア: **${avgScore.toFixed(1)}**\n• 高スコア投稿(80+): **${highScoreCount}件**\n• 優先インフルエンサー: **${priorityCount}件**`,
            inline: true,
          },
          {
            name: '👥 注目アカウント',
            value: topAuthors || 'なし',
            inline: true,
          },
          {
            name: '🔥 本日のハイライト',
            value: highlights,
          },
        ],
        footer: { text: 'AI Trend Collector - Pattern C Test' },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  await sendWebhook(payload);
  logger.info('パターンC送信完了');
}

async function main() {
  const inputPath = process.argv[2] || 'data/scored_2025-12-19.json';

  logger.info('Discord表示形式テストを開始します');
  logger.info(`入力ファイル: ${inputPath}`);

  // データ読み込み
  const data = JSON.parse(readFileSync(inputPath, 'utf-8'));
  const allTweets: ScoredTweet[] = data.allTweets || [];
  const totalCollected = allTweets.length;

  // スコア順にソート
  const sortedTweets = [...allTweets].sort((a, b) => b.finalScore - a.finalScore);

  logger.info(`読み込み完了: ${totalCollected}件`);
  logger.info('');

  // 3パターンを順番に送信（間隔を空ける）
  logger.info('パターンA（トップ10件）を送信中...');
  await sendPatternA(sortedTweets);
  await new Promise(r => setTimeout(r, 2000));

  logger.info('パターンB（カテゴリ別）を送信中...');
  await sendPatternB(sortedTweets);
  await new Promise(r => setTimeout(r, 2000));

  logger.info('パターンC（レポート形式）を送信中...');
  await sendPatternC(sortedTweets, totalCollected);

  logger.info('');
  logger.info('✅ 3パターンすべて送信完了！Discordを確認してください。');
}

main().catch(console.error);
