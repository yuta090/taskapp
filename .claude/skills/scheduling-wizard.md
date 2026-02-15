---
name: scheduling-wizard
description: 日程調整の全フロー。空き時間提案→提案作成→回答確認→確定。「日程調整」「スケジュール調整」「会議の日程を決めたい」と言われた時に使用。
---

# 日程調整ウィザード スキル

GoogleカレンダーからAI空き時間提案→提案作成→回答フォロー→確定までの一連のフローを実行します。

## ワークフロー

### Step 1: 空き時間の自動提案
MCP `suggest_available_slots` で参加者全員のGoogleカレンダーを確認し、共通の空き時間を取得。

必要な情報：
- 参加者のユーザーUUID（`client_list` / `client_get` で検索可能）
- 対象期間（開始日〜終了日）
- 会議時間（分）

### Step 2: 提案作成
候補スロットから2〜5個を選び、MCP `create_scheduling_proposal` で提案を作成。
- client側の回答者を1名以上含める
- `videoProvider` でオンライン会議ツールを指定可能

### Step 3: 回答状況の確認
MCP `get_proposal_responses` で回答状況を確認。
- 未回答者がいれば `send_proposal_reminder` でリマインド通知

### Step 4: スロット確定
全員の回答が揃ったら、MCP `confirm_proposal_slot` で確定。
- 自動で会議が作成される

### 補助操作
- 期限切れ前の延長: `cancel_scheduling_proposal` (action=extend)
- 中止: `cancel_scheduling_proposal` (action=cancel)

## 使用するMCPツール
| ステップ | ツール |
|---------|--------|
| 空き時間確認 | `suggest_available_slots` |
| 提案作成 | `create_scheduling_proposal` |
| 回答確認 | `get_proposal_responses` |
| リマインド | `send_proposal_reminder` |
| 確定 | `confirm_proposal_slot` |
| キャンセル/延長 | `cancel_scheduling_proposal` |
| 提案一覧 | `list_scheduling_proposals` |
