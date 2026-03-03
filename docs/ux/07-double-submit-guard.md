# UX-07: 二重送信防止 + pending状態表示

## 概要

フォーム送信・アクションボタンの二重クリックを防止し、処理中はボタンを無効化+テキストで状態を表示する。

## 対象コンポーネント

### 1. MeetingCreateSheet
- `isSubmitting` state追加
- `handleSubmit` を async + try/finally で保護
- 作成ボタン: `disabled={isSubmitting}` + "作成中..." テキスト

### 2. ReviewInspector
- `isSubmitting` state追加
- 承認ボタン: `handleApprove` async化、disabled + "処理中..."
- 差し戻しボタン: `handleBlock` async化、disabled + "処理中..."
- 承認処理中は差し戻しボタンも無効化（相互排他）

### 3. TaskInspector
- `isSavingOwners` state追加
- `handleSaveOwners` に try/finally ガード
- 「外部に渡す」ボタン: disabled + "処理中..."
- 「保存」ボタン: disabled + "保存中..."

## 設計方針

- props の戻り値型を `void | Promise<void>` に拡張（後方互換）
- `try/finally` パターンで確実にフラグ解除
- `disabled:bg-gray-300 disabled:cursor-not-allowed` で統一的な無効化スタイル
