# Space Archive & Folders Spec

> **Version**: v1.0
> **Date**: 2026-03-03
> **Status**: Draft

## 背景

社内ミニアプリ等でプロジェクト（Space）が増殖し、LeftNavが管理困難になる問題への対処。
2段階で実装する。

---

## Phase A: スペースアーカイブ

### A-0: LeftNav 動的スペースリスト化（前提条件）

現状 LeftNav は「Webリニューアル」をハードコードしている。
アーカイブ・フォルダを実装する前に、`useUserSpaces()` hookを統合して動的リスト化する。

**変更点:**
- `LeftNav.tsx`: `useUserSpaces()` で activeOrg のスペース一覧を取得
- 現在の org に属するスペースのみ表示（`orgId` でフィルタ）
- 各スペースはクリックで展開/折畳（現在のサブナビ構造を維持）
- アクティブなスペースのサブナビのみ表示
- スペースアイコンは `Planet` 固定（将来的にカスタマイズ可能に）

**LeftNav スペースリストUI:**
```
チーム                           [+]
├─ 🟣 Webリニューアル          ▾
│   ├─ タスク
│   ├─ 確認待ち
│   ├─ 議事録
│   ├─ Wiki
│   ├─ ガントチャート
│   └─ 設定
├─ 🟣 社内ダッシュボード
└─ 🟣 採用管理ツール
```

### A-1: DB スキーマ変更

**DDL: `DDL_v0.8_space_archive.sql`**

```sql
-- spaces テーブルにアーカイブカラム追加
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS archived_by uuid NULL REFERENCES auth.users(id);

COMMENT ON COLUMN spaces.archived_at IS 'アーカイブ日時。NULLはアクティブ。';
COMMENT ON COLUMN spaces.archived_by IS 'アーカイブ実行者。';

-- アクティブスペースのクエリ高速化
CREATE INDEX IF NOT EXISTS idx_spaces_active
  ON spaces (org_id)
  WHERE archived_at IS NULL;
```

### A-2: 型定義更新

**`src/types/database.ts`** の `spaces` テーブル型に追加:

```typescript
spaces: {
  Row: {
    // ...existing fields...
    archived_at: string | null
    archived_by: string | null
  }
  Insert: {
    // ...existing fields...
    archived_at?: string | null
    archived_by?: string | null
  }
  Update: {
    // ...existing fields...
    archived_at?: string | null
    archived_by?: string | null
  }
}
```

### A-3: useUserSpaces hook 拡張

**`src/lib/hooks/useUserSpaces.ts`** を拡張:

```typescript
export interface UserSpace {
  id: string
  name: string
  orgId: string
  orgName: string
  role: 'admin' | 'editor' | 'viewer' | 'client'
  archivedAt: string | null      // 追加
}

// フック引数に includeArchived オプションを追加
export function useUserSpaces(options?: { includeArchived?: boolean }) {
  // ...
  // クエリで archived_at も取得
  // includeArchived=false(デフォルト)の場合、archived_at IS NULL でフィルタ
}
```

**アーカイブ操作用フック `src/lib/hooks/useSpaceArchive.ts`** を新規作成:

```typescript
export function useSpaceArchive(spaceId: string) {
  return {
    archive: () => Promise<void>,   // archived_at = now(), archived_by = user.id
    unarchive: () => Promise<void>, // archived_at = null, archived_by = null
    isArchived: boolean,
  }
}
```

### A-4: LeftNav アーカイブ対応

- アーカイブ済みスペースはデフォルト非表示
- スペースリスト下部に「アーカイブ済み (N)」トグルを表示（N>0の場合のみ）
- トグル展開時、アーカイブ済みスペースは薄いグレーで表示
- アーカイブ済みスペースにも通常通りアクセス可能（読み取り専用ではない）

```
チーム                           [+]
├─ 🟣 Webリニューアル          ▾
│   └─ (サブナビ)
├─ 🟣 社内ダッシュボード
│
▸ アーカイブ済み (2)             ← トグル
  ├─ 🟣 旧LP改修     (薄字)
  └─ 🟣 テストプロジェクト (薄字)
```

### A-5: GeneralSettings にアーカイブボタン追加

**`GeneralSettings.tsx`** のプロジェクト名セクションの下に「危険ゾーン」セクションを追加:

```
─── 危険ゾーン ───
[アーカイブする]  ← 赤系ボタン
「このプロジェクトをアーカイブすると、サイドバーの一覧から非表示になります。
 データは削除されず、いつでも復元できます。」
```

