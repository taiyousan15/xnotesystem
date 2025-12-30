/**
 * Digest Builder Service
 * 日次ダイジェストのオーケストレーション
 */

import {
  CollectedTweet,
  AnalyzedTweet,
  Topic,
  DigestStats,
  DigestResult,
  LLMCategory,
  ContentType,
  ALL_CATEGORIES,
  ALL_TYPES,
  DEFAULT_DIGEST_CONFIG,
} from '../types/digest.js';
import { analyzeAllTweets } from './llm-analyzer.js';
import { resolveLinksFromTweet, initLinkCache, closeLinkCache } from './link-resolver.js';
import { extractTopics, getTopicStats } from './topic-extractor.js';
import { upsertTweets, getDatabaseParentId, createDigestPage } from './notion-upsert.js';
import { buildTweetPageContent, buildDigestPageContent } from './notion-page-builder.js';
import { logger } from '../utils/logger.js';

// 設定
const TOP_PICK_COUNT = DEFAULT_DIGEST_CONFIG.selection.topPickCount;
const MAX_PER_AUTHOR = DEFAULT_DIGEST_CONFIG.selection.maxPerAuthor;
const MAX_PER_TOPIC = DEFAULT_DIGEST_CONFIG.selection.maxPerTopic;
const MIN_CATEGORY_DIVERSITY = DEFAULT_DIGEST_CONFIG.selection.minCategoryDiversity;
const NOTION_DB_VIEW_URL = process.env.NOTION_DB_VIEW_URL || DEFAULT_DIGEST_CONFIG.notion.dbViewUrl;

/**
 * CollectedTweetからAnalyzedTweetの基本構造を作成
 */
function toBaseAnalyzedTweet(tweet: CollectedTweet): Omit<AnalyzedTweet, 'analysis' | 'links' | 'topicKey' | 'topicLabel' | 'isTopPick' | 'combinedScore'> {
  return {
    id: tweet.id,
    authorId: tweet.authorId,
    authorUsername: tweet.authorUsername,
    content: tweet.content,
    createdAt: tweet.createdAt,
    url: tweet.url,
    likes: tweet.likes,
    retweets: tweet.retweets,
    replies: tweet.replies,
    quotes: tweet.quotes,
  };
}

/**
 * 統合スコアを計算
 */
function calculateCombinedScore(tweet: AnalyzedTweet): number {
  const llmScore = tweet.analysis.score;

  // エンゲージメントスコア（正規化）
  const engagement = tweet.likes + tweet.retweets * 2 + tweet.replies * 0.5 + tweet.quotes * 3;
  const engagementScore = Math.min(100, Math.log10(engagement + 1) * 25);

  // 統合スコア = LLM 60% + エンゲージメント 40%
  return Math.round(llmScore * 0.6 + engagementScore * 0.4);
}

/**
 * 重複圧縮（clusterKeyベース）
 */
function deduplicateByCluster(tweets: AnalyzedTweet[]): AnalyzedTweet[] {
  const clusterMap = new Map<string, AnalyzedTweet>();

  for (const tweet of tweets) {
    const key = tweet.analysis.clusterKey;
    const existing = clusterMap.get(key);

    if (!existing || tweet.combinedScore > existing.combinedScore) {
      clusterMap.set(key, tweet);
    }
  }

  return Array.from(clusterMap.values());
}

/**
 * Top 25選定
 */
function selectTopPicks(tweets: AnalyzedTweet[]): AnalyzedTweet[] {
  // 重複圧縮
  const deduplicated = deduplicateByCluster(tweets);

  // スコア降順ソート
  const sorted = [...deduplicated].sort((a, b) => b.combinedScore - a.combinedScore);

  const selected: AnalyzedTweet[] = [];
  const authorCounts: Record<string, number> = {};
  const topicCounts: Record<string, number> = {};
  const categoryCovered: Set<string> = new Set();

  // Phase 1: 多様性確保（必須カテゴリから各1件）
  for (const category of MIN_CATEGORY_DIVERSITY) {
    const candidate = sorted.find(t =>
      t.analysis.category === category &&
      !selected.includes(t)
    );

    if (candidate) {
      selected.push(candidate);
      authorCounts[candidate.authorUsername] = (authorCounts[candidate.authorUsername] || 0) + 1;
      topicCounts[candidate.topicKey] = (topicCounts[candidate.topicKey] || 0) + 1;
      categoryCovered.add(category);
    }
  }

  // Phase 2: スコア順に追加（制約チェック付き）
  for (const tweet of sorted) {
    if (selected.length >= TOP_PICK_COUNT) break;
    if (selected.includes(tweet)) continue;

    const author = tweet.authorUsername;
    const topic = tweet.topicKey;

    // 著者制限チェック
    if ((authorCounts[author] || 0) >= MAX_PER_AUTHOR) continue;

    // トピック制限チェック
    if ((topicCounts[topic] || 0) >= MAX_PER_TOPIC) continue;

    selected.push(tweet);
    authorCounts[author] = (authorCounts[author] || 0) + 1;
    topicCounts[topic] = (topicCounts[topic] || 0) + 1;
    categoryCovered.add(tweet.analysis.category);
  }

  // 選定理由を付与
  for (const tweet of selected) {
    tweet.isTopPick = true;
    tweet.whySelected = generateWhySelected(tweet, categoryCovered.has(tweet.analysis.category));
  }

  return selected;
}

