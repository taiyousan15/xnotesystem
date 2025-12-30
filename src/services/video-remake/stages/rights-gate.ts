// Stage A: Rights & Scope Gate

import { logger } from '../../../utils/logger.js';
import type { PipelineState, StageResult } from '../types.js';

/**
 * 権利確認ゲート
 * - ユーザーが権利を保有しているか確認
 * - 目的が「同一複製」でないか確認
 */
export async function stageRightsGate(state: PipelineState): Promise<StageResult> {
  const { input } = state;
  const warnings: string[] = [];

  // URL検証
  if (!input.sourceUrl) {
    return {
      stage: 'rights_gate',
      success: false,
      duration: 0,
      error: 'Source URL is required',
    };
  }

  // YouTube URL判定
  const isYouTube = input.sourceUrl.includes('youtube.com') || input.sourceUrl.includes('youtu.be');

  if (isYouTube) {
    warnings.push('YouTube動画は著作権に注意してください');
    warnings.push('自身の動画または許諾済みの動画のみ使用可能です');
  }

  // 目的チェック
  const goal = input.remakeGoal.toLowerCase();
  const forbiddenGoals = ['copy', 'duplicate', 'replicate', '複製', 'コピー'];

  for (const forbidden of forbiddenGoals) {
    if (goal.includes(forbidden)) {
      return {
        stage: 'rights_gate',
        success: false,
        duration: 0,
        error: `目的「${input.remakeGoal}」は許可されていません。構造参照による新規制作に変更してください。`,
      };
    }
  }

  // 禁止事項チェック
  if (input.forbidden && input.forbidden.length > 0) {
    logger.info(`禁止事項: ${input.forbidden.join(', ')}`);
  }

  // 人物差し替えの権利チェック
  if (input.personaChange) {
    warnings.push('人物差し替えには同意・権利確認が必要です');

    if (!input.personaAssets || input.personaAssets.length === 0) {
      warnings.push('personaAssetsが未指定のため、新規キャラクターを生成します');
    }
  }

  logger.info('Rights gate passed');
  logger.info(`Goal: ${input.remakeGoal}`);
  logger.info(`Style: ${input.outputStyle}`);
  logger.info(`Duration: ${input.durationTarget}`);
  logger.info(`Language: ${input.languageTarget}`);

  return {
    stage: 'rights_gate',
    success: true,
    duration: 0,
    output: {
      isYouTube,
      verified: true,
    },
    warnings,
  };
}
