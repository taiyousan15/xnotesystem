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
