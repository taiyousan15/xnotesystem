#!/usr/bin/env tsx
import 'dotenv/config';
import { Command } from 'commander';
import { exec } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import { extractVideoId, checkYtDlp } from '../services/youtube/index.js';

const program = new Command();

program
  .name('download-youtube')
  .description('YouTube動画をダウンロード')
  .argument('<url>', 'YouTube URL または動画ID')
  .option('-o, --output <dir>', '出力ディレクトリ', './output/videos')
  .option('-f, --format <format>', '形式 (mp4 | webm | mkv | audio)', 'mp4')
  .option('-q, --quality <quality>', '品質 (best | 1080 | 720 | 480 | 360)', 'best')
  .option('--audio-only', '音声のみダウンロード')
  .option('--list-formats', '利用可能な形式を表示')
  .action(async (url, options) => {
    // yt-dlpチェック
    if (!checkYtDlp()) {
      console.error('❌ yt-dlp がインストールされていません');
      console.log('\nインストール方法:');
      console.log('  brew install yt-dlp');
      process.exit(1);
    }

    // 動画ID検証
    const videoId = extractVideoId(url);
    if (!videoId) {
      logger.error('無効なYouTube URLまたは動画IDです');
      process.exit(1);
    }

    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // 利用可能な形式を表示
    if (options.listFormats) {
      console.log('\n利用可能な形式を取得中...\n');
      exec(`yt-dlp -F "${youtubeUrl}"`, (error, stdout, stderr) => {
        if (error) {
          console.error('エラー:', stderr);
          process.exit(1);
        }
        console.log(stdout);
      });
      return;
    }

    // 出力ディレクトリ作成
    if (!existsSync(options.output)) {
      mkdirSync(options.output, { recursive: true });
    }

    // ダウンロードオプション構築
    let formatOption: string;
    let extension: string;

    if (options.audioOnly || options.format === 'audio') {
      formatOption = '-x --audio-format mp3 --audio-quality 0';
      extension = 'mp3';
    } else {
      // 品質に応じたフォーマット指定
      switch (options.quality) {
        case '1080':
          formatOption = '-f "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best"';
          break;
        case '720':
          formatOption = '-f "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best"';
          break;
        case '480':
          formatOption = '-f "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best"';
          break;
        case '360':
          formatOption = '-f "bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360][ext=mp4]/best"';
          break;
        case 'best':
        default:
          formatOption = '-f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"';
          break;
      }
      extension = options.format || 'mp4';
    }

    const outputFile = join(options.output, `${videoId}.${extension}`);
    const command = `yt-dlp ${formatOption} --merge-output-format ${extension} -o "${outputFile}" "${youtubeUrl}"`;

    console.log('\n📥 ダウンロード開始...');
    console.log(`動画ID: ${videoId}`);
    console.log(`品質: ${options.quality}`);
    console.log(`出力先: ${outputFile}`);
    console.log('');

    const downloadProcess = exec(command, { maxBuffer: 100 * 1024 * 1024 });

    // 進捗を表示
    downloadProcess.stdout?.on('data', (data) => {
      process.stdout.write(data);
    });

    downloadProcess.stderr?.on('data', (data) => {
      process.stderr.write(data);
    });

    downloadProcess.on('close', (code) => {
      if (code === 0) {
        console.log('\n✅ ダウンロード完了!');
        console.log(`保存先: ${outputFile}`);
      } else {
        console.error('\n❌ ダウンロード失敗');
        process.exit(1);
      }
    });
  });

program.parse();
