import { google, sheets_v4 } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { ScoredTweet } from '../types/index.js';
import { logger } from '../utils/logger.js';

// Google Sheets API クライアント
let sheetsClient: sheets_v4.Sheets | null = null;

/**
 * Google Sheets API クライアントを初期化
 */
async function getClient(): Promise<sheets_v4.Sheets> {
  if (sheetsClient) {
    return sheetsClient;
  }

  // 方法1: credentials.json ファイルから認証
  const credentialsPath = process.env.GOOGLE_SHEETS_CREDENTIALS_PATH || './credentials.json';
  const absolutePath = resolve(credentialsPath);

  if (existsSync(absolutePath)) {
    const credentials = JSON.parse(readFileSync(absolutePath, 'utf-8'));
    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    sheetsClient = google.sheets({ version: 'v4', auth });
    logger.info('Google Sheets API client initialized with credentials.json');
    return sheetsClient;
  }

  // 方法2: 環境変数から認証（フォールバック）
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!email || !privateKey) {
    throw new Error('credentials.json not found and GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_PRIVATE_KEY not set');
  }

  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

/**
 * スプレッドシートIDを取得
 */
function getSpreadsheetId(): string {
  const id = process.env.GOOGLE_SPREADSHEET_ID;
  if (!id) {
    throw new Error('GOOGLE_SPREADSHEET_ID is required');
  }
  return id;
}

/**
 * シート名を生成 (Daily_YYYYMMDD)
 */
function generateSheetName(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `Daily_${year}${month}${day}`;
}

/**
 * シートが存在するか確認
 */
async function sheetExists(sheetName: string): Promise<boolean> {
  const client = await getClient();
  const spreadsheetId = getSpreadsheetId();

  try {
    const response = await client.spreadsheets.get({
      spreadsheetId,
    });

    const sheets = response.data.sheets || [];
    return sheets.some((sheet) => sheet.properties?.title === sheetName);
  } catch (error) {
    logger.error('Failed to check sheet existence:', error);
    return false;
  }
}

/**
 * 新しいシートを作成
 */
async function createSheet(sheetName: string): Promise<void> {
  const client = await getClient();
  const spreadsheetId = getSpreadsheetId();

  try {
    await client.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetName,
              },
            },
          },
        ],
      },
    });

    logger.info(`Created new sheet: ${sheetName}`);
  } catch (error) {
    logger.error(`Failed to create sheet ${sheetName}:`, error);
    throw error;
  }
}

/**
 * ヘッダー行を書き込み
 */
async function writeHeaders(sheetName: string): Promise<void> {
  const client = await getClient();
  const spreadsheetId = getSpreadsheetId();

  const headers = [
    'tweet_id',
    'author_username',
    'content',
    'created_at',
    'like_count',
    'repost_count',
    'reply_count',
    'follower_count',
    'base_score',
    'velocity_score',
    'efficiency_score',
    'semantic_score',
    'final_score',
    'is_priority',
    'is_top_pick',
    'note_used',
    'kindle_used',
  ];

  try {
    await client.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:Q1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [headers],
      },
    });

    logger.info(`Wrote headers to ${sheetName}`);
  } catch (error) {
    logger.error('Failed to write headers:', error);
    throw error;
  }
}

/**
 * 投稿データをシートに書き込み
 */
