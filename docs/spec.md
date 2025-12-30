# 仕様書（UI / API / DB）
## X AIトレンド自動収集・収益化システム

---

## 1. システム構成図

```
┌─────────────────────────────────────────────────────────────────┐
│                        X API (Twitter)                          │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Collector Service                          │
│  - キーワード検索                                                │
│  - インフルエンサー投稿取得                                       │
│  - 重複排除                                                      │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Scoring Service                            │
│  - Base Score 計算                                              │
│  - Velocity Score 計算                                          │
│  - Semantic Score (LLM)                                         │
└─────────────────────────────┬───────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌──────────────────┐ ┌──────────────┐ ┌──────────────────┐
│ Google Sheets    │ │ Notion DB    │ │ Discord Webhook  │
│ (一次保存)        │ │ (アーカイブ)  │ │ (配信)           │
└──────────────────┘ └──────────────┘ └──────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Content Generator                            │
│  - note記事生成                                                  │
│  - Kindle原稿生成                                                │
│  - YouTube台本生成                                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. API 仕様

### 2.1 X API エンドポイント

#### 検索取得
```
GET /2/tweets/search/recent
```

| パラメータ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| query | string | Yes | 検索クエリ（AI関連キーワード） |
| max_results | number | No | 最大取得件数（10-100） |
| tweet.fields | string | No | 取得フィールド |

**取得フィールド**
```
tweet.fields=public_metrics,created_at,author_id,conversation_id
user.fields=public_metrics,username,name
```

#### ユーザー投稿取得
```
GET /2/users/:id/tweets
```

| パラメータ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| id | string | Yes | ユーザーID |
| max_results | number | No | 最大取得件数 |
| start_time | string | No | 取得開始日時（ISO8601） |

### 2.2 内部API

#### POST /api/collect
日次収集を実行

**Request**
```json
{
  "date": "2024-01-15",
  "keywords": ["ChatGPT", "Claude", "GPT-4", ...],
  "force": false
}
```

**Response**
```json
{
  "success": true,
  "collected": 200,
  "duplicates_removed": 15,
  "date": "2024-01-15"
}
```

#### POST /api/score
スコアリングを実行

**Request**
```json
{
  "tweet_ids": ["123456789", ...],
  "include_semantic": true
}
```

**Response**
```json
{
  "success": true,
  "scored": 185,
  "top_tweets": [
    {
      "tweet_id": "123456789",
      "final_score": 85.5,
      "base_score": 72.0,
      "velocity_score": 90.0,
      "semantic_score": 88.0
    }
  ]
}
```

#### POST /api/generate/note
note記事を生成

**Request**
```json
{
  "type": "paid",
  "tweet_ids": ["123456789", "987654321"],
  "word_count": 10000,
  "title": "今週のAIトレンド"
}
```

**Response**
```json
{
  "success": true,
  "article": {
    "title": "...",
    "body": "...",
    "word_count": 10234,
    "price": 480
  }
}
```

#### POST /api/distribute/discord
Discord配信を実行

**Request**
```json
{
  "channel": "vip",
  "type": "daily",
  "content": {
    "top_tweets": [...],
    "summary": "..."
  }
}
```

---

## 3. データベース仕様

### 3.1 Prisma Schema

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// 投稿データ
model Tweet {
  id              String    @id @default(cuid())
  tweetId         String    @unique @map("tweet_id")
  authorId        String    @map("author_id")
  authorUsername  String    @map("author_username")
  content         String
  createdAt       DateTime  @map("created_at")
  collectedAt     DateTime  @default(now()) @map("collected_at")

  // メトリクス
  likeCount       Int       @default(0) @map("like_count")
  repostCount     Int       @default(0) @map("repost_count")
  replyCount      Int       @default(0) @map("reply_count")
  impressionCount Int?      @map("impression_count")
  followerCount   Int       @default(0) @map("follower_count")

  // スコア
  baseScore       Float?    @map("base_score")
  velocityScore   Float?    @map("velocity_score")
  efficiencyScore Float?    @map("efficiency_score")
  semanticScore   Float?    @map("semantic_score")
  finalScore      Float?    @map("final_score")

  // フラグ
  isPriority      Boolean   @default(false) @map("is_priority")
  isTopPick       Boolean   @default(false) @map("is_top_pick")
  usedInNote      Boolean   @default(false) @map("used_in_note")
  usedInKindle    Boolean   @default(false) @map("used_in_kindle")

  // リレーション
  articles        ArticleTweet[]

  @@map("tweets")
  @@index([collectedAt])
  @@index([finalScore])
  @@index([isPriority])
}

// 優先インフルエンサー
model Influencer {
  id        String   @id @default(cuid())
  userId    String   @unique @map("user_id")
  username  String   @unique
  name      String
  isActive  Boolean  @default(true) @map("is_active")
  createdAt DateTime @default(now()) @map("created_at")

  @@map("influencers")
}

// 検索キーワード
model Keyword {
  id        String   @id @default(cuid())
  keyword   String   @unique
  weight    Float    @default(1.0)
  isActive  Boolean  @default(true) @map("is_active")
  createdAt DateTime @default(now()) @map("created_at")

  @@map("keywords")
}

// 生成記事
model Article {
  id          String         @id @default(cuid())
  type        ArticleType
  title       String
  body        String
  wordCount   Int            @map("word_count")
  price       Int?
  status      ArticleStatus  @default(DRAFT)
  createdAt   DateTime       @default(now()) @map("created_at")
  publishedAt DateTime?      @map("published_at")

  // リレーション
  tweets      ArticleTweet[]

  @@map("articles")
}

// 記事-投稿 中間テーブル
model ArticleTweet {
  articleId String  @map("article_id")
  tweetId   String  @map("tweet_id")
  article   Article @relation(fields: [articleId], references: [id])
  tweet     Tweet   @relation(fields: [tweetId], references: [id])

  @@id([articleId, tweetId])
  @@map("article_tweets")
}

// 日次実行ログ
model DailyLog {
  id            String   @id @default(cuid())
  date          DateTime @unique
  tweetsCollected Int    @map("tweets_collected")
  tweetsScored    Int    @map("tweets_scored")
  topPickIds      String[] @map("top_pick_ids")
  discordSent     Boolean @default(false) @map("discord_sent")
  errors          String?
  createdAt       DateTime @default(now()) @map("created_at")

  @@map("daily_logs")
}

enum ArticleType {
  NOTE_FREE
  NOTE_PAID
  KINDLE
  YOUTUBE_SCRIPT
}

enum ArticleStatus {
  DRAFT
  REVIEW
  PUBLISHED
}
```

