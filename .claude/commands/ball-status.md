ボール状態を一覧表示する。

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
