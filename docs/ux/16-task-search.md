# UX-16: タスク検索（インクリメンタルサーチ）

## 概要
タスク一覧ヘッダーにインクリメンタル検索を追加。
タイトルと説明をリアルタイムでフィルタリングする。

## 実装
- ヘッダーのフィルタ行に検索入力欄を追加
- `searchQuery` state → `filteredTasks` の `useMemo` 内で `toLowerCase().includes()` マッチ
- クリアボタン（X）で即座にリセット
- `/` キーで検索欄にフォーカス（キーボードショートカット）
- 検索結果 0 件時は専用の EmptyState（検索アイコン + クリアリンク）
- フォーカス時に入力欄が 40→56 の幅に拡大（transition-all）

## 変更ファイル
- `src/app/(internal)/[orgId]/project/[spaceId]/TasksPageClient.tsx`
- `src/components/shared/KeyboardShortcutsHelp.tsx` — `/` ショートカット追加