### 3.2 Google Sheets 構造

#### シート: Daily_YYYYMMDD

| 列 | フィールド | 型 | 説明 |
|----|-----------|-----|------|
| A | tweet_id | string | 投稿ID |
| B | author_username | string | ユーザー名 |
| C | content | string | 投稿内容 |
| D | created_at | datetime | 投稿日時 |
| E | like_count | number | いいね数 |
| F | repost_count | number | リポスト数 |
| G | reply_count | number | リプライ数 |
| H | follower_count | number | フォロワー数 |
| I | base_score | number | ベーススコア |
| J | velocity_score | number | 速度スコア |
| K | efficiency_score | number | 効率スコア |
| L | semantic_score | number | 意味スコア |
| M | final_score | number | 最終スコア |
| N | is_priority | boolean | 優先フラグ |
| O | is_top_pick | boolean | 本日の重要投稿 |
| P | note_used | boolean | note使用済み |
| Q | kindle_used | boolean | Kindle使用済み |

### 3.3 Notion DB プロパティ

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| Title | title | 投稿内容（先頭50文字） |
| Tweet ID | text | 投稿ID |
| Author | text | ユーザー名 |
| Score | number | 最終スコア |
| Category | select | AI/LLM/Tool/News/Opinion |
| Priority | checkbox | 優先インフルエンサー |
| Top Pick | checkbox | 重要投稿 |
| Date | date | 投稿日 |
| Note Status | select | Unused/Used/Candidate |
| Kindle Status | select | Unused/Used/Candidate |
| VIP Only | checkbox | VIP限定フラグ |

---

## 4. UI 仕様（CLI）

本システムはCLIベースで動作し、外部UIは持たない。

### 4.1 コマンド一覧

