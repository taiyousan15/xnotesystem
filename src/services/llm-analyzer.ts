/**
 * LLM解析サービス
 * Ollama (llama3.1:70b) を使用してツイートを解析
 */
import 'dotenv/config';
import { createHash } from 'crypto';
import { logger } from '../utils/logger.js';
import {
  LLMAnalysisResult,
  LLMAnalysisInput,
  LLMCategory,
  ContentType,
  CollectedTweet,
  ALL_CATEGORIES,
  ALL_TYPES,
} from '../types/digest.js';

// ============================================
// 設定
// ============================================

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:70b';
const OLLAMA_TIMEOUT = parseInt(process.env.OLLAMA_TIMEOUT || '180000', 10);
const OLLAMA_CONCURRENCY = parseInt(process.env.OLLAMA_CONCURRENCY || '1', 10);

// ============================================
// システムプロンプト
// ============================================

const SYSTEM_PROMPT = `あなたはX投稿を日次インテリジェンスに変換する分析エンジンです。
必ず指定スキーマのJSONだけを出力してください。説明文・前置き・コードフェンスは禁止です。

出力形式:
{
  "category": "LLM|Agent|RAG|MCP|Tooling|Research|Product|Business|Security|Other",
  "type": "News|Tools-OSS|Papers|Tutorials|Opinions|Security",
  "tags": ["#tag1", "#tag2"],
  "topicHints": ["hint1", "hint2"],
  "score": 0-100,
  "titleJa": "日本語タイトル（50文字以内）",
  "summaryBulletsJa": ["要約1", "要約2"],
  "insightJa": "洞察（100文字以内）",
  "clusterKey": "正規化キー"
}

カテゴリ定義:
- LLM: 大規模言語モデル、GPT、Claude、Gemini関連
- Agent: AIエージェント、自律実行、マルチエージェント
- RAG: 検索拡張生成、ベクトルDB、埋め込み
- MCP: Model Context Protocol関連
- Tooling: 開発ツール、IDE、CLI、ライブラリ
- Research: 論文、研究成果、ベンチマーク
- Product: 製品発表、サービスリリース
- Business: ビジネス、収益化、スタートアップ
- Security: セキュリティ、脆弱性、プライバシー
- Other: 上記に該当しない

タイプ定義:
- News: ニュース、発表、アップデート
- Tools-OSS: オープンソースツール、ライブラリ
- Papers: 論文、研究
- Tutorials: チュートリアル、ハウツー、解説
- Opinions: 意見、考察、議論
- Security: セキュリティ関連

スコア基準:
- 90-100: 業界を変えるニュース、必読
- 70-89: 重要な技術情報、多くの人に有益
- 50-69: 有益だが限定的な対象
- 30-49: 情報価値は低いが参考になる
- 0-29: ノイズに近い

clusterKey生成:
- リンク先がある場合: URLのドメイン+パス正規化
- ない場合: 投稿内容の主題キーワード組み合わせ`;

// ============================================
// 接続確認
// ============================================

/**
 * Ollamaサーバーへの接続を確認
 */
