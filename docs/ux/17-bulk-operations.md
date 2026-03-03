# UX-17: 一括操作UI

## 概要
タスク一覧で複数タスクを選択し、ステータス・ボールを一括変更する。

## 実装

### 選択モデル
- TaskRow にチェックボックスを追加
- 通常時: hover で表示（`group-hover:opacity-100`）
- 一括モード（1件以上選択時）: 全行のチェックボックスが常時表示
- 選択行は `bg-blue-50/60` でハイライト
- `Escape` キーで全選択解除
- フィルタータブ変更時にも自動クリア

### バルクアクションツールバー
- タスクリストの下部に固定表示（`animate-slide-down`）
- 表示要素:
  - 選択件数
  - ステータス変更: Todo / 進行中 / 完了
  - ボール変更: 社内 / クライアント
  - 選択解除ボタン
- クライアントへのボール変更時、クライアント担当者未設定タスクがあればエラー表示

### TaskRow 新 props
- `bulkMode: boolean` — 一括選択モードか
- `isChecked: boolean` — 選択されているか
- `onCheckChange: (taskId, checked) => void` — チェック変更

## 変更ファイル
- `src/components/task/TaskRow.tsx` — チェックボックス追加
- `src/app/(internal)/[orgId]/project/[spaceId]/TasksPageClient.tsx` — 選択管理 + ツールバー
- `src/components/shared/KeyboardShortcutsHelp.tsx` — Esc 説明更新
