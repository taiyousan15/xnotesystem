/**
 * Notion Page Builder Service
 * ツイートページの本文コンテンツを構築
 */

import { AnalyzedTweet, Topic, DigestStats, LLMCategory, ContentType } from '../types/digest.js';

// Notion Block Types
type NotionBlock = {
  object: 'block';
  type: string;
  [key: string]: any;
};

/**
 * テキストをrich_text形式に変換
 */
function text(content: string, options?: { bold?: boolean; italic?: boolean; code?: boolean; link?: string }): any {
  const textObj: any = {
    type: 'text',
    text: { content: content.slice(0, 2000) }, // 2000文字制限
  };

  if (options?.link) {
    textObj.text.link = { url: options.link };
  }

  if (options?.bold || options?.italic || options?.code) {
    textObj.annotations = {
      bold: options?.bold || false,
      italic: options?.italic || false,
      code: options?.code || false,
    };
  }

  return textObj;
}

/**
 * 見出し1ブロック
 */
function heading1(content: string): NotionBlock {
  return {
    object: 'block',
    type: 'heading_1',
    heading_1: {
      rich_text: [text(content)],
    },
  };
}

/**
 * 見出し2ブロック
 */
function heading2(content: string): NotionBlock {
  return {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [text(content)],
    },
  };
}

/**
 * 見出し3ブロック
 */
function heading3(content: string): NotionBlock {
  return {
    object: 'block',
    type: 'heading_3',
    heading_3: {
      rich_text: [text(content)],
    },
  };
}

/**
 * 段落ブロック
 */
function paragraph(richTexts: any[]): NotionBlock {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: richTexts,
    },
  };
}

/**
 * 箇条書きブロック
 */
function bulletItem(content: string): NotionBlock {
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [text(content)],
    },
  };
}

/**
 * 番号付きリストブロック
 */
function numberedItem(content: string): NotionBlock {
  return {
    object: 'block',
    type: 'numbered_list_item',
    numbered_list_item: {
      rich_text: [text(content)],
    },
  };
}

/**
 * コールアウトブロック
 */
function callout(content: string, emoji: string = '💡'): NotionBlock {
  return {
    object: 'block',
    type: 'callout',
    callout: {
      rich_text: [text(content)],
      icon: { emoji },
    },
  };
}

/**
 * 区切り線ブロック
 */
function divider(): NotionBlock {
  return {
    object: 'block',
    type: 'divider',
    divider: {},
  };
}

/**
 * ブックマークブロック
 */
function bookmark(url: string): NotionBlock {
  return {
    object: 'block',
    type: 'bookmark',
    bookmark: {
      url,
    },
  };
}

/**
 * コードブロック
 */
function codeBlock(content: string, language: string = 'plain text'): NotionBlock {
  return {
    object: 'block',
    type: 'code',
    code: {
      rich_text: [text(content)],
      language,
    },
  };
}

/**
 * 引用ブロック
 */
function quote(content: string): NotionBlock {
  return {
    object: 'block',
    type: 'quote',
    quote: {
      rich_text: [text(content)],
    },
  };
}

/**
 * テーブルブロック（2列）
 */
function table2Cols(rows: [string, string][]): NotionBlock[] {
  const blocks: NotionBlock[] = [];

  // テーブル本体
  const tableBlock: any = {
    object: 'block',
    type: 'table',
    table: {
      table_width: 2,
      has_column_header: false,
      has_row_header: true,
      children: rows.map(([col1, col2]) => ({
        object: 'block',
        type: 'table_row',
        table_row: {
          cells: [
            [text(col1, { bold: true })],
            [text(col2)],
          ],
        },
      })),
    },
  };

  blocks.push(tableBlock);
  return blocks;
}

/**
 * ツイートページの本文を構築
 */
