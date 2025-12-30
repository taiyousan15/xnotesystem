// fal.ai サービス
// 画像生成（Nano-banana Pro, Seedream）と動画生成（Sora 2, Veo 3.1, Kling 1.6）をサポート

export * from './types.js';
export * from './client.js';

// 使用例
// import {
//   generateWithNanoBanana,
//   generateWithSeedream,
//   generateWithSora2,
//   generateWithVeo31,
//   generateWithKling16,
//   getAvailableModels,
// } from '../services/fal/index.js';
//
// // 画像生成
// const imageResult = await generateWithNanoBanana({
//   prompt: 'anime style girl with blue hair',
//   image_size: 'portrait_16_9',
//   num_images: 1,
// });
//
// // 動画生成（画像から）
// const videoResult = await generateWithVeo31({
//   prompt: 'gentle wind blowing through hair',
//   image_url: imageResult.urls[0],
//   duration: '4s',
// });
