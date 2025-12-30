import { logger } from '../../utils/logger.js';
import type {
  FalQueueResponse,
  NanoBananaRequest,
  NanoBananaResponse,
  SeedreamRequest,
  SeedreamResponse,
  Sora2Request,
  Sora2Response,
  Veo31Request,
  Veo31Response,
  Kling16Request,
  Kling16Response,
  FalModel,
  GenerationOptions,
  GenerationResult,
} from './types.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, basename } from 'path';

const FAL_API_BASE = 'https://queue.fal.run';
const FAL_STATUS_BASE = 'https://queue.fal.run';

// モデルIDマッピング
const MODEL_ENDPOINTS: Record<FalModel, string> = {
  'nano-banana-pro': 'fal-ai/nano-banana-pro',
  'seedream-4.5': 'fal-ai/seedream-4.5',
  'sora-2': 'fal-ai/sora/video-to-video',
  'veo-3.1': 'fal-ai/veo-3.1/image-to-video',
  'kling-1.6': 'fal-ai/kling-video/v1.6/standard/image-to-video',
};

/**
 * fal.ai APIキーを取得
 */
function getApiKey(): string {
  const key = process.env.FAL_KEY;
  if (!key) {
    throw new Error('FAL_KEY is not set in environment variables');
  }
  return key;
}

/**
 * fal.ai APIリクエストを送信
 */
async function falRequest<T>(
  endpoint: string,
  body: Record<string, unknown>
): Promise<FalQueueResponse> {
  const apiKey = getApiKey();
  const url = `${FAL_API_BASE}/${endpoint}`;

  logger.info(`fal.ai request: ${endpoint}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`fal.ai API error (${response.status}): ${error}`);
  }

  return response.json();
}

/**
 * キューのステータスをポーリング
 */
async function pollStatus<T>(
  requestId: string,
  endpoint: string,
  maxWaitMs: number = 300000,
  intervalMs: number = 5000
): Promise<T> {
  const apiKey = getApiKey();
  const statusUrl = `${FAL_STATUS_BASE}/${endpoint}/requests/${requestId}/status`;
  const resultUrl = `${FAL_STATUS_BASE}/${endpoint}/requests/${requestId}`;
  const startTime = Date.now();

  logger.info(`Polling status for request: ${requestId}`);

  while (Date.now() - startTime < maxWaitMs) {
    const response = await fetch(statusUrl, {
      headers: { 'Authorization': `Key ${apiKey}` },
    });

    if (!response.ok) {
      throw new Error(`Status check failed: ${response.status}`);
    }

    const status: FalQueueResponse = await response.json();
    logger.debug(`Status: ${status.status}`);

    if (status.status === 'COMPLETED') {
      // 結果を取得
      const resultResponse = await fetch(resultUrl, {
        headers: { 'Authorization': `Key ${apiKey}` },
      });

      if (!resultResponse.ok) {
        throw new Error(`Result fetch failed: ${resultResponse.status}`);
      }

      return resultResponse.json();
    }

    if (status.status === 'FAILED') {
      throw new Error('Generation failed on fal.ai');
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timeout: Generation did not complete within ${maxWaitMs}ms`);
}

/**
 * ファイルをダウンロード
 */
