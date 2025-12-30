# X AIトレンド収集・収益化システム 完全仕様書

**最終更新**: 2025-12-24
**システムバージョン**: 2.0

---

## システムの使命

X（旧Twitter）のAI関連投稿を自動収集し、編集価値を付加してVIPコミュニティへ提供する。
情報の深さ・編集度・先行性によって一般/VIP会員を明確に差別化する。

---

## クイックスタート

### 日次運用（毎日実行）
```bash
npm run ai-news          # AIニュース収集 → Discord投稿（約20分）
```

### 週次運用
```bash
npm run weekly-summary:tuesday      # 火曜日: 無料まとめ → Discord
npm run weekly-summary:friday:note  # 金曜日: 有料まとめ → Discord + note自動公開
```

### テスト実行（投稿なし）
```bash
npm run ai-news:dry
npm run weekly-summary:tuesday:dry
npm run weekly-summary:friday:dry
```

---

## 絶対原則

### 1. 収集ルール
- 優先インフルエンサー（7名）は **バズ条件に関係なく必ず全件取得**
- AI関連キーワード（11クエリ）で日次取得
- 重複排除は `tweet_id` 単位で厳守

### 2. スコアリング
```
final_score = (base * 0.25) + (velocity * 0.25) + (efficiency * 0.25) + (semantic * 0.25)
priority_account → +15
```

### 3. 収益化ルール
- 有料note: **週最大2本、480円固定**
- 有料条件: 再現性がある or 時間/お金の価値が明確
- それ以外は無料記事

### 4. 配信ルール
- 一般会員: トレンド要約のみ
- VIP会員: 重要投稿2件 + 編集解説

---

## 優先インフルエンサー（必須取得）

```
@SuguruKun_ai
@taishiyade
@ceo_tommy1
@rute1203d
@The_AGI_WAY
@unikoukokun
@kamui_qai
```

---

## 禁止事項

- 同日二重処理
- LLMハルシネーション（不明点は必ず確認）
- 設定値のハードコーディング（config.json で管理）
- APIキーのコード内記述（.env 必須）

---

## ファイル構成

```
taissunyuco/
├── .env                              # 環境変数（API キー、認証情報）
├── .claude/CLAUDE.md                 # このファイル（システム仕様書）
├── config/
│   ├── config.json                   # 基本設定
│   └── ai-news-queries.json          # 検索クエリ設定（11本）
├── src/cli/
│   ├── ai-news-collect.ts            # 日次AIニュース収集
│   └── weekly-summary.ts             # 週次まとめ生成
├── scripts/
│   ├── note_draft_poster_selenium.py # note自動投稿（Selenium）
│   └── README_NOTE_POSTER.md         # note投稿スクリプト説明
├── data/
│   └── ai-news/                      # 収集データ保存
│       └── ai-news_YYYY-MM-DD.json
└── output/
    └── weekly-summary/               # 週次記事保存
        ├── weekly_tuesday_YYYY-MM-DD.md
        └── weekly_friday_YYYY-MM-DD.md
```

---

## 環境変数一覧（.env）

```bash
# === X (Twitter) API ===
TWITTER_BEARER_TOKEN=xxx           # X API Bearer Token（Basic Plan $100/月）

# === Anthropic API ===
ANTHROPIC_API_KEY=xxx              # Claude API キー

# === Discord Webhooks ===
DISCORD_WEBHOOK_RAW=xxx              # 全件投稿チャンネル
DISCORD_WEBHOOK_NEWS=xxx             # 速報ピック10件
DISCORD_WEBHOOK_PRACTICE=xxx         # 実務ピック10件
DISCORD_WEBHOOK_NOTE_PAID=xxx        # 有料候補一覧
DISCORD_WEBHOOK_WEEKLY_SUMMARY=xxx   # VIP週次まとめ（1つ目）
DISCORD_WEBHOOK_WEEKLY_SUMMARY_2=xxx # VIP週次まとめ（2つ目）

# === note.com 認証 ===
NOTE_EMAIL=xxx                     # noteログインメール
NOTE_PASSWORD=xxx                  # noteパスワード
NOTE_USER_NAME=xxx                 # noteユーザー名（オプション）
```

