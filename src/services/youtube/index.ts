// YouTube分析サービス
export * from './analyzer.js';
export * from './capture.js';
export * from './transcribe.js';

import {
  analyzeVideo,
  extractVideoId,
  identifyKeyScenes,
  generateMarkdown,
  VideoAnalysis,
} from './analyzer.js';
import {
  downloadVideo,
  captureFrames,
  captureFramesAtInterval,
  cleanupTempFiles,
  CapturedFrame,
  CaptureOptions,
  checkYtDlp,
  checkFfmpeg,
} from './capture.js';
import { logger } from '../../utils/logger.js';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface FullVideoAnalysis extends VideoAnalysis {
  frames: CapturedFrame[];
  markdownPath: string;
  outputDir: string;
}

/**
 * YouTube動画の完全分析（文字起こし + フレームキャプチャ）
 */
export async function analyzeVideoFull(
  urlOrId: string,
  options: {
    outputDir?: string;
    captureInterval?: number; // 秒単位。指定しない場合はキーシーンのみ
    numKeyScenes?: number;
  } = {}
): Promise<FullVideoAnalysis> {
  const videoId = extractVideoId(urlOrId);
  if (!videoId) {
    throw new Error('Invalid YouTube URL or video ID');
  }

  const outputDir = options.outputDir || `./output/${videoId}`;
  const framesDir = join(outputDir, 'frames');

  // ディレクトリ作成
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  if (!existsSync(framesDir)) {
    mkdirSync(framesDir, { recursive: true });
  }

  logger.info('='.repeat(50));
  logger.info(`Full video analysis: ${videoId}`);
  logger.info('='.repeat(50));

  // Step 1: 文字起こし・要約分析
  logger.info('Step 1: Analyzing transcript...');
  const analysis = await analyzeVideo(urlOrId);
  logger.info(`Title: ${analysis.title}`);
  logger.info(`Transcript length: ${analysis.transcript.length} characters`);

  // Step 2: キーシーン特定
  logger.info('Step 2: Identifying key scenes...');
  const numScenes = options.numKeyScenes || 10;
  const keyScenes = await identifyKeyScenes(analysis.timestamps, numScenes);
  logger.info(`Identified ${keyScenes.length} key scenes`);

  // Step 3: 動画ダウンロード（フレームキャプチャ用）
  let frames: CapturedFrame[] = [];
  const tempDir = join(outputDir, 'temp');

  if (checkYtDlp() && checkFfmpeg()) {
    logger.info('Step 3: Downloading video for frame capture...');

    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    try {
      const videoPath = await downloadVideo(videoId, tempDir);

      // Step 4: フレームキャプチャ
      logger.info('Step 4: Capturing frames...');

      const captureOptions: CaptureOptions = {
        outputDir: framesDir,
        format: 'jpg',
        quality: 90,
      };

      if (options.captureInterval) {
        // 一定間隔でキャプチャ
        frames = await captureFramesAtInterval(
          videoPath,
          options.captureInterval,
          captureOptions
        );
      } else {
        // キーシーンのみキャプチャ
        frames = await captureFrames(videoPath, keyScenes, captureOptions);
      }

      logger.info(`Captured ${frames.length} frames`);

      // 一時ファイルをクリーンアップ
      cleanupTempFiles(tempDir);
    } catch (error) {
      logger.error('Frame capture failed:', error);
      logger.warn('Continuing without frame capture...');
    }
  } else {
    logger.warn('yt-dlp or ffmpeg not installed. Skipping frame capture.');
    logger.info('Install with: brew install yt-dlp ffmpeg');
  }

  // Step 5: Markdownドキュメント生成
  logger.info('Step 5: Generating documentation...');
  const markdown = generateMarkdown(analysis);

  // フレーム情報を追加
  let markdownWithFrames = markdown;
  if (frames.length > 0) {
    const frameSection = `
## キャプチャフレーム

${frames.map(f => `### ${f.timestamp}s - ${f.description}
![Frame at ${f.timestamp}s](frames/${f.filename})
`).join('\n')}
`;
    markdownWithFrames = markdown.replace('---', frameSection + '\n---');
  }

  const markdownPath = join(outputDir, 'analysis.md');
  writeFileSync(markdownPath, markdownWithFrames);
  logger.info(`Documentation saved: ${markdownPath}`);

  // JSON形式でも保存
  const jsonPath = join(outputDir, 'analysis.json');
  writeFileSync(jsonPath, JSON.stringify({
    ...analysis,
    keyScenes,
    frames: frames.map(f => ({
      timestamp: f.timestamp,
      description: f.description,
      filename: f.filename,
    })),
  }, null, 2));
  logger.info(`JSON data saved: ${jsonPath}`);

  logger.info('='.repeat(50));
  logger.info('Analysis complete!');
  logger.info('='.repeat(50));

  return {
    ...analysis,
    frames,
    markdownPath,
    outputDir,
  };
}

/**
 * 依存関係のチェック
 */
export function checkDependencies(): {
  ytDlp: boolean;
  ffmpeg: boolean;
  allInstalled: boolean;
} {
  const ytDlp = checkYtDlp();
  const ffmpeg = checkFfmpeg();

  return {
    ytDlp,
    ffmpeg,
    allInstalled: ytDlp && ffmpeg,
  };
}

/**
 * 依存関係のインストール手順を表示
 */
export function getInstallInstructions(): string {
  const deps = checkDependencies();

  if (deps.allInstalled) {
    return 'All dependencies are installed!';
  }

  let instructions = 'Missing dependencies:\n\n';

  if (!deps.ytDlp) {
    instructions += '## yt-dlp (YouTube downloader)\n';
    instructions += 'Install with:\n';
    instructions += '```bash\nbrew install yt-dlp\n```\n\n';
  }

  if (!deps.ffmpeg) {
    instructions += '## ffmpeg (video processing)\n';
    instructions += 'Install with:\n';
    instructions += '```bash\nbrew install ffmpeg\n```\n\n';
  }

  return instructions;
}
