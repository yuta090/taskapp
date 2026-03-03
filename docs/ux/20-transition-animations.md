# UX-20: トランジションアニメーション

## 概要
Inspector・モーダルダイアログにトランジションアニメーションを追加。
体感の滑らかさを向上させる。

## 実装

### Inspector
- `.inspector-pane` に `opacity` transition を追加（width + opacity 同時遷移）
- 開く時: width 150ms + opacity 150ms (50ms delay) で自然にフェードイン
- 閉じる時: width 150ms + opacity 100ms で素早く消える

### モーダルダイアログ
- backdrop: `animate-backdrop-in` (fadeIn 0.15s)
- dialog: `animate-dialog-in` (scale 0.95→1 + translateY 4px→0 + opacity, 0.15s)
- 対象: TaskCreateSheet, MeetingCreateSheet, ProposalCreateSheet, ConfirmDialog, ShortcutsHelpDialog

### アクセシビリティ
- `prefers-reduced-motion: reduce` で全アニメーション無効化

## 変更ファイル
- `src/app/globals.css` — アニメーション定義 + Inspector opacity + reduced-motion
- `src/components/task/TaskCreateSheet.tsx`
- `src/components/meeting/MeetingCreateSheet.tsx`
- `src/components/scheduling/ProposalCreateSheet.tsx`
- `src/components/shared/ConfirmDialog.tsx`
- `src/components/shared/KeyboardShortcutsHelp.tsx`
