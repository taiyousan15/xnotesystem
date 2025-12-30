// Stage E: Plan (台本 + EDL + 生成計画)

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../../../utils/logger.js';
import type {
  PipelineState,
  StageResult,
  EditRecipe,
  SegmentOperation,
  TimelineOperation,
  GenerationPrompt,
  NarrationScript,
} from '../types.js';

/**
 * 編集計画を作成
 * - 台本生成
 * - セグメント操作計画
 * - 生成素材計画
 * - レシピ出力
 */
export async function stagePlan(state: PipelineState): Promise<StageResult> {
  const { workingDir, sourceDir, input, segments, metadata } = state;
  const warnings: string[] = [];

  if (!segments || !metadata) {
    return {
      stage: 'plan',
      success: false,
      duration: 0,
      error: 'Missing segments or metadata',
    };
  }

  try {
    // 分析結果を読み込み
    const analysisPath = join(workingDir, 'analysis.json');
    const analysis = existsSync(analysisPath)
      ? JSON.parse(readFileSync(analysisPath, 'utf-8'))
      : null;

    // 1. 目標尺を計算
    const targetDuration = parseTargetDuration(input.durationTarget, metadata.duration);
    logger.info(`Target duration: ${formatDuration(targetDuration)}`);

    // 2. 編集方針を決定
    const editStrategy = determineEditStrategy(
      metadata.duration,
      targetDuration,
      input.outputStyle
    );
    logger.info(`Edit strategy: ${editStrategy.type}`);

    // 3. 台本生成
    logger.info('Generating script...');
    const narration = await generateNarration(
      segments,
      analysis,
      input,
      targetDuration
    );

    // 4. セグメント操作計画
    logger.info('Planning segment operations...');
    const segmentOps = planSegmentOperations(
      segments,
      targetDuration,
      editStrategy
    );

    // 5. タイムライン構築
    logger.info('Building timeline...');
    const timeline = buildTimeline(segmentOps, narration);

    // 6. 生成素材計画
    logger.info('Planning generation...');
    const generationPrompts = planGenerations(
      input,
      analysis,
      targetDuration
    );

    // 7. レシピ作成
    const recipe: EditRecipe = {
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      source: {
        url: input.sourceUrl,
        videoId: metadata.videoId,
        hash: '', // TODO: calculate file hash
      },
      segments: segmentOps,
      narration,
      timeline,
      generation: generationPrompts,
      dependencies: [
        { tool: 'ffmpeg', version: '6.0+' },
        { tool: 'yt-dlp', version: '2024+' },
      ],
      notes: [
        `Original duration: ${formatDuration(metadata.duration)}`,
        `Target duration: ${formatDuration(targetDuration)}`,
        `Edit strategy: ${editStrategy.type}`,
      ],
      rights: {
        verified: true,
        notes: 'User confirmed rights ownership',
      },
    };

    // レシピを保存
    const recipePath = join(workingDir, 'recipe.json');
    writeFileSync(recipePath, JSON.stringify(recipe, null, 2));

    // YAML形式でも保存
    const recipeYamlPath = join(workingDir, 'recipe.yaml');
    writeFileSync(recipeYamlPath, jsonToYaml(recipe));

    state.recipe = recipe;

    logger.info(`Recipe saved: ${recipePath}`);
    logger.info(`Segment operations: ${segmentOps.length}`);
    logger.info(`Timeline operations: ${timeline.length}`);
    logger.info(`Generation prompts: ${generationPrompts.length}`);

    return {
      stage: 'plan',
      success: true,
      duration: 0,
      output: {
        targetDuration,
        segmentOps: segmentOps.length,
        timelineOps: timeline.length,
        generations: generationPrompts.length,
      },
      warnings,
    };
  } catch (error) {
    return {
      stage: 'plan',
      success: false,
      duration: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 目標尺をパース
 */
function parseTargetDuration(target: string, originalDuration: number): number {
  if (target === 'original') return originalDuration;

  const match = target.match(/^(\d+)(s|m|h)?$/);
  if (!match) return originalDuration;

  const value = parseInt(match[1], 10);
  const unit = match[2] || 's';

  switch (unit) {
    case 'h':
      return value * 3600;
    case 'm':
      return value * 60;
    default:
      return value;
  }
}

/**
 * 編集方針を決定
 */
function determineEditStrategy(
  originalDuration: number,
  targetDuration: number,
  style: string
): { type: string; ratio: number } {
  const ratio = targetDuration / originalDuration;

  if (ratio < 0.5) {
    return { type: 'aggressive_cut', ratio };
  } else if (ratio < 0.8) {
    return { type: 'moderate_cut', ratio };
  } else if (ratio > 1.2) {
    return { type: 'extend', ratio };
  } else {
    return { type: 'restructure', ratio };
  }
}

/**
 * 台本を生成
 */
async function generateNarration(
  segments: any[],
  analysis: any,
  input: any,
  targetDuration: number
): Promise<NarrationScript | undefined> {
  if (!input.storyChange) {
    return undefined; // 台本変更なし
  }

  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `元の動画の内容を基に、以下の指示に従って新しい台本を作成してください。

元の内容要約: ${analysis?.content?.summary || ''}

変更指示: ${input.storyChange}
目標尺: ${targetDuration}秒
スタイル: ${input.outputStyle}

以下のJSON形式で回答:
{
  "voice": "ナレーション声質",
  "style": "スタイル",
  "segments": [
    {"timecode": "0:00", "text": "セリフ", "emotion": "感情"}
  ]
}`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}';

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {
    logger.warn('Failed to parse narration response');
  }

  return undefined;
}

/**
 * セグメント操作を計画
 */
function planSegmentOperations(
  segments: any[],
  targetDuration: number,
  strategy: { type: string; ratio: number }
): SegmentOperation[] {
  const ops: SegmentOperation[] = [];

  // スコアでソート
  const sorted = [...segments].sort((a, b) => (b.score || 0) - (a.score || 0));

  let currentDuration = 0;

  for (const seg of sorted) {
    const segDuration = seg.end - seg.start;

    if (currentDuration + segDuration <= targetDuration) {
      ops.push({
        segmentId: seg.id,
        action: 'keep',
        transition: 'cut',
      });
      currentDuration += segDuration;
    } else if (strategy.type === 'aggressive_cut') {
      ops.push({
        segmentId: seg.id,
        action: 'cut',
      });
    } else {
      // 速度調整で収める
      const speedRatio = segDuration / (targetDuration - currentDuration);
      if (speedRatio < 2) {
        ops.push({
          segmentId: seg.id,
          action: 'modify',
          speed: speedRatio,
          transition: 'fade',
        });
        currentDuration = targetDuration;
      } else {
        ops.push({
          segmentId: seg.id,
          action: 'cut',
        });
      }
    }
  }

  return ops;
}

/**
 * タイムラインを構築
 */
function buildTimeline(
  segmentOps: SegmentOperation[],
  narration?: NarrationScript
): TimelineOperation[] {
  const ops: TimelineOperation[] = [];
  let currentTime = 0;

  // ビデオトラック
  for (const segOp of segmentOps.filter((op) => op.action !== 'cut')) {
    ops.push({
      type: 'video',
      track: 0,
      start: currentTime,
      end: currentTime + 10, // 仮の長さ
      source: segOp.segmentId,
      properties: {
        speed: segOp.speed || 1,
        transition: segOp.transition,
      },
    });
    currentTime += 10;
  }

  // ナレーショントラック
  if (narration) {
    for (const seg of narration.segments) {
      ops.push({
        type: 'audio',
        track: 1,
        start: parseTimecode(seg.timecode),
        end: parseTimecode(seg.timecode) + 10,
        source: 'narration',
        properties: {
          text: seg.text,
          emotion: seg.emotion,
        },
      });
    }
  }

  return ops;
}

/**
 * 生成素材を計画
 */
function planGenerations(
  input: any,
  analysis: any,
  targetDuration: number
): GenerationPrompt[] {
  const prompts: GenerationPrompt[] = [];

  // サムネイル
  prompts.push({
    type: 'thumbnail',
    prompt: `${input.outputStyle}スタイルのYouTubeサムネイル、トピック: ${analysis?.content?.summary?.slice(0, 50) || '動画'}`,
    style: input.outputStyle,
  });

  // Bロール（尺が長い場合）
  if (targetDuration > 60) {
    prompts.push({
      type: 'b-roll',
      prompt: `${input.outputStyle}スタイルの補足映像`,
      duration: 5,
      insertAt: Math.floor(targetDuration / 2),
    });
  }

  return prompts;
}

/**
 * タイムコードをパース
 */
function parseTimecode(timecode: string): number {
  const parts = timecode.split(':').map(Number);
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

/**
 * 秒を読みやすい形式に変換
 */
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * JSONをYAML風に変換（簡易版）
 */
function jsonToYaml(obj: any, indent = 0): string {
  const spaces = '  '.repeat(indent);
  let result = '';

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;

    if (Array.isArray(value)) {
      result += `${spaces}${key}:\n`;
      for (const item of value) {
        if (typeof item === 'object') {
          result += `${spaces}- \n${jsonToYaml(item, indent + 2)}`;
        } else {
          result += `${spaces}- ${item}\n`;
        }
      }
    } else if (typeof value === 'object') {
      result += `${spaces}${key}:\n${jsonToYaml(value, indent + 1)}`;
    } else {
      result += `${spaces}${key}: ${value}\n`;
    }
  }

  return result;
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
