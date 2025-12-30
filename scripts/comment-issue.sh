#!/bin/bash
# GitHub Issue コメント自動化スクリプト
# 使い方: ./scripts/comment-issue.sh <issue番号> <コメント>

ISSUE_NUMBER=$1
COMMENT=$2

if [ -z "$ISSUE_NUMBER" ] || [ -z "$COMMENT" ]; then
    echo "使い方: $0 <issue番号> <コメント>"
    echo "例: $0 123 '修正完了しました'"
    exit 1
fi

# GitHub CLIでコメント投稿
gh issue comment "$ISSUE_NUMBER" --body "$COMMENT"

if [ $? -eq 0 ]; then
    echo "✅ Issue #$ISSUE_NUMBER にコメントを投稿しました"
else
    echo "❌ コメント投稿に失敗しました"
    exit 1
fi
