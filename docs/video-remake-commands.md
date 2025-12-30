# Video Remake Pipeline コマンド一覧

## 依存関係チェック

```bash
npm run remake:check
```

## 基本コマンド

### YouTube動画をショート動画に変換

```bash
npm run remake https://youtube.com/watch?v=xxx
```

### カスタムオプション

```bash
npm run remake https://youtube.com/watch?v=xxx -d 5m -s education
```

### ストーリー変更

```bash
npm run remake https://youtube.com/watch?v=xxx --story "失敗→学び→成功の三幕構成に"
```

## 全オプション一覧

| オプション | 短縮形 | 説明 | デフォルト |
|-----------|--------|------|-----------|
| `--goal` | `-g` | リメイク目標 | 要約ショート動画の作成 |
| `--duration` | `-d` | 目標尺 (1m, 5m, original) | 1m |
| `--style` | `-s` | 出力スタイル | short |
| `--lang` | `-l` | 出力言語 | ja |
| `--story` | - | ストーリー変更指示 | - |
| `--persona` | - | 人物差し替え指示 | - |
| `--forbidden` | - | 禁止ワード（カンマ区切り） | - |
| `--output` | - | 出力ディレクトリ | ./working/{timestamp} |
| `--dry-run` | - | ドライラン | false |
| `--verbose` | - | 詳細ログ | false |

## 使用例

### 教育系動画（5分）

```bash
npm run remake https://youtube.com/watch?v=xxx -d 5m -s education -l ja
```

### ドキュメンタリー風（オリジナル尺）

```bash
npm run remake https://youtube.com/watch?v=xxx -d original -s documentary
```

### 禁止ワード指定

```bash
npm run remake https://youtube.com/watch?v=xxx --forbidden "競合名,ブランド名"
```

### 中断したパイプラインの再開

```bash
npm run remake:resume ./working/1234567890
```

## 出力ファイル

| ファイル | 説明 |
|---------|------|
| `final.mp4` | 最終動画 |
| `recipe.json` | 編集レシピ（再現可能） |
| `subtitles.srt` | 字幕ファイル |
| `thumbnail.png` | サムネイル |
| `metadata.txt` | メタデータ |
| `chapters.txt` | チャプター情報 |
| `qa-result.json` | 品質検査結果 |

## 必要な依存関係

```bash
# 必須
brew install yt-dlp ffmpeg

# オプション（YouTube字幕がない場合のASR用）
pip install openai-whisper
```
