// fal.ai API 型定義

// 共通レスポンス
export interface FalQueueResponse {
  request_id: string;
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  response_url?: string;
}

export interface FalImage {
  url: string;
  width: number;
  height: number;
  content_type: string;
}

export interface FalVideo {
  url: string;
  content_type: string;
  file_name?: string;
  file_size?: number;
}

// ================================
// Nano-banana Pro (画像生成)
// ================================
export interface NanoBananaRequest {
  prompt: string;
  negative_prompt?: string;
  image_size?: 'square_hd' | 'square' | 'portrait_4_3' | 'portrait_16_9' | 'landscape_4_3' | 'landscape_16_9';
  num_inference_steps?: number;
  guidance_scale?: number;
  num_images?: number;
  seed?: number;
  enable_safety_checker?: boolean;
  sync_mode?: boolean;
}

export interface NanoBananaResponse {
  images: FalImage[];
  seed: number;
  prompt: string;
  timings?: { inference: number };
}

// ================================
// Seedream 4.5 (高品質画像生成)
// ================================
export interface SeedreamRequest {
  prompt: string;
  negative_prompt?: string;
  image_size?: 'square' | 'portrait_4_3' | 'portrait_16_9' | 'landscape_4_3' | 'landscape_16_9';
  num_inference_steps?: number;
  guidance_scale?: number;
  num_images?: number;
  seed?: number;
}

export interface SeedreamResponse {
  images: FalImage[];
  seed: number;
}

// ================================
// Sora 2 (動画生成)
// ================================
export interface Sora2Request {
  prompt: string;
  aspect_ratio?: '16:9' | '9:16' | '1:1';
  duration?: '5s' | '10s' | '15s' | '20s';
  resolution?: '480p' | '720p' | '1080p';
  image_url?: string; // image-to-video用
}

export interface Sora2Response {
  video: FalVideo;
  prompt: string;
  timings?: { inference: number };
}

// ================================
// Veo 3.1 (Google動画生成)
// ================================
export interface Veo31Request {
  prompt: string;
  image_url: string;
  duration?: '4s' | '6s' | '8s';
  aspect_ratio?: '16:9' | '9:16' | '1:1';
  loop?: boolean;
  prompt_adherence?: 'low' | 'medium' | 'high';
  motion_amount?: 'low' | 'medium' | 'high';
}

export interface Veo31Response {
  video: FalVideo;
  prompt: string;
  seed?: number;
  timings?: { inference: number };
}

// ================================
// Kling 1.6 (動画生成)
// ================================
export interface Kling16Request {
  prompt: string;
  negative_prompt?: string;
  image_url?: string;
  aspect_ratio?: '16:9' | '9:16' | '1:1';
  duration?: '5s' | '10s';
  cfg_scale?: number;
  seed?: number;
  mode?: 'std' | 'pro';
}

export interface Kling16Response {
  video: FalVideo;
  prompt: string;
  seed?: number;
}

// ================================
// モデル選択
// ================================
export type ImageModel = 'nano-banana-pro' | 'seedream-4.5';
export type VideoModel = 'sora-2' | 'veo-3.1' | 'kling-1.6';
export type FalModel = ImageModel | VideoModel;

export interface GenerationOptions {
  outputDir?: string;
  filename?: string;
  downloadResult?: boolean;
}

export interface GenerationResult {
  model: FalModel;
  requestId: string;
  success: boolean;
  urls: string[];
  localPaths?: string[];
  error?: string;
  duration?: number;
}
