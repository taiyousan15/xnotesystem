// Video Remake Pipeline Types

/**
 * パイプライン入力パラメータ
 */
export interface RemakeInput {
  sourceUrl: string;
  remakeGoal: string;
  durationTarget: string; // e.g., "5m", "15m", "original"
  languageTarget: string; // e.g., "ja", "en"
  outputStyle: string; // e.g., "education", "short", "documentary"

  // Optional
  personaChange?: string;
  personaAssets?: string[];
  storyChange?: string;
  forbidden?: string[];
  brandGuide?: {
    colors?: string[];
    fonts?: string[];
    logo?: string;
  };
}

/**
 * パイプラインステージ
 */
export type PipelineStage =
  | 'rights_gate'
  | 'ingest'
  | 'normalize'
  | 'understand'
  | 'plan'
  | 'execute'
  | 'qa'
  | 'package';

/**
 * ステージ結果
 */
export interface StageResult {
  stage: PipelineStage;
  success: boolean;
  duration: number;
  output?: Record<string, unknown>;
  error?: string;
  warnings?: string[];
}

/**
 * 動画メタデータ
 */
export interface VideoMetadata {
  videoId: string;
  title: string;
  description?: string;
  duration: number; // seconds
  resolution: { width: number; height: number };
  fps: number;
  codec: string;
  fileSize: number;
  hasSubtitles: boolean;
  language?: string;
}

/**
 * セグメント情報
 */
export interface VideoSegment {
  id: string;
  start: number;
  end: number;
  type: 'scene' | 'chapter' | 'silence' | 'speech';
  content?: string; // transcript text if speech
  description?: string;
  keyFrame?: string; // path to keyframe image
  score?: number; // importance score
}

/**
 * 編集レシピ
 */
export interface EditRecipe {
  version: string;
  createdAt: string;
  source: {
    url: string;
    videoId: string;
    hash: string;
  };
  segments: SegmentOperation[];
  narration?: NarrationScript;
  timeline: TimelineOperation[];
  generation: GenerationPrompt[];
  dependencies: {
    tool: string;
    version: string;
  }[];
  notes: string[];
  rights: {
    verified: boolean;
    notes: string;
  };
}

/**
 * セグメント操作
 */
export interface SegmentOperation {
  segmentId: string;
  action: 'keep' | 'cut' | 'modify' | 'replace';
  newStart?: number;
  newEnd?: number;
  speed?: number;
  transition?: 'cut' | 'fade' | 'dissolve';
}

/**
 * ナレーション台本
 */
export interface NarrationScript {
  voice?: string;
  style?: string;
  segments: {
    timecode: string;
    text: string;
    emotion?: string;
  }[];
}

/**
 * タイムライン操作
 */
export interface TimelineOperation {
  type: 'video' | 'audio' | 'text' | 'image' | 'effect';
  track: number;
  start: number;
  end: number;
  source: string;
  properties?: Record<string, unknown>;
}

/**
 * 生成プロンプト
 */
export interface GenerationPrompt {
  type: 'b-roll' | 'diagram' | 'animation' | 'background' | 'thumbnail';
  prompt: string;
  duration?: number;
  style?: string;
  insertAt?: number;
}

/**
 * QA結果
 */
export interface QAResult {
  passed: boolean;
  checks: {
    name: string;
    passed: boolean;
    value?: unknown;
    expected?: unknown;
    message?: string;
  }[];
  score: number; // 0-100
  issues: string[];
  suggestions: string[];
}

/**
 * 最終出力
 */
export interface RemakeOutput {
  recipe: EditRecipe;
  finalVideo: string;
  subtitles?: string;
  chapters?: string;
  thumbnail?: string;
  metadata: {
    title: string;
    description: string;
    tags: string[];
    credits: string[];
    license?: string;
  };
  qa: QAResult;
  logs: {
    commands: string;
    analysis: string;
    changelog: string;
  };
}

/**
 * パイプライン状態
 */
export interface PipelineState {
  input: RemakeInput;
  currentStage: PipelineStage;
  completedStages: StageResult[];
  workingDir: string;
  sourceDir: string;
  outputDir: string;
  videoPath?: string;
  metadata?: VideoMetadata;
  segments?: VideoSegment[];
  recipe?: EditRecipe;
  output?: RemakeOutput;
}

/**
 * パイプラインオプション
 */
export interface PipelineOptions {
  workingDir?: string;
  skipRightsCheck?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  maxRetries?: number;
  timeout?: number;
}