---

## 日次AIニュース収集システム

### 概要
毎日200〜300件のAI関連投稿をXから収集し、Discordに自動投稿する。

### 実行コマンド
```bash
npm run ai-news              # 本番実行（約20分）
npm run ai-news:breaking     # 速報のみ（Q1-Q5）
npm run ai-news:practical    # 実務系のみ（Q6-Q11）
npm run ai-news:dry          # テスト（Discord投稿なし）
```

### 検索クエリ構成（11本）

#### 速報系（Q1-Q5）
| ID | 名称 | 件数 | 説明 |
|----|------|------|------|
| Q1 | 公式リリース（英） | 20 | OpenAI/Google/Anthropic/Meta/xAI |
| Q2 | 研究論文 | 20 | arXiv/論文/ベンチマーク |
| Q3 | プロダクト | 20 | ツール/API/SDK |
| Q4 | 規制議論 | 20 | AI Act/著作権/規制 |
| Q5 | 日本語ニュース | 40 | 日本語のAI速報 |

#### 実務系（Q6-Q11）
| ID | 名称 | 件数 | 説明 |
|----|------|------|------|
| Q6 | 開発OSS | 20 | LangChain/LlamaIndex/Ollama |
| Q7 | エージェントRAG | 20 | AIエージェント/RAG |
| Q8 | ビジネス収益 | 20 | 収益化/副業/自動化 |
| Q9 | セキュリティ | 20 | プロンプトインジェクション/脆弱性 |
| Q10 | 日本語活用事例 | 40 | 日本語の実務ノウハウ |
| Q11 | 優先インフルエンサー | 50 | 7名の全投稿 |

### Rate Limit対策
- X API Basic Plan: $100/月、10,000 tweets/月
- 2分間隔で順次実行（11クエリ × 2分 = 約22分）
- 設定: `config/ai-news-queries.json` → `delayBetweenQueries: 120000`

### 出力先
- **JSON保存**: `data/ai-news/ai-news_YYYY-MM-DD.json`
- **Discord投稿**: 各Webhookチャンネルへ自動投稿

### タグ判定ルール
- `[STAR]`: 再現手順/テンプレ/具体例/数字あり → 有料note候補
- `[DEEP]`: 研究/比較/スレッド/長文 → 深掘り候補
- `[LIKE]`: 有益だが深掘り不要 → 保管

---

## 週次まとめシステム

### 投稿スケジュール
| 曜日 | モード | 価格 | 投稿先 |
|------|--------|------|--------|
| 火曜日 | 速報まとめ | 無料 | VIP Discord |
| 金曜日 | 実務深掘り | 480円 | VIP Discord + note |

### コマンド
```bash
# 火曜日: 速報まとめ（無料）→ Discord投稿
npm run weekly-summary:tuesday

# 金曜日: 実務深掘り（有料480円）→ Discord投稿のみ
npm run weekly-summary:friday

# 金曜日: Discord投稿 + note自動公開（480円）
npm run weekly-summary:friday:note

# テスト（投稿なし）
npm run weekly-summary:tuesday:dry
npm run weekly-summary:friday:dry
```

### 処理フロー
1. 過去7日分の `data/ai-news/` データを集約
2. Claude APIで記事生成（火曜=7000文字、金曜=10000文字）
3. `output/weekly-summary/` に保存
4. VIP Discord（DISCORD_WEBHOOK_WEEKLY_SUMMARY）に全文投稿
5. note.com投稿（金曜日のみ自動、火曜日は手動）

### note自動投稿の仕組み
- Pythonスクリプト: `scripts/note_draft_poster_selenium.py`
- Seleniumでブラウザを自動操作
- 有料記事（480円）として公開
- 環境変数: `NOTE_EMAIL`, `NOTE_PASSWORD` が必要

