# UX-04: aria-live を動的コンテンツ領域に追加

## 概要

動的に更新されるUI要素にaria-liveを追加し、スクリーンリーダーが変更を読み上げるようにする。

## 対象

| # | コンポーネント | 要素 | aria-live | 理由 |
|---|--------------|------|----------|------|
| 1 | LeftNav NavItem | バッジ(未読数) | `polite` | 通知件数の変化 |
| 2 | TaskInspector | 「保存しました」表示 | `polite` | 操作フィードバック |
| 3 | PortalLeftNav | アクションバッジ | `polite` | 要対応件数の変化 |

## Sonner Toaster

Sonner (v1+) は内部で `aria-live="polite"` + `role="status"` を自動設定するため、
手動追加は不要。

## 方針

- `aria-live="polite"` を使用（assertiveは緊急時のみ）
- バッジspan自体に付与（更新の度にテキスト変更が読み上げられる）
- 「保存しました」の表示領域に付与
