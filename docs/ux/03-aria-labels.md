# UX-03: aria-label をインタラクティブ要素に追加

## 概要

テキストなしのアイコンボタン、ドロップダウントリガー等にaria-labelを付与し、
スクリーンリーダーのアクセシビリティを改善する。

## 修正対象

| ファイル | 要素 | aria-label |
|---------|------|-----------|
| TaskRow.tsx | Quick doneチェックボックス | 動的: `完了にする` / `未完了に戻す` |
| TaskRow.tsx | DotsThreeアクションメニュー | `タスクアクション` |
| NotificationInspector.tsx | 前の通知ボタン | `前の通知` |
| NotificationInspector.tsx | 次の通知ボタン | `次の通知` |
| NotificationInspector.tsx | 閉じるボタン | `閉じる` |
| MeetingInspector.tsx | 閉じるボタン | `会議詳細を閉じる` |
| ReviewInspector.tsx | 閉じるボタン | `レビュー詳細を閉じる` |
| GanttChart.tsx | グルーピングトグル | 動的: `フラット表示` / `マイルストーン別` |
| GanttChart.tsx | ズームアウト | `縮小` |
| GanttChart.tsx | ズームイン | `拡大` |
| PortalHeader.tsx | ヘルプボタン | `ヘルプ` |
| PortalHeader.tsx | モバイルメニュー | 動的: `メニューを開く` / `メニューを閉じる` |
| PortalLeftNav.tsx | 折りたたみトグル | 動的: `サイドバーを展開` / `サイドバーを折りたたむ` |
| LeftNav.tsx | 折りたたみトグル | 動的: `サイドバーを展開` / `サイドバーを折りたたむ` |

## 方針

- `title` 属性が既にある要素には、同じ値で `aria-label` を追加
- 動的な要素は状態に応じてラベルを切り替え
- 装飾アイコンには `aria-hidden="true"` を追加しない（今回のスコープ外）