export function buildTweetPageContent(tweet: AnalyzedTweet): NotionBlock[] {
  const blocks: NotionBlock[] = [];

  // === 基本情報 ===
  blocks.push(heading2('📝 投稿情報'));

  // X原文
  blocks.push(quote(tweet.content));

  // メタ情報テーブル
  blocks.push(...table2Cols([
    ['投稿者', `@${tweet.authorUsername}`],
    ['投稿日時', tweet.createdAt],
    ['Tweet URL', tweet.url],
    ['Type', tweet.analysis.type],
    ['Category', tweet.analysis.category],
    ['Score', `${tweet.analysis.score}/100`],
  ]));

  blocks.push(divider());

  // === タグ・トピック ===
  blocks.push(heading2('🏷️ タグ・トピック'));

  // タグ
  if (tweet.analysis.tags.length > 0) {
    blocks.push(paragraph([
      text('Tags: ', { bold: true }),
      text(tweet.analysis.tags.join(' ')),
    ]));
  }

  // トピック
  if (tweet.topicKey && tweet.topicLabel) {
    blocks.push(paragraph([
      text('Topic: ', { bold: true }),
      text(`${tweet.topicLabel} (${tweet.topicKey})`),
    ]));
  }

  blocks.push(divider());

  // === LLM解析結果 ===
  blocks.push(heading2('🤖 AI解析'));

  // 要約箇条書き
  if (tweet.analysis.summaryBulletsJa.length > 0) {
    blocks.push(heading3('要約'));
    for (const bullet of tweet.analysis.summaryBulletsJa) {
      blocks.push(bulletItem(bullet));
    }
  }

  // 洞察
  if (tweet.analysis.insightJa) {
    blocks.push(heading3('洞察'));
    blocks.push(callout(tweet.analysis.insightJa, '💡'));
  }

  // 選定理由（Top Pickの場合）
  if (tweet.isTopPick && tweet.whySelected) {
    blocks.push(heading3('選定理由'));
    blocks.push(callout(tweet.whySelected, '⭐'));
  }

  blocks.push(divider());

  // === リンク解析 ===
  if (tweet.links && tweet.links.length > 0) {
    blocks.push(heading2('🔗 リンク解析'));

    for (const link of tweet.links) {
      if (link.error) {
        blocks.push(paragraph([
          text(`${link.originalUrl} `, { link: link.originalUrl }),
          text(`(${link.error})`, { italic: true }),
        ]));
        continue;
      }

      // リンクタイトル
      if (link.title) {
        blocks.push(paragraph([
          text(link.title, { bold: true }),
        ]));
      }

      // ブックマーク
      blocks.push(bookmark(link.canonicalUrl || link.originalUrl));

      // サマリー
      if (link.summary) {
        blocks.push(paragraph([text(link.summary)]));
      }

      // ドメイン
      blocks.push(paragraph([
        text(`Domain: ${link.domain}`, { italic: true }),
      ]));
    }

    blocks.push(divider());
  }

  // === エンゲージメント ===
  blocks.push(heading2('📊 エンゲージメント'));

  blocks.push(...table2Cols([
    ['いいね', String(tweet.likes)],
    ['リツイート', String(tweet.retweets)],
    ['リプライ', String(tweet.replies)],
    ['引用', String(tweet.quotes)],
    ['統合スコア', String(tweet.combinedScore)],
  ]));

  return blocks.slice(0, 100); // 100ブロック制限
}

/**
 * 日次ダイジェストページの本文を構築
 */