```bash
# 日次収集
npm run collect -- --date=2024-01-15

# スコアリング
npm run score -- --date=2024-01-15 --semantic

# Discord配信
npm run distribute -- --channel=vip --type=daily

# note生成
npm run generate:note -- --type=paid --word-count=10000

# Kindle生成
npm run generate:kindle -- --week=2024-W03

# 全処理実行（日次）
npm run daily

# 全処理実行（週次）
npm run weekly
```

### 4.2 出力フォーマット

```
[2024-01-15 00:00:01] INFO  Starting daily collection...
[2024-01-15 00:00:05] INFO  Fetched 150 tweets from keywords
[2024-01-15 00:00:08] INFO  Fetched 50 tweets from influencers
[2024-01-15 00:00:10] INFO  Removed 15 duplicates
[2024-01-15 00:00:30] INFO  Scoring completed: 185 tweets
[2024-01-15 00:00:31] INFO  Top picks: tweet_123, tweet_456
[2024-01-15 00:00:35] INFO  Discord notification sent (VIP)
[2024-01-15 00:00:36] INFO  Daily process completed
```

---

## 5. 設定ファイル仕様

### 5.1 config.json

```json
{
  "scoring": {
    "weights": {
      "base": 0.25,
      "velocity": 0.25,
      "efficiency": 0.25,
      "semantic": 0.25
    },
    "priority_bonus": 15,
    "top_pick_count": 2
  },
  "collection": {
    "max_tweets_per_keyword": 100,
    "max_tweets_per_influencer": 50,
    "lookback_hours": 24
  },
  "note": {
    "max_paid_per_week": 2,
    "price": 480,
    "word_counts": [7000, 10000, 12000, 15000]
  },
  "kindle": {
    "min_pages": 50,
    "max_pages": 100
  },
  "discord": {
    "channels": {
      "general": "WEBHOOK_URL_GENERAL",
      "vip": "WEBHOOK_URL_VIP"
    }
  }
}
```

### 5.2 .env

```env
# X API
X_API_KEY=xxx
X_API_SECRET=xxx
X_ACCESS_TOKEN=xxx
X_ACCESS_SECRET=xxx
X_BEARER_TOKEN=xxx

# Database
DATABASE_URL=postgresql://...

# Google Sheets
GOOGLE_SERVICE_ACCOUNT_KEY=xxx
GOOGLE_SPREADSHEET_ID=xxx

# Notion
NOTION_API_KEY=xxx
NOTION_DATABASE_ID=xxx

# Discord
DISCORD_WEBHOOK_GENERAL=xxx
DISCORD_WEBHOOK_VIP=xxx

# LLM
ANTHROPIC_API_KEY=xxx
OPENAI_API_KEY=xxx
```

---

## 6. エラーコード一覧

| コード | 説明 | 対処 |
|--------|------|------|
| E001 | X API レート制限 | 前日データ再利用 or スキップ |
| E002 | X API 認証エラー | 認証情報を確認 |
| E003 | 取得件数 0件 | Discord通知のみ |
| E004 | LLM API エラー | 再試行1回 → スキップ |
| E005 | Google Sheets 書込失敗 | リトライ3回 |
| E006 | Notion 同期失敗 | ログ記録のみ |
| E007 | Discord 送信失敗 | 再送なし |
| E008 | 同日二重処理検出 | 処理スキップ |

---

## 7. セキュリティ仕様

### 7.1 認証情報管理
- すべてのAPIキーは `.env` で管理
- `.env` は `.gitignore` に含める
- 本番環境では環境変数から読み込み

### 7.2 レート制限対策
- X API: 1リクエスト/秒 以下に制限
- LLM API: バッチ処理で最適化
- 指数バックオフによる再試行

### 7.3 データ保護
- VIPコンテンツはフラグで管理
- Discord Webhookは環境別に分離

---

## 8. fal.ai 連携仕様（AIアニメ制作用）

### 8.1 概要

fal.ai は統合AIプラットフォームで、画像生成・動画生成の最新モデルにAPIアクセスを提供。

**環境変数**
```env
FAL_KEY=your_fal_api_key
```

### 8.2 画像生成モデル

| モデル | エンドポイント | 特徴 |
|--------|---------------|------|
| **Nano-banana Pro** | `fal-ai/nanobanana-pro` | Google製。キャラクター一貫性に優れる |
| **Seedream 4.5** | `fal-ai/seedream` | ByteDance製。高品質な画像生成・編集 |
| **FLUX 2 Flex** | `fal-ai/flux-2-flex` | タイポグラフィ強化、微調整制御可能 |
| **GPT-Image 1.5** | `fal-ai/gpt-image-1` | 高忠実度、指示追従性が高い |