export async function checkOllamaConnection(): Promise<{
  connected: boolean;
  modelAvailable: boolean;
  error?: string;
}> {
  try {
    // サーバー接続確認
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return {
        connected: false,
        modelAvailable: false,
        error: `Server returned ${response.status}`,
      };
    }

    const data = await response.json() as { models?: Array<{ name: string }> };
    const models = data.models || [];
    const modelAvailable = models.some(m => m.name.includes(OLLAMA_MODEL.split(':')[0]));

    return {
      connected: true,
      modelAvailable,
      error: modelAvailable ? undefined : `Model ${OLLAMA_MODEL} not found. Available: ${models.map(m => m.name).join(', ')}`,
    };
  } catch (error) {
    return {
      connected: false,
      modelAvailable: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================
// メイン関数
// ============================================

/**
 * 全ツイートをLLM解析
 */
export async function analyzeAllTweets(
  tweets: CollectedTweet[],
  onProgress?: (current: number, total: number) => void
): Promise<Map<string, LLMAnalysisResult>> {
  const results = new Map<string, LLMAnalysisResult>();
  const total = tweets.length;

  logger.info(`LLM解析開始: ${total}件 (model: ${OLLAMA_MODEL}, concurrency: ${OLLAMA_CONCURRENCY})`);

  // バッチ処理
  for (let i = 0; i < tweets.length; i += OLLAMA_CONCURRENCY) {
    const batch = tweets.slice(i, i + OLLAMA_CONCURRENCY);

    const batchResults = await Promise.all(
      batch.map(async (tweet) => {
        try {
          const result = await analyzeSingleTweet(tweet);
          return { id: tweet.id, result, success: true };
        } catch (error) {
          logger.warn(`LLM解析失敗 (${tweet.id}): ${error}`);
          const fallback = generateFallback(tweet);
          return { id: tweet.id, result: fallback, success: false };
        }
      })
    );

    for (const { id, result } of batchResults) {
      results.set(id, result);
    }

    const current = Math.min(i + OLLAMA_CONCURRENCY, total);
    onProgress?.(current, total);

    // バッチ間の待機（Rate Limit対策）
    if (i + OLLAMA_CONCURRENCY < tweets.length) {
      await sleep(1000);
    }
  }

  logger.info(`LLM解析完了: ${results.size}件`);
  return results;
}

/**
 * 単一ツイートをLLM解析
 */
export async function analyzeSingleTweet(
  tweet: CollectedTweet,
  links?: { title?: string; excerpt?: string; text?: string }
): Promise<LLMAnalysisResult> {
  const input = buildAnalysisInput(tweet, links);
  const prompt = buildUserPrompt(input);

  const response = await callOllama(prompt);
  return parseAnalysisJSON(response, tweet);
}

/**
 * Ollama接続テスト
 */
export async function testOllamaConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ============================================
// 内部関数
// ============================================

/**
 * 解析入力を構築
 */
function buildAnalysisInput(
  tweet: CollectedTweet,
  links?: { title?: string; excerpt?: string; text?: string }
): LLMAnalysisInput {
  const urls = extractUrls(tweet.content);
  const domains = urls.map(u => {
    try {
      return new URL(u).hostname;
    } catch {
      return '';
    }
  }).filter(Boolean);

  return {
    tweet_text: tweet.content,
    author: `@${tweet.authorUsername}`,
    created_at: tweet.createdAt,
    metrics: {
      like: tweet.likes,
      repost: tweet.retweets,
      reply: tweet.replies,
      quote: tweet.quotes,
    },
    canonical_url: urls[0] || null,
    link_title: links?.title || null,
    link_excerpt: links?.excerpt || null,
    link_extracted_text: links?.text || null,
    hints: {
      domains,
      has_github: domains.some(d => d.includes('github')),
      has_arxiv: domains.some(d => d.includes('arxiv')),
    },
  };
}

/**
 * ユーザープロンプトを構築
 */
function buildUserPrompt(input: LLMAnalysisInput): string {
  return `入力:
${JSON.stringify(input, null, 2)}

出力（JSONのみ）:`;
}

/**
 * Ollama APIを呼び出し
 */
async function callOllama(prompt: string, retryCount = 0): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT);

  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        system: SYSTEM_PROMPT,
        stream: false,
        options: {
          temperature: 0.3,
          num_predict: 1024,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = await response.json() as { response?: string };
    return data.response || '';
  } catch (error: unknown) {
    clearTimeout(timeoutId);

    // タイムアウトまたはエラー時のリトライ
    if (retryCount < 1) {
      logger.warn(`Ollama呼び出しリトライ (${retryCount + 1}/1)`);
      await sleep(2000);
      return callOllama(prompt, retryCount + 1);
    }

    throw error;
  }
}

/**
 * JSON応答をパース（修復機能付き）
 */
