#!/bin/bash
# AIT42エージェント優先設定スクリプト
# 他のプロジェクトでAIT42のCoordinatorを優先的に起動させる

set -euo pipefail

# カラー出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 設定
AIT42_SOURCE="${1:-node_modules/ait42/.claude/agents}"
TARGET_DIR=".claude/agents"
COPY_ALL="${2:-no}"  # "all" を指定すると全エージェントをコピー

# ヘッダー
echo -e "${BLUE}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  AIT42 エージェント優先設定スクリプト         ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════╝${NC}"
echo ""

# 引数チェック
if [[ ! -d "$AIT42_SOURCE" ]]; then
  echo -e "${RED}❌ エラー: AIT42のエージェントディレクトリが見つかりません${NC}"
  echo -e "${YELLOW}   指定されたパス: $AIT42_SOURCE${NC}"
  echo ""
  echo "使用方法:"
  echo "  ./setup-ait42-priority.sh [AIT42のパス] [all]"
  echo ""
  echo "例:"
  echo "  ./setup-ait42-priority.sh                           # npm install後（デフォルト）"
  echo "  ./setup-ait42-priority.sh /path/to/AIT42/.claude/agents  # 直接パス指定"
  echo "  ./setup-ait42-priority.sh /path/to/AIT42/.claude/agents all  # 全エージェントコピー"
  exit 1
fi

# ターゲットディレクトリ作成
echo -e "${BLUE}📁 ターゲットディレクトリ作成: $TARGET_DIR${NC}"
mkdir -p "$TARGET_DIR"

# Coordinator の優先コピー
echo ""
echo -e "${BLUE}🎯 PRIMARY AGENT: Coordinator をコピー${NC}"

COORDINATOR_SOURCE=""
if [[ -f "$AIT42_SOURCE/00-ait42-coordinator.md" ]]; then
  COORDINATOR_SOURCE="00-ait42-coordinator.md"
elif [[ -f "$AIT42_SOURCE/coordinator.md" ]]; then
  COORDINATOR_SOURCE="coordinator.md"
else
  echo -e "${RED}❌ エラー: coordinator.md が見つかりません${NC}"
  exit 1
fi

cp "$AIT42_SOURCE/$COORDINATOR_SOURCE" "$TARGET_DIR/00-ait42-coordinator.md"
echo -e "${GREEN}✅ Coordinator: 00-ait42-coordinator.md として配置${NC}"
echo -e "${YELLOW}   → アルファベット順で最優先で読み込まれます${NC}"

# Memory system のコピー
echo ""
echo -e "${BLUE}🧠 Memory System をコピー${NC}"

MEMORY_SOURCE="$(dirname "$AIT42_SOURCE")/memory"
MEMORY_BACKUP="$(dirname "$AIT42_SOURCE")/memory.bak"