#### Nano-banana Pro API

```typescript
// リクエスト
POST https://fal.run/fal-ai/nanobanana-pro

{
  "prompt": "anime girl, pink hair, school uniform, front view",
  "negative_prompt": "low quality, blurry",
  "image_size": "square_hd",
  "num_images": 1,
  "seed": 12345
}

// レスポンス
{
  "images": [
    {
      "url": "https://...",
      "content_type": "image/png"
    }
  ]
}
```

#### Seedream 4.5 API

```typescript
POST https://fal.run/fal-ai/seedream

{
  "prompt": "character sheet, multiple poses, anime style",
  "aspect_ratio": "16:9",
  "num_images": 1
}
```

### 8.3 動画生成モデル

| モデル | エンドポイント | 特徴 |
|--------|---------------|------|
| **Sora 2** | `fal-ai/sora-2` | OpenAI製。音声付き動画生成 |
| **Veo 3.1** | `fal-ai/veo-3` | Google DeepMind製。最高品質 |
| **Kling 1.6** | `fal-ai/kling-video/v1.6` | 高品質な動画生成 |
| **Runway Gen-3** | `fal-ai/runway-gen3` | モーション制御に優れる |

#### Sora 2 API

```typescript
// テキストから動画生成
POST https://fal.run/fal-ai/sora-2

{
  "prompt": "anime character walking in a park, cherry blossoms falling",
  "duration": "5s",
  "aspect_ratio": "16:9"
}

// 画像から動画生成
POST https://fal.run/fal-ai/sora-2/image-to-video

{
  "image_url": "https://...",
  "prompt": "character starts walking, hair flowing in wind",
  "duration": "5s"
}
```

#### Veo 3.1 API

```typescript
POST https://fal.run/fal-ai/veo-3

{
  "prompt": "cinematic anime scene, character turning around",
  "aspect_ratio": "16:9",
  "duration": "8s"
}
```

### 8.4 利用料金目安

| モデル | 単価（概算） |
|--------|-------------|
| Nano-banana Pro | $0.01/画像 |
| Seedream 4.5 | $0.02/画像 |
| Sora 2 | $0.10/秒 |
| Veo 3.1 | $0.15/秒 |
| Kling 1.6 | $0.05/秒 |

### 8.5 推奨ワークフロー

```
1. キャラクターシート生成
   → Nano-banana Pro（キャラクター一貫性）

2. 背景・シーン生成
   → Seedream 4.5（高品質）

3. 静止画から動画化
   → Veo 3.1 または Sora 2（image-to-video）

4. テキストから動画生成
   → Sora 2（音声付き）
```

---

## 9. YouTube Data API 連携仕様

### 9.1 概要

YouTube動画の分析、文字起こし、メタデータ取得に使用。

**環境変数**
```env
YOUTUBE_API_KEY=your_youtube_api_key
```

### 9.2 エンドポイント

#### 動画情報取得
```
GET https://www.googleapis.com/youtube/v3/videos

パラメータ:
- id: 動画ID
- part: snippet,contentDetails,statistics
- key: APIキー
```

#### 字幕取得
```
GET https://www.googleapis.com/youtube/v3/captions

パラメータ:
- videoId: 動画ID
- part: snippet
- key: APIキー
```

### 9.3 内部コマンド

```bash
# YouTube動画を分析
npm run analyze:youtube "VIDEO_URL"

# 文字起こしのみ
npm run analyze:youtube "VIDEO_URL" --transcript-only

# フレームキャプチャ付き
npm run analyze:youtube "VIDEO_URL" -i 5  # 5秒間隔
```

### 9.4 出力構造

```
output/VIDEO_ID/
├── analysis.md      # Markdownドキュメント
├── analysis.json    # JSON形式
└── frames/          # キャプチャ画像
    ├── frame_0_00.jpg
    ├── frame_5_00.jpg
    └── ...
```

### 9.5 レート制限

- 1日あたり10,000クエリ（無料枠）
- 超過時は追加課金または翌日まで待機
