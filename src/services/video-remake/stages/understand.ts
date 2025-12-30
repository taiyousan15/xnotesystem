// Stage D: Understand (意味解析 + スタイル指紋)

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../../../utils/logger.js';
import type { PipelineState, StageResult, VideoSegment } from '../types.js';

interface ContentAnalysis {
  summary: string;
  structure: {
    type: string;
    sections: {
      name: string;
      start: number;
      end: number;
      purpose: string;
    }[];
  };
  keyPoints: string[];
  tone: string;
  targetAudience: string;
}

interface StyleFingerprint {
  tempo: 'slow' | 'medium' | 'fast';
  cutDensity: number; // cuts per minute
  textOverlayFrequency: number; // overlays per minute
  bRollRatio: number; // 0-1
  audioBalance: {
    voice: number;
    music: number;
    sfx: number;
  };
  colorPalette: string[];
}

/**
 * 動画の内容を理解し、スタイル指紋を抽出
 */
export async function stageUnderstand(state: PipelineState): Promise<StageResult> {
  const { workingDir, sourceDir, segments, metadata, input } = state;
  const warnings: string[] = [];

  if (!segments || segments.length === 0) {
    return {
      stage: 'understand',
      success: false,
      duration: 0,
      error: 'No segments found',
    };
  }

  try {
    // 字幕テキストを読み込み
    const transcriptPath = join(sourceDir, 'transcript.txt');
    const transcript = readFileSync(transcriptPath, 'utf-8');

    // 1. 内容分析
    logger.info('Analyzing content structure...');
    const contentAnalysis = await analyzeContent(transcript, input.languageTarget);

    logger.info(`Structure: ${contentAnalysis.structure.type}`);
    logger.info(`Sections: ${contentAnalysis.structure.sections.length}`);
    logger.info(`Key points: ${contentAnalysis.keyPoints.length}`);

    // 2. スタイル指紋抽出
    logger.info('Extracting style fingerprint...');
    const styleFingerprint = extractStyleFingerprint(segments, metadata!.duration);

    logger.info(`Tempo: ${styleFingerprint.tempo}`);
    logger.info(`Cut density: ${styleFingerprint.cutDensity.toFixed(1)}/min`);

    // 3. セグメントにスコア付け
    logger.info('Scoring segments...');
    const scoredSegments = await scoreSegments(segments, contentAnalysis);

    // 結果を保存
    const analysisPath = join(workingDir, 'analysis.json');
    writeFileSync(
      analysisPath,
      JSON.stringify(
        {
          content: contentAnalysis,
          style: styleFingerprint,
          segments: scoredSegments,
        },
        null,
        2
      )
    );

    // Markdown形式でも保存
    const markdownPath = join(workingDir, 'analysis.md');
    writeFileSync(markdownPath, generateAnalysisMarkdown(contentAnalysis, styleFingerprint));

    return {
      stage: 'understand',
      success: true,
      duration: 0,
      output: {
        summary: contentAnalysis.summary,
        sectionsCount: contentAnalysis.structure.sections.length,
        tempo: styleFingerprint.tempo,
        cutDensity: styleFingerprint.cutDensity,
      },
      warnings,
    };
  } catch (error) {
    return {
      stage: 'understand',
      success: false,
      duration: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * LLMで内容を分析
 */
async function analyzeContent(
  transcript: string,
  language: string
): Promise<ContentAnalysis> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `以下の動画の文字起こしを分析してください。

文字起こし:
${transcript.slice(0, 8000)}

以下のJSON形式で回答してください:
{
  "summary": "動画の要約（100-200文字）",
  "structure": {
    "type": "教育/エンタメ/ニュース/ドキュメンタリー/Vlog/その他",
    "sections": [
      {"name": "セクション名", "start": 開始秒, "end": 終了秒, "purpose": "目的"}
    ]
  },
  "keyPoints": ["重要ポイント1", "重要ポイント2", ...],
  "tone": "フォーマル/カジュアル/技術的/感情的",
  "targetAudience": "想定視聴者層"
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
    logger.warn('Failed to parse LLM response as JSON');
  }

  // フォールバック
  return {
    summary: transcript.slice(0, 200),
    structure: { type: 'unknown', sections: [] },
    keyPoints: [],
    tone: 'unknown',
    targetAudience: 'general',
  };
}

/**
 * スタイル指紋を抽出
 */
function extractStyleFingerprint(
  segments: VideoSegment[],
  totalDuration: number
): StyleFingerprint {
  const durationMinutes = totalDuration / 60;

  // カット密度を計算
  const sceneChanges = segments.filter((s) => s.type === 'scene').length;
  const cutDensity = sceneChanges / durationMinutes;

  // テンポを判定
  let tempo: 'slow' | 'medium' | 'fast' = 'medium';
  if (cutDensity < 2) tempo = 'slow';
  else if (cutDensity > 6) tempo = 'fast';

  // 音声セグメントの比率
  const speechSegments = segments.filter((s) => s.type === 'speech');
  const speechDuration = speechSegments.reduce((sum, s) => sum + (s.end - s.start), 0);
  const voiceRatio = speechDuration / totalDuration;

  return {
    tempo,
    cutDensity,
    textOverlayFrequency: 0, // 今後実装
    bRollRatio: 1 - voiceRatio,
    audioBalance: {
      voice: voiceRatio,
      music: (1 - voiceRatio) * 0.7,
      sfx: (1 - voiceRatio) * 0.3,
    },
    colorPalette: [], // 今後実装
  };
}

/**
 * セグメントにスコア付け
 */
async function scoreSegments(
  segments: VideoSegment[],
  analysis: ContentAnalysis
): Promise<VideoSegment[]> {
  // キーポイントに基づいてスコア付け
  const keyPointsLower = analysis.keyPoints.map((kp) => kp.toLowerCase());

  return segments.map((seg) => {
    let score = seg.score || 0;

    if (seg.content) {
      const contentLower = seg.content.toLowerCase();

      // キーポイントとの一致度
      for (const kp of keyPointsLower) {
        if (contentLower.includes(kp.slice(0, 20))) {
          score += 10;
        }
      }

      // 長さに基づくスコア
      score += Math.min(seg.content.length / 10, 20);
    }

    return { ...seg, score };
  });
}

/**
 * 分析結果をMarkdown形式で生成
 */
function generateAnalysisMarkdown(
  content: ContentAnalysis,
  style: StyleFingerprint
): string {
  return `# 動画分析レポート

## 要約
${content.summary}

## 構造
- **タイプ**: ${content.structure.type}
- **トーン**: ${content.tone}
- **対象視聴者**: ${content.targetAudience}

### セクション
${content.structure.sections.map((s) => `- ${s.name} (${s.start}s - ${s.end}s): ${s.purpose}`).join('\n')}

## 重要ポイント
${content.keyPoints.map((kp) => `- ${kp}`).join('\n')}

## スタイル指紋
- **テンポ**: ${style.tempo}
- **カット密度**: ${style.cutDensity.toFixed(1)}/分
- **音声バランス**: Voice ${(style.audioBalance.voice * 100).toFixed(0)}%, Music ${(style.audioBalance.music * 100).toFixed(0)}%, SFX ${(style.audioBalance.sfx * 100).toFixed(0)}%
- **Bロール比率**: ${(style.bRollRatio * 100).toFixed(0)}%
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
