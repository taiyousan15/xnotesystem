#!/bin/bash
# スリープ解除スケジュール設定スクリプト
# 管理者権限で実行: sudo ./setup-wake-schedule.sh

echo "=========================================="
echo "  X Note System - スリープ解除スケジュール設定"
echo "=========================================="

# 現在の設定を表示
echo ""
echo "[現在のスケジュール]"
pmset -g sched
echo ""

# 既存のスケジュールをクリア
echo "[既存スケジュールをクリア中...]"
sudo pmset repeat cancel 2>/dev/null

# 新しいスケジュールを設定
# 毎日5:55にスリープ解除（AI News収集の5分前）
echo "[新しいスケジュールを設定中...]"
sudo pmset repeat wake MTWRFSU 05:55:00

echo ""
echo "[設定完了]"
echo ""

# 設定確認
echo "[新しいスケジュール]"
pmset -g sched

echo ""
echo "=========================================="
echo "  追加設定（電源接続時のスリープ防止）"
echo "=========================================="
echo ""
echo "電源接続時にスリープしないようにするには:"
echo "  sudo pmset -c sleep 0"
echo ""
echo "現在の電源設定:"
pmset -g | grep sleep
echo ""
