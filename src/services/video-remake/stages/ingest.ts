// Stage B: Ingest (動画取得)

import { execSync } from 'child_process';
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../../../utils/logger.js';
import { checkYtDlp, downloadVideo } from '../../youtube/capture.js';
import { extractVideoId } from '../../youtube/analyzer.js';
import type { PipelineState, StageResult, VideoMetadata } from '../types.js';

/**
 * 動画を取得し、メタデータを保存
 */
export async function stageIngest(state: PipelineState): Promise<StageResult> {
  const { input, sourceDir } = state;
  const warnings: string[] = [];

  // yt-dlp チェック
  if (!checkYtDlp()) {
    return {
      stage: 'ingest',
      success: false,
      duration: 0,
      error: 'yt-dlp is not installed. Run: brew install yt-dlp',
    };
  }

  try {
    // Video ID 抽出
    const videoId = extractVideoId(input.sourceUrl);
    if (!videoId) {
      return {
        stage: 'ingest',
        success: false,
        duration: 0,
        error: 'Could not extract video ID from URL',
      };
    }

    logger.info(`Video ID: ${videoId}`);

    // メタデータ取得
    const metadata = await fetchVideoMetadata(input.sourceUrl, sourceDir);
    state.metadata = metadata;

    logger.info(`Title: ${metadata.title}`);
    logger.info(`Duration: ${formatDuration(metadata.duration)}`);
    logger.info(`Resolution: ${metadata.resolution.width}x${metadata.resolution.height}`);

    // 動画ダウンロード
    logger.info('Downloading video...');
    const videoPath = await downloadVideo(videoId, sourceDir);
    state.videoPath = videoPath;

    logger.info(`Downloaded: ${videoPath}`);

    // 字幕ダウンロード試行
    try {
      await downloadSubtitles(input.sourceUrl, sourceDir);
      logger.info('Subtitles downloaded');
    } catch {
      warnings.push('字幕のダウンロードに失敗しました。Whisperで生成します。');
    }

    // info.json 保存
    const infoPath = join(sourceDir, 'info.json');
    writeFileSync(infoPath, JSON.stringify(metadata, null, 2));

    return {
      stage: 'ingest',
      success: true,
      duration: 0,
      output: {
        videoId,
        videoPath,
        metadata,
      },
      warnings,
    };
  } catch (error) {
    return {
      stage: 'ingest',
      success: false,
      duration: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * yt-dlp でメタデータ取得
 */
async function fetchVideoMetadata(url: string, outputDir: string): Promise<VideoMetadata> {
  const jsonPath = join(outputDir, 'metadata.json');

  try {
    execSync(`yt-dlp --dump-json "${url}" > "${jsonPath}"`, {
      maxBuffer: 10 * 1024 * 1024,
    });

    const data = JSON.parse(require('fs').readFileSync(jsonPath, 'utf-8'));

    return {
      videoId: data.id,
      title: data.title,
      description: data.description,
      duration: data.duration,
      resolution: {
        width: data.width || 1920,
        height: data.height || 1080,
      },
      fps: data.fps || 30,
      codec: data.vcodec || 'unknown',
      fileSize: data.filesize || 0,
      hasSubtitles: (data.subtitles && Object.keys(data.subtitles).length > 0) || false,
      language: data.language || undefined,
    };
  } catch (error) {
    logger.error('Failed to fetch metadata:', error);
    throw new Error('Failed to fetch video metadata');
  }
}

/**
 * 字幕をダウンロード
 */
async function downloadSubtitles(url: string, outputDir: string): Promise<string | null> {
  const subtitlePath = join(outputDir, 'subtitles');

  try {
    execSync(
      `yt-dlp --write-subs --write-auto-subs --sub-langs "ja,en" --skip-download -o "${subtitlePath}" "${url}"`,
      { maxBuffer: 5 * 1024 * 1024, stdio: 'ignore' }
    );

    return subtitlePath;
  } catch {
    return null;
  }
}

/**
 * 秒を読みやすい形式に変換
 */
function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}
