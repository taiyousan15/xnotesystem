# AIミュージックビデオ制作ガイド

ユーザーのAIミュージックビデオ制作をステップバイステップでサポートします。

## 制作フロー

### Step 1: 楽曲制作
**使用ツール**: ChatGPT + Suno

1. ChatGPTで楽曲のコンセプト、歌詞を作成
2. Sunoで楽曲を生成

**プロンプト例（Suno）**:
```
[Genre: J-Pop/Electronic]
[Mood: Energetic, Uplifting]
[BPM: 128]
[Language: Japanese]

歌詞をここに入力...
```

### Step 2: キャラクター設計
**使用ツール**: ChatGPT

以下を決定：
- キャラクター名
- 外見（髪型、髪色、目の色、服装）
- 性格・背景設定
- 世界観

### Step 3: キャラクターシート作成
**使用ツール**: Nano-banana

**プロンプト例**:
```
character sheet, multiple poses, multiple expressions,
[キャラクター詳細],
anime style, consistent design, white background,
front view, side view, back view
```

### Step 4: MV構成
**使用ツール**: ChatGPT

楽曲の構成に合わせてシーンを設計：
- イントロ（0:00-0:15）
- Aメロ（0:15-0:45）
- Bメロ（0:45-1:15）
- サビ（1:15-1:45）
- ...

### Step 5: 静止画生成
**使用ツール**: Nano-banana, Seedream

各シーンの静止画を生成。キャラクターの一貫性を保つ。

**カメラワークの種類**:
- ロングショット（全体）
- ミディアムショット（腰上）
- クローズアップ（顔）
- エクストリームクローズアップ（目など）

### Step 6-8: 技法学習
- **カメラワーク**: パン、ティルト、ズーム、ドリー
- **ライティング**: 順光、逆光、サイド光、リムライト
- **演出効果**: ブラー、グロー、パーティクル

### Step 9-10: 動画生成
**使用ツール**: Kling, Vidu, Sora 2

静止画を動画化。動きのプロンプトを追加：
```
[静止画のプロンプト],
camera slowly zooms in,
hair flowing in wind,
subtle breathing motion
```

### Step 11: AI動画の技法
- フレーム補間でスムーズ化
- 不自然な動きの修正
- シーン間のトランジション

### Step 12-13: 動画編集
**使用ツール**: Remotion

```bash
# Remotionプロジェクト作成
npx create-video@latest

# 開発サーバー起動
npm start
```

字幕、エフェクト、トランジションを追加。

### Step 14: マーケティング
**投稿プラットフォーム**:
- YouTube（フル版）
- YouTube Shorts（縦型短尺）
- TikTok
- X (Twitter)

**最適化のコツ**:
- サムネイルにキャラクターの顔
- 最初の3秒で引き込む
- ハッシュタグ活用

---

ユーザーが現在どのステップにいるか確認し、適切なサポートを提供してください。