### 記事生成プロンプト
- WIIFM法則（読者視点で価値を明示）
- PASCAL型構成（Problem → Agitate → Solution → Credibility → Action → Limitation）
- 希少性と緊急性を訴求（有料記事）

---

## cron設定（自動実行）

```bash
# 毎日6時: AIニュース収集
0 6 * * * cd /Users/yuco/div/taissunyuco && npm run ai-news >> /tmp/ai-news.log 2>&1

# 火曜10時: 速報まとめ（Discord投稿）
0 10 * * 2 cd /Users/yuco/div/taissunyuco && npm run weekly-summary:tuesday >> /tmp/weekly-tue.log 2>&1

# 金曜10時: 実務深掘り（Discord投稿 + note自動公開）
0 10 * * 5 cd /Users/yuco/div/taissunyuco && npm run weekly-summary:friday:note >> /tmp/weekly-fri.log 2>&1
```

### cron設定方法
```bash
crontab -e
# 上記の3行を追加して保存
```

---

## note記事生成の原則

### 記事タイプ
1. **有料販売記事**: 販売フック・コピー重視
2. **無料教育記事**: 信頼・教育・価値提供重視
3. **誘導記事**: 共感・メリット・行動喚起 + 明確なCTA

### コピーライティング原則
- WIIFM法則（What's In It For Me?）: 読者視点で価値を明示
- ベネフィット・ヘッドライン: 冒頭で「何が得られるか」を伝える
- PASCAL型構成: 悩み→共感→解決→行動喚起

### 心理技術
- 影響力6原則: 社会的証明・好意・権威・返報性・一貫性・希少性
- 損失回避: 「買わないと失う」「最悪の未来」を示す

---

## トラブルシューティング

### X API Rate Limit エラー
```
Error: 429 Too Many Requests
```
**対処**: `config/ai-news-queries.json` の `delayBetweenQueries` を増やす（現在120000ms = 2分）

### note投稿失敗
```
Error: ログインに失敗しました
```
**対処**:
1. `NOTE_EMAIL`, `NOTE_PASSWORD` を確認
2. noteの2段階認証を無効化
3. スクリーンショット確認: `/tmp/note_debug_*.png`

### Discord Webhook エラー
```
Error: Invalid Webhook URL
```
**対処**: `.env` のWebhook URLを確認（https://discord.com/api/webhooks/... の形式）

### Claude API エラー
```
Error: 401 Unauthorized
```
**対処**: `ANTHROPIC_API_KEY` を確認

---

## セットアップ手順（新規環境）

### 1. 依存関係インストール
```bash
npm install
pip install selenium python-dotenv
```

### 2. 環境変数設定
```bash
cp .env.example .env
# .env を編集してAPIキー等を設定
```

### 3. 動作確認
```bash
# テスト実行（投稿なし）
npm run ai-news:dry
npm run weekly-summary:friday:dry
```

### 4. cron設定
```bash
crontab -e
# 上記のcron設定を追加
```

---

## API情報

### X (Twitter) API
- プラン: Basic ($100/月)
- 制限: 10,000 tweets/月
- 認証: Bearer Token

### Anthropic Claude API
- モデル: claude-sonnet-4-20250514
- 用途: 週次記事生成

### Discord Webhook
- 5つのチャンネルに分散投稿
- 2000文字制限のため分割送信

### note.com
- Selenium自動操作
- 有料記事480円固定

---

## 実装原則

- 各処理は独立関数/独立ファイル
- 設定値は `config.json` で一元管理
- 再実行耐性必須
- エラー時は再試行1回→スキップ→通知

---

## 変更履歴

### 2025-12-24 v2.0
- 週次まとめシステム実装
- note自動投稿連携
- Discord VIP Webhook追加
- 日本語コンテンツ強化（Q5, Q10を40件、Q11追加）
- Rate Limit対策（2分間隔）

### 初期バージョン
- 日次AIニュース収集
- Discord自動投稿
- タグ判定システム
