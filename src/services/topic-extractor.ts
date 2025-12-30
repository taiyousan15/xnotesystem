/**
 * Topic Extractor Service
 * ツイートをトピック別にクラスタリング
 */

import {
  AnalyzedTweet,
  Topic,
  TopicExtractionResult,
  LLMCategory,
  DEFAULT_DIGEST_CONFIG,
} from '../types/digest.js';

// 設定
const OLLAMA_URL = process.env.OLLAMA_URL || DEFAULT_DIGEST_CONFIG.ollama.url;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || DEFAULT_DIGEST_CONFIG.ollama.model;
const OLLAMA_TIMEOUT = parseInt(process.env.OLLAMA_TIMEOUT || String(DEFAULT_DIGEST_CONFIG.ollama.timeout), 10);

/**
 * トピック抽出メイン処理
 */
export async function extractTopics(tweets: AnalyzedTweet[]): Promise<TopicExtractionResult> {
  if (tweets.length === 0) {
    return { topics: [], tweetTopicMapping: new Map() };
  }

  // Step 1: clusterKeyでグループ化（重複圧縮の基盤）
  const clusterGroups = groupByClusterKey(tweets);

  // Step 2: topicHintsを集約してトピック候補を生成
  const topicCandidates = await generateTopicCandidates(tweets, clusterGroups);

  // Step 3: 各ツイートにトピックを割り当て
  const { topics, tweetTopicMapping } = assignTopicsToTweets(tweets, topicCandidates);

  return { topics, tweetTopicMapping };
}

/**
 * clusterKeyでグループ化
 */
function groupByClusterKey(tweets: AnalyzedTweet[]): Map<string, AnalyzedTweet[]> {
  const groups = new Map<string, AnalyzedTweet[]>();

  for (const tweet of tweets) {
    const key = tweet.analysis.clusterKey || generateClusterKey(tweet);
    const existing = groups.get(key) || [];
    existing.push(tweet);
    groups.set(key, existing);
  }

  return groups;
}

/**
 * クラスターキー生成（フォールバック）
 */
function generateClusterKey(tweet: AnalyzedTweet): string {
  // カテゴリ + 主要タグ + リンクドメインで生成
  const category = tweet.analysis.category;
  const mainTag = tweet.analysis.tags[0]?.replace('#', '') || 'general';
  const domain = tweet.links[0]?.domain || '';

  return `${category}:${mainTag}:${domain}`.toLowerCase();
}

/**
 * トピック候補生成（LLM使用）
 */
async function generateTopicCandidates(
  tweets: AnalyzedTweet[],
  clusterGroups: Map<string, AnalyzedTweet[]>
): Promise<TopicCandidate[]> {
  // topicHintsを集約
  const allHints: string[] = [];
  const categoryHints: Record<LLMCategory, string[]> = {} as Record<LLMCategory, string[]>;

  for (const tweet of tweets) {
    const category = tweet.analysis.category;
    if (!categoryHints[category]) {
      categoryHints[category] = [];
    }
    categoryHints[category].push(...tweet.analysis.topicHints);
    allHints.push(...tweet.analysis.topicHints);
  }

  // LLMでトピックラベル生成
  const prompt = buildTopicGenerationPrompt(tweets, categoryHints, clusterGroups);

  try {
    const response = await callOllama(prompt);
    return parseTopicResponse(response, tweets, clusterGroups);
  } catch (error) {
    console.error('Topic generation failed, using fallback:', error);
    return generateFallbackTopics(tweets, categoryHints, clusterGroups);
  }
}

/**
 * トピック生成プロンプト構築
 */