# シンボリックリンクの場合はバックアップから、通常のディレクトリの場合はそのままコピー
MEMORY_COPIED=false
if [[ -L "$MEMORY_SOURCE" ]]; then
  echo -e "${YELLOW}   ⚠️  シンボリックリンク検出: バックアップからコピーします${NC}"
  if [[ -d "$MEMORY_BACKUP" ]]; then
    mkdir -p .claude/memory
    cp -r "$MEMORY_BACKUP"/* .claude/memory/ 2>/dev/null || true
    echo -e "${GREEN}✅ Memory System: .claude/memory/ にコピー（バックアップから）${NC}"
    MEMORY_COPIED=true
  else
    echo -e "${RED}❌ エラー: バックアップが見つかりません${NC}"
  fi
elif [[ -d "$MEMORY_SOURCE" ]]; then
  mkdir -p .claude/memory
  cp -r "$MEMORY_SOURCE"/* .claude/memory/ 2>/dev/null || true
  echo -e "${GREEN}✅ Memory System: .claude/memory/ にコピー${NC}"
  MEMORY_COPIED=true
else
  echo -e "${YELLOW}⚠️  Memory System が見つかりません（スキップ）${NC}"
fi

# Memory System scripts の依存関係インストール
if [[ "$MEMORY_COPIED" == true ]] && [[ -f ".claude/memory/scripts/package.json" ]]; then
  echo ""
  echo -e "${BLUE}📦 Memory System scripts の依存関係をインストール中...${NC}"

  # npm が利用可能か確認
  if command -v npm &> /dev/null; then
    (cd .claude/memory/scripts && npm install --silent --no-audit --no-fund) && {
      echo -e "${GREEN}✅ 依存関係のインストールに成功しました${NC}"
    } || {
      echo -e "${YELLOW}⚠️  依存関係のインストールに失敗しました${NC}"
      echo -e "${YELLOW}   Memory記録機能が動作しない可能性があります${NC}"
      echo -e "${YELLOW}   手動で実行してください: cd .claude/memory/scripts && npm install${NC}"
    }
  else
    echo -e "${YELLOW}⚠️  npm が見つかりません${NC}"
    echo -e "${YELLOW}   Memory記録機能を使用するには、以下を実行してください:${NC}"
    echo -e "${YELLOW}   cd .claude/memory/scripts && npm install${NC}"
  fi
fi

# ReflectionAgent のコピー
echo ""
echo -e "${BLUE}🔍 ReflectionAgent をコピー${NC}"

if [[ -f "$AIT42_SOURCE/reflection-agent.md" ]]; then
  cp "$AIT42_SOURCE/reflection-agent.md" "$TARGET_DIR/ait42-reflection-agent.md"
  echo -e "${GREEN}✅ ReflectionAgent: ait42-reflection-agent.md として配置${NC}"
else
  echo -e "${YELLOW}⚠️  reflection-agent.md が見つかりません（スキップ）${NC}"
fi

# 全エージェントのコピー（オプション）
if [[ "$COPY_ALL" == "all" ]]; then
  echo ""
  echo -e "${BLUE}📦 全エージェントをコピー中...${NC}"

  COUNT=0
  for file in "$AIT42_SOURCE"/*.md; do
    basename=$(basename "$file")

    # Coordinatorと ReflectionAgent は既にコピー済みなのでスキップ
    if [[ "$basename" == "coordinator.md" ]] || \
       [[ "$basename" == "00-ait42-coordinator.md" ]] || \
       [[ "$basename" == "reflection-agent.md" ]]; then
      continue
    fi

    # ait42- プレフィックスが無い場合は追加
    if [[ "$basename" != ait42-* ]]; then
      cp "$file" "$TARGET_DIR/ait42-${basename}"
    else
      cp "$file" "$TARGET_DIR/${basename}"
    fi

    COUNT=$((COUNT + 1))
  done

  echo -e "${GREEN}✅ ${COUNT}個の追加エージェントをコピーしました${NC}"
fi

# SOPs（標準手順書）のコピー
echo ""
echo -e "${BLUE}📋 SOPs（標準手順書）をコピー${NC}"

SOP_SOURCE="$(dirname "$AIT42_SOURCE")/memory/sop-templates"
SOP_BACKUP="$(dirname "$AIT42_SOURCE")/memory.bak/sop-templates"

# メモリーシステムがシンボリックリンクの場合はバックアップから
if [[ -L "$(dirname "$AIT42_SOURCE")/memory" ]]; then
  if [[ -d "$SOP_BACKUP" ]]; then
    mkdir -p .claude/memory/sop-templates
    cp -r "$SOP_BACKUP"/* .claude/memory/sop-templates/ 2>/dev/null || true
    echo -e "${GREEN}✅ SOPs: .claude/memory/sop-templates/ にコピー（バックアップから）${NC}"
  else
    echo -e "${YELLOW}⚠️  SOPs バックアップが見つかりません（スキップ）${NC}"
  fi
elif [[ -d "$SOP_SOURCE" ]]; then
  mkdir -p .claude/memory/sop-templates
  cp -r "$SOP_SOURCE"/* .claude/memory/sop-templates/ 2>/dev/null || true
  echo -e "${GREEN}✅ SOPs: .claude/memory/sop-templates/ にコピー${NC}"
else
  echo -e "${YELLOW}⚠️  SOPs が見つかりません（スキップ）${NC}"
fi

# 検証
echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  インストール結果                             ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${GREEN}📋 インストール済みAIT42エージェント:${NC}"
ls -1 "$TARGET_DIR"/00-*.md "$TARGET_DIR"/ait42-*.md 2>/dev/null | head -10 || echo "  (エージェントが見つかりません)"

echo ""
echo -e "${GREEN}🧠 Memory System:${NC}"
if [[ -d ".claude/memory" ]]; then
  echo "  ✅ .claude/memory/ が存在します"
  echo "     - config.yaml: $(test -f .claude/memory/config.yaml && echo '✅' || echo '❌')"

  # agents/ の詳細
  if [[ -d .claude/memory/agents ]]; then
    AGENT_COUNT=$(find .claude/memory/agents -name "*.yaml" -type f 2>/dev/null | wc -l)
    echo "     - agents/: ✅ (${AGENT_COUNT}個の統計ファイル)"
  else
    echo "     - agents/: ❌"
  fi

  # tasks/ の詳細
  if [[ -d .claude/memory/tasks ]]; then
    TASK_COUNT=$(find .claude/memory/tasks -name "*.yaml" -type f 2>/dev/null | wc -l)
    echo "     - tasks/: ✅ (${TASK_COUNT}個のサンプル)"
  else
    echo "     - tasks/: ❌"
  fi

  # sop-templates/ の詳細
  if [[ -d .claude/memory/sop-templates ]]; then
    SOP_COUNT=$(find .claude/memory/sop-templates -name "*.md" -type f 2>/dev/null | wc -l)
    echo "     - sop-templates/: ✅ (${SOP_COUNT}個のテンプレート)"
  else
    echo "     - sop-templates/: ❌"
  fi

  # scripts/ の詳細
  if [[ -d .claude/memory/scripts ]]; then
    if [[ -d .claude/memory/scripts/node_modules ]]; then
      echo "     - scripts/: ✅ (依存関係インストール済み)"
    else
      echo "     - scripts/: ⚠️  (依存関係未インストール)"
    fi
  else
    echo "     - scripts/: ❌"
  fi
else
  echo "  ❌ .claude/memory/ が存在しません"
fi

# 完了メッセージ
echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  ✅ AIT42 優先設定完了                        ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}使用方法:${NC}"
echo ""
echo -e "${YELLOW}1. 自動ディスパッチ（推奨）:${NC}"
echo '   Claude Codeで: "新機能を実装して"'
echo '   → 00-ait42-coordinator が自動的に最優先で選択されます'
echo ""
echo -e "${YELLOW}2. 明示的指定:${NC}"
echo '   Claude Codeで: "ait42-coordinatorで、新機能を実装して"'
echo '   → 確実に AIT42 の Coordinator が起動します'
echo ""
echo -e "${YELLOW}3. Memory System 有効化:${NC}"
echo '   初回タスク実行後、.claude/memory/ に履歴が記録され'
echo '   次回から過去の成功パターンを学習します'
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}AIT42 v1.4.0 が優先的に起動する準備が整いました！${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