async function downloadFile(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const dir = join(outputPath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(outputPath, buffer);
  logger.info(`Downloaded: ${outputPath}`);
}

// ================================
// 画像生成
// ================================

/**
 * Nano-banana Proで画像生成
 */
export async function generateWithNanoBanana(
  request: NanoBananaRequest,
  options?: GenerationOptions
): Promise<GenerationResult> {
  const model: FalModel = 'nano-banana-pro';
  const endpoint = MODEL_ENDPOINTS[model];
  const startTime = Date.now();

  try {
    // sync_modeが設定されていない場合はキューを使用
    const useSync = request.sync_mode === true;

    if (useSync) {
      const url = `https://fal.run/${endpoint}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Key ${getApiKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const result: NanoBananaResponse = await response.json();
      const urls = result.images.map((img) => img.url);
      const localPaths: string[] = [];

      if (options?.downloadResult && options.outputDir) {
        for (let i = 0; i < urls.length; i++) {
          const filename = options.filename || `nano-banana-${Date.now()}-${i}.png`;
          const outputPath = join(options.outputDir, filename);
          await downloadFile(urls[i], outputPath);
          localPaths.push(outputPath);
        }
      }

      return {
        model,
        requestId: 'sync',
        success: true,
        urls,
        localPaths: localPaths.length > 0 ? localPaths : undefined,
        duration: Date.now() - startTime,
      };
    } else {
      const queueResponse = await falRequest(endpoint, request);
      const result = await pollStatus<NanoBananaResponse>(
        queueResponse.request_id,
        endpoint
      );

      const urls = result.images.map((img) => img.url);
      const localPaths: string[] = [];

      if (options?.downloadResult && options.outputDir) {
        for (let i = 0; i < urls.length; i++) {
          const filename = options.filename || `nano-banana-${Date.now()}-${i}.png`;
          const outputPath = join(options.outputDir, filename);
          await downloadFile(urls[i], outputPath);
          localPaths.push(outputPath);
        }
      }

      return {
        model,
        requestId: queueResponse.request_id,
        success: true,
        urls,
        localPaths: localPaths.length > 0 ? localPaths : undefined,
        duration: Date.now() - startTime,
      };
    }
  } catch (error) {
    logger.error('Nano-banana generation failed:', error);
    return {
      model,
      requestId: '',
      success: false,
      urls: [],
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Seedream 4.5で画像生成
 */
export async function generateWithSeedream(
  request: SeedreamRequest,
  options?: GenerationOptions
): Promise<GenerationResult> {
  const model: FalModel = 'seedream-4.5';
  const endpoint = MODEL_ENDPOINTS[model];
  const startTime = Date.now();

  try {
    const queueResponse = await falRequest(endpoint, request);
    const result = await pollStatus<SeedreamResponse>(
      queueResponse.request_id,
      endpoint
    );

    const urls = result.images.map((img) => img.url);
    const localPaths: string[] = [];

    if (options?.downloadResult && options.outputDir) {
      for (let i = 0; i < urls.length; i++) {
        const filename = options.filename || `seedream-${Date.now()}-${i}.png`;
        const outputPath = join(options.outputDir, filename);
        await downloadFile(urls[i], outputPath);
        localPaths.push(outputPath);
      }
    }

    return {
      model,
      requestId: queueResponse.request_id,
      success: true,
      urls,
      localPaths: localPaths.length > 0 ? localPaths : undefined,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    logger.error('Seedream generation failed:', error);
    return {
      model,
      requestId: '',
      success: false,
      urls: [],
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
}

// ================================
// 動画生成
// ================================

/**
 * Sora 2で動画生成
 */
export async function generateWithSora2(
  request: Sora2Request,
  options?: GenerationOptions
): Promise<GenerationResult> {
  const model: FalModel = 'sora-2';
  const endpoint = MODEL_ENDPOINTS[model];
  const startTime = Date.now();

  try {
    const queueResponse = await falRequest(endpoint, request);
    const result = await pollStatus<Sora2Response>(
      queueResponse.request_id,
      endpoint,
      600000 // 動画は10分まで待機
    );

    const urls = [result.video.url];
    const localPaths: string[] = [];

    if (options?.downloadResult && options.outputDir) {
      const filename = options.filename || `sora2-${Date.now()}.mp4`;
      const outputPath = join(options.outputDir, filename);
      await downloadFile(result.video.url, outputPath);
      localPaths.push(outputPath);
    }

    return {
      model,
      requestId: queueResponse.request_id,
      success: true,
      urls,
      localPaths: localPaths.length > 0 ? localPaths : undefined,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    logger.error('Sora 2 generation failed:', error);
    return {
      model,
      requestId: '',
      success: false,
      urls: [],
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Veo 3.1で動画生成
 */
export async function generateWithVeo31(
  request: Veo31Request,
  options?: GenerationOptions
): Promise<GenerationResult> {
  const model: FalModel = 'veo-3.1';
  const endpoint = MODEL_ENDPOINTS[model];
  const startTime = Date.now();

  try {
    const queueResponse = await falRequest(endpoint, request);
    const result = await pollStatus<Veo31Response>(
      queueResponse.request_id,
      endpoint,
      600000
    );

    const urls = [result.video.url];
    const localPaths: string[] = [];

    if (options?.downloadResult && options.outputDir) {
      const filename = options.filename || `veo31-${Date.now()}.mp4`;
      const outputPath = join(options.outputDir, filename);
      await downloadFile(result.video.url, outputPath);
      localPaths.push(outputPath);
    }

    return {
      model,
      requestId: queueResponse.request_id,
      success: true,
      urls,
      localPaths: localPaths.length > 0 ? localPaths : undefined,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    logger.error('Veo 3.1 generation failed:', error);
    return {
      model,
      requestId: '',
      success: false,
      urls: [],
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Kling 1.6で動画生成
 */
export async function generateWithKling16(
  request: Kling16Request,
  options?: GenerationOptions
): Promise<GenerationResult> {
  const model: FalModel = 'kling-1.6';
  const endpoint = MODEL_ENDPOINTS[model];
  const startTime = Date.now();

  try {
    const queueResponse = await falRequest(endpoint, request);
    const result = await pollStatus<Kling16Response>(
      queueResponse.request_id,
      endpoint,
      600000
    );

    const urls = [result.video.url];
    const localPaths: string[] = [];

    if (options?.downloadResult && options.outputDir) {
      const filename = options.filename || `kling16-${Date.now()}.mp4`;
      const outputPath = join(options.outputDir, filename);
      await downloadFile(result.video.url, outputPath);
      localPaths.push(outputPath);
    }

    return {
      model,
      requestId: queueResponse.request_id,
      success: true,
      urls,
      localPaths: localPaths.length > 0 ? localPaths : undefined,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    logger.error('Kling 1.6 generation failed:', error);
    return {
      model,
      requestId: '',
      success: false,
      urls: [],
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
}

// ================================
// ユーティリティ
// ================================

/**
 * 利用可能なモデル一覧を取得
 */
export function getAvailableModels(): { image: string[]; video: string[] } {
  return {
    image: ['nano-banana-pro', 'seedream-4.5'],
    video: ['sora-2', 'veo-3.1', 'kling-1.6'],
  };
}

/**
 * モデルの料金目安（USD/生成）
 */
export function getModelPricing(): Record<FalModel, { unit: string; price: string }> {
  return {
    'nano-banana-pro': { unit: '1画像', price: '$0.01' },
    'seedream-4.5': { unit: '1画像', price: '$0.03' },
    'sora-2': { unit: '10秒動画', price: '$0.50' },
    'veo-3.1': { unit: '8秒動画', price: '$0.25' },
    'kling-1.6': { unit: '5秒動画', price: '$0.10' },
  };
}
