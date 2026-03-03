# UX-14: キーボードショートカット

## 概要
パワーユーザー向けにキーボードショートカットを追加。
汎用フック + ヘルプダイアログ + ページ固有ショートカットの3層構成。

## 実装

### 汎用フック `useKeyboardShortcuts`
- `src/lib/hooks/useKeyboardShortcuts.ts`
- `key` / `meta` (Cmd/Ctrl) / `allowInInput` オプション
- input/textarea/select/contentEditable にフォーカス中は発火しない（`allowInInput: true` で上書き可能）

### ヘルプダイアログ `KeyboardShortcutsHelp`
- `src/components/shared/KeyboardShortcutsHelp.tsx`
- `?` キーでトグル表示
- `useShortcutsHelp()` フックを `AppShell` でグローバル登録

### ページ固有ショートカット
| ページ | キー | アクション |
|--------|------|------------|
| タスク一覧 | `N` | 新規タスク作成シートを開く |
| 全ページ | `?` | ショートカットヘルプ表示 |
| 全ページ | `Esc` | パネルを閉じる |

## 変更ファイル
- `src/lib/hooks/useKeyboardShortcuts.ts` (新規)
- `src/components/shared/KeyboardShortcutsHelp.tsx` (新規)
- `src/components/layout/AppShell.tsx` — GlobalShortcuts 追加
- `src/app/(internal)/[orgId]/project/[spaceId]/TasksPageClient.tsx` — `N` ショートカット追加
- `src/components/shared/index.ts` — export 追加
- `src/lib/hooks/index.ts` — export 追加