/**
 * 選定理由を生成
 */
function generateWhySelected(tweet: AnalyzedTweet, isDiversityPick: boolean): string {
  const reasons: string[] = [];

  if (isDiversityPick) {
    reasons.push(`${tweet.analysis.category}カテゴリの代表`);
  }

  if (tweet.combinedScore >= 80) {
    reasons.push('高スコア');
  }

  if (tweet.likes >= 100 || tweet.retweets >= 50) {
    reasons.push('高エンゲージメント');
  }

  if (tweet.analysis.type === 'News') {
    reasons.push('最新ニュース');
  } else if (tweet.analysis.type === 'Papers') {
    reasons.push('研究論文');
  } else if (tweet.analysis.type === 'Tools-OSS') {
    reasons.push('ツール/OSS');
  }

  return reasons.join('・') || '重要トピック';
}

/**
 * 統計情報を計算
 */
function calculateStats(tweets: AnalyzedTweet[], topPicks: AnalyzedTweet[]): DigestStats {
  const categoryDistribution: Record<LLMCategory, number> = {} as Record<LLMCategory, number>;
  const typeDistribution: Record<ContentType, number> = {} as Record<ContentType, number>;
  const authorCounts: Record<string, number> = {};

  // 初期化
  for (const cat of ALL_CATEGORIES) {
    categoryDistribution[cat] = 0;
  }
  for (const type of ALL_TYPES) {
    typeDistribution[type] = 0;
  }

  // 集計
  for (const tweet of tweets) {
    categoryDistribution[tweet.analysis.category]++;
    typeDistribution[tweet.analysis.type]++;
    authorCounts[tweet.authorUsername] = (authorCounts[tweet.authorUsername] || 0) + 1;
  }

  // 上位著者
  const topAuthors = Object.entries(authorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([author, count]) => ({ author, count }));

  // 平均スコア
  const avgScore = tweets.length > 0
    ? tweets.reduce((sum, t) => sum + t.combinedScore, 0) / tweets.length
    : 0;

  return {
    totalCount: tweets.length,
    categoryDistribution,
    typeDistribution,
    topAuthors,
    topPickCount: topPicks.length,
    averageScore: Math.round(avgScore * 10) / 10,
  };
}

/**
 * 日次ダイジェストをビルド
 */
