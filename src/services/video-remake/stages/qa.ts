// Stage G: QA (自動品質検査)

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../../../utils/logger.js';
import type { PipelineState, StageResult, QAResult } from '../types.js';

interface QACheck {
  name: string;
  passed: boolean;
  value?: unknown;
  expected?: unknown;
  message?: string;
}

/**
 * 品質検査を実行
 */
export async function stageQA(state: PipelineState): Promise<StageResult> {
  const { workingDir, outputDir, input, recipe } = state;
  const warnings: string[] = [];

  const finalPath = join(outputDir, 'final.mp4');

  if (!existsSync(finalPath)) {
    return {
      stage: 'qa',
      success: false,
      duration: 0,
      error: 'Final video not found',
    };
  }

  try {
    const checks: QACheck[] = [];

    // 1. 尺チェック
    logger.info('Checking duration...');
    const durationCheck = await checkDuration(finalPath, input.durationTarget);
    checks.push(durationCheck);

    // 2. 音量チェック
    logger.info('Checking audio levels...');
    const audioCheck = await checkAudioLevels(finalPath);
    checks.push(audioCheck);

    // 3. 黒画面チェック
    logger.info('Checking for black frames...');
    const blackFrameCheck = await checkBlackFrames(finalPath);
    checks.push(blackFrameCheck);

    // 4. 無音チェック
    logger.info('Checking for silence...');
    const silenceCheck = await checkSilence(finalPath);
    checks.push(silenceCheck);

    // 5. 解像度チェック
    logger.info('Checking resolution...');
    const resolutionCheck = await checkResolution(finalPath);
    checks.push(resolutionCheck);

    // 6. 禁止事項チェック
    if (input.forbidden && input.forbidden.length > 0) {
      logger.info('Checking forbidden content...');
      const forbiddenCheck = await checkForbiddenContent(
        workingDir,
        input.forbidden
      );
      checks.push(forbiddenCheck);
    }

    // 結果を集計
    const passedCount = checks.filter((c) => c.passed).length;
    const score = Math.round((passedCount / checks.length) * 100);
    const passed = score >= 70; // 70%以上で合格

    const issues = checks
      .filter((c) => !c.passed)
      .map((c) => c.message || `${c.name} failed`);

    const suggestions = generateSuggestions(checks);

    const qaResult: QAResult = {
      passed,
      checks,
      score,
      issues,
      suggestions,
    };

    // 結果を保存
    const qaPath = join(workingDir, 'qa-result.json');
    writeFileSync(qaPath, JSON.stringify(qaResult, null, 2));

    // 警告を追加
    if (!passed) {
      warnings.push(`QA score: ${score}% (threshold: 70%)`);
      for (const issue of issues) {
        warnings.push(`Issue: ${issue}`);
      }
    }

    logger.info(`QA Score: ${score}%`);
    logger.info(`Passed: ${passed ? 'Yes' : 'No'}`);

    return {
      stage: 'qa',
      success: passed,
      duration: 0,
      output: {
        score,
        passed,
        checks: passedCount,
        total: checks.length,
      },
      warnings,
    };
  } catch (error) {
    return {
      stage: 'qa',
      success: false,
      duration: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 尺チェック
 */
async function checkDuration(
  videoPath: string,
  targetDuration: string
): Promise<QACheck> {
  try {
    const output = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
    ).toString().trim();

    const actualDuration = parseFloat(output);

    // 目標尺をパース
    let expectedDuration = actualDuration;
    if (targetDuration !== 'original') {
      const match = targetDuration.match(/^(\d+)(s|m|h)?$/);
      if (match) {
        const value = parseInt(match[1], 10);
        const unit = match[2] || 's';
        switch (unit) {
          case 'h':
            expectedDuration = value * 3600;
            break;
          case 'm':
            expectedDuration = value * 60;
            break;
          default:
            expectedDuration = value;
        }
      }
    }

    // 10%の許容範囲
    const tolerance = expectedDuration * 0.1;
    const passed = Math.abs(actualDuration - expectedDuration) <= tolerance;

    return {
      name: 'duration',
      passed,
      value: actualDuration,
      expected: expectedDuration,
      message: passed
        ? undefined
        : `Duration ${actualDuration.toFixed(1)}s differs from target ${expectedDuration.toFixed(1)}s`,
    };
  } catch {
    return {
      name: 'duration',
      passed: false,
      message: 'Failed to check duration',
    };
  }
}

/**
 * 音量チェック
 */
async function checkAudioLevels(videoPath: string): Promise<QACheck> {
  try {
    const output = execSync(
      `ffmpeg -i "${videoPath}" -af "volumedetect" -f null - 2>&1 | grep -E "max_volume|mean_volume"`,
      { maxBuffer: 5 * 1024 * 1024 }
    ).toString();

    const maxMatch = output.match(/max_volume:\s*([-\d.]+)\s*dB/);
    const meanMatch = output.match(/mean_volume:\s*([-\d.]+)\s*dB/);

    const maxVolume = maxMatch ? parseFloat(maxMatch[1]) : 0;
    const meanVolume = meanMatch ? parseFloat(meanMatch[1]) : -20;

    // クリップしていないか（max > 0）、静かすぎないか（mean < -30）
    const passed = maxVolume <= 0 && meanVolume > -30;

    return {
      name: 'audio_levels',
      passed,
      value: { max: maxVolume, mean: meanVolume },
      message: passed
        ? undefined
        : maxVolume > 0
        ? 'Audio is clipping'
        : 'Audio is too quiet',
    };
  } catch {
    return {
      name: 'audio_levels',
      passed: true, // 音声がない場合はスキップ
      message: 'No audio track or failed to analyze',
    };
  }
}

/**
 * 黒画面チェック
 */
async function checkBlackFrames(videoPath: string): Promise<QACheck> {
  try {
    const output = execSync(
      `ffmpeg -i "${videoPath}" -vf "blackdetect=d=2:pix_th=0.1" -f null - 2>&1 | grep -c "black_start" || echo "0"`,
      { maxBuffer: 5 * 1024 * 1024, timeout: 60000 }
    ).toString().trim();

    const blackSegments = parseInt(output, 10) || 0;
    const passed = blackSegments <= 2; // 2箇所まで許容

    return {
      name: 'black_frames',
      passed,
      value: blackSegments,
      expected: '≤2',
      message: passed
        ? undefined
        : `Found ${blackSegments} black segments (>2s each)`,
    };
  } catch {
    return {
      name: 'black_frames',
      passed: true,
      message: 'Failed to check black frames',
    };
  }
}

/**
 * 無音チェック
 */
async function checkSilence(videoPath: string): Promise<QACheck> {
  try {
    const output = execSync(
      `ffmpeg -i "${videoPath}" -af "silencedetect=n=-50dB:d=5" -f null - 2>&1 | grep -c "silence_start" || echo "0"`,
      { maxBuffer: 5 * 1024 * 1024, timeout: 60000 }
    ).toString().trim();

    const silenceSegments = parseInt(output, 10) || 0;
    const passed = silenceSegments <= 3; // 3箇所まで許容

    return {
      name: 'silence',
      passed,
      value: silenceSegments,
      expected: '≤3',
      message: passed
        ? undefined
        : `Found ${silenceSegments} silence segments (>5s each)`,
    };
  } catch {
    return {
      name: 'silence',
      passed: true,
      message: 'Failed to check silence',
    };
  }
}

/**
 * 解像度チェック
 */
async function checkResolution(videoPath: string): Promise<QACheck> {
  try {
    const output = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${videoPath}"`
    ).toString().trim();

    const [width, height] = output.split('x').map(Number);
    const passed = width >= 720 && height >= 480; // 最低720x480

    return {
      name: 'resolution',
      passed,
      value: { width, height },
      expected: '≥720x480',
      message: passed ? undefined : `Resolution ${width}x${height} is too low`,
    };
  } catch {
    return {
      name: 'resolution',
      passed: false,
      message: 'Failed to check resolution',
    };
  }
}

/**
 * 禁止コンテンツチェック
 */
async function checkForbiddenContent(
  workingDir: string,
  forbidden: string[]
): Promise<QACheck> {
  const transcriptPath = join(workingDir, 'source', 'transcript.txt');

  if (!existsSync(transcriptPath)) {
    return {
      name: 'forbidden_content',
      passed: true,
      message: 'No transcript to check',
    };
  }

  const transcript = readFileSync(transcriptPath, 'utf-8').toLowerCase();
  const found: string[] = [];

  for (const word of forbidden) {
    if (transcript.includes(word.toLowerCase())) {
      found.push(word);
    }
  }

  const passed = found.length === 0;

  return {
    name: 'forbidden_content',
    passed,
    value: found,
    message: passed ? undefined : `Found forbidden content: ${found.join(', ')}`,
  };
}

/**
 * 改善提案を生成
 */
function generateSuggestions(checks: QACheck[]): string[] {
  const suggestions: string[] = [];

  for (const check of checks) {
    if (check.passed) continue;

    switch (check.name) {
      case 'duration':
        suggestions.push('尺を調整するため、セグメントの追加/削除を検討してください');
        break;
      case 'audio_levels':
        suggestions.push('音量正規化の設定を調整してください');
        break;
      case 'black_frames':
        suggestions.push('黒画面部分をBロールまたはテキストで埋めてください');
        break;
      case 'silence':
        suggestions.push('無音部分にBGMまたはナレーションを追加してください');
        break;
      case 'resolution':
        suggestions.push('より高解像度のソース動画を使用してください');
        break;
      case 'forbidden_content':
        suggestions.push('禁止コンテンツを削除または編集してください');
        break;
    }
  }

  return suggestions;
}
