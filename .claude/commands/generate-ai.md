# AI画像/動画生成スキル

fal.aiを使用してAI画像・動画を生成します。

## 利用可能なモデル

### 画像生成
| モデル | 説明 | 料金目安 |
|--------|------|----------|
| **Nano-banana Pro** | 高速画像生成、アニメスタイル得意 | $0.01/枚 |
| **Seedream 4.5** | 高品質画像生成 | $0.03/枚 |

### 動画生成
| モデル | 説明 | 料金目安 |
|--------|------|----------|
| **Sora 2** | OpenAI動画生成 | $0.50/10秒 |
| **Veo 3.1** | Google動画生成（image-to-video） | $0.25/8秒 |
| **Kling 1.6** | 高品質動画生成 | $0.10/5秒 |

## 使用方法

### 画像生成
```bash
# Nano-banana Proで画像生成
npm run fal:image -- -p "anime girl with blue hair, detailed eyes" -m nano-banana-pro

# Seedreamで高品質画像生成
npm run fal:image -- -p "cinematic scene, sunset" -m seedream-4.5

# オプション指定
npm run fal:image -- -p "プロンプト" -s portrait_16_9 -n 4 -o ./output/images
```

### 動画生成
```bash
# Kling 1.6で動画生成
npm run fal:video -- -p "wind blowing through hair" -i <image_url> -m kling-1.6

# Veo 3.1で動画生成（要：入力画像）
npm run fal:video -- -p "gentle movement" -i <image_url> -m veo-3.1 -d 4s

# Sora 2で動画生成
npm run fal:video -- -p "cinematic camera movement" -m sora-2 -d 10s
```

### モデル一覧確認
```bash
npm run fal:models
```

## オプション

### 画像生成オプション
- `-p, --prompt` : プロンプト（必須）
- `-m, --model` : モデル名（default: nano-banana-pro）
- `-s, --size` : 画像サイズ（square_hd | portrait_4_3 | portrait_16_9 | landscape_4_3 | landscape_16_9）
- `-n, --num` : 生成枚数（default: 1）
- `-o, --output` : 出力ディレクトリ（default: ./output/fal）
- `--negative` : ネガティブプロンプト

### 動画生成オプション
- `-p, --prompt` : プロンプト（必須）
- `-m, --model` : モデル名（default: kling-1.6）
- `-i, --image` : 入力画像URL（image-to-video用）
- `-d, --duration` : 動画長さ（4s | 5s | 6s | 8s | 10s）
- `-a, --aspect` : アスペクト比（16:9 | 9:16 | 1:1）
- `-o, --output` : 出力ディレクトリ

## AIアニメワークフロー

### 1. YouTube動画分析 → プロンプト生成 → 画像生成 → 動画生成

```bash
# Step 1: 参考動画を分析
npm run analyze:youtube "https://youtu.be/VIDEO_ID"

# Step 2: 分析結果からプロンプトを作成
# output/VIDEO_ID/frames/ の画像を参考に

# Step 3: 画像生成
npm run fal:image -- -p "anime girl, detailed, high quality" -m nano-banana-pro -o ./output/anime

# Step 4: 動画生成
npm run fal:video -- -p "gentle movement, wind" -i <生成した画像URL> -m kling-1.6
```

### 2. MV制作ワークフロー
詳細は `/ai-anime-mv` を参照

### 3. ストーリーアニメ制作
詳細は `/ai-anime-story` を参照

## プログラムからの使用

```typescript
import {
  generateWithNanoBanana,
  generateWithSeedream,
  generateWithKling16,
  generateWithVeo31,
} from './src/services/fal/index.js';

// 画像生成
const imageResult = await generateWithNanoBanana({
  prompt: 'anime style portrait',
  image_size: 'portrait_16_9',
  num_images: 1,
});

// 動画生成
const videoResult = await generateWithKling16({
  prompt: 'wind blowing through hair',
  image_url: imageResult.urls[0],
  duration: '5s',
});
```

---

ユーザーが生成したいコンテンツ（画像/動画）とプロンプトを聞いて、適切なモデルで生成を実行してください。