function parseAnalysisJSON(response: string, tweet: CollectedTweet): LLMAnalysisResult {
  // Step 1: 直接パースを試行
  try {
    const parsed = JSON.parse(response.trim());
    return validateAndFillDefaults(parsed, tweet);
  } catch {
    // Continue to Step 2
  }

  // Step 2: JSONを抽出してパース
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return validateAndFillDefaults(parsed, tweet);
    }
  } catch {
    // Continue to Step 3
  }

  // Step 3: 正規表現でフィールドを抽出
  try {
    const extracted = extractFieldsFromText(response);
    return validateAndFillDefaults(extracted, tweet);
  } catch {
    // Continue to fallback
  }

  // Step 4: フォールバック
  logger.warn(`JSONパース失敗、フォールバック使用: ${tweet.id}`);
  return generateFallback(tweet);
}

/**
 * テキストからフィールドを抽出（正規表現）
 */
function extractFieldsFromText(text: string): Partial<LLMAnalysisResult> {
  const result: Partial<LLMAnalysisResult> = {};

  // category
  const categoryMatch = text.match(/"category"\s*:\s*"([^"]+)"/);
  if (categoryMatch && ALL_CATEGORIES.includes(categoryMatch[1] as LLMCategory)) {
    result.category = categoryMatch[1] as LLMCategory;
  }

  // type
  const typeMatch = text.match(/"type"\s*:\s*"([^"]+)"/);
  if (typeMatch && ALL_TYPES.includes(typeMatch[1] as ContentType)) {
    result.type = typeMatch[1] as ContentType;
  }

  // score
  const scoreMatch = text.match(/"score"\s*:\s*(\d+(?:\.\d+)?)/);
  if (scoreMatch) {
    result.score = Math.min(100, Math.max(0, parseFloat(scoreMatch[1])));
  }

  // titleJa
  const titleMatch = text.match(/"titleJa"\s*:\s*"([^"]+)"/);
  if (titleMatch) {
    result.titleJa = titleMatch[1].slice(0, 50);
  }

  // insightJa
  const insightMatch = text.match(/"insightJa"\s*:\s*"([^"]+)"/);
  if (insightMatch) {
    result.insightJa = insightMatch[1].slice(0, 100);
  }

  // clusterKey
  const clusterMatch = text.match(/"clusterKey"\s*:\s*"([^"]+)"/);
  if (clusterMatch) {
    result.clusterKey = clusterMatch[1];
  }

  return result;
}

/**
 * バリデーションとデフォルト値補完
 */
function validateAndFillDefaults(
  parsed: Partial<LLMAnalysisResult>,
  tweet: CollectedTweet
): LLMAnalysisResult {
  return {
    category: validateCategory(parsed.category),
    type: validateType(parsed.type),
    tags: validateTags(parsed.tags),
    topicHints: Array.isArray(parsed.topicHints) ? parsed.topicHints.slice(0, 5) : [],
    score: validateScore(parsed.score, tweet),
    titleJa: parsed.titleJa?.slice(0, 50) || generateTitle(tweet),
    summaryBulletsJa: validateSummaryBullets(parsed.summaryBulletsJa),
    insightJa: parsed.insightJa?.slice(0, 100) || '詳細は元投稿を参照',
    clusterKey: parsed.clusterKey || generateClusterKey(tweet),
  };
}

/**
 * カテゴリをバリデート
 */
function validateCategory(category: unknown): LLMCategory {
  if (typeof category === 'string' && ALL_CATEGORIES.includes(category as LLMCategory)) {
    return category as LLMCategory;
  }
  return 'Other';
}

/**
 * タイプをバリデート
 */
function validateType(type: unknown): ContentType {
  if (typeof type === 'string' && ALL_TYPES.includes(type as ContentType)) {
    return type as ContentType;
  }
  return 'News';
}

/**
 * タグをバリデート
 */
function validateTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((t): t is string => typeof t === 'string')
    .map(t => t.startsWith('#') ? t : `#${t}`)
    .slice(0, 6);
}

/**
 * スコアをバリデート
 */
function validateScore(score: unknown, tweet: CollectedTweet): number {
  if (typeof score === 'number' && score >= 0 && score <= 100) {
    return score;
  }
  // エンゲージメントベースのフォールバックスコア
  const engagement = tweet.likes + tweet.retweets * 3 + tweet.replies * 2;
  return Math.min(100, Math.max(0, Math.round(engagement / 10) + 30));
}

/**
 * 要約箇条書きをバリデート
 */
