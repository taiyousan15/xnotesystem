#!/usr/bin/env tsx
import 'dotenv/config';
import { Command } from 'commander';
import {
  analyzeVideoFull,
  analyzeVideo,
  extractVideoId,
  checkDependencies,
  getInstallInstructions,
  generateMarkdown,
} from '../services/youtube/index.js';
import { logger } from '../utils/logger.js';
import { writeFileSync } from 'fs';

const program = new Command();

program
  .name('analyze-youtube')
  .description('YouTube動画を分析し、文字起こし・要約・フレームキャプチャを生成')
  .argument('[url]', 'YouTube URL または動画ID')
  .option('-o, --output <dir>', '出力ディレクトリ', './output')
  .option('-i, --interval <seconds>', 'フレームキャプチャ間隔（秒）', parseFloat)
  .option('-n, --num-scenes <number>', 'キーシーン数', parseInt, 10)
  .option('--transcript-only', '文字起こしのみ（フレームキャプチャなし）')
  .option('--check-deps', '依存関係をチェック')
  .action(async (url, options) => {
    // 依存関係チェックモード
    if (options.checkDeps) {
      const deps = checkDependencies();
      console.log('\n依存関係チェック:');
      console.log(`  yt-dlp:  ${deps.ytDlp ? '✅ インストール済み' : '❌ 未インストール'}`);
      console.log(`  ffmpeg:  ${deps.ffmpeg ? '✅ インストール済み' : '❌ 未インストール'}`);

      if (!deps.allInstalled) {
        console.log('\n' + getInstallInstructions());
      }
      return;
    }

    // URLが指定されていない場合
    if (!url) {
      logger.error('YouTube URLまたは動画IDを指定してください');
      console.log('\n使用例:');
      console.log('  npm run analyze:youtube "https://youtu.be/VIDEO_ID"');
      console.log('  npm run analyze:youtube VIDEO_ID --transcript-only');
      process.exit(1);
    }

    // 動画ID検証
    const videoId = extractVideoId(url);
    if (!videoId) {
      logger.error('無効なYouTube URLまたは動画IDです');
      process.exit(1);
    }

    try {
      if (options.transcriptOnly) {
        // 文字起こしのみ
        logger.info('文字起こしモードで実行...');
        const analysis = await analyzeVideo(url);

        console.log('\n' + '='.repeat(50));
        console.log(`タイトル: ${analysis.title}`);
        console.log('='.repeat(50));
        console.log('\n## 要約\n');
        console.log(analysis.summary);
        console.log('\n## 主要ポイント\n');
        analysis.bulletPoints.forEach((point, i) => {
          console.log(`${i + 1}. ${point}`);
        });

        // Markdownファイルとして保存
        const markdown = generateMarkdown(analysis);
        const outputPath = `${options.output}/${videoId}_analysis.md`;
        writeFileSync(outputPath, markdown);
        logger.info(`保存先: ${outputPath}`);
      } else {
        // フル分析（フレームキャプチャ含む）
        const result = await analyzeVideoFull(url, {
          outputDir: `${options.output}/${videoId}`,
          captureInterval: options.interval,
          numKeyScenes: options.numScenes,
        });

        console.log('\n' + '='.repeat(50));
        console.log('分析完了!');
        console.log('='.repeat(50));
        console.log(`タイトル: ${result.title}`);
        console.log(`出力ディレクトリ: ${result.outputDir}`);
        console.log(`キャプチャフレーム数: ${result.frames.length}`);
        console.log(`Markdownファイル: ${result.markdownPath}`);
      }
    } catch (error) {
      logger.error('分析に失敗しました:', error);
      process.exit(1);
    }
  });

program.parse();
