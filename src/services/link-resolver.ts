/**
 * Link Resolver Service
 * URL解析とSQLiteキャッシュ
 */

import * as fs from 'fs';
import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { LinkMetadata, LinkCacheRecord, DEFAULT_DIGEST_CONFIG } from '../types/digest.js';

// 設定
const CACHE_PATH = process.env.LINK_CACHE_PATH || DEFAULT_DIGEST_CONFIG.linkCache.path;
const TTL_DAYS = DEFAULT_DIGEST_CONFIG.linkCache.ttlDays;
const FETCH_TIMEOUT = 10000; // 10秒
const USER_AGENT = 'Mozilla/5.0 (compatible; AIDigestBot/1.0)';

// 除外ドメイン（解析不要）
const SKIP_DOMAINS = [
  'twitter.com',
  'x.com',
  't.co',
  'pic.twitter.com',
];

// SQLiteデータベース初期化
let db: Database.Database | null = null;

/**
 * データベース初期化
 */
export function initLinkCache(): void {
  if (db) return;

  // データディレクトリ確保
  const dir = CACHE_PATH.substring(0, CACHE_PATH.lastIndexOf('/'));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(CACHE_PATH);

  // テーブル作成
  db.exec(`
    CREATE TABLE IF NOT EXISTS link_cache (
      url_hash TEXT PRIMARY KEY,
      original_url TEXT NOT NULL,
      canonical_url TEXT,
      title TEXT,
      summary TEXT,
      domain TEXT,
      fetched_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_expires_at ON link_cache(expires_at);
  `);

  // 期限切れレコードを削除
  const now = new Date().toISOString();
  db.prepare('DELETE FROM link_cache WHERE expires_at < ?').run(now);
}

/**
 * データベースクローズ
 */
export function closeLinkCache(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * URLハッシュ生成
 */
function hashUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}

/**
 * ツイートテキストからURL抽出
 */
export function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
  const matches = text.match(urlRegex) || [];

  // 重複除去・フィルタリング
  const seen = new Set<string>();
  return matches.filter(url => {
    if (seen.has(url)) return false;
    seen.add(url);

    // 除外ドメインチェック
    try {
      const domain = new URL(url).hostname.replace('www.', '');
      return !SKIP_DOMAINS.some(skip => domain.includes(skip));
    } catch {
      return false;
    }
  });
}

/**
 * キャッシュからレコード取得
 */
function getFromCache(url: string): LinkCacheRecord | null {
  if (!db) initLinkCache();

  const hash = hashUrl(url);
  const now = new Date().toISOString();

  const row = db!.prepare(`
    SELECT * FROM link_cache
    WHERE url_hash = ? AND expires_at > ?
  `).get(hash, now) as LinkCacheRecord | undefined;

  return row || null;
}

/**
 * キャッシュにレコード保存
 * エラー時は短いTTL（1日）、成功時は通常TTL
 */