function buildTopicGenerationPrompt(
  tweets: AnalyzedTweet[],
  categoryHints: Record<LLMCategory, string[]>,
  clusterGroups: Map<string, AnalyzedTweet[]>
): string {
  // カテゴリ別のヒント要約
  const categorySummaries = Object.entries(categoryHints)
    .filter(([, hints]) => hints.length > 0)
    .map(([cat, hints]) => {
      const uniqueHints = [...new Set(hints)].slice(0, 10);
      return `${cat}: ${uniqueHints.join(', ')}`;
    })
    .join('\n');

  // 主要クラスター
  const topClusters = Array.from(clusterGroups.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 20)
    .map(([key, group]) => `${key} (${group.length}件)`)
    .join('\n');

  return `
あなたはAIニュースのトピック分類エキスパートです。
以下の情報から、今日の主要トピック（8-12個）を生成してください。

## カテゴリ別トピックヒント
${categorySummaries}

## 主要クラスター（キー: 件数）
${topClusters}

## 出力形式（JSON配列）
[
  {
    "key": "gpt-4-turbo-release",
    "label": "GPT-4 Turbo新機能リリース",
    "summary": "OpenAIがGPT-4 Turboの新機能を発表。128Kコンテキスト対応など大幅アップデート。",
    "keywords": ["gpt-4", "openai", "turbo", "128k"]
  }
]

## 制約
- キーは英数字とハイフンのみ（例: claude-3-opus-launch）
- ラベルは日本語で簡潔に（15文字以内推奨）
- サマリーは1文（50文字以内）
- keywordsは関連キーワード3-5個

JSONのみ出力してください。
`;
}

/**
 * Ollama API呼び出し
 */
async function callOllama(prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT);

  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: {
          temperature: 0.3,
          num_predict: 2000,
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
  } finally {
    clearTimeout(timeoutId);
  }
}

interface TopicCandidate {
  key: string;
  label: string;
  summary: string;
  keywords: string[];
}

/**
 * LLMレスポンスをパース
 */
function parseTopicResponse(
  response: string,
  tweets: AnalyzedTweet[],
  clusterGroups: Map<string, AnalyzedTweet[]>
): TopicCandidate[] {
  try {
    // JSON抽出
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('No JSON array found');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) {
      throw new Error('Not an array');
    }

    return parsed.map((item: any) => ({
      key: String(item.key || '').toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      label: String(item.label || ''),
      summary: String(item.summary || ''),
      keywords: Array.isArray(item.keywords) ? item.keywords.map(String) : [],
    })).filter(t => t.key && t.label);

  } catch (error) {
    console.error('Topic parsing failed:', error);
    return generateFallbackTopics(tweets, {}, clusterGroups);
  }
}

/**
 * フォールバックトピック生成
 */
function generateFallbackTopics(
  tweets: AnalyzedTweet[],
  categoryHints: Record<string, string[]>,
  clusterGroups: Map<string, AnalyzedTweet[]>
): TopicCandidate[] {
  const topics: TopicCandidate[] = [];

  // カテゴリ別にトピック生成
  const categoryMap: Record<LLMCategory, string> = {
    'LLM': 'LLMモデル・技術',
    'Agent': 'AIエージェント',
    'RAG': 'RAG・検索拡張',
    'MCP': 'MCP・ツール連携',
    'Tooling': '開発ツール・OSS',
    'Research': 'AI研究・論文',
    'Product': 'AIプロダクト',
    'Business': 'AIビジネス',
    'Security': 'AIセキュリティ',
    'Other': 'その他AI話題',
  };

  // ツイートのカテゴリ分布を確認
  const categoryCount: Record<string, number> = {};
  for (const tweet of tweets) {
    const cat = tweet.analysis.category;
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
  }

  // 件数の多いカテゴリからトピック生成
  for (const [category, count] of Object.entries(categoryCount).sort((a, b) => b[1] - a[1])) {
    if (count >= 3) {
      topics.push({
        key: category.toLowerCase(),
        label: categoryMap[category as LLMCategory] || category,
        summary: `${category}関連の話題${count}件`,
        keywords: [category.toLowerCase()],
      });
    }
  }

  // 最低8トピック確保
  if (topics.length < 8) {
    const remaining = Object.entries(categoryMap)
      .filter(([cat]) => !topics.some(t => t.key === cat.toLowerCase()))
      .slice(0, 8 - topics.length);

    for (const [cat, label] of remaining) {
      topics.push({
        key: cat.toLowerCase(),
        label,
        summary: `${label}の最新動向`,
        keywords: [cat.toLowerCase()],
      });
    }
  }

  return topics;
}

