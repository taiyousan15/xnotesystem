/**
 * Notion Upsert Service
 * Tweet IDをキーとしたUpsert（存在確認→更新or新規作成）
 */

import { Client } from '@notionhq/client';
import {
  AnalyzedTweet,
  UpsertResult,
  UpsertOptions,
  LLMCategory,
  DEFAULT_DIGEST_CONFIG,
} from '../types/digest.js';
import { logger } from '../utils/logger.js';

// Notion クライアント
let notionClient: Client | null = null;

// 設定
const DATABASE_ID = process.env.NOTION_DATABASE_ID || DEFAULT_DIGEST_CONFIG.notion.databaseId;
const RATE_LIMIT_DELAY = 350; // ms
const MAX_RETRIES = 3;
const BACKOFF_BASE = 1000; // ms

/**
 * Notion クライアントを取得
 */
function getClient(): Client {
  if (notionClient) return notionClient;

  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) {
    throw new Error('NOTION_API_KEY is required');
  }

  notionClient = new Client({ auth: apiKey });
  return notionClient;
}

/**
 * 指数バックオフ付きリトライ
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number = MAX_RETRIES
): Promise<T> {
  let lastError: Error | null = null;

  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Rate Limit エラーの場合のみリトライ
      if (error?.code === 'rate_limited' || error?.status === 429) {
        const delay = BACKOFF_BASE * Math.pow(2, i);
        logger.warn(`Rate limited, retrying in ${delay}ms...`);
        await sleep(delay);
        continue;
      }

      // その他のエラーは即座に投げる
      throw error;
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

/**
 * スリープ
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Tweet IDでページを検索
 */
async function findPageByTweetId(tweetId: string): Promise<string | null> {
  const client = getClient();

  try {
    const response = await withRetry(() =>
      client.databases.query({
        database_id: DATABASE_ID,
        filter: {
          property: 'Tweet ID',
          rich_text: {
            equals: tweetId,
          },
        },
        page_size: 1,
      })
    );

    if (response.results.length > 0) {
      return response.results[0].id;
    }

    return null;
  } catch (error) {
    logger.error(`Failed to search for tweet ${tweetId}:`, error);
    return null;
  }
}

/**
 * 既存ページのステータスを取得（保護のため）
 */
async function getExistingStatuses(pageId: string): Promise<{
  noteStatus: string | null;
  kindleStatus: string | null;
}> {
  const client = getClient();

  try {
    const page = await withRetry(() => client.pages.retrieve({ page_id: pageId }));
    const props = (page as any).properties;

    return {
      noteStatus: props['Note Status']?.select?.name || null,
      kindleStatus: props['Kindle Status']?.select?.name || null,
    };
  } catch (error) {
    logger.error(`Failed to get existing statuses for page ${pageId}:`, error);
    return { noteStatus: null, kindleStatus: null };
  }
}

/**
 * プロパティオブジェクトを構築
 */
function buildProperties(
  tweet: AnalyzedTweet,
  options: UpsertOptions,
  existingStatuses?: { noteStatus: string | null; kindleStatus: string | null }
): Record<string, any> {
  const properties: Record<string, any> = {
    // Title: 日本語タイトル
    Title: {
      title: [{ text: { content: tweet.analysis.titleJa.slice(0, 100) } }],
    },
    // Tweet ID
    'Tweet ID': {
      rich_text: [{ text: { content: tweet.id } }],
    },
    // Author
    Author: {
      rich_text: [{ text: { content: `@${tweet.authorUsername}` } }],
    },
    // Category (10種)
    Category: {
      select: { name: tweet.analysis.category },
    },
    // Score (0-100)
    Score: {
      number: tweet.analysis.score,
    },
    // Date
    Date: {
      date: { start: options.digestDate },
    },
    // Priority
    Priority: {
      checkbox: options.isPriority || false,
    },
    // Top Pick
    'Top Pick': {
      checkbox: options.isTopPick || false,
    },
  };

  // Note Status: 既存値を保護（Unused以外は上書きしない）
  if (existingStatuses?.noteStatus && existingStatuses.noteStatus !== 'Unused') {
    // 既存のステータスを維持（更新しない）
  } else {
    properties['Note Status'] = {
      select: { name: 'Unused' },
    };
  }

  // Kindle Status: 既存値を保護（Unused以外は上書きしない）
  if (existingStatuses?.kindleStatus && existingStatuses.kindleStatus !== 'Unused') {
    // 既存のステータスを維持（更新しない）
  } else {
    properties['Kindle Status'] = {
      select: { name: 'Unused' },
    };
  }

  return properties;
}