function saveToCache(record: Omit<LinkCacheRecord, 'url_hash' | 'expires_at'> & { error?: string }): void {
  if (!db) initLinkCache();

  const hash = hashUrl(record.original_url);
  // エラー時は1日、成功時は通常TTL
  const ttlDays = record.error ? 1 : TTL_DAYS;
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

  db!.prepare(`
    INSERT OR REPLACE INTO link_cache
    (url_hash, original_url, canonical_url, title, summary, domain, fetched_at, expires_at, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    hash,
    record.original_url,
    record.canonical_url,
    record.title,
    record.summary,
    record.domain,
    record.fetched_at,
    expiresAt,
    record.error || null
  );
}

/**
 * HTMLからOGメタデータ抽出
 */
function extractMetadata(html: string, url: string): { title: string; summary: string; canonicalUrl: string } {
  // タイトル抽出（優先順位: og:title > title > h1）
  let title = '';
  const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);

  title = ogTitleMatch?.[1] || titleMatch?.[1] || h1Match?.[1] || '';
  title = decodeHtmlEntities(title).trim().slice(0, 200);

  // 説明文抽出（優先順位: og:description > description）
  let summary = '';
  const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);

  summary = ogDescMatch?.[1] || descMatch?.[1] || '';
  summary = decodeHtmlEntities(summary).trim().slice(0, 500);

  // 正規URL抽出（優先順位: og:url > canonical > 元URL）
  let canonicalUrl = url;
  const ogUrlMatch = html.match(/<meta[^>]*property=["']og:url["'][^>]*content=["']([^"']+)["']/i);
  const canonicalMatch = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);

  canonicalUrl = ogUrlMatch?.[1] || canonicalMatch?.[1] || url;

  return { title, summary, canonicalUrl };
}

/**
 * HTMLエンティティデコード
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ');
}

/**
 * 単一URL解析
 */
async function resolveUrl(url: string): Promise<LinkMetadata> {
  // キャッシュチェック
  const cached = getFromCache(url);
  if (cached) {
    return {
      originalUrl: cached.original_url,
      canonicalUrl: cached.canonical_url,
      title: cached.title,
      summary: cached.summary,
      domain: cached.domain,
      fetchedAt: cached.fetched_at,
      error: (cached as any).error || undefined,
    };
  }

  const fetchedAt = new Date().toISOString();
  let domain = '';

  try {
    domain = new URL(url).hostname.replace('www.', '');
  } catch {
    // 無効なURL
    const errorResult: LinkMetadata = {
      originalUrl: url,
      canonicalUrl: url,
      title: '',
      summary: '',
      domain: '',
      fetchedAt,
      error: 'Invalid URL',
    };
    saveToCache({
      original_url: url,
      canonical_url: url,
      title: '',
      summary: '',
      domain: '',
      fetched_at: fetchedAt,
      error: 'Invalid URL',
    });
    return errorResult;
  }

  try {
    // fetch実行
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja,en;q=0.9',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const { title, summary, canonicalUrl } = extractMetadata(html, response.url || url);

    const result: LinkMetadata = {
      originalUrl: url,
      canonicalUrl,
      title,
      summary,
      domain,
      fetchedAt,
    };

    // キャッシュ保存
    saveToCache({
      original_url: url,
      canonical_url: canonicalUrl,
      title,
      summary,
      domain,
      fetched_at: fetchedAt,
    });

    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    const errorResult: LinkMetadata = {
      originalUrl: url,
      canonicalUrl: url,
      title: '',
      summary: '',
      domain,
      fetchedAt,
      error: errorMessage,
    };

    // エラーもキャッシュ（短期間の再試行防止）
    saveToCache({
      original_url: url,
      canonical_url: url,
      title: '',
      summary: '',
      domain,
      fetched_at: fetchedAt,
      error: errorMessage,
    });

    return errorResult;
  }
}

/**
 * 複数URL一括解析
 */
export async function resolveLinks(urls: string[]): Promise<LinkMetadata[]> {
  if (!db) initLinkCache();

  const results: LinkMetadata[] = [];

  // 並列実行（同時最大5件）
  const concurrency = 5;
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(url => resolveUrl(url)));
    results.push(...batchResults);
  }

  return results;
}

/**
 * ツイートテキストからリンク解析
 */
export async function resolveLinksFromTweet(tweetText: string): Promise<LinkMetadata[]> {
  const urls = extractUrls(tweetText);
  if (urls.length === 0) return [];

  return resolveLinks(urls);
}

/**
 * GitHub/arXiv等の特殊ドメイン判定
 */
export function detectSpecialDomain(url: string): {
  isGitHub: boolean;
  isArxiv: boolean;
  isHuggingFace: boolean;
  isPaper: boolean;
} {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return {
      isGitHub: hostname.includes('github.com') || hostname.includes('github.io'),
      isArxiv: hostname.includes('arxiv.org'),
      isHuggingFace: hostname.includes('huggingface.co'),
      isPaper: hostname.includes('arxiv.org') ||
               hostname.includes('openreview.net') ||
               hostname.includes('aclanthology.org') ||
               hostname.includes('papers.nips.cc'),
    };
  } catch {
    return { isGitHub: false, isArxiv: false, isHuggingFace: false, isPaper: false };
  }
}

/**
 * キャッシュ統計取得
 */
export function getCacheStats(): { total: number; expired: number; errors: number } {
  if (!db) initLinkCache();

  const now = new Date().toISOString();

  const total = (db!.prepare('SELECT COUNT(*) as count FROM link_cache').get() as any).count;
  const expired = (db!.prepare('SELECT COUNT(*) as count FROM link_cache WHERE expires_at < ?').get(now) as any).count;
  const errors = (db!.prepare('SELECT COUNT(*) as count FROM link_cache WHERE error IS NOT NULL').get() as any).count;

  return { total, expired, errors };
}

/**
 * キャッシュクリア（期限切れのみ or 全件）
 */
export function clearCache(expiredOnly: boolean = true): number {
  if (!db) initLinkCache();

  if (expiredOnly) {
    const now = new Date().toISOString();
    const result = db!.prepare('DELETE FROM link_cache WHERE expires_at < ?').run(now);
    return result.changes;
  } else {
    const result = db!.prepare('DELETE FROM link_cache').run();
    return result.changes;
  }
}