/**
 * ツイートにトピックを割り当て
 */
function assignTopicsToTweets(
  tweets: AnalyzedTweet[],
  topicCandidates: TopicCandidate[]
): { topics: Topic[]; tweetTopicMapping: Map<string, string> } {
  const tweetTopicMapping = new Map<string, string>();
  const topicCounts: Record<string, number> = {};
  const topicRepresentatives: Record<string, string[]> = {};

  for (const tweet of tweets) {
    // 最適なトピックを見つける
    const topicKey = findBestTopic(tweet, topicCandidates);
    tweetTopicMapping.set(tweet.id, topicKey);

    // カウント更新
    topicCounts[topicKey] = (topicCounts[topicKey] || 0) + 1;

    // 代表サンプル追加（最大3件）
    if (!topicRepresentatives[topicKey]) {
      topicRepresentatives[topicKey] = [];
    }
    if (topicRepresentatives[topicKey].length < 3) {
      topicRepresentatives[topicKey].push(tweet.id);
    }

    // ツイートにトピック情報を付与
    tweet.topicKey = topicKey;
    const candidate = topicCandidates.find(t => t.key === topicKey);
    tweet.topicLabel = candidate?.label || topicKey;
  }

  // Topic配列を生成
  const topics: Topic[] = topicCandidates
    .filter(t => topicCounts[t.key] > 0)
    .map(t => ({
      key: t.key,
      label: t.label,
      summary: t.summary,
      tweetCount: topicCounts[t.key] || 0,
      representativeTweetIds: topicRepresentatives[t.key] || [],
    }))
    .sort((a, b) => b.tweetCount - a.tweetCount);

  return { topics, tweetTopicMapping };
}

/**
 * ツイートに最適なトピックを見つける
 */
function findBestTopic(tweet: AnalyzedTweet, topicCandidates: TopicCandidate[]): string {
  let bestTopic = topicCandidates[0]?.key || 'other';
  let bestScore = 0;

  const tweetText = (tweet.content + ' ' + tweet.analysis.titleJa).toLowerCase();
  const tweetTags = tweet.analysis.tags.map(t => t.toLowerCase().replace('#', ''));
  const tweetHints = tweet.analysis.topicHints.map(h => h.toLowerCase());
  const tweetCategory = tweet.analysis.category.toLowerCase();

  for (const topic of topicCandidates) {
    let score = 0;

    // キーワードマッチ
    for (const keyword of topic.keywords) {
      const kw = keyword.toLowerCase();
      if (tweetText.includes(kw)) score += 3;
      if (tweetTags.some(t => t.includes(kw))) score += 2;
      if (tweetHints.some(h => h.includes(kw))) score += 2;
    }

    // トピックキーとの直接マッチ
    if (tweetText.includes(topic.key)) score += 5;
    if (tweetCategory === topic.key) score += 4;

    // ラベルマッチ
    if (tweetText.includes(topic.label.toLowerCase())) score += 3;

    if (score > bestScore) {
      bestScore = score;
      bestTopic = topic.key;
    }
  }

  // スコアが低い場合はカテゴリベースのフォールバック
  if (bestScore < 2) {
    const categoryTopic = topicCandidates.find(t => t.key === tweetCategory);
    if (categoryTopic) {
      return categoryTopic.key;
    }
  }

  return bestTopic;
}

/**
 * トピック統計取得
 */
export function getTopicStats(topics: Topic[]): {
  totalTopics: number;
  avgTweetsPerTopic: number;
  largestTopic: { key: string; count: number } | null;
} {
  if (topics.length === 0) {
    return { totalTopics: 0, avgTweetsPerTopic: 0, largestTopic: null };
  }

  const totalTweets = topics.reduce((sum, t) => sum + t.tweetCount, 0);
  const sorted = [...topics].sort((a, b) => b.tweetCount - a.tweetCount);

  return {
    totalTopics: topics.length,
    avgTweetsPerTopic: Math.round(totalTweets / topics.length * 10) / 10,
    largestTopic: sorted[0] ? { key: sorted[0].key, count: sorted[0].tweetCount } : null,
  };
}
