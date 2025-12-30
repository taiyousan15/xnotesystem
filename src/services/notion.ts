import { Client } from '@notionhq/client';
import { ScoredTweet } from '../types/index.js';
import { logger } from '../utils/logger.js';

// Notion クライアント
let notionClient: Client | null = null;

/**
 * Notion クライアントを取得
 */
function getClient(): Client {
  if (notionClient) {
    return notionClient;
  }

  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) {
    throw new Error('NOTION_API_KEY is required');
  }

  notionClient = new Client({ auth: apiKey });
  return notionClient;
}

/**
 * データベースIDを取得
 */
function getDatabaseId(): string {
  const id = process.env.NOTION_DATABASE_ID;
  if (!id) {
    throw new Error('NOTION_DATABASE_ID is required');
  }
  return id;
}

/**
 * カテゴリを判定
 */
function categorize(content: string): string {
  const lower = content.toLowerCase();

  if (lower.includes('llm') || lower.includes('gpt') || lower.includes('claude') || lower.includes('gemini')) {
    return 'LLM';
  }
  if (lower.includes('agent') || lower.includes('エージェント')) {
    return 'AI';
  }
  if (lower.includes('tool') || lower.includes('ツール') || lower.includes('アプリ')) {
    return 'Tool';
  }
  if (lower.includes('発表') || lower.includes('リリース') || lower.includes('update')) {
    return 'News';
  }
  return 'Opinion';
}

/**
 * 投稿をNotionに保存
 */
export async function saveTweetToNotion(
  tweet: ScoredTweet,
  options: {
    isTopPick?: boolean;
    vipOnly?: boolean;
    noteStatus?: 'Unused' | 'Used' | 'Candidate';
    kindleStatus?: 'Unused' | 'Used' | 'Candidate';
  } = {}
): Promise<string | null> {
  const client = getClient();
  const databaseId = getDatabaseId();

  try {
    const response = await client.pages.create({
      parent: { database_id: databaseId },
      properties: {
        // Title: 投稿内容（先頭50文字）
        Title: {
          title: [
            {
              text: {
                content: tweet.content.slice(0, 50),
              },
            },
          ],
        },
        // Tweet ID
        'Tweet ID': {
          rich_text: [
            {
              text: {
                content: tweet.tweetId,
              },
            },
          ],
        },
        // Author
        Author: {
          rich_text: [
            {
              text: {
                content: `@${tweet.authorUsername}`,
              },
            },
          ],
        },
        // Score
        Score: {
          number: tweet.finalScore,
        },
        // Category
        Category: {
          select: {
            name: categorize(tweet.content),
          },
        },
        // Priority
        Priority: {
          checkbox: tweet.isPriority,
        },
        // Top Pick
        'Top Pick': {
          checkbox: options.isTopPick || false,
        },
        // Date
        Date: {
          date: {
            start: tweet.createdAt.toISOString().split('T')[0],
          },
        },
        // Note Status
        'Note Status': {
          select: {
            name: options.noteStatus || 'Unused',
          },
        },
        // Kindle Status
        'Kindle Status': {
          select: {
            name: options.kindleStatus || 'Unused',
          },
        },
        // VIP Only
        'VIP Only': {
          checkbox: options.vipOnly || false,
        },
      },
    });

    logger.info(`Saved to Notion: ${tweet.tweetId}`);
    return response.id;
  } catch (error) {
    logger.error(`Failed to save tweet ${tweet.tweetId} to Notion:`, error);
    return null;
  }
}

/**
 * 複数の投稿をNotionに保存
 */
