# UX-09: リトライUI追加

## 概要

データ取得失敗時にユーザーが手動でリトライできるUIを追加する。

## 問題

- エラー発生時、ユーザーはページリロードしか手段がなかった
- エラーメッセージだけが表示され、次のアクションが不明確

## 対応

### 共通コンポーネント: ErrorRetry

`src/components/shared/ErrorRetry.tsx` を新規作成。
- エラーメッセージ + 「再試行」ボタン
- `message` と `onRetry` props のシンプルなインターフェース

### 適用箇所

| ページ | リトライ方法 |
|--------|------------|
| TasksPageClient | `fetchTasks()` (React Query refetch) |
| InboxClient | `fetchNotifications()` (React Query refetch) |
| MyTasksClient | `retryKey` state で useEffect 再実行 |

### NotificationInspector のアクションエラー

- エラーメッセージをクリック可能に変更（クリックで閉じる）
- エラー解除後にアクションボタンを再クリック可能
