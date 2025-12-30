// Video Remake Pipeline - Main Export

export * from './types.js';
export * from './pipeline.js';

import { VideoRemakePipeline, runRemakePipeline, resumePipeline } from './pipeline.js';
import type { RemakeInput, PipelineOptions, RemakeOutput } from './types.js';
import { logger } from '../../utils/logger.js';
import { checkYtDlp, checkFfmpeg } from '../youtube/capture.js';

/**
 * 依存関係をチェック
 */
export function checkDependencies(): {
  ytDlp: boolean;
  ffmpeg: boolean;
  whisper: boolean;
  allRequired: boolean;
  message: string;
} {
  const ytDlp = checkYtDlp();
  const ffmpeg = checkFfmpeg();

  // Whisper チェック（オプション）
  let whisper = false;
  try {
    require('child_process').execSync('which whisper', { stdio: 'ignore' });
    whisper = true;
  } catch {
    whisper = false;
  }

  const allRequired = ytDlp && ffmpeg;

  let message = '';
  if (!ytDlp) message += 'yt-dlp is missing. Install: brew install yt-dlp\n';
  if (!ffmpeg) message += 'ffmpeg is missing. Install: brew install ffmpeg\n';
  if (!whisper) message += 'whisper is optional. Install: pip install openai-whisper\n';

  return {
    ytDlp,
    ffmpeg,
    whisper,
    allRequired,
    message: message || 'All required dependencies are installed.',
  };
}

/**
 * クイックスタート: YouTube動画を要約ショート動画に変換
 */
export async function quickRemake(
  sourceUrl: string,
  options: {
    duration?: string;
    style?: string;
    language?: string;
  } = {}
): Promise<RemakeOutput> {
  const input: RemakeInput = {
    sourceUrl,
    remakeGoal: '要約ショート動画の作成',
    durationTarget: options.duration || '1m',
    languageTarget: options.language || 'ja',
    outputStyle: options.style || 'short',
  };

  return runRemakePipeline(input);
}

/**
 * フルカスタマイズ: 詳細オプション付きリメイク
 */
export async function customRemake(
  input: RemakeInput,
  options?: PipelineOptions
): Promise<RemakeOutput> {
  return runRemakePipeline(input, options);
}

/**
 * パイプラインを再開
 */
export async function continueRemake(workingDir: string): Promise<RemakeOutput | null> {
  return resumePipeline(workingDir);
}

/**
 * 使い方を表示
 */
export function printUsage(): void {
  console.log(`
Video Remake Pipeline
=====================

Usage:
  npm run remake <url> [options]

Options:
  --goal, -g      Remake goal (default: "要約ショート動画の作成")
  --duration, -d  Target duration (e.g., "1m", "5m", "original")
  --style, -s     Output style (e.g., "short", "education", "documentary")
  --lang, -l      Target language (e.g., "ja", "en")
  --story         Story change instructions
  --persona       Persona change instructions
  --forbidden     Comma-separated list of forbidden words

Examples:
  # Quick short video
  npm run remake https://youtube.com/watch?v=xxx

  # Custom duration and style
  npm run remake https://youtube.com/watch?v=xxx -d 5m -s education

  # With story change
  npm run remake https://youtube.com/watch?v=xxx --story "失敗→学び→成功の三幕構成に"

Dependencies:
  Required: yt-dlp, ffmpeg
  Optional: whisper (for ASR when YouTube subtitles unavailable)

  Install:
    brew install yt-dlp ffmpeg
    pip install openai-whisper
`);
}

// Default export
export default {
  VideoRemakePipeline,
  runRemakePipeline,
  resumePipeline,
  checkDependencies,
  quickRemake,
  customRemake,
  continueRemake,
  printUsage,
};