export async function saveTweetsToNotion(
  tweets: ScoredTweet[],
  topPickIds: string[] = []
): Promise<{ saved: number; errors: number }> {
  let saved = 0;
  let errors = 0;

  for (const tweet of tweets) {
    const isTopPick = topPickIds.includes(tweet.tweetId);
    const result = await saveTweetToNotion(tweet, { isTopPick });

    if (result) {
      saved++;
    } else {
      errors++;
    }

    // レート制限対策
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  logger.info(`Notion sync completed: ${saved} saved, ${errors} errors`);
  return { saved, errors };
}

/**
 * Notionからトップピックを取得
 */
export async function getTopPicksFromNotion(): Promise<ScoredTweet[]> {
  const client = getClient();
  const databaseId = getDatabaseId();

  try {
    const response = await client.databases.query({
      database_id: databaseId,
      filter: {
        property: 'Top Pick',
        checkbox: {
          equals: true,
        },
      },
      sorts: [
        {
          property: 'Score',
          direction: 'descending',
        },
      ],
    });

    return response.results.map((page: any) => {
      const props = page.properties;
      return {
        tweetId: getTextContent(props['Tweet ID']),
        authorId: '',
        authorUsername: getTextContent(props['Author']).replace('@', ''),
        content: getTitleContent(props['Title']),
        createdAt: new Date(props['Date']?.date?.start || Date.now()),
        likeCount: 0,
        repostCount: 0,
        replyCount: 0,
        followerCount: 0,
        baseScore: 0,
        velocityScore: 0,
        efficiencyScore: 0,
        semanticScore: 0,
        finalScore: props['Score']?.number || 0,
        isPriority: props['Priority']?.checkbox || false,
      };
    });
  } catch (error) {
    logger.error('Failed to get top picks from Notion:', error);
    return [];
  }
}

/**
 * 未使用の投稿を取得
 */
export async function getUnusedFromNotion(
  type: 'note' | 'kindle',
  limit: number = 10
): Promise<ScoredTweet[]> {
  const client = getClient();
  const databaseId = getDatabaseId();

  const statusProperty = type === 'note' ? 'Note Status' : 'Kindle Status';

  try {
    const response = await client.databases.query({
      database_id: databaseId,
      filter: {
        property: statusProperty,
        select: {
          equals: 'Unused',
        },
      },
      sorts: [
        {
          property: 'Score',
          direction: 'descending',
        },
      ],
      page_size: limit,
    });

    return response.results.map((page: any) => {
      const props = page.properties;
      return {
        tweetId: getTextContent(props['Tweet ID']),
        authorId: '',
        authorUsername: getTextContent(props['Author']).replace('@', ''),
        content: getTitleContent(props['Title']),
        createdAt: new Date(props['Date']?.date?.start || Date.now()),
        likeCount: 0,
        repostCount: 0,
        replyCount: 0,
        followerCount: 0,
        baseScore: 0,
        velocityScore: 0,
        efficiencyScore: 0,
        semanticScore: 0,
        finalScore: props['Score']?.number || 0,
        isPriority: props['Priority']?.checkbox || false,
      };
    });
  } catch (error) {
    logger.error('Failed to get unused tweets from Notion:', error);
    return [];
  }
}

/**
 * ステータスを更新
 */
export async function updateNotionStatus(
  pageId: string,
  updates: {
    noteStatus?: 'Unused' | 'Used' | 'Candidate';
    kindleStatus?: 'Unused' | 'Used' | 'Candidate';
  }
): Promise<void> {
  const client = getClient();

  const properties: any = {};

  if (updates.noteStatus) {
    properties['Note Status'] = {
      select: { name: updates.noteStatus },
    };
  }

  if (updates.kindleStatus) {
    properties['Kindle Status'] = {
      select: { name: updates.kindleStatus },
    };
  }

  try {
    await client.pages.update({
      page_id: pageId,
      properties,
    });

    logger.info(`Updated Notion page: ${pageId}`);
  } catch (error) {
    logger.error(`Failed to update Notion page ${pageId}:`, error);
  }
}

/**
 * rich_text からテキストを取得
 */
function getTextContent(prop: any): string {
  if (!prop?.rich_text || prop.rich_text.length === 0) {
    return '';
  }
  return prop.rich_text[0]?.text?.content || '';
}

/**
 * title からテキストを取得
 */
function getTitleContent(prop: any): string {
  if (!prop?.title || prop.title.length === 0) {
    return '';
  }
  return prop.title[0]?.text?.content || '';
}

/**
 * 日次データをNotionに同期
 */
export async function syncDailyToNotion(
  tweets: ScoredTweet[],
  topPicks: ScoredTweet[]
): Promise<{ success: boolean; synced: number }> {
  try {
    const topPickIds = topPicks.map((t) => t.tweetId);
    const result = await saveTweetsToNotion(tweets, topPickIds);
    return { success: true, synced: result.saved };
  } catch (error) {
    logger.error('Failed to sync daily data to Notion:', error);
    return { success: false, synced: 0 };
  }
}

/**
 * AIニュース収集データをNotionに保存（ai-news-collect.ts用）
 */
interface AINewsPost {
  category: string;
  tag: string;
  title: string;
  url: string;
  metrics: {
    likes: number;
    retweets: number;
    replies: number;
    quotes: number;
  };
  datetime: string;
  author: string;
  raw: {
    id: string;
    authorUsername: string;
    content: string;
    createdAt: string;
    isBreaking: boolean;
  };
}

export async function saveTweetsToNotionFromAINews(
  posts: AINewsPost[],
  topPickIds: string[] = [],
  starIds: string[] = []
): Promise<{ saved: number; errors: number }> {
  const client = getClient();
  const databaseId = getDatabaseId();

  let saved = 0;
  let errors = 0;

  for (const post of posts) {
    const isTopPick = topPickIds.includes(post.raw.id);
    const isStar = starIds.includes(post.raw.id);

    try {
      await client.pages.create({
        parent: { database_id: databaseId },
        properties: {
          Title: {
            title: [{ text: { content: post.title.slice(0, 50) } }],
          },
          'Tweet ID': {
            rich_text: [{ text: { content: post.raw.id } }],
          },
          Author: {
            rich_text: [{ text: { content: post.author } }],
          },
          Score: {
            number: post.metrics.likes + post.metrics.retweets * 2,
          },
          Category: {
            select: { name: mapCategory(post.category) },
          },
          Priority: {
            checkbox: false,
          },
          'Top Pick': {
            checkbox: isTopPick,
          },
          Date: {
            date: { start: post.datetime.split(' ')[0] },
          },
          'Note Status': {
            select: { name: isStar ? 'Candidate' : 'Unused' },
          },
          'Kindle Status': {
            select: { name: 'Unused' },
          },
          'VIP Only': {
            checkbox: false,
          },
        },
      });

      saved++;
    } catch (error) {
      logger.error(`Failed to save post ${post.raw.id} to Notion:`, error);
      errors++;
    }

    // レート制限対策
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  logger.info(`Notion sync completed: ${saved} saved, ${errors} errors`);
  return { saved, errors };
}

/**
 * カテゴリをNotionのセレクトオプションにマッピング
 */
function mapCategory(category: string): string {
  const mapping: Record<string, string> = {
    'NEWS': 'News',
    'RESEARCH': 'AI',
    'TOOL': 'Tool',
    'DEV': 'Tool',
    'OPS': 'Tool',
    'BIZ': 'Opinion',
    'POLICY': 'Opinion',
    'SECURITY': 'Tool',
    'JP': 'News',
  };
  return mapping[category] || 'Opinion';
}

/**
 * 週次まとめをNotionページとして保存
 */
export async function saveWeeklySummaryToNotion(
  title: string,
  content: string,
  date: string,
  type: 'tuesday' | 'friday'
): Promise<string | null> {
  const client = getClient();

  // 週次まとめ用の親ページID（環境変数から取得、なければデフォルトのDBに保存）
  const parentPageId = process.env.NOTION_WEEKLY_PARENT_ID;

  try {
    const response = await client.pages.create({
      parent: parentPageId
        ? { page_id: parentPageId }
        : { database_id: getDatabaseId() },
      properties: parentPageId
        ? {
            title: {
              title: [{ text: { content: title } }],
            },
          }
        : {
            Title: {
              title: [{ text: { content: title } }],
            },
            'Tweet ID': {
              rich_text: [{ text: { content: `weekly_${type}_${date}` } }],
            },
            Author: {
              rich_text: [{ text: { content: '@system' } }],
            },
            Score: { number: 100 },
            Category: { select: { name: 'News' } },
            Priority: { checkbox: true },
            'Top Pick': { checkbox: true },
            Date: { date: { start: date } },
            'Note Status': { select: { name: type === 'friday' ? 'Used' : 'Unused' } },
            'Kindle Status': { select: { name: 'Unused' } },
            'VIP Only': { checkbox: true },
          },
      children: splitContentToBlocks(content),
    });

    logger.info(`Weekly summary saved to Notion: ${response.id}`);
    return response.id;
  } catch (error) {
    logger.error('Failed to save weekly summary to Notion:', error);
    return null;
  }
}

/**
 * コンテンツをNotionブロックに分割
 */
function splitContentToBlocks(content: string): any[] {
  const blocks: any[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    if (line.startsWith('# ')) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{ type: 'text', text: { content: line.slice(2) } }],
        },
      });
    } else if (line.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: line.slice(3) } }],
        },
      });
    } else if (line.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: line.slice(4) } }],
        },
      });
    } else if (line.startsWith('- ')) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{ type: 'text', text: { content: line.slice(2) } }],
        },
      });
    } else if (line.trim()) {
      // Notionのrich_textは2000文字制限があるため分割
      const chunks = chunkString(line, 2000);
      for (const chunk of chunks) {
        blocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: chunk } }],
          },
        });
      }
    }
  }

  // Notion APIは100ブロックまでしか一度に送れない
  return blocks.slice(0, 100);
}

/**
 * 文字列を指定長で分割
 */
function chunkString(str: string, length: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < str.length; i += length) {
    chunks.push(str.slice(i, i + length));
  }
  return chunks;
}
