#!/bin/bash
# 週次まとめスクリプト
# LaunchAgentから呼び出される

# 環境変数の読み込み
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# プロジェクトディレクトリ
PROJECT_DIR="/Users/matsumototoshihiko/Desktop/テスト開発/xnotesystem"
LOG_FILE="$PROJECT_DIR/logs/weekly-summary.log"

# ログディレクトリ作成
mkdir -p "$PROJECT_DIR/logs"

# 曜日を取得（1=月, 2=火, ..., 5=金）
DAY_OF_WEEK=$(date '+%u')

# タイムスタンプ
echo "========================================" >> "$LOG_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 週次まとめ開始（曜日: $DAY_OF_WEEK）" >> "$LOG_FILE"

# プロジェクトディレクトリに移動
cd "$PROJECT_DIR"

# 曜日に応じて実行
if [ "$DAY_OF_WEEK" -eq 2 ]; then
    # 火曜日: 無料まとめ → Discord
    echo "火曜日モード: 速報まとめ（無料）" >> "$LOG_FILE"
    /opt/homebrew/bin/npm run weekly-summary:tuesday >> "$LOG_FILE" 2>&1
    EXIT_CODE=$?
elif [ "$DAY_OF_WEEK" -eq 5 ]; then
    # 金曜日: 有料まとめ → Discord + note
    echo "金曜日モード: 実務深掘り（有料） + note投稿" >> "$LOG_FILE"
    /opt/homebrew/bin/npm run weekly-summary:friday:note >> "$LOG_FILE" 2>&1
    EXIT_CODE=$?
else
    echo "実行対象外の曜日です（火曜・金曜のみ実行）" >> "$LOG_FILE"
    EXIT_CODE=0
fi

if [ $EXIT_CODE -eq 0 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 週次まとめ完了（成功）" >> "$LOG_FILE"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 週次まとめ完了（エラー: $EXIT_CODE）" >> "$LOG_FILE"
fi

echo "========================================" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

exit $EXIT_CODE
