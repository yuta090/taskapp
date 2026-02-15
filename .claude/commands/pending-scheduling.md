日程調整の未回答状況を一覧表示する。

**前提**: spaceIdが必要。ユーザーに確認するか、`space_list` で取得して指定すること。

以下のMCPツールを実行し、結果をテーブル形式で出力せよ：

1. `list_scheduling_proposals` (spaceId=対象スペース, status=open) でオープンな提案一覧を取得
2. 各提案について `get_proposal_responses` (spaceId=対象スペース, proposalId) で回答状況を取得

出力フォーマット：

```
## 日程調整 未回答状況

### [提案タイトル] (期限: YYYY-MM-DD)
- 回答済: X/Y名
- 未回答者: user1, user2, ...
- スロット別:
  | 日時 | 参加可 | 欠席OK | 不可 |
  |------|--------|--------|------|
  | MM/DD HH:MM | X | X | X |

---
(各提案について繰り返し)
```
