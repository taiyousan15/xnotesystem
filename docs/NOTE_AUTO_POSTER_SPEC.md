# note自動有料記事投稿システム 要件定義書

## 1. システム概要

### 1.1 目的

Markdown形式で生成されたnote記事を、Seleniumブラウザ自動操作により
noteプラットフォームに**有料記事（480円）として自動公開**するシステム。

### 1.2 設計原則

| 原則 | 説明 |
|------|------|
| 有料公開 | 480円の有料記事として自動公開 |
| URLリンク化 | 記事内のURLは全てクリック可能なリンクに変換 |
| 認証情報保護 | `.env`ファイルで管理、ログではマスク表示 |

---

## 2. 技術仕様

### 2.1 使用技術

| 技術 | バージョン/詳細 |
|------|----------------|
| Python | 3.9+ |
| Selenium | 4.6+ (ChromeDriver自動ダウンロード対応) |
| Chrome | 最新版 |
| python-dotenv | 環境変数管理 |

### 2.2 ファイル構成

```
scripts/
├── note_draft_poster_selenium.py  # メインスクリプト（有料記事公開対応）
└── README_NOTE_POSTER.md          # 使用マニュアル

.env                               # 認証情報（gitignore必須）
```

---

## 3. 環境設定

### 3.1 必須環境変数

`.env`ファイルに以下を設定：

```bash
# note.com 認証情報
NOTE_EMAIL=your_email@example.com
NOTE_PASSWORD=your_password
NOTE_USER_NAME=your_note_username  # オプション
```

### 3.2 .envファイル形式の注意

**禁止事項：**
- シェルスクリプト構文（`cat << 'EOF'`等）を含めない
- 各行は `KEY=VALUE` 形式のみ

**正しい例：**
```bash
NOTE_EMAIL=example@gmail.com
NOTE_PASSWORD=mypassword123
NOTE_USER_NAME=myusername
```

---

## 4. 処理フロー

### 4.1 全体フロー（有料記事公開）

```
Step 1: ログイン
    ↓
Step 2: 記事作成画面へ移動
    ↓
Step 3: タイトル入力
    ↓
Step 4: 本文入力（JavaScript注入・URLリンク化）
    ↓
Step 5: 画像アップロード（オプション）
    ↓
Step 6: 「公開」ボタンクリック → 設定パネル表示
    ↓
Step 7: 「有料」選択 → 価格480円入力
    ↓
Step 8: 「有料エリア設定」ボタンクリック
    ↓
Step 9: 有料ライン設定（デフォルト使用）
    ↓
Step 10: 「投稿する」ボタンクリック → 公開完了
```

### 4.2 各Stepの詳細仕様

#### Step 1: ログイン

| 項目 | 仕様 |
|------|------|
| URL | `https://note.com/login` |
| 待機時間 | 3秒（ページ読み込み） |
| メール入力 | CSS: `.o-login__mailField input, input[type="email"]` |
| パスワード入力 | CSS: `input[type="password"]` |
| ログインボタン | CSS: `.o-login__button, button[type="submit"]` |
| 成功判定 | URLに`login`が含まれないこと |
| 待機時間 | ログインボタンクリック後5秒 |

#### Step 2: 記事作成画面への移動

| 項目 | 仕様 |
|------|------|
| 初期アクセスURL | `https://note.com/post` |
| 「テキスト」ボタン検索 | XPath複数パターンで試行 |
| フォールバックURL | `https://note.com/notes/new` |
| 最終URL形式 | `https://editor.note.com/notes/{note_id}/edit/` |

#### Step 3: タイトル入力

| 項目 | 仕様 |
|------|------|
| 待機時間 | 3秒（エディタ読み込み） |
| 入力方式 | `scrollIntoView` → `click` → `clear` → `send_keys` |
| 主要セレクタ | `textarea[placeholder*="タイトル"]` |

**失敗時：** `/tmp/note_debug_step3.png` にスクリーンショット保存

#### Step 4: 本文入力（URLリンク化対応）

| 項目 | 仕様 |
|------|------|
| 待機時間 | 2秒 |
| 入力方式 | **JavaScript innerHTML注入**（優先） |
| URLリンク化 | 全てのURLを`<a href="...">` タグに変換 |
| BMP制限対策 | 非BMP文字（絵文字等）を事前除去 |

**本文入力欄のCSSセレクタ：**
```python
[
    '.ProseMirror',
    '[contenteditable="true"]:not([data-placeholder*="タイトル"])',
    '.editor-body [contenteditable="true"]',
]
```

**JavaScript注入による入力：**
```javascript
var editor = arguments[0];
var content = arguments[1];  // HTMLコンテンツ（<a>タグ含む）
editor.innerHTML = content;
editor.dispatchEvent(new Event('input', { bubbles: true }));
```

**失敗時：** `/tmp/note_debug_step4.png` にスクリーンショット保存

#### Step 5: 画像アップロード（オプション）

| 項目 | 仕様 |
|------|------|
| 実行条件 | `image_path`が指定され、ファイルが存在する場合 |
| アイキャッチボタン | XPath: `//*[contains(text(), 'アイキャッチ')]` |
| ファイル入力 | CSS: `input[type="file"]` |

#### Step 6: 公開設定パネルを開く

| 項目 | 仕様 |
|------|------|
| 待機時間 | 2秒 |
| ボタンセレクタ | `//span[contains(text(), '公開')]/ancestor::button` |
| 待機時間 | クリック後3秒 |

**失敗時：** `/tmp/note_debug_step6.png` にスクリーンショット保存

#### Step 7: 有料設定（480円）

| 項目 | 仕様 |
|------|------|
| 待機時間 | 2秒 |
| 有料選択 | `//span[contains(text(), '有料')]` |
| 価格入力 | `//input[@type='number']` → "480" |

