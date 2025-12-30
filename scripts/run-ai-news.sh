#!/bin/bash
# AI News 日次収集スクリプト
# LaunchAgentから呼び出される

# 環境変数の読み込み
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# プロジェクトディレクトリ
PROJECT_DIR="/Users/matsumototoshihiko/Desktop/テスト開発/xnotesystem"
LOG_FILE="$PROJECT_DIR/logs/ai-news.log"

# ログディレクトリ作成
mkdir -p "$PROJECT_DIR/logs"

# タイムスタンプ
echo "========================================" >> "$LOG_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] AI News収集開始" >> "$LOG_FILE"

# プロジェクトディレクトリに移動
cd "$PROJECT_DIR"

# npm run ai-news 実行
/opt/homebrew/bin/npm run ai-news >> "$LOG_FILE" 2>&1
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] AI News収集完了（成功）" >> "$LOG_FILE"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] AI News収集完了（エラー: $EXIT_CODE）" >> "$LOG_FILE"
fi

echo "========================================" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

exit $EXIT_CODE
