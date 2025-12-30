import { exec } from 'child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { logger } from '../../utils/logger.js';
import { TranscriptSegment } from './analyzer.js';
import { checkYtDlp } from './capture.js';

const FAL_API_BASE = 'https://fal.run';

interface WhisperResponse {
  text: string;
  chunks?: Array<{
    text: string;
    timestamp: [number, number];
  }>;
}

/**
 * fal.ai APIキーを取得
 */
function getFalApiKey(): string {
  const key = process.env.FAL_KEY;
  if (!key) {
    throw new Error('FAL_KEY is not set in environment variables');
  }
  return key;
}

/**
 * YouTube動画から音声をダウンロード
 */
export async function downloadAudio(
  videoId: string,
  outputDir: string
): Promise<string> {
  if (!checkYtDlp()) {
    throw new Error('yt-dlp is not installed. Install with: brew install yt-dlp');
  }

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const outputFile = join(outputDir, `${videoId}.mp3`);

  // 既にダウンロード済みの場合はスキップ
  if (existsSync(outputFile)) {
    logger.info(`Audio already exists: ${outputFile}`);
    return outputFile;
  }

  logger.info(`Downloading audio: ${videoId}`);

  return new Promise((resolve, reject) => {
    exec(
      `yt-dlp -x --audio-format mp3 --audio-quality 0 -o "${outputFile}" "${url}"`,
      { maxBuffer: 100 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          logger.error('Audio download failed:', stderr);
          reject(new Error(`Failed to download audio: ${error.message}`));
          return;
        }
        logger.info('Audio download complete');
        resolve(outputFile);
      }
    );
  });
}

/**
 * 音声ファイルをfal.aiにアップロード
 */
async function uploadToFal(filePath: string): Promise<string> {
  const apiKey = getFalApiKey();

  // tmpfiles.orgにアップロード（fal.aiが推奨する方法）
  const fileBuffer = readFileSync(filePath);
  const blob = new Blob([fileBuffer], { type: 'audio/mpeg' });

  const formData = new FormData();
  formData.append('file', blob, 'audio.mp3');

  const response = await fetch('https://tmpfiles.org/api/v1/upload', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status}`);
  }

  const result = await response.json();
  // tmpfiles.orgのURLをdlリンクに変換
  const uploadUrl = result.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');

  logger.info(`Uploaded audio to: ${uploadUrl}`);
  return uploadUrl;
}

/**
 * fal.ai Whisperで音声を文字起こし
 */
export async function transcribeWithWhisper(
  audioUrl: string,
  language?: string
): Promise<WhisperResponse> {
  const apiKey = getFalApiKey();

  logger.info('Transcribing audio with Whisper...');

  const response = await fetch(`${FAL_API_BASE}/fal-ai/whisper`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      task: 'transcribe',
      language: language || null, // null = auto-detect
      chunk_level: 'segment',
      version: '3',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Whisper API error (${response.status}): ${error}`);
  }

  return response.json();
}

/**
 * Whisperレスポンスをトランスクリプトセグメントに変換
 */
export function whisperToSegments(response: WhisperResponse): TranscriptSegment[] {
  if (!response.chunks || response.chunks.length === 0) {
    // チャンクがない場合は全体を1つのセグメントとして返す
    return [{
      text: response.text,
      start: 0,
      duration: 0,
    }];
  }

  return response.chunks.map((chunk) => ({
    text: chunk.text,
    start: chunk.timestamp[0],
    duration: chunk.timestamp[1] - chunk.timestamp[0],
  }));
}

/**
 * YouTube動画の音声から文字起こし（フル処理）
 */
export async function transcribeYouTubeAudio(
  videoId: string,
  options: {
    outputDir?: string;
    language?: string;
    keepAudioFile?: boolean;
  } = {}
): Promise<TranscriptSegment[]> {
  const outputDir = options.outputDir || './output/audio';

  try {
    // 1. 音声をダウンロード
    const audioPath = await downloadAudio(videoId, outputDir);

    // 2. fal.aiにアップロード
    const audioUrl = await uploadToFal(audioPath);

    // 3. Whisperで文字起こし
    const whisperResult = await transcribeWithWhisper(audioUrl, options.language);

    // 4. セグメントに変換
    const segments = whisperToSegments(whisperResult);

    // 5. 一時ファイルを削除（オプション）
    if (!options.keepAudioFile && existsSync(audioPath)) {
      unlinkSync(audioPath);
      logger.info('Cleaned up audio file');
    }

    logger.info(`Transcription complete: ${segments.length} segments`);
    return segments;

  } catch (error) {
    logger.error('Transcription failed:', error);
    throw error;
  }
}

/**
 * 字幕取得を試行し、失敗したら音声文字起こしにフォールバック
 */
export async function getTranscriptWithFallback(
  videoId: string,
  getYoutubeTranscript: () => Promise<TranscriptSegment[]>,
  options?: { language?: string }
): Promise<{ segments: TranscriptSegment[]; source: 'youtube' | 'whisper' }> {
  // まずYouTube字幕を試行
  try {
    const segments = await getYoutubeTranscript();
    if (segments.length > 0) {
      logger.info('Using YouTube subtitles');
      return { segments, source: 'youtube' };
    }
  } catch (error) {
    logger.warn('YouTube subtitles not available, falling back to Whisper');
  }

  // Whisperにフォールバック
  const segments = await transcribeYouTubeAudio(videoId, {
    language: options?.language,
  });

  return { segments, source: 'whisper' };
}