export async function buildDailyDigest(
  collectedTweets: CollectedTweet[],
  digestDate: string,
  options: {
    skipNotion?: boolean;
    skipDiscord?: boolean;
    dryRun?: boolean;
  } = {}
): Promise<DigestResult> {
  const errors: string[] = [];
  const collectedAt = new Date().toISOString();

  logger.info(`Building digest for ${digestDate} with ${collectedTweets.length} tweets`);

  // Phase 1: リンクキャッシュ初期化
  initLinkCache();

  try {
    // Phase 2: LLM解析（全件）
    logger.info('Phase 2: LLM analysis...');
    const analysisResults = await analyzeAllTweets(collectedTweets);

    // 解析結果をマージ
    const analyzedTweets: AnalyzedTweet[] = [];
    for (const tweet of collectedTweets) {
      const analysis = analysisResults.get(tweet.id);
      if (!analysis) {
        errors.push(`No analysis for tweet ${tweet.id}`);
        continue;
      }

      const base = toBaseAnalyzedTweet(tweet);
      analyzedTweets.push({
        ...base,
        analysis,
        links: [],
        topicKey: '',
        topicLabel: '',
        isTopPick: false,
        combinedScore: 0,
      });
    }

    // Phase 3: リンク解析
    logger.info('Phase 3: Link resolution...');
    for (const tweet of analyzedTweets) {
      try {
        tweet.links = await resolveLinksFromTweet(tweet.content);
      } catch (error) {
        errors.push(`Link resolution failed for ${tweet.id}: ${error}`);
        tweet.links = [];
      }
    }

    // Phase 4: 統合スコア計算
    logger.info('Phase 4: Score calculation...');
    for (const tweet of analyzedTweets) {
      tweet.combinedScore = calculateCombinedScore(tweet);
    }

    // Phase 5: トピック抽出
    logger.info('Phase 5: Topic extraction...');
    const { topics, tweetTopicMapping } = await extractTopics(analyzedTweets);

    // トピック情報を付与
    for (const tweet of analyzedTweets) {
      const topicKey = tweetTopicMapping.get(tweet.id) || 'other';
      tweet.topicKey = topicKey;
      const topic = topics.find(t => t.key === topicKey);
      tweet.topicLabel = topic?.label || topicKey;
    }

    // Phase 6: Top 25選定
    logger.info('Phase 6: Top picks selection...');
    const topPicks = selectTopPicks(analyzedTweets);

    // Phase 7: 統計計算
    const stats = calculateStats(analyzedTweets, topPicks);

    // Phase 8: Notion Upsert
    let digestPageId = '';
    let digestPageUrl = '';

    if (!options.skipNotion && !options.dryRun) {
      logger.info('Phase 8: Notion upsert...');

      // 全件Upsert
      const upsertResult = await upsertTweets(
        analyzedTweets,
        {
          digestDate,
          isTopPick: false,
          isPriority: false,
          addPageContent: true,
        },
        buildTweetPageContent
      );

      // Top Picksの更新
      for (const tweet of topPicks) {
        const pageId = upsertResult.pageIds.get(tweet.id);
        if (pageId) {
          // Top Pickフラグを更新（別途実装が必要な場合）
        }
      }

      // 日次ダイジェストページ作成
      const parentId = await getDatabaseParentId();
      if (parentId) {
        const digestContent = buildDigestPageContent(
          digestDate,
          stats,
          topics,
          topPicks,
          NOTION_DB_VIEW_URL
        );

        const digestPage = await createDigestPage(
          parentId,
          `Daily AI Digest ${digestDate}`,
          digestContent
        );

        digestPageId = digestPage.pageId;
        digestPageUrl = digestPage.url;
      }
    }

    // 結果を返す
    const result: DigestResult = {
      date: digestDate,
      collectedAt,
      stats,
      topics,
      topPicks,
      allTweets: analyzedTweets,
      digestPageId,
      digestPageUrl,
      errors,
    };

    logger.info(`Digest built: ${stats.totalCount} tweets, ${topPicks.length} top picks, ${topics.length} topics`);

    return result;

  } finally {
    closeLinkCache();
  }
}

/**
 * 結果をJSON形式で保存
 */
export function serializeDigestResult(result: DigestResult): string {
  return JSON.stringify({
    ...result,
    // MapはJSONにシリアライズできないので変換
    topPicks: result.topPicks.map(t => ({
      ...t,
      // linksのMapも処理
    })),
    allTweets: result.allTweets.map(t => ({
      ...t,
    })),
  }, null, 2);
}

/**
 * Discord投稿用のデータを生成
 */
export function prepareDiscordPost(result: DigestResult): {
  statsEmbed: string;
  topicsEmbed: string;
  topPicksEmbeds: string[];
  notionUrl: string;
} {
  // 統計埋め込み
  const statsLines = [
    `## 📊 Daily AI Digest ${result.date}`,
    '',
    `**収集件数:** ${result.stats.totalCount}件`,
    `**Top Pick:** ${result.stats.topPickCount}件`,
    `**平均スコア:** ${result.stats.averageScore}`,
    '',
    '**カテゴリ上位:**',
    ...Object.entries(result.stats.categoryDistribution)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cat, count]) => `- ${cat}: ${count}件`),
  ];

  // トピック埋め込み
  const topicsLines = [
    '## 🗂️ 今日のトピック',
    '',
    ...result.topics.slice(0, 8).map(t =>
      `**${t.label}** (${t.tweetCount}件)\n└ ${t.summary}`
    ),
  ];

  // Top Picks埋め込み（25件を5件ずつ分割）
  const topPicksEmbeds: string[] = [];
  for (let i = 0; i < result.topPicks.length; i += 5) {
    const chunk = result.topPicks.slice(i, i + 5);
    const lines = [
      `## ⭐ Top Picks (${i + 1}-${i + chunk.length})`,
      '',
    ];

    for (const tweet of chunk) {
      lines.push(`### ${tweet.analysis.titleJa}`);
      for (const bullet of tweet.analysis.summaryBulletsJa.slice(0, 2)) {
        lines.push(`- ${bullet}`);
      }
      lines.push(`📊 Score: ${tweet.combinedScore} | 🏷️ ${tweet.analysis.category}`);
      lines.push(`🔗 ${tweet.url}`);
      lines.push('');
    }

    topPicksEmbeds.push(lines.join('\n'));
  }

  return {
    statsEmbed: statsLines.join('\n'),
    topicsEmbed: topicsLines.join('\n'),
    topPicksEmbeds,
    notionUrl: result.digestPageUrl || NOTION_DB_VIEW_URL,
  };
}