export async function writeTweetsToSheet(
  tweets: ScoredTweet[],
  topPickIds: string[],
  date: Date = new Date()
): Promise<{ sheetName: string; rowsWritten: number }> {
  const client = await getClient();
  const spreadsheetId = getSpreadsheetId();
  const sheetName = generateSheetName(date);

  // シートが存在しない場合は作成
  const exists = await sheetExists(sheetName);
  if (!exists) {
    await createSheet(sheetName);
    await writeHeaders(sheetName);
  }

  // データを行形式に変換
  const rows = tweets.map((tweet) => [
    tweet.tweetId,
    tweet.authorUsername,
    tweet.content.slice(0, 500), // 長すぎる場合はカット
    typeof tweet.createdAt === 'string' ? tweet.createdAt : tweet.createdAt.toISOString(),
    tweet.likeCount,
    tweet.repostCount,
    tweet.replyCount,
    tweet.followerCount,
    tweet.baseScore.toFixed(2),
    tweet.velocityScore.toFixed(2),
    tweet.efficiencyScore.toFixed(2),
    tweet.semanticScore.toFixed(2),
    tweet.finalScore.toFixed(2),
    tweet.isPriority ? 'TRUE' : 'FALSE',
    topPickIds.includes(tweet.tweetId) ? 'TRUE' : 'FALSE',
    'FALSE', // note_used
    'FALSE', // kindle_used
  ]);

  try {
    await client.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A2`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: rows,
      },
    });

    logger.info(`Wrote ${rows.length} rows to ${sheetName}`);
    return { sheetName, rowsWritten: rows.length };
  } catch (error) {
    logger.error('Failed to write tweets to sheet:', error);
    throw error;
  }
}

/**
 * シートからデータを読み込み
 */
export async function readTweetsFromSheet(
  date: Date
): Promise<ScoredTweet[]> {
  const client = await getClient();
  const spreadsheetId = getSpreadsheetId();
  const sheetName = generateSheetName(date);

  try {
    const response = await client.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A2:Q`,
    });

    const rows = response.data.values || [];

    return rows.map((row) => ({
      tweetId: row[0] || '',
      authorUsername: row[1] || '',
      authorId: '',
      content: row[2] || '',
      createdAt: new Date(row[3] || Date.now()),
      likeCount: parseInt(row[4], 10) || 0,
      repostCount: parseInt(row[5], 10) || 0,
      replyCount: parseInt(row[6], 10) || 0,
      followerCount: parseInt(row[7], 10) || 0,
      impressionCount: undefined,
      baseScore: parseFloat(row[8]) || 0,
      velocityScore: parseFloat(row[9]) || 0,
      efficiencyScore: parseFloat(row[10]) || 0,
      semanticScore: parseFloat(row[11]) || 0,
      finalScore: parseFloat(row[12]) || 0,
      isPriority: row[13] === 'TRUE',
    }));
  } catch (error) {
    logger.error('Failed to read tweets from sheet:', error);
    throw error;
  }
}

/**
 * 投稿のフラグを更新（note_used, kindle_used）
 */
export async function updateTweetFlags(
  date: Date,
  tweetId: string,
  flags: { noteUsed?: boolean; kindleUsed?: boolean }
): Promise<void> {
  const client = await getClient();
  const spreadsheetId = getSpreadsheetId();
  const sheetName = generateSheetName(date);

  try {
    // まず全データを取得
    const response = await client.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:Q`,
    });

    const rows = response.data.values || [];
    const rowIndex = rows.findIndex((row) => row[0] === tweetId);

    if (rowIndex === -1) {
      logger.warn(`Tweet ${tweetId} not found in ${sheetName}`);
      return;
    }

    // フラグを更新
    const updates: { range: string; values: string[][] }[] = [];

    if (flags.noteUsed !== undefined) {
      updates.push({
        range: `${sheetName}!P${rowIndex + 1}`,
        values: [[flags.noteUsed ? 'TRUE' : 'FALSE']],
      });
    }

    if (flags.kindleUsed !== undefined) {
      updates.push({
        range: `${sheetName}!Q${rowIndex + 1}`,
        values: [[flags.kindleUsed ? 'TRUE' : 'FALSE']],
      });
    }

    for (const update of updates) {
      await client.spreadsheets.values.update({
        spreadsheetId,
        range: update.range,
        valueInputOption: 'RAW',
        requestBody: {
          values: update.values,
        },
      });
    }

    logger.info(`Updated flags for tweet ${tweetId}`);
  } catch (error) {
    logger.error('Failed to update tweet flags:', error);
    throw error;
  }
}

/**
 * 日次処理用のシートへの保存（簡易版）
 */
export async function saveDailyData(
  tweets: ScoredTweet[],
  topPicks: ScoredTweet[],
  date: Date = new Date()
): Promise<{ sheetName: string; success: boolean }> {
  try {
    const topPickIds = topPicks.map((t) => t.tweetId);
    const result = await writeTweetsToSheet(tweets, topPickIds, date);
    return { sheetName: result.sheetName, success: true };
  } catch (error) {
    logger.error('Failed to save daily data to Sheets:', error);
    return { sheetName: generateSheetName(date), success: false };
  }
}
