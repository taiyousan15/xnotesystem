/**
 * Ollama を使用したツイート解析サービス
 * Why（なぜ重要か）と Action（次のアクション）を生成
 */

import { logger } from '../utils/logger.js';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'deepseek-r1:8b';
const OLLAMA_TIMEOUT = parseInt(process.env.OLLAMA_TIMEOUT || '120000', 10); // 2分

interface AnalysisResult {
  why: string;
  action: string;
}

interface TweetForAnalysis {
  id: string;
  content: string;
  category: string;
  author: string;
}

/**
 * 単一ツイートを解析
 */
export async function analyzeTweet(tweet: TweetForAnalysis): Promise<AnalysisResult> {
  const prompt = `以下のツイートを分析して、JSON形式で回答してください。

ツイート: ${tweet.content.slice(0, 300)}
カテゴリ: ${tweet.category}

回答例: {"why": "AI業界の重要な進展", "action": "詳細を確認して試す"}

回答:`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT);

    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: {
          temperature: 0.3,
          num_predict: 200,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = await response.json() as { response: string; thinking?: string };

    // deepseek-r1はthinkingフィールドを使用することがある
    const textToAnalyze = data.response || data.thinking || '';
    return parseAnalysisResponse(textToAnalyze);
  } catch (error) {
    logger.warn(`Ollama analysis failed for ${tweet.id}:`, error);
    return {
      why: '（解析失敗）',
      action: '（解析失敗）',
    };
  }
}

/**
 * バッチ解析（10件ずつ）
 */
export async function analyzeTweetsBatch(
  tweets: TweetForAnalysis[],
  onProgress?: (current: number, total: number) => void
): Promise<Map<string, AnalysisResult>> {
  const results = new Map<string, AnalysisResult>();
  const batchSize = 5; // 並列処理数
  const total = tweets.length;

  logger.info(`Ollama解析開始: ${total}件 (モデル: ${OLLAMA_MODEL})`);

  for (let i = 0; i < tweets.length; i += batchSize) {
    const batch = tweets.slice(i, i + batchSize);

    // 並列処理
    const batchResults = await Promise.all(
      batch.map(async (tweet) => {
        const result = await analyzeTweet(tweet);
        return { id: tweet.id, result };
      })
    );

    for (const { id, result } of batchResults) {
      results.set(id, result);
    }

    const progress = Math.min(i + batchSize, total);
    if (onProgress) {
      onProgress(progress, total);
    }
    logger.info(`  解析進捗: ${progress}/${total}`);

    // レート制限対策（バッチ間で少し待機）
    if (i + batchSize < tweets.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  logger.info(`Ollama解析完了: ${results.size}件`);
  return results;
}

/**
 * レスポンスをパース
 */
function parseAnalysisResponse(response: string): AnalysisResult {
  try {
    // JSONを抽出
    const jsonMatch = response.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        why: truncate(parsed.why || '情報価値あり', 50),
        action: truncate(parsed.action || '詳細を確認', 50),
      };
    }
  } catch {
    // パース失敗時はテキストから抽出を試みる
  }

  // フォールバック: テキストから抽出
  const lines = response.split('\n').filter(l => l.trim());
  return {
    why: truncate(extractValue(lines, 'why') || '最新のAIトレンド情報', 50),
    action: truncate(extractValue(lines, 'action') || '詳細をチェック', 50),
  };
}

function extractValue(lines: string[], key: string): string | null {
  for (const line of lines) {
    if (line.toLowerCase().includes(key)) {
      const match = line.match(/[:：]\s*(.+)/);
      if (match) return match[1].trim();
    }
  }
  return null;
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + '…';
}

/**
 * Ollamaの接続テスト
 */
export async function testOllamaConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);
    if (response.ok) {
      logger.info(`Ollama接続OK: ${OLLAMA_URL}`);
      return true;
    }
  } catch (error) {
    logger.warn(`Ollama接続失敗: ${error}`);
  }
  return false;
}
