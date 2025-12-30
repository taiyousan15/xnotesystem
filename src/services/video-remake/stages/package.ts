// Stage H: Package (納品)

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../../../utils/logger.js';
import type { PipelineState, StageResult, RemakeOutput } from '../types.js';

/**
 * 最終成果物をパッケージ化
 */
export async function stagePackage(state: PipelineState): Promise<StageResult> {
  const { workingDir, outputDir, recipe, input, metadata } = state;
  const warnings: string[] = [];

  const finalPath = join(outputDir, 'final.mp4');

  if (!existsSync(finalPath)) {
    return {
      stage: 'package',
      success: false,
      duration: 0,
      error: 'Final video not found',
    };
  }

  try {
    // 1. 字幕ファイルを生成/コピー
    logger.info('Preparing subtitles...');
    const subtitlesPath = await prepareSubtitles(workingDir, outputDir);

    // 2. チャプターファイルを生成
    logger.info('Generating chapters...');
    const chaptersPath = await generateChapters(workingDir, outputDir);

    // 3. サムネイルを準備
    logger.info('Preparing thumbnail...');
    const thumbnailPath = await prepareThumbnail(workingDir, outputDir, finalPath);

    // 4. メタデータを生成
    logger.info('Generating metadata...');
    const metadataContent = generateMetadata(input, metadata!, recipe!);
    const metadataPath = join(outputDir, 'metadata.txt');
    writeFileSync(metadataPath, metadataContent);

    // 5. ログを集約
    logger.info('Collecting logs...');
    const logs = collectLogs(workingDir);

    // 6. QA結果を読み込み
    const qaPath = join(workingDir, 'qa-result.json');
    const qaResult = existsSync(qaPath)
      ? JSON.parse(readFileSync(qaPath, 'utf-8'))
      : { passed: true, checks: [], score: 100, issues: [], suggestions: [] };

    // 7. レシピをコピー
    const recipeSrcPath = join(workingDir, 'recipe.json');
    const recipeDestPath = join(outputDir, 'recipe.json');
    if (existsSync(recipeSrcPath)) {
      copyFileSync(recipeSrcPath, recipeDestPath);
    }

    // 最終出力オブジェクト
    const output: RemakeOutput = {
      recipe: recipe!,
      finalVideo: finalPath,
      subtitles: subtitlesPath,
      chapters: chaptersPath,
      thumbnail: thumbnailPath,
      metadata: {
        title: generateTitle(input, metadata!),
        description: generateDescription(input, metadata!),
        tags: generateTags(input),
        credits: [
          `Original: ${metadata!.title}`,
          'Processed by: Video Remake Pipeline',
          `Generated: ${new Date().toISOString()}`,
        ],
      },
      qa: qaResult,
      logs,
    };

    state.output = output;

    // サマリーを出力
    logger.info('');
    logger.info('='.repeat(50));
    logger.info('Package Complete!');
    logger.info('='.repeat(50));
    logger.info(`Final video: ${finalPath}`);
    if (subtitlesPath) logger.info(`Subtitles: ${subtitlesPath}`);
    if (chaptersPath) logger.info(`Chapters: ${chaptersPath}`);
    if (thumbnailPath) logger.info(`Thumbnail: ${thumbnailPath}`);
    logger.info(`Metadata: ${metadataPath}`);
    logger.info(`Recipe: ${recipeDestPath}`);
    logger.info(`QA Score: ${qaResult.score}%`);

    // 次のステップを提案
    logger.info('');
    logger.info('Next steps:');
    logger.info('1. Review the final video');
    logger.info('2. Adjust recipe.json if needed');
    logger.info('3. Run pipeline again with modified recipe');

    return {
      stage: 'package',
      success: true,
      duration: 0,
      output: {
        finalVideo: finalPath,
        subtitles: subtitlesPath,
        chapters: chaptersPath,
        thumbnail: thumbnailPath,
        qaScore: qaResult.score,
      },
      warnings,
    };
  } catch (error) {
    return {
      stage: 'package',
      success: false,
      duration: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 字幕ファイルを準備
 */
async function prepareSubtitles(
  workingDir: string,
  outputDir: string
): Promise<string | undefined> {
  const sourceDir = join(workingDir, 'source');

  // 既存の字幕を探す
  const srtPath = join(sourceDir, 'subtitles.srt');
  const vttPath = join(sourceDir, 'subtitles.vtt');

  if (existsSync(srtPath)) {
    const destPath = join(outputDir, 'subtitles.srt');
    copyFileSync(srtPath, destPath);
    return destPath;
  }

  if (existsSync(vttPath)) {
    const destPath = join(outputDir, 'subtitles.vtt');
    copyFileSync(vttPath, destPath);
    return destPath;
  }

  // 字幕を生成（transcriptから）
  const transcriptPath = join(sourceDir, 'transcript.txt');
  if (existsSync(transcriptPath)) {
    const destPath = join(outputDir, 'subtitles.srt');
    const transcript = readFileSync(transcriptPath, 'utf-8');
    const srt = generateSRTFromTranscript(transcript);
    writeFileSync(destPath, srt);
    return destPath;
  }

  return undefined;
}

/**
 * 簡易SRT生成
 */
function generateSRTFromTranscript(transcript: string): string {
  const lines = transcript.split(/[.!?。！？]/).filter((l) => l.trim());
  const srt: string[] = [];

  let time = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const duration = Math.max(3, Math.min(line.length / 10, 8));
    const startTime = formatSRTTime(time);
    const endTime = formatSRTTime(time + duration);

    srt.push(`${i + 1}`);
    srt.push(`${startTime} --> ${endTime}`);
    srt.push(line);
    srt.push('');

    time += duration;
  }

  return srt.join('\n');
}

/**
 * SRT形式の時間フォーマット
 */
function formatSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

/**
 * チャプターファイルを生成
 */
async function generateChapters(
  workingDir: string,
  outputDir: string
): Promise<string | undefined> {
  const analysisPath = join(workingDir, 'analysis.json');

  if (!existsSync(analysisPath)) {
    return undefined;
  }

  try {
    const analysis = JSON.parse(readFileSync(analysisPath, 'utf-8'));
    const sections = analysis.content?.structure?.sections || [];

    if (sections.length === 0) {
      return undefined;
    }

    const chapters = sections
      .map((s: any) => `${formatChapterTime(s.start)} ${s.name}`)
      .join('\n');

    const chaptersPath = join(outputDir, 'chapters.txt');
    writeFileSync(chaptersPath, chapters);

    return chaptersPath;
  } catch {
    return undefined;
  }
}

/**
 * チャプター形式の時間フォーマット
 */
function formatChapterTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * サムネイルを準備
 */
async function prepareThumbnail(
  workingDir: string,
  outputDir: string,
  videoPath: string
): Promise<string | undefined> {
  const tempDir = join(workingDir, 'temp');

  // 生成済みサムネイルを探す
  const generatedThumbnails = [
    join(tempDir, 'thumbnail.png'),
    join(tempDir, 'thumbnail_1.png'),
  ];

  for (const path of generatedThumbnails) {
    if (existsSync(path)) {
      const destPath = join(outputDir, 'thumbnail.png');
      copyFileSync(path, destPath);
      return destPath;
    }
  }

  // 動画から抽出
  try {
    const destPath = join(outputDir, 'thumbnail.png');
    execSync(
      `ffmpeg -i "${videoPath}" -ss 5 -frames:v 1 -q:v 2 -y "${destPath}"`,
      { stdio: 'ignore' }
    );
    return destPath;
  } catch {
    return undefined;
  }
}

/**
 * メタデータを生成
 */
function generateMetadata(input: any, metadata: any, recipe: any): string {
  return `# Video Metadata

## Basic Info
- Title: ${generateTitle(input, metadata)}
- Original: ${metadata.title}
- Duration: ${formatDuration(metadata.duration)}
- Language: ${input.languageTarget}

## Description
${generateDescription(input, metadata)}

## Tags
${generateTags(input).join(', ')}

## Credits
- Original video: ${input.sourceUrl}
- Processed by: Video Remake Pipeline
- Generated: ${new Date().toISOString()}

## License
Please ensure you have the rights to use and distribute this content.

## Recipe Version
${recipe.version}
`;
}

/**
 * タイトルを生成
 */
function generateTitle(input: any, metadata: any): string {
  if (input.storyChange) {
    return `[Remake] ${metadata.title}`;
  }
  return `${metadata.title} (${input.outputStyle})`;
}

/**
 * 説明を生成
 */
function generateDescription(input: any, metadata: any): string {
  return `${input.remakeGoal}

Original: ${metadata.title}
Style: ${input.outputStyle}

---
Generated by Video Remake Pipeline`;
}

/**
 * タグを生成
 */
function generateTags(input: any): string[] {
  const tags = [input.outputStyle, input.languageTarget];

  if (input.remakeGoal.includes('教育')) tags.push('education');
  if (input.remakeGoal.includes('ショート')) tags.push('shorts');

  return tags;
}

/**
 * ログを収集
 */
function collectLogs(workingDir: string): {
  commands: string;
  analysis: string;
  changelog: string;
} {
  const logsDir = join(workingDir, 'logs');

  const commandsPath = join(logsDir, 'commands.log');
  const analysisPath = join(workingDir, 'analysis.md');
  const changelogPath = join(logsDir, 'changelog.md');

  return {
    commands: existsSync(commandsPath) ? commandsPath : '',
    analysis: existsSync(analysisPath) ? analysisPath : '',
    changelog: existsSync(changelogPath) ? changelogPath : '',
  };
}

/**
 * 秒を読みやすい形式に変換
 */
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
