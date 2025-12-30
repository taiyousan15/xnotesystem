import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../../utils/logger.js';

// YouTube動画の分析結果
export interface VideoAnalysis {
  videoId: string;
  title: string;
  transcript: string;
  summary: string;
  bulletPoints: string[];
  formattedTranscript: string;
  timestamps: TranscriptSegment[];
}

export interface TranscriptSegment {
  text: string;
  start: number;
  duration: number;
}

export interface FrameCapture {
  timestamp: number;
  imageUrl?: string;
  description: string;
}

/**
 * YouTube動画IDを抽出
 */
export function extractVideoId(urlOrId: string): string | null {
  // 既にIDの場合
  if (/^[a-zA-Z0-9_-]{11}$/.test(urlOrId)) {
    return urlOrId;
  }

  // 通常のYouTube URL
  const normalMatch = urlOrId.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (normalMatch) return normalMatch[1];

  // 短縮URL (youtu.be)
  const shortMatch = urlOrId.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];

  // 埋め込みURL
  const embedMatch = urlOrId.match(/embed\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch) return embedMatch[1];

  return null;
}

/**
 * YouTube動画のタイトルを取得
 */
export async function getVideoTitle(videoId: string): Promise<string> {
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
    const html = await response.text();

    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (titleMatch) {
      return titleMatch[1].replace(' - YouTube', '').trim();
    }
    return `Video ${videoId}`;
  } catch (error) {
    logger.error('Failed to get video title:', error);
    return `Video ${videoId}`;
  }
}

/**
 * YouTube字幕を取得（youtube-transcript-api相当）
 * 注: 実際の実装ではyoutube-transcript パッケージを使用
 */
export async function getTranscript(videoId: string): Promise<TranscriptSegment[]> {
  try {
    // YouTube Transcript API を使用
    // npm install youtube-transcript が必要
    const { YoutubeTranscript } = await import('youtube-transcript');
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);

    return transcript.map((item: any) => ({
      text: item.text,
      start: item.offset / 1000, // ミリ秒を秒に変換
      duration: item.duration / 1000,
    }));
  } catch (error) {
    logger.error('Failed to get transcript:', error);

    // フォールバック: 手動字幕取得を試行
    try {
      const response = await fetch(
        `https://www.youtube.com/api/timedtext?v=${videoId}&lang=ja`
      );
      if (response.ok) {
        const xml = await response.text();
        return parseTimedText(xml);
      }
    } catch (fallbackError) {
      logger.error('Fallback transcript fetch failed:', fallbackError);
    }

    return [];
  }
}

/**
 * XML形式の字幕をパース
 */
function parseTimedText(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const regex = /<text start="([^"]+)" dur="([^"]+)"[^>]*>([^<]*)<\/text>/g;
  let match;

  while ((match = regex.exec(xml)) !== null) {
    segments.push({
      start: parseFloat(match[1]),
      duration: parseFloat(match[2]),
      text: decodeHTMLEntities(match[3]),
    });
  }

  return segments;
}

function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n/g, ' ');
}

/**
 * 字幕を全文テキストに変換
 */
export function transcriptToText(segments: TranscriptSegment[]): string {
  return segments.map(s => s.text).join(' ');
}

/**
 * LLMで要約を生成
 */
export async function generateSummary(text: string): Promise<string> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `以下のYouTube動画の文字起こしを、簡潔で包括的な要約にまとめてください。
主要なポイントと重要な詳細を正確にキャプチャしてください。

文字起こし:
${text}

要約:`,
      },
    ],
  });

  return response.content[0].type === 'text' ? response.content[0].text : '';
}

/**
 * LLMで箇条書きを生成
 */
export async function generateBulletPoints(text: string): Promise<string[]> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `以下のテキストを5つの重要な箇条書きにまとめてください。
各項目は主要なポイントをキャプチャし、論理的な順序で整理してください。

テキスト:
${text}

箇条書き（JSON配列形式で出力）:`,
      },
    ],
  });

  const responseText = response.content[0].type === 'text' ? response.content[0].text : '[]';

  try {
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {
    // JSONパース失敗時は行で分割
    return responseText.split('\n').filter(line => line.trim().startsWith('-') || line.trim().startsWith('•'));
  }

  return [];
}

