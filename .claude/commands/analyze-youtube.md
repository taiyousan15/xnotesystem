# YouTube動画分析スキル

YouTube動画を分析し、文字起こし、要約、フレームキャプチャを生成します。

## 機能

1. **文字起こし**: 動画の音声を自動でテキスト化
2. **要約生成**: LLMによる簡潔な要約
3. **箇条書き抽出**: 重要ポイントを5つに整理
4. **フレームキャプチャ**: キーシーンを自動検出して画像化
5. **Markdown/JSON出力**: 分析結果をドキュメント化

## 使用方法

```bash
# 基本的な分析
npm run analyze:youtube "https://youtu.be/VIDEO_ID"

# 文字起こしのみ
npm run analyze:youtube "VIDEO_ID" --transcript-only

# フレーム間隔を指定（10秒ごと）
npm run analyze:youtube "VIDEO_ID" -i 10

# キーシーン数を指定
npm run analyze:youtube "VIDEO_ID" -n 15

# 出力ディレクトリを指定
npm run analyze:youtube "VIDEO_ID" -o ./my-output

# 依存関係チェック
npm run analyze:youtube --check-deps
```

## 出力構造

```
output/
└── VIDEO_ID/
    ├── analysis.md      # Markdownドキュメント
    ├── analysis.json    # JSON形式の分析データ
    └── frames/          # キャプチャした画像
        ├── frame_0_00.jpg
        ├── frame_30_00.jpg
        └── ...
```

## 必要な依存関係

### 必須
- Node.js 18+
- ANTHROPIC_API_KEY（.envに設定）

### フレームキャプチャ用（オプション）
```bash
# macOS
brew install yt-dlp ffmpeg

# Ubuntu/Debian
sudo apt install yt-dlp ffmpeg
```

## AIアニメ制作との連携

分析した動画を参考にAIアニメを作成する場合：

1. **動画を分析**
   ```bash
   npm run analyze:youtube "https://youtu.be/VIDEO_ID" -n 20
   ```

2. **キャプチャフレームを確認**
   - `output/VIDEO_ID/frames/` 内の画像を確認
   - 参考にしたいシーンを特定

3. **AIアニメスキルを使用**
   - `/ai-anime` で総合ガイドを参照
   - `/ai-anime-mv` でMV制作
   - `/ai-anime-story` でストーリーアニメ制作

4. **プロンプトを生成**
   - キャプチャした画像を参考にNano-bananaプロンプトを作成
   - 同じスタイル・構図を再現

## 分析結果の活用

### 文字起こしから学ぶ
- 動画の構成を分析
- ナレーションのテンポを参考に
- キーワードを抽出

### フレームキャプチャから学ぶ
- カメラワークを分析
- 色彩・ライティングを参考に
- キャラクターのポーズを研究

### 要約から学ぶ
- 動画の本質を把握
- 自分の動画のテーマ設定に活用

---

ユーザーが分析したいYouTube動画のURLを聞いて、分析を実行してください。