/**
 * 新規ページ作成
 */
async function createPage(
  tweet: AnalyzedTweet,
  options: UpsertOptions,
  pageContent?: any[]
): Promise<string> {
  const client = getClient();
  const properties = buildProperties(tweet, options);

  const createParams: any = {
    parent: { database_id: DATABASE_ID },
    properties,
  };

  // ページ本文を追加
  if (pageContent && pageContent.length > 0) {
    createParams.children = pageContent.slice(0, 100); // 100ブロック制限
  }

  const response = await withRetry(() => client.pages.create(createParams));
  return response.id;
}

/**
 * 既存ページ更新
 */
async function updatePage(
  pageId: string,
  tweet: AnalyzedTweet,
  options: UpsertOptions,
  existingStatuses: { noteStatus: string | null; kindleStatus: string | null }
): Promise<void> {
  const client = getClient();
  const properties = buildProperties(tweet, options, existingStatuses);

  await withRetry(() =>
    client.pages.update({
      page_id: pageId,
      properties,
    })
  );
}

/**
 * 単一ツイートをUpsert
 */
export async function upsertTweet(
  tweet: AnalyzedTweet,
  options: UpsertOptions,
  pageContent?: any[]
): Promise<{ pageId: string; isNew: boolean }> {
  // 既存ページを検索
  const existingPageId = await findPageByTweetId(tweet.id);

  if (existingPageId) {
    // 既存: ステータスを取得して保護しながら更新
    const existingStatuses = await getExistingStatuses(existingPageId);
    await updatePage(existingPageId, tweet, options, existingStatuses);
    return { pageId: existingPageId, isNew: false };
  } else {
    // 新規作成
    const pageId = await createPage(tweet, options, pageContent);
    return { pageId, isNew: true };
  }
}

/**
 * 複数ツイートを一括Upsert
 */
export async function upsertTweets(
  tweets: AnalyzedTweet[],
  options: UpsertOptions,
  pageContentBuilder?: (tweet: AnalyzedTweet) => any[]
): Promise<UpsertResult> {
  const result: UpsertResult = {
    created: 0,
    updated: 0,
    errors: 0,
    pageIds: new Map(),
  };

  for (const tweet of tweets) {
    try {
      const pageContent = pageContentBuilder ? pageContentBuilder(tweet) : undefined;
      const { pageId, isNew } = await upsertTweet(tweet, options, pageContent);

      result.pageIds.set(tweet.id, pageId);
      if (isNew) {
        result.created++;
      } else {
        result.updated++;
      }

      logger.debug(`Upserted tweet ${tweet.id}: ${isNew ? 'created' : 'updated'}`);
    } catch (error) {
      logger.error(`Failed to upsert tweet ${tweet.id}:`, error);
      result.errors++;
    }

    // レート制限対策
    await sleep(RATE_LIMIT_DELAY);
  }

  logger.info(
    `Upsert completed: ${result.created} created, ${result.updated} updated, ${result.errors} errors`
  );

  return result;
}

/**
 * ページ本文を追加（既存ページに対して）
 */
export async function appendPageContent(
  pageId: string,
  content: any[]
): Promise<void> {
  const client = getClient();

  await withRetry(() =>
    client.blocks.children.append({
      block_id: pageId,
      children: content.slice(0, 100),
    })
  );
}

/**
 * データベースの親ページIDを取得
 */
