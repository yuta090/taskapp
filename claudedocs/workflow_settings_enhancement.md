# Workflow: 設定ページ拡充 & ユーザー名表示修正

## 概要
TaskAppの設定機能を拡充し、ユーザーエクスペリエンスを向上させる。
現在UUIDで表示されている担当者名を、人間が読める名前に修正することが最優先。

## フェーズ構成

---

## Phase 1: プロフィールテーブル & ユーザー名表示修正
**優先度**: 🔴 Critical (現在UUIDが表示されている問題を解決)

### 1.1 プロフィールテーブル作成
- [ ] `profiles` テーブルのDDL作成
  - `id` (uuid, PK, auth.users.id参照)
  - `display_name` (text)
  - `avatar_url` (text, nullable)
  - `created_at`, `updated_at`
- [ ] auth.usersのトリガー作成（新規ユーザー作成時に自動でprofilesレコード作成）
- [ ] 既存ユーザーのprofilesレコード作成（migration）

### 1.2 ユーザー名取得フック作成
- [ ] `src/lib/hooks/useUsers.ts` 作成
  - `useSpaceMembers(spaceId)` - スペースメンバー一覧（名前付き）
  - `useUserName(userId)` - 単一ユーザー名取得
- [ ] profiles テーブルとspace_membershipsのJOIN

### 1.3 TaskInspector修正
- [ ] `members` stateを `{id, name, email, role}` 形式に変更
- [ ] 担当者ドロップダウンで名前表示
- [ ] オーナー選択で名前表示

### 1.4 検証
- [ ] 担当者選択でユーザー名が表示されることを確認
- [ ] オーナー編集でユーザー名が表示されることを確認

**成果物**:
- `supabase/migrations/YYYYMMDD_profiles.sql`
- `src/lib/hooks/useUsers.ts`
- `src/components/task/TaskInspector.tsx` (修正)

---

## Phase 2: プロフィール設定ページ
**優先度**: 🟡 High

### 2.1 アカウント設定ページ構造
- [ ] `/settings/account/page.tsx` 作成
- [ ] 設定ナビゲーション追加（左ナビまたはタブ）

### 2.2 プロフィール編集機能
- [ ] 表示名の編集
- [ ] アバター画像のアップロード（Supabase Storage）
- [ ] メールアドレス表示（変更はSupabase Auth経由）

### 2.3 LeftNav連携
- [ ] ユーザーメニューから「アカウント設定」リンク

**成果物**:
- `src/app/settings/account/page.tsx`
- `src/components/settings/ProfileSettings.tsx`

---

## Phase 3: メンバー管理設定
**優先度**: 🟡 High

### 3.1 メンバー一覧表示
- [ ] プロジェクト設定ページに「メンバー」セクション追加
- [ ] 現在のメンバー一覧（名前、役割、参加日）

### 3.2 メンバー招待
- [ ] メールアドレスで招待
- [ ] 役割選択（admin, member, client）
- [ ] 招待メール送信（またはリンク生成）

### 3.3 メンバー編集・削除
- [ ] 役割変更
- [ ] メンバー削除（オーナーのみ）

**成果物**:
- `src/app/(internal)/[orgId]/project/[spaceId]/settings/MembersSettings.tsx`

---

## Phase 4: 通知設定
**優先度**: 🟢 Medium

### 4.1 通知設定テーブル
- [ ] `user_notification_settings` テーブル作成
  - メール通知ON/OFF
  - 通知タイプ別設定

### 4.2 通知設定UI
- [ ] `/settings/notifications/page.tsx` 作成
- [ ] トグルスイッチで各種通知ON/OFF

**成果物**:
- `supabase/migrations/YYYYMMDD_notification_settings.sql`
- `src/app/settings/notifications/page.tsx`

---

## 実行順序

```
Phase 1 (Critical)
    ↓ Codex Review
Phase 2
    ↓ Codex Review
Phase 3
    ↓ Codex Review
Phase 4
    ↓ Codex Review
Complete
```

## 現在のステータス

| Phase | Status | 開始日 | 完了日 |
|-------|--------|--------|--------|
| Phase 1 | ✅ Completed | 2024-02-03 | 2024-02-03 |
| Phase 2 | ✅ Completed | 2024-02-03 | 2024-02-03 |
| Phase 3 | ✅ Completed | 2024-02-03 | 2024-02-03 |
| Phase 4 | ✅ Completed | 2024-02-03 | 2024-02-03 |

---

## 完了！

すべてのPhaseが完了しました。

### 作成されたファイル
- `supabase/migrations/20240203_000_profiles.sql` - プロフィールテーブルとRPC
- `src/lib/hooks/useSpaceMembers.ts` - メンバー取得フック
- `src/app/settings/account/page.tsx` - アカウント設定ページ
- `src/app/settings/notifications/page.tsx` - 通知設定ページ
- `src/app/(internal)/[orgId]/project/[spaceId]/settings/MembersSettings.tsx` - メンバー管理設定

### 修正されたファイル
- `src/components/task/TaskInspector.tsx` - ユーザー名表示
- `src/components/layout/LeftNav.tsx` - アカウント設定リンク
- `src/app/(internal)/[orgId]/project/[spaceId]/settings/page.tsx` - メンバーセクション追加

### 適用が必要なマイグレーション
```bash
# Supabase でマイグレーションを実行
npx supabase db push
# または
psql -f supabase/migrations/20240203_000_profiles.sql
```
