# UX-19: ツールチップ（トランケート対応）

## 概要
テキストがトランケートされた場合のみ、ホバーでネイティブツールチップを表示。
全文が見えるときはツールチップを出さない。

## 実装

### TruncatedText コンポーネント
- `src/components/shared/TruncatedText.tsx`
- `mouseEnter` 時に `scrollWidth > clientWidth` で overflow 検出
- overflow 時のみ `title` 属性を設定（ネイティブブラウザツールチップ）
- `mouseLeave` で `title` をクリア
- `as` prop でセマンティックタグ対応（`span`, `h3` 等）
- `truncate` クラスは自動付与

### 適用箇所
- `TaskRow` — タスクタイトル
- `MeetingRow` — 会議タイトル
- `LeftNav` — ナビ項目ラベル、スペース名、組織名
- `TaskInspector` — サブタスクタイトル
- `WikiPageRow` — Wiki ページタイトル
- `TaskFilterMenu` — マイルストーン名
- `InboxClient` — 通知タイトル

## 変更ファイル
- `src/components/shared/TruncatedText.tsx` (新規)
- `src/components/shared/index.ts`
- `src/components/task/TaskRow.tsx`
- `src/components/task/TaskInspector.tsx`
- `src/components/task/TaskFilterMenu.tsx`
- `src/components/meeting/MeetingRow.tsx`
- `src/components/wiki/WikiPageRow.tsx`
- `src/components/layout/LeftNav.tsx`
- `src/app/(internal)/inbox/InboxClient.tsx`
