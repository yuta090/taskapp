---
name: seed-testdata
description: Supabaseローカル環境にテストデータを投入する。「テストデータ追加」「seed」「シード」と言われた時に使用。
---

# テストデータ投入スキル

Supabaseローカル環境にテストデータを投入します。

## 実行手順

1. まず Supabase が起動しているか確認：
```bash
supabase status
```

2. テストデータを投入：
```bash
npm run seed:test
```

## テストアカウント情報

| メール | パスワード | 役割 |
|--------|-----------|------|
| demo@example.com | demo1234 | Internal PM (田中 太郎) |
| staff1@example.com | staff1234 | Designer (佐藤 花子) |
| staff2@example.com | staff2345 | Developer (山田 次郎) |
| client1@client.com | client1234 | Client PM (鈴木 一郎) |
| client2@client.com | client2345 | Client Approver (高橋 美咲) |

## 投入されるデータ

### タスク (35件)
| 状態 | 件数 | 説明 |
|------|------|------|
| 完了 (done) | 11件 | キックオフ、要件定義、競合調査、ペルソナ設計など |
| クライアント確認待ち (ball=client) | 12件 | デザイン確認、カラー選定、コピー確認など |
| 内部作業中 (ball=internal) | 12件 | フロントエンド開発、バックエンド開発など |

### その他
- **組織**: デモ組織
- **プロジェクト**: Webリニューアル
- **マイルストーン**: 3件（要件定義、設計、開発）
- **ミーティング**: 3件（完了2件、予定1件）
- **通知**: 13件
- **プロフィール**: 5件
- **組織メンバーシップ**: 5件

## 固定ID

テストで使用する固定ID：
- 組織: `00000000-0000-0000-0000-000000000001`
- プロジェクト: `00000000-0000-0000-0000-000000000010`

## クイックログイン

ログイン画面 (`/login`) にテストアカウントのクイックログインボタンがあります。
ボタンをクリックするだけで各アカウントでログインできます。

## トラブルシューティング

データが消えた場合の原因：
1. `supabase db reset` を実行した
2. `supabase stop --no-backup` でデータを削除して停止した
3. Dockerコンテナが再作成された

データを保持して停止する場合は `supabase stop`（オプションなし）を使用してください。

## データ確認SQL

```sql
-- タスクの状態別カウント
SELECT status, ball, count(*) FROM tasks GROUP BY status, ball ORDER BY status, ball;

-- ユーザー一覧
SELECT id, email FROM auth.users;

-- 組織メンバーシップ
SELECT u.email, m.role FROM org_memberships m JOIN auth.users u ON m.user_id = u.id;
```
