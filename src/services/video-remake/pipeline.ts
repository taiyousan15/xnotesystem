// Video Remake Pipeline Coordinator

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../../utils/logger.js';
import type {
  RemakeInput,
  PipelineState,
  PipelineOptions,
  PipelineStage,
  StageResult,
  RemakeOutput,
} from './types.js';

// Stage imports
import { stageRightsGate } from './stages/rights-gate.js';
import { stageIngest } from './stages/ingest.js';
import { stageNormalize } from './stages/normalize.js';
import { stageUnderstand } from './stages/understand.js';
import { stagePlan } from './stages/plan.js';
import { stageExecute } from './stages/execute.js';
import { stageQA } from './stages/qa.js';
import { stagePackage } from './stages/package.js';

const STAGES: PipelineStage[] = [
  'rights_gate',
  'ingest',
  'normalize',
  'understand',
  'plan',
  'execute',
  'qa',
  'package',
];

const STAGE_HANDLERS: Record<PipelineStage, (state: PipelineState) => Promise<StageResult>> = {
  rights_gate: stageRightsGate,
  ingest: stageIngest,
  normalize: stageNormalize,
  understand: stageUnderstand,
  plan: stagePlan,
  execute: stageExecute,
  qa: stageQA,
  package: stagePackage,
};

/**
 * Video Remake Pipeline
 */
export class VideoRemakePipeline {
  private state: PipelineState;
  private options: PipelineOptions;

  constructor(input: RemakeInput, options: PipelineOptions = {}) {
    const workingDir = options.workingDir || `./working/${Date.now()}`;

    this.options = {
      maxRetries: 1,
      timeout: 600000, // 10 minutes
      verbose: false,
      ...options,
    };

    this.state = {
      input,
      currentStage: 'rights_gate',
      completedStages: [],
      workingDir,
      sourceDir: join(workingDir, 'source'),
      outputDir: join(workingDir, 'output'),
    };

    // Create directories
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    const dirs = [
      this.state.workingDir,
      this.state.sourceDir,
      this.state.outputDir,
      join(this.state.workingDir, 'segments'),
      join(this.state.workingDir, 'frames'),
      join(this.state.workingDir, 'temp'),
      join(this.state.workingDir, 'logs'),
    ];

    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * パイプライン全体を実行
   */
  async run(): Promise<RemakeOutput> {
    logger.info('='.repeat(60));
    logger.info('Starting Video Remake Pipeline');
    logger.info(`Source: ${this.state.input.sourceUrl}`);
    logger.info(`Goal: ${this.state.input.remakeGoal}`);
    logger.info('='.repeat(60));

    const startTime = Date.now();

    try {
      for (const stage of STAGES) {
        this.state.currentStage = stage;
        const result = await this.runStage(stage);

        this.state.completedStages.push(result);

        if (!result.success) {
          // Try to recover once
          if (this.options.maxRetries && this.options.maxRetries > 0) {
            logger.warn(`Stage ${stage} failed, retrying...`);
            const retryResult = await this.runStage(stage);
            this.state.completedStages.push(retryResult);

            if (!retryResult.success) {
              throw new Error(`Stage ${stage} failed after retry: ${retryResult.error}`);
            }
          } else {
            throw new Error(`Stage ${stage} failed: ${result.error}`);
          }
        }

        // Save state after each stage
        this.saveState();
      }

      const totalDuration = Date.now() - startTime;
      logger.info('='.repeat(60));
      logger.info(`Pipeline completed in ${(totalDuration / 1000).toFixed(1)}s`);
      logger.info('='.repeat(60));

      return this.state.output!;
    } catch (error) {
      logger.error('Pipeline failed:', error);
      this.saveState();
      throw error;
    }
  }

  /**
   * 特定のステージを実行
   */
  private async runStage(stage: PipelineStage): Promise<StageResult> {
    const handler = STAGE_HANDLERS[stage];
    const stageName = stage.replace('_', ' ').toUpperCase();

    logger.info('');
    logger.info(`${'─'.repeat(50)}`);
    logger.info(`Stage: ${stageName}`);
    logger.info(`${'─'.repeat(50)}`);

    const startTime = Date.now();

    try {
      const result = await handler(this.state);
      const duration = Date.now() - startTime;

      if (result.success) {
        logger.info(`✓ ${stageName} completed (${(duration / 1000).toFixed(1)}s)`);
      } else {
        logger.error(`✗ ${stageName} failed: ${result.error}`);
      }

      if (result.warnings && result.warnings.length > 0) {
        for (const warning of result.warnings) {
          logger.warn(`  ⚠ ${warning}`);
        }
      }

      return { ...result, duration };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error(`✗ ${stageName} threw error: ${errorMessage}`);

      return {
        stage,
        success: false,
        duration,
        error: errorMessage,
      };
    }
  }

  /**
   * 状態を保存
   */
  private saveState(): void {
    const statePath = join(this.state.workingDir, 'state.json');
    writeFileSync(statePath, JSON.stringify(this.state, null, 2));
  }

  /**
   * 状態を読み込み（リジューム用）
   */
  static loadState(workingDir: string): PipelineState | null {
    const statePath = join(workingDir, 'state.json');
    if (existsSync(statePath)) {
      return JSON.parse(readFileSync(statePath, 'utf-8'));
    }
    return null;
  }

  /**
   * 現在の状態を取得
   */
  getState(): PipelineState {
    return this.state;
  }

  /**
   * 進捗を取得
   */
  getProgress(): { current: number; total: number; stage: PipelineStage } {
    const currentIndex = STAGES.indexOf(this.state.currentStage);
    return {
      current: currentIndex + 1,
      total: STAGES.length,
      stage: this.state.currentStage,
    };
  }
}

/**
 * パイプラインを実行（便利関数）
 */
export async function runRemakePipeline(
  input: RemakeInput,
  options?: PipelineOptions
): Promise<RemakeOutput> {
  const pipeline = new VideoRemakePipeline(input, options);
  return pipeline.run();
}

/**
 * パイプラインを再開
 */
export async function resumePipeline(workingDir: string): Promise<RemakeOutput | null> {
  const state = VideoRemakePipeline.loadState(workingDir);
  if (!state) {
    logger.error('No saved state found');
    return null;
  }

  const pipeline = new VideoRemakePipeline(state.input, { workingDir });
  return pipeline.run();
}