function validateSummaryBullets(bullets: unknown): string[] {
  if (!Array.isArray(bullets)) {
    return ['詳細は元投稿を参照'];
  }
  return bullets
    .filter((b): b is string => typeof b === 'string')
    .slice(0, 3);
}

/**
 * フォールバック解析結果を生成
 */
export function generateFallback(tweet: CollectedTweet): LLMAnalysisResult {
  return {
    category: inferCategoryFromContent(tweet.content),
    type: inferTypeFromContent(tweet.content),
    tags: extractHashtags(tweet.content),
    topicHints: [tweet.content.slice(0, 50)],
    score: calculateFallbackScore(tweet),
    titleJa: generateTitle(tweet),
    summaryBulletsJa: ['詳細は元投稿を参照'],
    insightJa: '（解析未完了）',
    clusterKey: generateClusterKey(tweet),
  };
}

/**
 * コンテンツからカテゴリを推定
 */
function inferCategoryFromContent(content: string): LLMCategory {
  const lower = content.toLowerCase();

  if (lower.includes('mcp') || lower.includes('model context protocol')) return 'MCP';
  if (lower.includes('agent') || lower.includes('エージェント')) return 'Agent';
  if (lower.includes('rag') || lower.includes('retrieval') || lower.includes('vector')) return 'RAG';
  if (lower.includes('llm') || lower.includes('gpt') || lower.includes('claude') || lower.includes('gemini')) return 'LLM';
  if (lower.includes('tool') || lower.includes('sdk') || lower.includes('api') || lower.includes('library')) return 'Tooling';
  if (lower.includes('paper') || lower.includes('research') || lower.includes('arxiv')) return 'Research';
  if (lower.includes('launch') || lower.includes('release') || lower.includes('product')) return 'Product';
  if (lower.includes('business') || lower.includes('revenue') || lower.includes('startup')) return 'Business';
  if (lower.includes('security') || lower.includes('vulnerability') || lower.includes('jailbreak')) return 'Security';

  return 'Other';
}

/**
 * コンテンツからタイプを推定
 */
function inferTypeFromContent(content: string): ContentType {
  const lower = content.toLowerCase();

  if (lower.includes('github.com') || lower.includes('open source') || lower.includes('repo')) return 'Tools-OSS';
  if (lower.includes('arxiv') || lower.includes('paper') || lower.includes('研究')) return 'Papers';
  if (lower.includes('tutorial') || lower.includes('how to') || lower.includes('方法') || lower.includes('手順')) return 'Tutorials';
  if (lower.includes('security') || lower.includes('vulnerability')) return 'Security';
  if (lower.includes('think') || lower.includes('opinion') || lower.includes('考え')) return 'Opinions';

  return 'News';
}

/**
 * ハッシュタグを抽出
 */
function extractHashtags(content: string): string[] {
  const matches = content.match(/#[\w\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]+/g);
  return matches ? matches.slice(0, 6) : [];
}

/**
 * フォールバックスコアを計算
 */
function calculateFallbackScore(tweet: CollectedTweet): number {
  const engagement = tweet.likes + tweet.retweets * 3 + tweet.replies * 2;
  return Math.min(100, Math.max(0, Math.round(engagement / 10) + 30));
}

/**
 * タイトルを生成
 */
function generateTitle(tweet: CollectedTweet): string {
  const firstLine = tweet.content.split('\n')[0];
  return firstLine.slice(0, 50);
}

/**
 * クラスターキーを生成
 */
function generateClusterKey(tweet: CollectedTweet): string {
  const urls = extractUrls(tweet.content);

  if (urls.length > 0) {
    // URLがある場合はURLベースのキー
    try {
      const url = new URL(urls[0]);
      const normalized = `${url.hostname}${url.pathname}`.toLowerCase();
      return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
    } catch {
      // URLパース失敗時は内容ベース
    }
  }

  // 内容ベースのキー
  const normalized = tweet.content
    .toLowerCase()
    .replace(/[^\w\s\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g, '')
    .slice(0, 100);
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * URLを抽出
 */
function extractUrls(content: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
  return content.match(urlRegex) || [];
}

/**
 * スリープ
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
