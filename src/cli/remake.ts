#!/usr/bin/env node
// Video Remake CLI

import 'dotenv/config';
import { Command } from 'commander';
import { logger } from '../utils/logger.js';
import {
  runRemakePipeline,
  resumePipeline,
  checkDependencies,
  printUsage,
} from '../services/video-remake/index.js';
import type { RemakeInput } from '../services/video-remake/types.js';

const program = new Command();

program
  .name('remake')
  .description('Video Remake Pipeline - YouTube動画を解析・編集・再構成')
  .version('1.0.0');

// メインコマンド
program
  .argument('[url]', 'YouTube動画のURL')
  .option('-g, --goal <goal>', 'リメイク目標', '要約ショート動画の作成')
  .option('-d, --duration <duration>', '目標尺 (e.g., 1m, 5m, original)', '1m')
  .option('-s, --style <style>', '出力スタイル', 'short')
  .option('-l, --lang <language>', '出力言語', 'ja')
  .option('--story <story>', 'ストーリー変更指示')
  .option('--persona <persona>', '人物差し替え指示')
  .option('--forbidden <words>', '禁止ワード（カンマ区切り）')
  .option('--output <dir>', '出力ディレクトリ')
  .option('--dry-run', 'ドライラン（実際の処理を行わない）')
  .option('--verbose', '詳細ログを出力')
  .action(async (url, options) => {
    if (!url) {
      printUsage();
      return;
    }

    // 依存関係チェック
    const deps = checkDependencies();
    if (!deps.allRequired) {
      logger.error('Missing required dependencies:');
      console.log(deps.message);
      process.exit(1);
    }

    // 入力を構築
    const input: RemakeInput = {
      sourceUrl: url,
      remakeGoal: options.goal,
      durationTarget: options.duration,
      languageTarget: options.lang,
      outputStyle: options.style,
      storyChange: options.story,
      personaChange: options.persona,
      forbidden: options.forbidden
        ? options.forbidden.split(',').map((w: string) => w.trim())
        : undefined,
    };

    try {
      logger.info('Starting Video Remake Pipeline...');
      logger.info(`URL: ${url}`);
      logger.info(`Goal: ${input.remakeGoal}`);
      logger.info(`Duration: ${input.durationTarget}`);
      logger.info(`Style: ${input.outputStyle}`);

      const result = await runRemakePipeline(input, {
        workingDir: options.output,
        dryRun: options.dryRun,
        verbose: options.verbose,
      });

      logger.info('');
      logger.info('='.repeat(60));
      logger.info('Pipeline Complete!');
      logger.info('='.repeat(60));
      logger.info(`Final video: ${result.finalVideo}`);
      logger.info(`QA Score: ${result.qa.score}%`);

      if (result.subtitles) {
        logger.info(`Subtitles: ${result.subtitles}`);
      }
      if (result.thumbnail) {
        logger.info(`Thumbnail: ${result.thumbnail}`);
      }

      logger.info('');
      logger.info('Metadata:');
      logger.info(`  Title: ${result.metadata.title}`);
      logger.info(`  Tags: ${result.metadata.tags.join(', ')}`);
    } catch (error) {
      logger.error('Pipeline failed:', error);
      process.exit(1);
    }
  });

// 再開コマンド
program
  .command('resume <working-dir>')
  .description('中断したパイプラインを再開')
  .action(async (workingDir) => {
    try {
      logger.info(`Resuming pipeline from: ${workingDir}`);

      const result = await resumePipeline(workingDir);

      if (result) {
        logger.info('Pipeline resumed and completed!');
        logger.info(`Final video: ${result.finalVideo}`);
      } else {
        logger.error('Could not resume pipeline. State file not found.');
        process.exit(1);
      }
    } catch (error) {
      logger.error('Resume failed:', error);
      process.exit(1);
    }
  });

// 依存関係チェックコマンド
program
  .command('check')
  .description('依存関係をチェック')
  .action(() => {
    const deps = checkDependencies();

    console.log('\nDependency Check');
    console.log('='.repeat(40));
    console.log(`yt-dlp:  ${deps.ytDlp ? '✓ Installed' : '✗ Missing'}`);
    console.log(`ffmpeg:  ${deps.ffmpeg ? '✓ Installed' : '✗ Missing'}`);
    console.log(`whisper: ${deps.whisper ? '✓ Installed' : '○ Optional'}`);
    console.log('');

    if (deps.allRequired) {
      console.log('All required dependencies are installed!');
    } else {
      console.log('Missing dependencies. Install with:');
      if (!deps.ytDlp) console.log('  brew install yt-dlp');
      if (!deps.ffmpeg) console.log('  brew install ffmpeg');
    }

    if (!deps.whisper) {
      console.log('\nOptional: For better ASR when YouTube subtitles unavailable:');
      console.log('  pip install openai-whisper');
    }
  });

// ヘルプ
program
  .command('help')
  .description('使い方を表示')
  .action(() => {
    printUsage();
  });

// パース実行
program.parse();