- アーカイブ済みの場合は「アーカイブを解除する」ボタンに切替
- admin ロールのみ実行可能
- 確認ダイアログは不要（即実行 + toast通知「アーカイブしました」）
- アーカイブ後、LeftNavのスペースリストを `invalidateQueries` で即時更新

---

## Phase B: スペースフォルダ（グループ）

### B-1: DB スキーマ変更

**DDL: `DDL_v0.8_space_archive.sql`** に追加（同一ファイル）:

```sql
-- スペースグループテーブル
CREATE TABLE IF NOT EXISTS space_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_space_groups_org
  ON space_groups (org_id, sort_order);

-- RLS
ALTER TABLE space_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can view space_groups"
  ON space_groups FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM org_memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "org admins can manage space_groups"
  ON space_groups FOR ALL
  USING (
    org_id IN (
      SELECT org_id FROM org_memberships
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- spaces にグループ参照を追加
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS group_id uuid NULL REFERENCES space_groups(id) ON DELETE SET NULL;
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_spaces_group ON spaces (group_id, sort_order);
```

### B-2: 型定義 & Hook

**型定義追加:**

```typescript
// database.ts
space_groups: {
  Row: {
    id: string
    org_id: string
    name: string
    sort_order: number
    created_at: string
  }
  // Insert, Update...
}

// spaces に追加
group_id: string | null
sort_order: number
```

**新規フック `src/lib/hooks/useSpaceGroups.ts`:**

```typescript
export interface SpaceGroup {
  id: string
  name: string
  sortOrder: number
}

export function useSpaceGroups(orgId: string) {
  return {
    groups: SpaceGroup[],
    loading: boolean,
    createGroup: (name: string) => Promise<SpaceGroup>,
    renameGroup: (groupId: string, name: string) => Promise<void>,
    deleteGroup: (groupId: string) => Promise<void>,  // スペースのgroup_idをnullに
    reorderGroups: (orderedIds: string[]) => Promise<void>,
    moveSpaceToGroup: (spaceId: string, groupId: string | null) => Promise<void>,
  }
}
```

### B-3: LeftNav グループ表示

- グループごとにアコーディオンセクション表示
- グループ未所属のスペースは「その他」セクションに表示
- グループヘッダーはクリックで折畳/展開（状態はlocalStorage保存）
- グループ名の右に「...」メニュー（リネーム・削除）

```
チーム                           [+]
─ クライアント案件               ▾
  ├─ 🟣 Webリニューアル
  └─ 🟣 LP改修
─ 社内ツール                    ▾
  ├─ 🟣 社内ダッシュボード
  └─ 🟣 採用管理
─ その他
  └─ 🟣 テスト

▸ アーカイブ済み (1)
```

### B-4: グループ管理UI

**グループ作成:**
- 「チーム」セクションヘッダの [+] ボタンメニューに「新しいグループ」を追加
- インライン入力でグループ名を入力 → Enter で作成

**スペースのグループ移動:**
- スペース名の右クリック or 「...」メニューで「グループを変更」→ グループ一覧ポップオーバー
- 将来的にドラッグ&ドロップ対応（この仕様では対象外）

**グループの並び替え:**
- グループヘッダの「...」メニュー →「上に移動」「下に移動」
- 将来的にドラッグ&ドロップ対応（この仕様では対象外）

---

## 実装順序

| Step | Scope | Description |
|------|-------|-------------|
| 1 | A-1, A-2 | DB: `archived_at` + 型定義更新 |
| 2 | A-3 | Hook: `useUserSpaces` 拡張 + `useSpaceArchive` 新規 |
| 3 | A-0 | LeftNav: 動的スペースリスト化 |
| 4 | A-4 | LeftNav: アーカイブ済みトグル |
| 5 | A-5 | GeneralSettings: アーカイブボタン |
| 6 | B-1, B-2 | DB: `space_groups` + 型 + Hook |
| 7 | B-3 | LeftNav: グループアコーディオン |
| 8 | B-4 | グループ管理UI |

## 設計判断

- **ソフトアーカイブ**: `archived_at` を使い、データは削除しない。復元可能。
- **アクセス制限なし**: アーカイブはあくまで一覧からの非表示。URLで直接アクセス可能、編集も可能。
- **グループは Org レベル**: Space レベルではなく Org レベルでグループを管理。
- **未所属スペース**: group_id=NULL のスペースは「その他」に表示。
- **並び替え**: sort_order で整数管理。D&D対応は将来。
