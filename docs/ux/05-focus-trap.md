# UX-05: フォーカストラップ補完

## 概要

モーダル/シート/ドロップダウンでTabキーが背景に逃げないよう、フォーカストラップを実装する。

## 新規作成

### `src/lib/hooks/useFocusTrap.ts`

カスタムhookで以下を実現:
- Tab/Shift+Tab でコンテナ内のフォーカス循環
- Escape でクローズコールバック呼び出し
- マウント時に最初のフォーカス可能要素にフォーカス
- アンマウント時にトリガー要素にフォーカスを返却

## 適用対象

| コンポーネント | Escape対応 | フォーカストラップ | 対応 |
|--------------|-----------|----------------|------|
| TaskCreateSheet | 既存 | なし | hook追加 |
| SpaceCreateSheet | なし | なし | hook追加 |
| MeetingCreateSheet | 既存 | なし | hook追加 |
| WikiCreateSheet | なし | なし | hook追加 |
| ProposalCreateSheet | 既存 | なし | hook追加 |

## 方針

- 外部ライブラリは使わずDOMベースで実装
- `focusable` セレクタ: `a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])`
- Escape は既存ハンドラを残し、hookでも対応（二重実行防止）
