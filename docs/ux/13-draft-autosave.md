# UX-13: 下書き自動保存

## 概要
タスク作成フォームの入力内容を localStorage に自動保存し、
フォームを閉じても入力内容が失われないようにする。

## 実装

### 汎用フック `useFormDraft<T>`
- `src/lib/hooks/useFormDraft.ts`
- localStorage に debounce 付き（500ms）で保存
- `enabled` フラグで保存/復元の有効化を制御
- `save(data)` / `clear()` / `draft` / `restored` を返す
- キーは `taskapp_draft_` プレフィックス付き

### TaskCreateSheet への適用
- スペースごとに独立したキー: `task_create_${spaceId}`
- グローバル作成は `task_create_global`
- フォームが開いた時に下書きを復元、`toast.info('下書きを復元しました')` で通知
- フィールド変更時に自動保存（debounce 500ms）
- 送信成功時に `clearDraft()` でクリア
- タイトル・説明・期限・担当者すべて空の場合は保存しない（空フォーム除外）

### 保存対象フィールド
title, description, ball, clientScope, dueDate, assigneeId,
milestoneId, parentTaskId, internalOwnerIds, clientOwnerIds,
wikiPageId, selectedSpaceId, showAdvanced

## 変更ファイル
- `src/lib/hooks/useFormDraft.ts` (新規)
- `src/components/task/TaskCreateSheet.tsx`
- `src/lib/hooks/index.ts` — export 追加
