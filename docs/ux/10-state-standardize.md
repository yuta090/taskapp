# UX-10: Loading/Empty/Error状態の標準化

## 概要

データのLoading・Empty・Error状態を共通コンポーネントで統一し、一貫したUXを提供する。

## 共通コンポーネント

### LoadingState
- スピナーアイコン（SpinnerGap animate-spin）+ テキスト
- デフォルトメッセージ: "読み込み中..."
- 従来の plain text 表示を置換

### EmptyState
- アイコン + メッセージ + オプションのアクションスロット
- アイコン: 4xl + opacity-50（視覚的に控えめ）
- フィルタ結果が空の場合は「リセット」アクションを提供

### ErrorRetry (Task #9で作成済み)
- エラーメッセージ + 「再試行」ボタン

## 適用箇所

| ページ | Loading | Empty | Error |
|--------|---------|-------|-------|
| TasksPageClient | LoadingState | EmptyState(Copy) | ErrorRetry |
| InboxClient | LoadingState | EmptyState(Tray) | ErrorRetry |
| MyTasksClient | LoadingState | EmptyState(Target/FunnelSimple) | ErrorRetry |

## 今後の展開

- ポータルページへの展開は別タスクで対応
- インスペクター内のエラー表示もこれらのコンポーネントの小型版で統一可能
