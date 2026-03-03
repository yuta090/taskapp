# UX-11: 確認ステップ + alert廃止

## 概要

`window.confirm()` をアプリ内 ConfirmDialog に、`window.alert()` を toast.error() に置換する。

## ConfirmDialog コンポーネント

`useConfirmDialog` フック:
- `confirm(options)` → Promise<boolean>
- `ConfirmDialog` → JSXをレンダーに配置
- variant: `danger`(赤), `default`(グレー)
- フォーカストラップ、Esc閉じ、alertdialog role

## confirm() 置換箇所

| ファイル | アクション | variant |
|---------|----------|---------|
| TaskInspector | タスク削除 | danger |
| TaskInspector | ボール切替警告 | default |
| TaskComments | コメント削除 | danger |
| TaskPRList | PR紐付け解除 | danger |
| api-keys/page | APIキー削除 | danger |

## alert() → toast.error() 置換箇所

| ファイル | 内容 |
|---------|------|
| MeetingsPageClient | 会議開始/終了/作成/日程作成失敗 |
| GanttPageClient | バリデーションエラー |
| ReviewInspector | 差し戻し理由未入力 |
| TaskPRList | PR紐付け/解除失敗 |
| SlackPostButton | Slack投稿失敗 |
| api-keys/page | APIキー作成/削除失敗 |

## 今後

- ポータル系ページの alert() は別タスクで対応
- 設定ページ(Members, Milestones, Integration)の confirm() も同様に置換可能