#### Step 8: 有料エリア設定

| 項目 | 仕様 |
|------|------|
| 待機時間 | 2秒 |
| ボタンセレクタ | `//span[contains(text(), '有料エリア設定')]/ancestor::button` |
| 待機時間 | クリック後3秒 |

**失敗時：** `/tmp/note_debug_step8_area.png` にスクリーンショット保存

#### Step 9: 有料ライン設定

| 項目 | 仕様 |
|------|------|
| 待機時間 | 3秒 |
| 処理 | デフォルト位置を使用（確定ボタンがあれば押す） |

**スクリーンショット：** `/tmp/note_step9_paywall.png`

#### Step 10: 最終公開

| 項目 | 仕様 |
|------|------|
| 待機時間 | 2秒 |
| ボタンセレクタ | `//button[normalize-space()='投稿する']` |
| 待機時間 | クリック後5秒 |

**主要セレクタパターン：**
```python
[
    "//button[text()='投稿する']",
    "//button[normalize-space()='投稿する']",
    "//button[contains(text(), '公開する')]",
    "//button[contains(text(), '有料で公開')]",
]
```

**失敗時：**
- `/tmp/note_debug_step8.png` にスクリーンショット保存
- 30秒待機して手動公開を促す

---

## 5. Markdown → HTML変換（URLリンク化）

### 5.1 変換ルール

| Markdown | 変換後 |
|----------|--------|
| `# 見出し1` | `◆ 見出し1` |
| `## 見出し2` | `■ 見出し2` |
| `### 見出し3` | `▼ 見出し3` |
| `**太字**` | `【太字】` |
| `*斜体*` | 斜体（装飾削除） |
| `` `コード` `` | `「コード」` |
| `[テキスト](URL)` | `<a href="URL">テキスト</a>` |
| プレーンURL | `<a href="URL">URL</a>` |
| コードブロック | 削除 |

### 5.2 URLリンク化処理

```python
def markdown_to_html(markdown_text: str) -> str:
    # 1. Markdownリンク [text](url) → <a href="url">text</a>
    text = re.sub(r'\[(.+?)\]\((https?://[^\)]+)\)', r'<a href="\2">\1</a>', text)

    # 2. プレーンURLを<a>タグに変換（既存リンク内は除く）
    text = re.sub(r'(https?://[^\s<>"\']+)', r'<a href="\1">\1</a>', text)

    return text
```

### 5.3 前処理

1. BMP外文字の除去（ChromeDriver制限対策）
2. フロントマター（YAML）の削除
3. 連続空行の正規化（3行以上 → 2行）

---

## 6. エラーハンドリング

### 6.1 ChromeDriver BMP制限エラー

**エラーメッセージ：**
```
ChromeDriver only supports characters in the BMP
```

**対策：**
- `remove_non_bmp()` 関数で事前にフィルタリング
- JavaScript innerHTML注入方式で入力

### 6.2 要素が見つからないエラー

**対策：**
- 複数のCSS/XPathセレクタを順次試行
- 失敗時はスクリーンショットを保存してデバッグ

### 6.3 バックグラウンド実行時のEOFError

**対策：**
```python
import sys
if sys.stdin.isatty():
    input("Enterキーで終了...")
else:
    time.sleep(10)  # バックグラウンド時は10秒待機
```

---

## 7. 使用方法

### 7.1 基本コマンド

```bash
# 有料記事として公開
python scripts/note_draft_poster_selenium.py \
  --title "記事タイトル" \
  --file path/to/article.md

# 画像付き
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

### 7.2 コマンドオプション

| オプション | 短縮 | 必須 | 説明 |
|-----------|------|------|------|
| `--title` | `-t` | Yes | 記事タイトル |
| `--file` | `-f` | Yes | Markdownファイルのパス |
| `--image` | `-i` | No | アイキャッチ画像のパス |
| `--headless` | - | No | ブラウザを非表示で実行 |

### 7.3 公開される記事の仕様

| 項目 | 値 |
|------|-----|
| 価格 | 480円（固定） |
| 有料ライン | デフォルト位置 |
| URLリンク | 全てクリック可能 |

---

## 8. 制限事項

| 項目 | 詳細 |
|------|------|
| 2段階認証 | 非対応（無効化が必要） |
| 価格変更 | 現在は480円固定（要カスタマイズ） |
| API安定性 | noteのUI変更で動作しなくなる可能性あり |
| レート制限 | 大量投稿は避けること（BAN/制限リスク） |
| 絵文字 | BMP外の絵文字は自動削除される |

---

## 9. トラブルシューティング

### 9.1 ログイン失敗

**確認事項：**
- `.env`のメールアドレス/パスワードが正しいか
- 2段階認証が無効になっているか

### 9.2 タイトル/本文入力失敗

**確認事項：**
- スクリーンショット: `/tmp/note_debug_step3.png`, `/tmp/note_debug_step4.png`

### 9.3 有料設定/公開失敗

**確認事項：**
- スクリーンショット: `/tmp/note_debug_step8_area.png`, `/tmp/note_step9_paywall.png`
- noteのUIが変更されていないか

### 9.4 URLがリンクにならない

**確認事項：**
- JavaScript innerHTML注入が成功しているか
- `<a href="...">` タグが正しく生成されているか

---

## 10. 関連ドキュメント

- [NOTE_IMAGE_SPEC.md](./NOTE_IMAGE_SPEC.md) - note記事生成の仕様書
- [README_NOTE_POSTER.md](../scripts/README_NOTE_POSTER.md) - 使用マニュアル

---

*作成日: 2024-12-22*
*最終更新: 2024-12-22*
*バージョン: 2.0 - 有料記事自動公開・URLリンク化対応*
