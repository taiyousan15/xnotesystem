// Stage F: Execute (編集・生成・合成)

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../../../utils/logger.js';
import { generateWithNanoBanana } from '../../fal/client.js';
import type { PipelineState, StageResult, EditRecipe } from '../types.js';

/**
 * レシピに基づいて動画を編集・合成
 */
export async function stageExecute(state: PipelineState): Promise<StageResult> {
  const { workingDir, sourceDir, outputDir, videoPath, recipe } = state;
  const warnings: string[] = [];

  if (!recipe || !videoPath) {
    return {
      stage: 'execute',
      success: false,
      duration: 0,
      error: 'Missing recipe or video path',
    };
  }

  const tempDir = join(workingDir, 'temp');
  const commandsLog: string[] = [];

  try {
    // 1. セグメントをカット
    logger.info('Cutting segments...');
    const segmentFiles = await cutSegments(videoPath, recipe, tempDir, commandsLog);

    // 2. 生成素材を作成
    logger.info('Generating assets...');
    const generatedAssets = await generateAssets(recipe, tempDir, commandsLog);

    // 3. タイムラインに従って結合
    logger.info('Concatenating timeline...');
    const intermediateVideo = await concatenateTimeline(
      segmentFiles,
      generatedAssets,
      tempDir,
      commandsLog
    );

    // 4. 音声正規化
    logger.info('Normalizing audio...');
    const normalizedVideo = await normalizeAudio(intermediateVideo, tempDir, commandsLog);

    // 5. 字幕を追加（オプション）
    logger.info('Adding subtitles...');
    const subtitledVideo = await addSubtitles(
      normalizedVideo,
      recipe,
      sourceDir,
      tempDir,
      commandsLog
    );

    // 6. 最終出力
    const finalPath = join(outputDir, 'final.mp4');
    execSync(`cp "${subtitledVideo}" "${finalPath}"`);

    // コマンドログを保存
    const logsDir = join(workingDir, 'logs');
    if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
    writeFileSync(join(logsDir, 'commands.log'), commandsLog.join('\n\n'));

    logger.info(`Final video: ${finalPath}`);

    return {
      stage: 'execute',
      success: true,
      duration: 0,
      output: {
        finalPath,
        segmentsProcessed: segmentFiles.length,
        assetsGenerated: generatedAssets.length,
      },
      warnings,
    };
  } catch (error) {
    // エラーログを保存
    const logsDir = join(workingDir, 'logs');
    if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
    writeFileSync(join(logsDir, 'commands.log'), commandsLog.join('\n\n'));

    return {
      stage: 'execute',
      success: false,
      duration: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * セグメントをカット
 */
async function cutSegments(
  videoPath: string,
  recipe: EditRecipe,
  tempDir: string,
  log: string[]
): Promise<string[]> {
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  const segmentFiles: string[] = [];
  const segmentsPath = join(tempDir, '..', 'segments.json');

  // セグメント情報を読み込み
  let segments: any[] = [];
  if (existsSync(segmentsPath)) {
    segments = JSON.parse(readFileSync(segmentsPath, 'utf-8'));
  }

  // Keep操作のセグメントのみ処理
  const keepOps = recipe.segments.filter((op) => op.action === 'keep' || op.action === 'modify');

  for (let i = 0; i < keepOps.length; i++) {
    const op = keepOps[i];
    const segment = segments.find((s: any) => s.id === op.segmentId);

    if (!segment) continue;

    const start = op.newStart ?? segment.start;
    const end = op.newEnd ?? segment.end;
    const outputPath = join(tempDir, `segment_${i.toString().padStart(3, '0')}.mp4`);

    const speed = op.speed || 1;
    const filterComplex = speed !== 1
      ? `-filter_complex "[0:v]setpts=${1 / speed}*PTS[v];[0:a]atempo=${speed}[a]" -map "[v]" -map "[a]"`
      : '';

    const cmd = `ffmpeg -ss ${start} -i "${videoPath}" -t ${end - start} ${filterComplex} -c:v libx264 -c:a aac -y "${outputPath}"`;

    log.push(`# Cut segment ${op.segmentId}\n${cmd}`);

    try {
      execSync(cmd, { stdio: 'ignore', timeout: 60000 });
      segmentFiles.push(outputPath);
    } catch (error) {
      logger.warn(`Failed to cut segment ${op.segmentId}`);
    }
  }

  return segmentFiles;
}

/**
 * 生成素材を作成
 */
async function generateAssets(
  recipe: EditRecipe,
  tempDir: string,
  log: string[]
): Promise<string[]> {
  const assets: string[] = [];

  for (const gen of recipe.generation) {
    try {
      if (gen.type === 'thumbnail' || gen.type === 'b-roll') {
        logger.info(`Generating ${gen.type}: ${gen.prompt.slice(0, 50)}...`);

        const result = await generateWithNanoBanana(
          {
            prompt: gen.prompt,
            num_images: 1,
            image_size: gen.type === 'thumbnail' ? 'landscape_16_9' : 'landscape_4_3',
          },
          {
            downloadResult: true,
            outputDir: tempDir,
            filename: `${gen.type}_${Date.now()}.png`,
          }
        );

        if (result.success && result.localPaths && result.localPaths.length > 0) {
          assets.push(result.localPaths[0]);
          log.push(`# Generated ${gen.type}\nPrompt: ${gen.prompt}\nOutput: ${result.localPaths[0]}`);
        }
      }
    } catch (error) {
      logger.warn(`Failed to generate ${gen.type}: ${error}`);
    }
  }

  return assets;
}

/**
 * タイムラインに従って結合
 */
async function concatenateTimeline(
  segmentFiles: string[],
  _generatedAssets: string[],
  tempDir: string,
  log: string[]
): Promise<string> {
  if (segmentFiles.length === 0) {
    throw new Error('No segments to concatenate');
  }

  if (segmentFiles.length === 1) {
    return segmentFiles[0];
  }

  // concat リストを作成
  const listPath = join(tempDir, 'concat_list.txt');
  const listContent = segmentFiles.map((f) => `file '${f}'`).join('\n');
  writeFileSync(listPath, listContent);

  const outputPath = join(tempDir, 'concatenated.mp4');
  const cmd = `ffmpeg -f concat -safe 0 -i "${listPath}" -c copy -y "${outputPath}"`;

  log.push(`# Concatenate segments\n${cmd}`);

  execSync(cmd, { stdio: 'ignore', timeout: 120000 });

  return outputPath;
}

/**
 * 音声を正規化
 */
async function normalizeAudio(
  videoPath: string,
  tempDir: string,
  log: string[]
): Promise<string> {
  const outputPath = join(tempDir, 'normalized.mp4');

  // loudnorm フィルターで音量正規化
  const cmd = `ffmpeg -i "${videoPath}" -af "loudnorm=I=-16:TP=-1.5:LRA=11" -c:v copy -c:a aac -y "${outputPath}"`;

  log.push(`# Normalize audio\n${cmd}`);

  try {
    execSync(cmd, { stdio: 'ignore', timeout: 120000 });
    return outputPath;
  } catch {
    // 正規化に失敗した場合は元のファイルを返す
    return videoPath;
  }
}

/**
 * 字幕を追加
 */
async function addSubtitles(
  videoPath: string,
  recipe: EditRecipe,
  sourceDir: string,
  tempDir: string,
  log: string[]
): Promise<string> {
  // 字幕ファイルを探す
  const srtPath = join(sourceDir, 'subtitles.srt');
  const vttPath = join(sourceDir, 'subtitles.vtt');

  let subtitlePath: string | null = null;
  if (existsSync(srtPath)) subtitlePath = srtPath;
  else if (existsSync(vttPath)) subtitlePath = vttPath;

  if (!subtitlePath) {
    // 字幕なしで返す
    return videoPath;
  }

  const outputPath = join(tempDir, 'subtitled.mp4');

  // 字幕を焼き込み
  const cmd = `ffmpeg -i "${videoPath}" -vf "subtitles=${subtitlePath}" -c:a copy -y "${outputPath}"`;

  log.push(`# Add subtitles\n${cmd}`);

  try {
    execSync(cmd, { stdio: 'ignore', timeout: 180000 });
    return outputPath;
  } catch {
    return videoPath;
  }
}
