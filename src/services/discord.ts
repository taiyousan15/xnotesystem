import { ScoredTweet, DiscordChannelType, DiscordMessageType } from '../types/index.js';
import { logger } from '../utils/logger.js';

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

/**
 * Discord Webhookにメッセージを送信
 */
async function sendWebhook(
  webhookUrl: string,
  payload: DiscordWebhookPayload
): Promise<boolean> {
  try {
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
  } catch (error) {
    logger.error('Discord webhook error:', error);
    return false;
  }
}

/**
 * チャンネルタイプからWebhook URLを取得
 */
function getWebhookUrl(channel: DiscordChannelType): string {
  const envKey = channel === 'vip' ? 'DISCORD_WEBHOOK_VIP' : 'DISCORD_WEBHOOK_GENERAL';
  const url = process.env[envKey];

  if (!url) {
    throw new Error(`${envKey} is not set`);
  }

  return url;
}

/**
 * 一般向け日次トレンド要約を送信
 */
export async function sendGeneralDailySummary(
  topTweets: ScoredTweet[],
  totalCollected: number
): Promise<boolean> {
  const webhookUrl = getWebhookUrl('general');

  // 各投稿にリンク付きで表示
  const trendSummary = topTweets
    .slice(0, 5)
    .map((t, i) => {
      const link = `https://x.com/${t.authorUsername}/status/${t.tweetId}`;
      return `**${i + 1}. [@${t.authorUsername}](${link})**\n${t.content.slice(0, 80)}...`;
    })
    .join('\n\n');

  const payload: DiscordWebhookPayload = {
    embeds: [
      {
        title: '📊 本日のAIトレンド要約',
        description: `本日 ${totalCollected} 件の投稿を収集・分析しました。`,
        color: 0x1da1f2,
        fields: [
          {
            name: '🔥 注目トピック',
            value: trendSummary || 'データなし',
          },
        ],
        footer: { text: 'AI Trend Collector' },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  logger.info('Sending general daily summary...');
  return sendWebhook(webhookUrl, payload);
}

/**
 * VIP向け日次重要投稿を送信
 */
export async function sendVipDailyPicks(
  topPicks: ScoredTweet[]
): Promise<boolean> {
  const webhookUrl = getWebhookUrl('vip');

  const embeds: DiscordEmbed[] = [
    {
      title: '🌟 VIP限定：本日の重要投稿',
      description: `厳選された ${topPicks.length} 件の重要投稿をお届けします。`,
      color: 0xffd700,
      timestamp: new Date().toISOString(),
    },
  ];

  // 各投稿を個別のembedで追加
  for (const tweet of topPicks) {
    embeds.push({
      title: `@${tweet.authorUsername}`,
      description: tweet.content,
      color: tweet.isPriority ? 0xff6b6b : 0x4ecdc4,
      fields: [
        {
          name: 'スコア',
          value: `${tweet.finalScore.toFixed(1)}`,
          inline: true,
        },
        {
          name: 'エンゲージメント',
          value: `❤️ ${tweet.likeCount} | 🔁 ${tweet.repostCount} | 💬 ${tweet.replyCount}`,
          inline: true,
        },
        {
          name: 'リンク',
          value: `https://x.com/${tweet.authorUsername}/status/${tweet.tweetId}`,
        },
      ],
    });
  }

  const payload: DiscordWebhookPayload = { embeds };

  logger.info('Sending VIP daily picks...');
  return sendWebhook(webhookUrl, payload);
}

/**
 * 週次Kindle告知を送信
 */
export async function sendWeeklyKindleAnnouncement(
  weekNumber: number,
  kindleUrl?: string
): Promise<boolean> {
  const webhookUrl = getWebhookUrl('general');

  const payload: DiscordWebhookPayload = {
    embeds: [
      {
        title: '📚 週刊AIトレンド Kindle版 公開',
        description: `第${weekNumber}週のKindle版が公開されました！`,
        color: 0xff9900,
        fields: kindleUrl
          ? [{ name: 'リンク', value: kindleUrl }]
          : [],
        footer: { text: 'AI Trend Collector' },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  logger.info('Sending weekly Kindle announcement...');
  return sendWebhook(webhookUrl, payload);
}

/**
 * 日次配信を実行
 */
export async function distributeDaily(
  topPicks: ScoredTweet[],
  totalCollected: number
): Promise<{ general: boolean; vip: boolean }> {
  const [generalResult, vipResult] = await Promise.all([
    sendGeneralDailySummary(topPicks, totalCollected),
    sendVipDailyPicks(topPicks),
  ]);

  return { general: generalResult, vip: vipResult };
}
