#!/usr/bin/env tsx
import 'dotenv/config';
import { Command } from 'commander';
import {
  generateWithNanoBanana,
  generateWithSeedream,
  generateWithSora2,
  generateWithVeo31,
  generateWithKling16,
  getAvailableModels,
  getModelPricing,
} from '../services/fal/index.js';
import { logger } from '../utils/logger.js';

const program = new Command();

program
  .name('generate-fal')
  .description('fal.ai APIで画像/動画を生成')
  .version('1.0.0');

// 画像生成コマンド
program
  .command('image')
  .description('画像を生成')
  .requiredOption('-p, --prompt <prompt>', 'プロンプト')
  .option('-m, --model <model>', 'モデル (nano-banana-pro | seedream-4.5)', 'nano-banana-pro')
  .option('-s, --size <size>', '画像サイズ', 'portrait_16_9')
  .option('-n, --num <number>', '生成枚数', parseInt, 1)
  .option('-o, --output <dir>', '出力ディレクトリ', './output/fal')
  .option('--negative <prompt>', 'ネガティブプロンプト')
  .action(async (options) => {
    logger.info(`画像生成開始: ${options.model}`);
    logger.info(`プロンプト: ${options.prompt}`);

    try {
      const request = {
        prompt: options.prompt,
        negative_prompt: options.negative,
        image_size: options.size,
        num_images: options.num,
      };

      const genOptions = {
        outputDir: options.output,
        downloadResult: true,
      };

      let result;
      if (options.model === 'seedream-4.5') {
        result = await generateWithSeedream(request, genOptions);
      } else {
        result = await generateWithNanoBanana(request, genOptions);
      }

      if (result.success) {
        console.log('\n✅ 生成完了!');
        console.log(`モデル: ${result.model}`);
        console.log(`生成時間: ${(result.duration! / 1000).toFixed(1)}秒`);
        console.log('\n生成された画像:');
        result.urls.forEach((url, i) => {
          console.log(`  ${i + 1}. ${url}`);
        });
        if (result.localPaths) {
          console.log('\nダウンロード先:');
          result.localPaths.forEach((path) => {
            console.log(`  - ${path}`);
          });
        }
      } else {
        console.error('\n❌ 生成失敗:', result.error);
        process.exit(1);
      }
    } catch (error) {
      logger.error('エラー:', error);
      process.exit(1);
    }
  });

// 動画生成コマンド
program
  .command('video')
  .description('動画を生成')
  .requiredOption('-p, --prompt <prompt>', 'プロンプト')
  .option('-m, --model <model>', 'モデル (sora-2 | veo-3.1 | kling-1.6)', 'kling-1.6')
  .option('-i, --image <url>', '入力画像URL（image-to-video用）')
  .option('-d, --duration <duration>', '動画長さ', '5s')
  .option('-a, --aspect <ratio>', 'アスペクト比', '16:9')
  .option('-o, --output <dir>', '出力ディレクトリ', './output/fal')
  .action(async (options) => {
    logger.info(`動画生成開始: ${options.model}`);
    logger.info(`プロンプト: ${options.prompt}`);

    try {
      const genOptions = {
        outputDir: options.output,
        downloadResult: true,
      };

      let result;

      switch (options.model) {
        case 'sora-2':
          result = await generateWithSora2(
            {
              prompt: options.prompt,
              image_url: options.image,
              duration: options.duration,
              aspect_ratio: options.aspect,
            },
            genOptions
          );
          break;

        case 'veo-3.1':
          if (!options.image) {
            console.error('❌ Veo 3.1 は image-to-video のみ対応。--image オプションが必要です。');
            process.exit(1);
          }
          result = await generateWithVeo31(
            {
              prompt: options.prompt,
              image_url: options.image,
              duration: options.duration,
              aspect_ratio: options.aspect,
            },
            genOptions
          );
          break;

        case 'kling-1.6':
        default:
          result = await generateWithKling16(
            {
              prompt: options.prompt,
              image_url: options.image,
              duration: options.duration,
              aspect_ratio: options.aspect,
            },
            genOptions
          );
          break;
      }

      if (result.success) {
        console.log('\n✅ 生成完了!');
        console.log(`モデル: ${result.model}`);
        console.log(`生成時間: ${(result.duration! / 1000).toFixed(1)}秒`);
        console.log('\n生成された動画:');
        result.urls.forEach((url) => {
          console.log(`  ${url}`);
        });
        if (result.localPaths) {
          console.log('\nダウンロード先:');
          result.localPaths.forEach((path) => {
            console.log(`  - ${path}`);
          });
        }
      } else {
        console.error('\n❌ 生成失敗:', result.error);
        process.exit(1);
      }
    } catch (error) {
      logger.error('エラー:', error);
      process.exit(1);
    }
  });

// モデル一覧コマンド
program
  .command('models')
  .description('利用可能なモデル一覧')
  .action(() => {
    const models = getAvailableModels();
    const pricing = getModelPricing();

    console.log('\n📷 画像生成モデル:');
    models.image.forEach((model) => {
      const p = pricing[model as keyof typeof pricing];
      console.log(`  - ${model}: ${p.price}/${p.unit}`);
    });

    console.log('\n🎬 動画生成モデル:');
    models.video.forEach((model) => {
      const p = pricing[model as keyof typeof pricing];
      console.log(`  - ${model}: ${p.price}/${p.unit}`);
    });

    console.log('\n使用例:');
    console.log('  npm run fal:image -- -p "anime girl" -m nano-banana-pro');
    console.log('  npm run fal:video -- -p "wind blowing" -i <image_url> -m kling-1.6');
  });

program.parse();
