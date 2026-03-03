# UX-15: トースト通知の改善

## 概要
成功/失敗トーストの統一化と、アーカイブ操作への undo 機能追加。

## 改善内容

### 1. 成功トースト追加
以前はエラーのみだった操作に `toast.success()` を追加。

| ファイル | 操作 |
|----------|------|
| MilestonesSettings | 作成・更新・削除 |
| MembersSettings | 役割変更・メンバー削除 |
| GitHubSettings | リポジトリ連携・解除 |
| SlackSettings | チャンネル連携・解除・Slack連携解除 |
| SlackPostButton | Slack投稿 |
| TaskPRList | PR紐付け・解除 |
| api-keys/page | APIキー削除 |

### 2. アーカイブの undo
GeneralSettings のアーカイブ操作に `toast.success()` + `action` で
「元に戻す」ボタンを追加。クリックで即座に unarchive を実行。

### 3. confirm() → useConfirmDialog 移行
残っていた `window.confirm()` を `useConfirmDialog` に置換。
- MilestonesSettings（マイルストーン削除）
- MembersSettings（メンバー削除）
- SlackSettings（Slack連携解除、チャンネル解除）
- GitHubSettings（リポジトリ連携解除）

## 変更ファイル
- `src/app/(internal)/[orgId]/project/[spaceId]/settings/GeneralSettings.tsx`
- `src/app/(internal)/[orgId]/project/[spaceId]/settings/MilestonesSettings.tsx`
- `src/app/(internal)/[orgId]/project/[spaceId]/settings/MembersSettings.tsx`
- `src/app/(internal)/[orgId]/project/[spaceId]/settings/SlackSettings.tsx`
- `src/app/(internal)/[orgId]/project/[spaceId]/settings/GitHubSettings.tsx`
- `src/app/settings/api-keys/page.tsx`
- `src/components/github/TaskPRList.tsx`
- `src/components/slack/SlackPostButton.tsx`
