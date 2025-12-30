// Stage C: Normalize (分解・構造化)

import { execSync, exec } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { logger } from '../../../utils/logger.js';
import { checkFfmpeg, getVideoDuration } from '../../youtube/capture.js';
import { getTranscript, transcriptToText } from '../../youtube/analyzer.js';
import type { PipelineState, StageResult, VideoSegment } from '../types.js';

/**
 * 動画を分解・構造化
 * - 音声抽出
 * - 字幕抽出（なければWhisper ASR）
 * - シーン検出
 * - セグメント化
 */
export async function stageNormalize(state: PipelineState): Promise<StageResult> {
  const { workingDir, sourceDir, videoPath, metadata } = state;
  const warnings: string[] = [];

  if (!videoPath || !existsSync(videoPath)) {
    return {
      stage: 'normalize',
      success: false,
      duration: 0,
      error: 'Video file not found',
    };
  }

  if (!checkFfmpeg()) {
    return {
      stage: 'normalize',
      success: false,
      duration: 0,
      error: 'ffmpeg is not installed. Run: brew install ffmpeg',
    };
  }

  const segmentsDir = join(workingDir, 'segments');
  const framesDir = join(workingDir, 'frames');

  try {
    // 1. 音声抽出
    logger.info('Extracting audio...');
    const audioPath = await extractAudio(videoPath, sourceDir);
    logger.info(`Audio: ${audioPath}`);

    // 2. 字幕取得 (YouTube API or Whisper)
    logger.info('Getting transcript...');
    let transcript: string;
    let segments: VideoSegment[] = [];

    try {
      // まずYouTube APIで試行
      const transcriptSegments = await getTranscript(metadata!.videoId);
      if (transcriptSegments.length > 0) {
        transcript = transcriptToText(transcriptSegments);

        // セグメント変換
        segments = transcriptSegments.map((seg, i) => ({
          id: `seg_${i}`,
          start: seg.start,
          end: seg.start + seg.duration,
          type: 'speech' as const,
          content: seg.text,
        }));

        logger.info(`Transcript from YouTube: ${transcript.length} chars`);
      } else {
        throw new Error('No transcript from YouTube');
      }
    } catch {
      // Whisper でフォールバック
      logger.info('Falling back to Whisper ASR...');
      const whisperResult = await runWhisperASR(audioPath, sourceDir);
      transcript = whisperResult.text;
      segments = whisperResult.segments;
      warnings.push('Whisper ASRを使用しました（精度がYouTube字幕より低い可能性があります）');
    }

    // 字幕ファイルを保存
    const transcriptPath = join(sourceDir, 'transcript.txt');
    writeFileSync(transcriptPath, transcript);

    // 3. シーン検出
    logger.info('Detecting scenes...');
    const sceneSegments = await detectScenes(videoPath, segmentsDir);

    // セグメントをマージ
    segments = mergeSegments(segments, sceneSegments);

    // 4. キーフレーム抽出
    logger.info('Extracting keyframes...');
    await extractKeyframes(videoPath, sceneSegments, framesDir);

    // セグメント情報を保存
    const segmentsPath = join(workingDir, 'segments.json');
    writeFileSync(segmentsPath, JSON.stringify(segments, null, 2));

    state.segments = segments;

    logger.info(`Total segments: ${segments.length}`);

    return {
      stage: 'normalize',
      success: true,
      duration: 0,
      output: {
        audioPath,
        transcript,
        segmentsCount: segments.length,
      },
      warnings,
    };
  } catch (error) {
    return {
      stage: 'normalize',
      success: false,
      duration: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 音声を抽出
 */
async function extractAudio(videoPath: string, outputDir: string): Promise<string> {
  const audioPath = join(outputDir, 'audio.wav');

  execSync(
    `ffmpeg -i "${videoPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 -y "${audioPath}"`,
    { stdio: 'ignore' }
  );

  return audioPath;
}

/**
 * Whisper ASR を実行
 */
async function runWhisperASR(
  audioPath: string,
  outputDir: string
): Promise<{ text: string; segments: VideoSegment[] }> {
  // whisper CLI が必要 (pip install openai-whisper)
  // または whisper.cpp / faster-whisper

  try {
    // whisper CLI を試行
    execSync(`which whisper`, { stdio: 'ignore' });

    const outputPath = join(outputDir, 'whisper');
    execSync(
      `whisper "${audioPath}" --model small --language ja --output_format json --output_dir "${outputDir}"`,
      { maxBuffer: 50 * 1024 * 1024, timeout: 600000 }
    );

    // Whisper出力をパース
    const resultPath = join(outputDir, 'audio.json');
    if (existsSync(resultPath)) {
      const data = JSON.parse(require('fs').readFileSync(resultPath, 'utf-8'));

      const segments: VideoSegment[] = data.segments.map((seg: any, i: number) => ({
        id: `whisper_${i}`,
        start: seg.start,
        end: seg.end,
        type: 'speech' as const,
        content: seg.text,
      }));

      return {
        text: data.text,
        segments,
      };
    }
  } catch {
    // Whisperがインストールされていない場合
    throw new Error(
      'Whisper is not installed. Run: pip install openai-whisper'
    );
  }

  return { text: '', segments: [] };
}

/**
 * シーン検出 (FFmpeg scene detection)
 */
async function detectScenes(
  videoPath: string,
  outputDir: string
): Promise<VideoSegment[]> {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // FFmpeg scene detection
  const scenesPath = join(outputDir, 'scenes.txt');

  try {
    // Scene detection using ffprobe
    execSync(
      `ffprobe -show_frames -of compact=p=0 -f lavfi "movie=${videoPath},select=gt(scene\\,0.3)" 2>/dev/null | grep "media_type=video" > "${scenesPath}"`,
      { maxBuffer: 50 * 1024 * 1024 }
    );
  } catch {
    // フォールバック: 一定間隔でシーン分割
    const duration = await getVideoDuration(videoPath);
    const interval = 30; // 30秒ごと

    const segments: VideoSegment[] = [];
    for (let i = 0; i < duration; i += interval) {
      segments.push({
        id: `scene_${segments.length}`,
        start: i,
        end: Math.min(i + interval, duration),
        type: 'scene',
        description: `Scene ${segments.length + 1}`,
      });
    }

    return segments;
  }

  // パース結果（簡略化）
  const duration = await getVideoDuration(videoPath);
  const segments: VideoSegment[] = [{
    id: 'scene_0',
    start: 0,
    end: duration,
    type: 'scene',
  }];

  return segments;
}

/**
 * キーフレームを抽出
 */
async function extractKeyframes(
  videoPath: string,
  segments: VideoSegment[],
  outputDir: string
): Promise<void> {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  for (const segment of segments.slice(0, 20)) { // 最大20フレーム
    const timestamp = segment.start;
    const filename = `keyframe_${segment.id}.jpg`;
    const outputPath = join(outputDir, filename);

    try {
      execSync(
        `ffmpeg -ss ${timestamp} -i "${videoPath}" -frames:v 1 -q:v 2 -y "${outputPath}"`,
        { stdio: 'ignore' }
      );
      segment.keyFrame = outputPath;
    } catch {
      // キーフレーム抽出失敗は無視
    }
  }
}

/**
 * セグメントをマージ
 */
function mergeSegments(
  speechSegments: VideoSegment[],
  sceneSegments: VideoSegment[]
): VideoSegment[] {
  // 簡略化: 音声セグメントを優先、シーン情報を付加
  const merged = [...speechSegments];

  // スコア付け（音声があるセグメントは重要度高）
  for (const seg of merged) {
    seg.score = seg.content ? seg.content.length : 0;
  }

  return merged.sort((a, b) => a.start - b.start);
}
