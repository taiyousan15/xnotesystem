# note自動有料記事投稿スクリプト

Markdown記事をnoteに**有料記事（480円）として自動公開**するPythonスクリプト。

## 特徴

- **有料記事公開**: 480円の有料記事として自動公開
- **URLリンク化**: 記事内の全URLをクリック可能なリンクに変換
- **Selenium直接操作**: UIを直接操作して確実に投稿
- **JavaScript注入**: 長文テキスト・HTMLリンクを安定して入力
- **BMP制限対策**: 絵文字等の特殊文字を自動除去
- **Markdown対応**: 見出し/リスト/強調を自動変換

---

## 1. インストール

### 依存ライブラリ

```bash
pip install selenium python-dotenv
```

### ChromeDriverの準備

Selenium 4.6以降では、ChromeDriverが自動でダウンロードされます。
特別な設定は不要です。

---

## 2. 環境変数の設定

`.env`ファイルをプロジェクトルートに作成：

```bash
# note.com 認証情報
NOTE_EMAIL=your_email@example.com
NOTE_PASSWORD=your_password
NOTE_USER_NAME=your_note_username
```

**重要：** シェルスクリプト構文（`cat << 'EOF'`等）を含めないこと。

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `NOTE_EMAIL` | Yes | noteのログインメールアドレス |
| `NOTE_PASSWORD` | Yes | noteのログインパスワード |
| `NOTE_USER_NAME` | No | noteのユーザー名（URL確認用） |

---

## 3. 実行方法

### 基本コマンド

```bash
# 有料記事として公開（480円）
python scripts/note_draft_poster_selenium.py \
  --title "記事タイトル" \
  --file path/to/article.md

# サムネイル画像付き
python scripts/note_draft_poster_selenium.py \
  --title "記事タイトル" \
  --file path/to/article.md \
  --image path/to/thumbnail.png

# ヘッドレスモード（ブラウザ非表示）
python scripts/note_draft_poster_selenium.py \
  --title "記事タイトル" \
  --file path/to/article.md \
  --headless
```

### オプション

| オプション | 短縮 | 必須 | 説明 |
|-----------|------|------|------|
| `--title` | `-t` | Yes | 記事タイトル |
| `--file` | `-f` | Yes | Markdownファイルのパス |
| `--image` | `-i` | No | サムネイル画像のパス |
| `--headless` | - | No | ブラウザを表示しない |

### 実行例

```bash
# 週間AIニュース記事を有料公開
python scripts/note_draft_poster_selenium.py \
  --title "【週間AI】GPT-5.2、日本語モデル登場" \
  --file output/notes/weekly_ai_news_paid_v2_2025-12-19.md
```

---

## 4. 処理フロー

```
Step 1: ログイン
Step 2: 記事作成画面へ移動
Step 3: タイトル入力
Step 4: 本文入力（URLリンク化含む）
Step 5: 画像アップロード（オプション）
Step 6: 「公開」ボタンクリック
Step 7: 「有料」選択 → 480円入力
Step 8: 「有料エリア設定」クリック
Step 9: 有料ライン設定
Step 10: 「投稿する」クリック → 公開完了
```

---

## 5. Markdown変換ルール

| Markdown | 変換後 |
|----------|--------|
| `# 見出し1` | `◆ 見出し1` |
| `## 見出し2` | `■ 見出し2` |
| `### 見出し3` | `▼ 見出し3` |
| `**太字**` | `【太字】` |
| `` `コード` `` | `「コード」` |
| `[テキスト](URL)` | `<a href="URL">テキスト</a>` (クリック可能) |
| `https://...` | `<a href="URL">URL</a>` (クリック可能) |

---

## 6. Pythonから呼び出す

```python
from scripts.note_draft_poster_selenium import post_to_note_selenium

content = """
## 見出し

これは**テスト**記事です。

元投稿
https://x.com/example/status/123456789
"""

result = post_to_note_selenium(
    email="your@email.com",
    password="your_password",
    title="テスト記事",
    markdown_content=content,
    headless=False
)

if result:
    print(f"公開成功！ URL: {result}")
```

---

## 7. よくあるエラーと対処

### ログイン失敗

**確認事項：**
- メールアドレス/パスワードが正しいか
- 2段階認証が無効か

### 有料設定/公開失敗

**確認事項：**
- スクリーンショット: `/tmp/note_debug_step8_area.png`
- noteのUIが変更されていないか

### URLがリンクにならない

**確認事項：**
- JavaScript innerHTML注入が成功しているか
- ログに「本文入力完了（JavaScript）」が表示されているか

---

## 8. 公開される記事の仕様

| 項目 | 値 |
|------|-----|
| 価格 | 480円（固定） |
| 有料ライン | デフォルト位置 |
| URLリンク | 全てクリック可能 |

---

## 9. 制限事項

- noteのUIは非公開のため、仕様変更で動作しなくなる可能性があります
- 大量投稿は避けてください（BAN/制限のリスク）
- 2段階認証には対応していません
- 価格は480円固定（変更するにはコード修正が必要）
- BMP外の絵文字は自動的に削除されます

---

## 10. ファイル構成

```
scripts/
├── note_draft_poster_selenium.py  # メインスクリプト
└── README_NOTE_POSTER.md          # このファイル

docs/
└── NOTE_AUTO_POSTER_SPEC.md       # 詳細仕様書

.env                               # 認証情報（gitignore推奨）
```

---

*最終更新: 2024-12-22*
*バージョン: 2.0 - 有料記事自動公開・URLリンク化対応*
