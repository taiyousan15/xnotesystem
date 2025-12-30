import { execSync, exec } from 'child_process';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { logger } from '../../utils/logger.js';
import { FrameCapture } from './analyzer.js';

export interface CaptureOptions {
  outputDir: string;
  format?: 'jpg' | 'png';
  quality?: number; // 1-100 for jpg
  width?: number;
  height?: number;
}

export interface CapturedFrame extends FrameCapture {
  filePath: string;
  filename: string;
}

/**
 * yt-dlpがインストールされているか確認
 */
export function checkYtDlp(): boolean {
  try {
    execSync('which yt-dlp', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * ffmpegがインストールされているか確認
 */
export function checkFfmpeg(): boolean {
  try {
    execSync('which ffmpeg', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * YouTube動画をダウンロード（一時ファイル）
 */
export async function downloadVideo(
  videoId: string,
  outputPath: string
): Promise<string> {
  if (!checkYtDlp()) {
    throw new Error('yt-dlp is not installed. Install with: brew install yt-dlp');
  }

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const outputFile = join(outputPath, `${videoId}.mp4`);

  logger.info(`Downloading video: ${videoId}`);

  return new Promise((resolve, reject) => {
    exec(
      `yt-dlp -f "best[ext=mp4]" -o "${outputFile}" "${url}"`,
      { maxBuffer: 50 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          logger.error('Download failed:', stderr);
          reject(new Error(`Failed to download video: ${error.message}`));
          return;
        }
        logger.info('Download complete');
        resolve(outputFile);
      }
    );
  });
}

/**
 * 動画から指定タイムスタンプでフレームをキャプチャ
 */
export async function captureFrame(
  videoPath: string,
  timestamp: number,
  outputPath: string,
  options: Partial<CaptureOptions> = {}
): Promise<string> {
  if (!checkFfmpeg()) {
    throw new Error('ffmpeg is not installed. Install with: brew install ffmpeg');
  }

  const format = options.format || 'jpg';
  const quality = options.quality || 90;
  const filename = `frame_${timestamp.toFixed(2).replace('.', '_')}.${format}`;
  const outputFile = join(outputPath, filename);

  // タイムスタンプを HH:MM:SS.mmm 形式に変換
  const hours = Math.floor(timestamp / 3600);
  const minutes = Math.floor((timestamp % 3600) / 60);
  const seconds = timestamp % 60;
  const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toFixed(3).padStart(6, '0')}`;

  const scaleFilter = options.width || options.height
    ? `-vf "scale=${options.width || -1}:${options.height || -1}"`
    : '';

  const qualityArg = format === 'jpg' ? `-q:v ${Math.round((100 - quality) / 3.3)}` : '';

  const command = `ffmpeg -ss ${timeStr} -i "${videoPath}" -frames:v 1 ${scaleFilter} ${qualityArg} -y "${outputFile}"`;

  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        logger.error(`Frame capture failed at ${timestamp}:`, stderr);
        reject(new Error(`Failed to capture frame: ${error.message}`));
        return;
      }
      resolve(outputFile);
    });
  });
}

/**
 * 複数のタイムスタンプでフレームをキャプチャ
 */
export async function captureFrames(
  videoPath: string,
  scenes: FrameCapture[],
  options: CaptureOptions
): Promise<CapturedFrame[]> {
  if (!existsSync(options.outputDir)) {
    mkdirSync(options.outputDir, { recursive: true });
  }

  const capturedFrames: CapturedFrame[] = [];

  for (const scene of scenes) {
    try {
      const filePath = await captureFrame(
        videoPath,
        scene.timestamp,
        options.outputDir,
        options
      );

      capturedFrames.push({
        ...scene,
        filePath,
        filename: filePath.split('/').pop() || '',
      });

      logger.info(`Captured frame at ${scene.timestamp}s: ${scene.description}`);
    } catch (error) {
      logger.error(`Failed to capture frame at ${scene.timestamp}:`, error);
    }
  }

  return capturedFrames;
}

/**
 * 動画から一定間隔でフレームをキャプチャ
 */
export async function captureFramesAtInterval(
  videoPath: string,
  intervalSeconds: number,
  options: CaptureOptions
): Promise<CapturedFrame[]> {
  if (!checkFfmpeg()) {
    throw new Error('ffmpeg is not installed');
  }

  if (!existsSync(options.outputDir)) {
    mkdirSync(options.outputDir, { recursive: true });
  }

  const format = options.format || 'jpg';
  const quality = options.quality || 90;
  const qualityArg = format === 'jpg' ? `-q:v ${Math.round((100 - quality) / 3.3)}` : '';

  const command = `ffmpeg -i "${videoPath}" -vf "fps=1/${intervalSeconds}" ${qualityArg} "${options.outputDir}/frame_%04d.${format}"`;

  logger.info(`Capturing frames every ${intervalSeconds} seconds...`);

  return new Promise((resolve, reject) => {
    exec(command, { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        logger.error('Interval capture failed:', stderr);
        reject(new Error(`Failed to capture frames: ${error.message}`));
        return;
      }

      // 生成されたファイルを列挙
      const files = readdirSync(options.outputDir)
        .filter(f => f.startsWith('frame_') && f.endsWith(`.${format}`))
        .sort();

      const frames: CapturedFrame[] = files.map((filename, index) => ({
        timestamp: index * intervalSeconds,
        description: `Frame at ${index * intervalSeconds}s`,
        filePath: join(options.outputDir, filename),
        filename,
      }));

      logger.info(`Captured ${frames.length} frames`);
      resolve(frames);
    });
  });
}

/**
 * 動画の長さを取得（秒）
 */
export async function getVideoDuration(videoPath: string): Promise<number> {
  if (!checkFfmpeg()) {
    throw new Error('ffmpeg is not installed');
  }

  return new Promise((resolve, reject) => {
    exec(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Failed to get duration: ${error.message}`));
          return;
        }
        resolve(parseFloat(stdout.trim()));
      }
    );
  });
}

/**
 * 一時ファイルをクリーンアップ
 */
export function cleanupTempFiles(directory: string): void {
  try {
    const files = readdirSync(directory);
    for (const file of files) {
      const filePath = join(directory, file);
      execSync(`rm -f "${filePath}"`);
    }
    logger.info(`Cleaned up ${files.length} files from ${directory}`);
  } catch (error) {
    logger.error('Cleanup failed:', error);
  }
}