export async function getDatabaseParentId(): Promise<string | null> {
  const client = getClient();

  try {
    const db = await withRetry(() =>
      client.databases.retrieve({ database_id: DATABASE_ID })
    );

    const parent = (db as any).parent;
    if (parent?.type === 'page_id') {
      return parent.page_id;
    }
    if (parent?.type === 'workspace') {
      return null; // ワークスペース直下
    }

    return null;
  } catch (error) {
    logger.error('Failed to get database parent:', error);
    return null;
  }
}

/**
 * 新しいページを親ページ直下に作成（日次ダイジェスト用）
 */
export async function createDigestPage(
  parentId: string,
  title: string,
  content: any[]
): Promise<{ pageId: string; url: string }> {
  const client = getClient();

  const response = await withRetry(() =>
    client.pages.create({
      parent: { page_id: parentId },
      properties: {
        title: {
          title: [{ text: { content: title } }],
        },
      },
      children: content.slice(0, 100),
    })
  );

  return {
    pageId: response.id,
    url: (response as any).url || `https://notion.so/${response.id.replace(/-/g, '')}`,
  };
}

/**
 * カテゴリ別集計を取得
 */
export async function getCategoryStats(
  digestDate: string
): Promise<Record<LLMCategory, number>> {
  const client = getClient();
  const stats: Record<string, number> = {};

  try {
    const response = await withRetry(() =>
      client.databases.query({
        database_id: DATABASE_ID,
        filter: {
          property: 'Date',
          date: {
            equals: digestDate,
          },
        },
        page_size: 100,
      })
    );

    for (const page of response.results) {
      const category = (page as any).properties?.Category?.select?.name || 'Other';
      stats[category] = (stats[category] || 0) + 1;
    }
  } catch (error) {
    logger.error('Failed to get category stats:', error);
  }

  return stats as Record<LLMCategory, number>;
}

/**
 * 指定したページのTop Pickフラグを更新
 */
export async function updateTopPickFlag(
  pageId: string,
  isTopPick: boolean
): Promise<void> {
  const client = getClient();

  await withRetry(() =>
    client.pages.update({
      page_id: pageId,
      properties: {
        'Top Pick': { checkbox: isTopPick },
      },
    })
  );
}

/**
 * 複数ページのTop Pickフラグを一括更新
 */
export async function updateTopPickFlags(
  pageIds: string[],
  isTopPick: boolean
): Promise<{ success: number; errors: number }> {
  let success = 0;
  let errors = 0;

  for (const pageId of pageIds) {
    try {
      await updateTopPickFlag(pageId, isTopPick);
      success++;
      logger.debug(`Updated Top Pick for page ${pageId}: ${isTopPick}`);
    } catch (error) {
      logger.error(`Failed to update Top Pick for page ${pageId}:`, error);
      errors++;
    }
    await sleep(RATE_LIMIT_DELAY);
  }

  logger.info(`Top Pick update: ${success} success, ${errors} errors`);
  return { success, errors };
}

/**
 * Top Pickをリセット（新しい日の処理前）
 */
export async function resetTopPicks(digestDate: string): Promise<number> {
  const client = getClient();
  let resetCount = 0;

  try {
    // 指定日のTop Pickを検索
    const response = await withRetry(() =>
      client.databases.query({
        database_id: DATABASE_ID,
        filter: {
          and: [
            {
              property: 'Date',
              date: { equals: digestDate },
            },
            {
              property: 'Top Pick',
              checkbox: { equals: true },
            },
          ],
        },
      })
    );

    // Top Pickをfalseに更新
    for (const page of response.results) {
      await withRetry(() =>
        client.pages.update({
          page_id: page.id,
          properties: {
            'Top Pick': { checkbox: false },
          },
        })
      );
      resetCount++;
      await sleep(RATE_LIMIT_DELAY);
    }

    logger.info(`Reset ${resetCount} top picks for ${digestDate}`);
  } catch (error) {
    logger.error('Failed to reset top picks:', error);
  }

  return resetCount;
}