/**
 * 字幕をフォーマット（句読点・段落追加）
 */
export async function formatTranscript(text: string): Promise<string> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `以下のYouTube動画の文字起こしに、適切な句読点と段落分けを追加してください。
内容は変更せず、読みやすくフォーマットしてください。

文字起こし:
${text}

フォーマット済み:`,
      },
    ],
  });

  return response.content[0].type === 'text' ? response.content[0].text : text;
}

/**
 * 動画の主要シーンを特定（タイムスタンプベース）
 */
export async function identifyKeyScenes(
  transcript: TranscriptSegment[],
  numScenes = 10
): Promise<FrameCapture[]> {
  const client = getAnthropicClient();
  const fullText = transcriptToText(transcript);

  const response = await client.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `以下の動画の文字起こしを分析し、重要なシーン（キャプチャすべき瞬間）を${numScenes}個特定してください。

文字起こし:
${fullText}

各シーンについて、以下の形式でJSON配列を出力してください:
[
  {"timestamp": 秒数, "description": "シーンの説明"}
]

重要なシーン:`,
      },
    ],
  });

  const responseText = response.content[0].type === 'text' ? response.content[0].text : '[]';

  try {
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    logger.error('Failed to parse key scenes:', error);
  }

  // フォールバック: 均等にシーンを分割
  const duration = transcript[transcript.length - 1]?.start || 0;
  const interval = duration / numScenes;

  return Array.from({ length: numScenes }, (_, i) => ({
    timestamp: Math.round(i * interval),
    description: `シーン ${i + 1}`,
  }));
}

/**
 * YouTube動画を完全分析
 */
export async function analyzeVideo(urlOrId: string, options?: { useWhisperFallback?: boolean }): Promise<VideoAnalysis> {
  const videoId = extractVideoId(urlOrId);
  if (!videoId) {
    throw new Error('Invalid YouTube URL or video ID');
  }

  logger.info(`Analyzing video: ${videoId}`);

  // タイトルを取得
  const title = await getVideoTitle(videoId);

  // 字幕を取得（Whisperフォールバック対応）
  let transcriptSegments: TranscriptSegment[];
  let transcriptSource: 'youtube' | 'whisper' = 'youtube';

  if (options?.useWhisperFallback !== false) {
    // Whisperフォールバックを使用
    try {
      const { getTranscriptWithFallback } = await import('./transcribe.js');
      const result = await getTranscriptWithFallback(
        videoId,
        () => getTranscript(videoId)
      );
      transcriptSegments = result.segments;
      transcriptSource = result.source;
    } catch (error) {
      // Whisperも失敗した場合は元のエラーを投げる
      logger.error('Both YouTube subtitles and Whisper failed:', error);
      throw new Error('Could not retrieve transcript for this video. No subtitles available and Whisper transcription failed.');
    }
  } else {
    // 従来の方法のみ
    transcriptSegments = await getTranscript(videoId);
  }

  if (transcriptSegments.length === 0) {
    throw new Error('Could not retrieve transcript for this video');
  }

  logger.info(`Transcript source: ${transcriptSource}`);


  const transcript = transcriptToText(transcriptSegments);

  // 並列でLLM処理
  const [summary, bulletPoints, formattedTranscript] = await Promise.all([
    generateSummary(transcript),
    generateBulletPoints(transcript),
    formatTranscript(transcript),
  ]);

  return {
    videoId,
    title,
    transcript,
    summary,
    bulletPoints,
    formattedTranscript,
    timestamps: transcriptSegments,
  };
}

/**
 * Markdownドキュメントを生成
 */
export function generateMarkdown(analysis: VideoAnalysis): string {
  const bulletList = analysis.bulletPoints
    .map(point => `- ${point}`)
    .join('\n');

  return `# ${analysis.title}

## 要約
${analysis.summary}

## 主要ポイント
${bulletList}

## 文字起こし
${analysis.formattedTranscript}

---
Video ID: ${analysis.videoId}
Generated by: AI Video Analyzer
`;
}

// Anthropic クライアント
let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required');
    }
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}
