ボール状態を一覧表示する。

> **モデル運用**: この集計・整形は機械的処理のため、`report-collector`（Haiku）サブエージェントに委譲してよい（メインが Opus/Fable のときはトークン節約のため委譲を推奨）。事実の列挙のみを担わせ、評価・次アクションの提案はメイン側で行う。

以下のMCPツールを実行し、結果をテーブル形式で出力せよ：

1. `ball_query` (ball=client, includeOwners=true) でクライアント側タスクを取得
2. `ball_query` (ball=internal, includeOwners=true) で社内側タスクを取得

出力フォーマット：

```
## ボール状態

### Client側 (XX件)
| タスク | ステータス | 作成日 |
|--------|-----------|--------|
| タイトル | status | YYYY-MM-DD |

### Internal側 (XX件)
| タスク | ステータス | 作成日 |
|--------|-----------|--------|
| タイトル | status | YYYY-MM-DD |
```