export function buildDigestPageContent(
  date: string,
  stats: DigestStats,
  topics: Topic[],
  topPicks: AnalyzedTweet[],
  notionDbViewUrl: string
): NotionBlock[] {
  const blocks: NotionBlock[] = [];

  // === ヘッダー ===
  blocks.push(heading1(`📰 Daily AI Digest ${date}`));

  // === 統計サマリー ===
  blocks.push(heading2('📊 本日の統計'));

  blocks.push(...table2Cols([
    ['収集件数', `${stats.totalCount}件`],
    ['Top Pick', `${stats.topPickCount}件`],
    ['平均スコア', `${stats.averageScore.toFixed(1)}`],
  ]));

  // カテゴリ分布
  blocks.push(heading3('カテゴリ分布'));
  const categoryEntries = Object.entries(stats.categoryDistribution)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  for (const [category, count] of categoryEntries) {
    blocks.push(bulletItem(`${category}: ${count}件`));
  }

  // タイプ分布
  blocks.push(heading3('タイプ分布'));
  const typeEntries = Object.entries(stats.typeDistribution)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  for (const [type, count] of typeEntries) {
    blocks.push(bulletItem(`${type}: ${count}件`));
  }

  blocks.push(divider());

  // === トピック一覧 ===
  blocks.push(heading2('🗂️ 今日のトピック'));

  for (const topic of topics.slice(0, 10)) {
    blocks.push(heading3(`${topic.label} (${topic.tweetCount}件)`));
    blocks.push(paragraph([text(topic.summary)]));
  }

  blocks.push(divider());

  // === Top Picks ===
  blocks.push(heading2('⭐ Top Picks'));

  for (let i = 0; i < Math.min(topPicks.length, 10); i++) {
    const tweet = topPicks[i];
    blocks.push(heading3(`${i + 1}. ${tweet.analysis.titleJa}`));

    // 要約
    if (tweet.analysis.summaryBulletsJa.length > 0) {
      for (const bullet of tweet.analysis.summaryBulletsJa.slice(0, 2)) {
        blocks.push(bulletItem(bullet));
      }
    }

    // リンク
    blocks.push(paragraph([
      text('@' + tweet.authorUsername + ' | '),
      text('Tweet', { link: tweet.url }),
      text(` | Score: ${tweet.analysis.score}`),
    ]));
  }

  blocks.push(divider());

  // === 全件リンク ===
  blocks.push(heading2('📁 全件データ'));
  blocks.push(paragraph([
    text('データベースビュー: ', { bold: true }),
    text('AI Tweets DB', { link: notionDbViewUrl }),
  ]));

  return blocks.slice(0, 100);
}

/**
 * Top 5 サマリー（Discord用）を構築
 */
export function buildTop5Summary(topPicks: AnalyzedTweet[]): string {
  const lines: string[] = [];
  lines.push('## ⭐ Top 5 AI News\n');

  for (let i = 0; i < Math.min(topPicks.length, 5); i++) {
    const tweet = topPicks[i];
    lines.push(`### ${i + 1}. ${tweet.analysis.titleJa}`);

    // 要約
    if (tweet.analysis.summaryBulletsJa.length > 0) {
      for (const bullet of tweet.analysis.summaryBulletsJa.slice(0, 2)) {
        lines.push(`- ${bullet}`);
      }
    }

    // メタ情報
    lines.push(`📊 Score: ${tweet.analysis.score} | 🏷️ ${tweet.analysis.category}`);
    lines.push(`🔗 ${tweet.url}\n`);
  }

  return lines.join('\n');
}

/**
 * トピックサマリー（Discord用）を構築
 */
export function buildTopicSummary(topics: Topic[]): string {
  const lines: string[] = [];
  lines.push('## 🗂️ 今日のトピック\n');

  for (const topic of topics.slice(0, 8)) {
    lines.push(`**${topic.label}** (${topic.tweetCount}件)`);
    lines.push(`└ ${topic.summary}`);
  }

  return lines.join('\n');
}

/**
 * 統計サマリー（Discord用）を構築
 */
export function buildStatsSummary(stats: DigestStats): string {
  const lines: string[] = [];
  lines.push('## 📊 本日の統計\n');

  lines.push(`- 収集件数: ${stats.totalCount}件`);
  lines.push(`- Top Pick: ${stats.topPickCount}件`);
  lines.push(`- 平均スコア: ${stats.averageScore.toFixed(1)}`);

  // カテゴリ上位3
  const topCategories = Object.entries(stats.categoryDistribution)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  lines.push('\n**カテゴリ上位:**');
  for (const [cat, count] of topCategories) {
    lines.push(`- ${cat}: ${count}件`);
  }

  return lines.join('\n');
}
