# Multi-Level Task Hierarchy Spec v2.1

## Overview

現在のタスク親子関係は1階層（親→子）に制限されている。
本仕様は多階層（親→子→孫→...最大10階層）をサポートするための変更を定義する。

---

## Current State (変更前)

### DB

- `tasks.parent_task_id` (FK → tasks.id, `ON DELETE SET NULL`)
- `chk_no_self_parent` CHECK制約: `parent_task_id IS NULL OR id != parent_task_id`
- `trg_prevent_invalid_parent_task` BEFORE INSERT/UPDATE trigger:
  - 親が既に子→NG (1階層制約)
  - 自身が既に親→NG (1階層制約)
  - 親子が別スペース→NG
- `space_id` はタスク作成時に固定、UPDATE不可（アプリ上のUIなし、APIにもなし）

### Client Constraints (`useTasks.ts` → `validateParentTask`)

1. 自己参照禁止: `parentTaskId !== currentTaskId`
2. 同一スペース制約: `parentTask.space_id === spaceId`
3. **1階層制約**: 親が既に子を持つ場合、子になれない
4. **1階層制約**: 子を持つタスクは親になれない

### Tree Utilities (`treeUtils.ts`)

- `buildTaskTree()`: 1階層のみ展開（子の子は無視）
- `getEligibleParents()`: `parent_task_id` がないタスクのみ対象
- `isParentTask()`: 子を持つかのboolチェック

---

## Parent Assignment Entry Points (全7箇所) — 実装マトリクス

| # | 場所 | ファイル | 関数/コンポーネント | バリデーション | Phase |
|---|------|---------|---------------------|---------------|-------|
| 1 | タスク一覧 Inspector | `src/app/.../TasksPageClient.tsx` L462 | `getEligibleParents(tasks, selectedTask.id)` → `TaskInspector` | `getEligibleParents` 内部変更で対応 | 2 |
| 2 | ガントチャート Inspector | `src/app/.../GanttPageClient.tsx` L139 | `parentTaskOptions` useMemo | `!t.parent_task_id` フィルタ削除 → `getEligibleParents` 使用に変更 | 3 |
| 3 | タスク作成シート | `src/app/.../TasksPageClient.tsx` L153 | `getEligibleParents(tasks)` → `TaskCreateSheet` | `getEligibleParents` 内部変更で対応 | 2 |
| 4 | ガントSVGドラッグ | `src/components/gantt/GanttChart.tsx` L178-200 | `eligibleTaskIds` useMemo | `getDescendantIds`/`getAncestorIds` 使用に変更 | 3 |
| 5 | MCP Server | `packages/mcp-server/src/tools/tasks.ts` L36 | `parentTaskId` schema description | description変更のみ (`'1階層のみ'` → `'最大10階層'`) | 3 |
| 6 | CLI | `packages/cli/src/commands/task.ts` L115 | `parentTaskId` option | 変更不要 (DBトリガーがバリデーション) | - |
| 7 | Slack | `src/lib/slack/modals.ts` | create modal | 変更不要 (DBトリガーがバリデーション) | - |

---

## Proposed Changes (変更内容)

### 1. DB: 既存トリガー置換 + 循環参照防止

**既存の `prevent_invalid_parent_task` トリガーを DROP し、新トリガーに置換。**

```sql
-- Step 1: Drop existing 1-level trigger
DROP TRIGGER IF EXISTS trg_prevent_invalid_parent_task ON tasks;
DROP FUNCTION IF EXISTS prevent_invalid_parent_task();

-- Step 2: New multi-level trigger
CREATE OR REPLACE FUNCTION check_task_parent_hierarchy()
RETURNS TRIGGER AS $$
DECLARE
  ancestor_id uuid;
  ancestor_space uuid;
  depth int := 0;
  max_depth int := 10;
BEGIN
  -- NULL parent is always OK
  IF NEW.parent_task_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Self-reference (redundant with CHECK but explicit)
  IF NEW.parent_task_id = NEW.id THEN
    RAISE EXCEPTION 'Task cannot be its own parent';
  END IF;

  -- Same-space check (immediate parent only; ancestors already validated)
  SELECT space_id INTO ancestor_space
  FROM tasks WHERE id = NEW.parent_task_id;

  IF ancestor_space IS NULL THEN
    RAISE EXCEPTION 'Parent task not found';
  END IF;

  IF ancestor_space != NEW.space_id THEN
    RAISE EXCEPTION 'Parent task must be in the same space';
  END IF;

  -- Walk up ancestor chain: detect cycles AND enforce max depth
  ancestor_id := NEW.parent_task_id;
  WHILE ancestor_id IS NOT NULL LOOP
    depth := depth + 1;

    IF depth > max_depth THEN
      RAISE EXCEPTION 'Maximum nesting depth (%) exceeded', max_depth;
    END IF;

    SELECT parent_task_id INTO ancestor_id
    FROM tasks WHERE id = ancestor_id;

    IF ancestor_id = NEW.id THEN
      RAISE EXCEPTION 'Circular parent reference detected';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_task_parent_hierarchy
  BEFORE INSERT OR UPDATE OF parent_task_id ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION check_task_parent_hierarchy();
```

**RLSとトリガーの関係:**
- PostgreSQLトリガー関数はテーブルオーナー権限で実行される（RLSをバイパス）
- トリガー内の `SELECT ... FROM tasks` はRLSに影響されない
- 既存の他トリガー（audit等）も同様のパターンで動作中
- `SECURITY DEFINER` は不要（トリガー関数は自動的にオーナー権限）

**DB契約:**

| 項目 | 値 |
|------|-----|
| トリガータイミング | `BEFORE INSERT OR UPDATE OF parent_task_id` |
| 最大深さ | 10階層 (parent_task_idチェーンの長さ) |
| 深さの定義 | ルートからの距離。ルート=depth 0, 直接の子=depth 1, ..., 最深=depth 10 |
| 循環検出 | 祖先チェーンを辿り `NEW.id` が出現したらREJECT |
| スペース制約 | 直接の親のspace_idのみチェック (祖先は帰納的に検証済み) |
| 削除時の挙動 | `ON DELETE SET NULL` (既存FK制約、変更なし) |
| 自己参照 | CHECK制約 + トリガーで二重防止 |
| space_id変更 | アプリ上不可能（UIなし、API未実装）。トリガーは `UPDATE OF parent_task_id` のみ発火 |

**削除セマンティクス:**

| 操作 | 挙動 | 理由 |
|------|------|------|
| 親タスク削除 | 子の `parent_task_id` → NULL | 子はトップレベルに昇格 |
| 中間タスク削除 (A→B→C で B削除) | Cの `parent_task_id` → NULL | Cはトップレベルに昇格。A-C間の自動再接続はしない |
| 子タスク削除 | 親は変化なし | FK参照元が消えるだけ |

**再接続しない理由:** 暗黙的な再接続はユーザーの意図と異なる可能性があるため、明示的にトップレベルに昇格させる。

**リペアレント（親変更）セマンティクス:**

| 操作 | 挙動 | 理由 |
|------|------|------|
| A→B→C で B の親を D に変更 | B→Dの子に。Cの親はBのまま（サブツリー保持） | サブツリーは親と一緒に移動する |
| depth制限超過 (移動先で10超) | DBトリガーがREJECT | B自体の移動はdepth計算で検証される |
| 子孫のdepth超過 | **トリガーは直接の変更行のみ検証** | Bの子孫(C等)のdepthはトリガー時点では検証されない。クライアント側で事前チェック |

**子孫depth超過の補足:**
- 例: A(0)→B(1)→C(2)。Bの親をX(depth 8)に変更 → B=depth 9, C=depth 10 → OK
- 例: A(0)→B(1)→C(2)→D(3)。Bの親をX(depth 8)に変更 → B=9, C=10, D=11 → **Dは制限超過だがトリガーはBの行のみ検証**
- 対策: クライアント側でサブツリー最大深さを計算してから移動を許可する
- `validateParentTask` に子孫深さチェックを追加（後述）

---

### 2. Client Validation (`useTasks.ts`)

`validateParentTask` を以下に変更:

```typescript
function validateParentTask(
  parentTaskId: string | null | undefined,
  currentTaskId: string | undefined,
  tasks: Task[],
  spaceId: string
): void {
  if (!parentTaskId) return

  // Self-reference check
  if (currentTaskId && parentTaskId === currentTaskId) {
    throw new Error('自己参照は禁止です')
  }

  const parentTask = tasks.find((t) => t.id === parentTaskId)
  if (!parentTask) return // DB trigger will catch

  // Same space check
  if (parentTask.space_id !== spaceId) {
    throw new Error('親タスクは同じスペース内である必要があります')
  }

  // Circular reference check: walk up ancestor chain
  if (currentTaskId) {
    const visited = new Set<string>([currentTaskId])
    let ancestorId: string | null = parentTaskId
    while (ancestorId) {
      if (visited.has(ancestorId)) {
        throw new Error('循環参照が検出されました')
      }
      visited.add(ancestorId)
      const ancestor = tasks.find((t) => t.id === ancestorId)
      ancestorId = ancestor?.parent_task_id ?? null
    }
  }

  // Depth check: parent's depth + 1 + max descendant depth of currentTask
  const parentDepth = getAncestorIds(parentTaskId, tasks).size
  const maxDescendantDepth = currentTaskId
    ? getMaxDescendantDepth(currentTaskId, tasks)
    : 0
  const newMaxDepth = parentDepth + 1 + maxDescendantDepth
  if (newMaxDepth > 10) {
    throw new Error(`最大ネスト深さ（10階層）を超えます（移動後: ${newMaxDepth}階層）`)
  }
}

/** サブツリーの最大深さを計算 (自身=0, 直接の子=1, ...) */
function getMaxDescendantDepth(taskId: string, tasks: Task[]): number {
  let maxDepth = 0
  const stack: Array<{ id: string; depth: number }> = [{ id: taskId, depth: 0 }]
  while (stack.length > 0) {
    const { id, depth } = stack.pop()!
    tasks.forEach((t) => {
      if (t.parent_task_id === id) {
        const childDepth = depth + 1
        if (childDepth > maxDepth) maxDepth = childDepth
        stack.push({ id: t.id, depth: childDepth })
      }
    })
  }
  return maxDepth
}
```

**削除する制約:**
- ~~親が子を持つ場合は子になれない~~ → 削除
- ~~子を持つタスクは親になれない~~ → 削除

---

### 3. Tree Utilities (`treeUtils.ts`)

**3a. TaskTreeNode 再帰化:**

```typescript
export interface TaskTreeNode {
  task: Task
  children: TaskTreeNode[]  // 再帰構造に変更 (旧: Task[])
  depth: number             // ネスト深さ (0 = top-level)
  summaryStart: string | null
  summaryEnd: string | null
}
```

**3b. buildTaskTree() — 再帰フラット化:**

```typescript
export function buildTaskTree(tasks: Task[]): TaskTreeNode[] {
  const taskMap = new Map<string, Task>()
  const childrenMap = new Map<string, Task[]>()

  tasks.forEach((t) => taskMap.set(t.id, t))
  tasks.forEach((t) => {
    if (t.parent_task_id && taskMap.has(t.parent_task_id)) {
      const siblings = childrenMap.get(t.parent_task_id) || []
      siblings.push(t)
      childrenMap.set(t.parent_task_id, siblings)
    }
  })

  const result: TaskTreeNode[] = []
  const processedIds = new Set<string>()

  function buildNode(task: Task, depth: number): TaskTreeNode {
    const children = childrenMap.get(task.id) || []
    const childNodes = children.map((c) => buildNode(c, depth + 1))
    const allDescendants = getAllDescendantTasks(task.id, childrenMap)
    const { summaryStart, summaryEnd } = computeSummaryDates(allDescendants)
    return { task, children: childNodes, depth, summaryStart, summaryEnd }
  }

  function flatten(node: TaskTreeNode): void {
    result.push(node)
    processedIds.add(node.task.id)
    node.children.forEach((child) => flatten(child))
  }

  tasks.forEach((t) => {
    if (processedIds.has(t.id)) return
    if (t.parent_task_id && taskMap.has(t.parent_task_id)) return
    const node = buildNode(t, 0)
    flatten(node)
  })

  return result
}
```

**3c. getEligibleParents() — 子孫除外:**

```typescript
export function getEligibleParents(tasks: Task[], excludeTaskId?: string): Task[] {
  if (!excludeTaskId) return tasks
  const descendantIds = getDescendantIds(excludeTaskId, tasks)
  return tasks.filter((t) => t.id !== excludeTaskId && !descendantIds.has(t.id))
}
```

**3d. getDescendantIds() — 新規追加:**

```typescript
export function getDescendantIds(taskId: string, tasks: Task[]): Set<string> {
  const result = new Set<string>()
  const stack = [taskId]
  while (stack.length > 0) {
    const current = stack.pop()!
    tasks.forEach((t) => {
      if (t.parent_task_id === current && !result.has(t.id)) {
        result.add(t.id)
        stack.push(t.id)
      }
    })
  }
  return result
}
```

**3e. getAncestorIds() — 新規追加:**

```typescript
export function getAncestorIds(taskId: string, tasks: Task[]): Set<string> {
  const result = new Set<string>()
  let currentId: string | null = taskId
  while (currentId) {
    const task = tasks.find((t) => t.id === currentId)
    currentId = task?.parent_task_id ?? null
    if (currentId) {
      if (result.has(currentId)) break // safety
      result.add(currentId)
    }
  }
  return result
}
```

---

### 4. Gantt Chart Sidebar

インデント: `depth * 16px` で多段インデント。`treeUtils.buildTaskTree()` の `depth` フィールドを使用。

```
親タスク A          (depth=0)
  └ 子タスク B      (depth=1)
    └ 孫タスク C    (depth=2)
  └ 子タスク D      (depth=1)
```

---

### 5. Gantt Chart SVG コネクタ

既存のL字破線コネクタは各親子ペアに対して描画する実装が既にある。
`buildTaskTree` の再帰化により、多段でも各 `parent_task_id` → 子 のペアが正しく検出される。変更不要。

---

### 6. Link Drag Eligibility (`GanttChart.tsx`)

**child mode** (左ハンドル: ソースが子になる):
- ターゲット候補 = 全タスク - ソース自身 - ソースの子孫 (`getDescendantIds`)
- 理由: ソースの子孫を親にすると循環

**parent mode** (右ハンドル: ソースが親になる):
- ターゲット候補 = 全タスク - ソース自身 - ソースの祖先 (`getAncestorIds`)
- 理由: ソースの祖先を子にすると循環

---

### 7. TaskInspector / TaskCreateSheet

- TaskInspector: `parentTasks` prop は呼び出し元 (`TasksPageClient`, `GanttPageClient`) が `getEligibleParents()` で生成。変更は呼び出し元のみ。
- TaskCreateSheet: `parentTasks` prop は `TasksPageClient` L153 で `getEligibleParents(tasks)` から生成。新規作成時は `excludeTaskId` なしなので全タスクが候補。

---

## Migration Plan

### Phase 1: DB安全策 (`feat/multi-level-phase1-db`)

**ブランチ:** `feat/multi-level-phase1-db` (from `develop`)

**変更ファイル:**
- `supabase/migrations/20260308_multi_level_hierarchy.sql` (新規)

**内容:**
1. `DROP TRIGGER trg_prevent_invalid_parent_task`
2. `DROP FUNCTION prevent_invalid_parent_task()`
3. `CREATE FUNCTION check_task_parent_hierarchy()`
4. `CREATE TRIGGER trg_check_task_parent_hierarchy`

**依存:** なし

**検証計画 (SQL):**
```sql
-- テスト環境で実行する6つのテストケース

-- T1: 2階層が成功すること
-- Setup: A (top-level), B (parent=A)
UPDATE tasks SET parent_task_id = (SELECT id FROM tasks WHERE title='A')
  WHERE title = 'B';
-- Expected: SUCCESS

-- T2: 3階層が成功すること
-- Setup: C (parent=B where B.parent=A)
UPDATE tasks SET parent_task_id = (SELECT id FROM tasks WHERE title='B')
  WHERE title = 'C';
-- Expected: SUCCESS

-- T3: 循環参照が拒否されること
UPDATE tasks SET parent_task_id = (SELECT id FROM tasks WHERE title='C')
  WHERE title = 'A';
-- Expected: ERROR 'Circular parent reference detected'

-- T4: 自己参照が拒否されること
UPDATE tasks SET parent_task_id = id WHERE title = 'A';
-- Expected: ERROR 'Task cannot be its own parent'

-- T5: 異スペース親が拒否されること
-- Setup: D in space2
UPDATE tasks SET parent_task_id = (SELECT id FROM tasks WHERE title='A')
  WHERE title = 'D';
-- Expected: ERROR 'Parent task must be in the same space'

-- T6: 削除時SET NULL
DELETE FROM tasks WHERE title = 'B';
SELECT parent_task_id FROM tasks WHERE title = 'C';
-- Expected: NULL
```

**ロールバック手順:**
```sql
-- Rollback script
DROP TRIGGER IF EXISTS trg_check_task_parent_hierarchy ON tasks;
DROP FUNCTION IF EXISTS check_task_parent_hierarchy();

-- Restore old trigger (from DDL_v0.6_subtasks.sql)
CREATE OR REPLACE FUNCTION prevent_invalid_parent_task()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_task_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM tasks WHERE id = NEW.parent_task_id AND parent_task_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Cannot set parent: target parent is already a child task (max 1 level)';
    END IF;
    IF EXISTS (
      SELECT 1 FROM tasks WHERE parent_task_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'Cannot set parent: this task already has children (max 1 level)';
    END IF;
    IF (SELECT space_id FROM tasks WHERE id = NEW.parent_task_id) != NEW.space_id THEN
      RAISE EXCEPTION 'Cannot set parent: parent task must be in the same space';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_invalid_parent_task
  BEFORE INSERT OR UPDATE OF parent_task_id ON tasks
  FOR EACH ROW EXECUTE FUNCTION prevent_invalid_parent_task();
```

---

### Phase 2: Client制約 + treeUtils (`feat/multi-level-phase2-client`)

**ブランチ:** `feat/multi-level-phase2-client` (from Phase 1 merge commit on `develop`)

**依存:** Phase 1 完了済み（DBが多階層を許可している必要あり）

**変更ファイル:**

| ファイル | 変更内容 |
|---------|----------|
| `src/lib/hooks/useTasks.ts` | `validateParentTask`: 1階層制約削除、循環チェック→祖先走査、深さチェック+サブツリー深さ計算追加 |
| `src/lib/gantt/treeUtils.ts` | `TaskTreeNode` 再帰化、`buildTaskTree` 再帰+フラット化、`getEligibleParents` 子孫除外、`getDescendantIds` 新規、`getAncestorIds` 新規、`isParentTask` 維持 |
| `src/__tests__/lib/gantt/treeUtils.test.ts` | 新規: 多階層ユニットテスト |

**検証計画 (Unit Tests):**

ファイル: `src/__tests__/lib/gantt/treeUtils.test.ts`

```typescript
describe('buildTaskTree (multi-level)', () => {
  test('3階層ツリーが正しい順序でフラット化される', () => {
    // Input: A, B(parent=A), C(parent=B), D(parent=A)
    // Expected order: A(depth=0), B(depth=1), C(depth=2), D(depth=1)
  })

  test('孤立した子はトップレベルとして扱われる', () => {
    // Input: B(parent=nonexistent)
    // Expected: B at depth=0
  })

  test('summaryDatesが全子孫から計算される', () => {
    // Input: A → B(start=3/1,due=3/5) → C(start=3/3,due=3/10)
    // Expected: A.summaryStart=3/1, A.summaryEnd=3/10
  })
})

describe('getDescendantIds', () => {
  test('A→B→C で A の子孫 = {B, C}', () => {})
  test('子なしタスクは空Setを返す', () => {})
  test('循環データでも無限ループしない', () => {})
})

describe('getAncestorIds', () => {
  test('A→B→C で C の祖先 = {A, B}', () => {})
  test('トップレベルタスクは空Setを返す', () => {})
})

describe('getEligibleParents', () => {
  test('自身と子孫が除外される', () => {
    // A→B→C, exclude=A → result excludes A,B,C
  })
  test('excludeなしで全タスクが返る', () => {})
})
```

検証コマンド: `npx jest src/__tests__/lib/gantt/treeUtils.test.ts`

**ロールバック:** `git revert` で Phase 2 コミットを取り消し

---

### Phase 3: UI更新 (`feat/multi-level-phase3-ui`)

**ブランチ:** `feat/multi-level-phase3-ui` (from Phase 2 merge commit on `develop`)

**依存:** Phase 2 完了済み（treeUtilsの再帰版が前提）

**変更ファイル:**

| ファイル | 変更内容 |
|---------|----------|
| `src/components/gantt/GanttChart.tsx` | `eligibleTaskIds`: child mode→`getDescendantIds`除外、parent mode→`getAncestorIds`除外。サイドバー: `depth * 16px` インデント |
| `src/app/.../GanttPageClient.tsx` L139-144 | `parentTaskOptions`: `!t.parent_task_id` フィルタ削除 → `getEligibleParents(tasks, selectedTask.id)` 使用 |
| `packages/mcp-server/src/tools/tasks.ts` L36 | description: `'親タスクUUID（1階層のみ）'` → `'親タスクUUID（最大10階層）'` |

**検証計画 (Manual UI Tests):**

| # | テスト | 操作 | 期待結果 |
|---|--------|------|----------|
| U1 | 3階層ドラッグ (child→parent) | タスクCの左ハンドルからタスクBにドラッグ (B.parent=A) | トースト「CをBの子タスクに設定」、C.parent_task_id=B |
| U2 | 循環ドラッグ拒否 | A→B→C 状態でCの右ハンドルからAにドラッグ | Aがeligible=false (ハイライトされない) |
| U3 | サイドバー3段インデント | A→B→C を設定後 | A=0px, B=16px, C=32px インデント |
| U4 | SVGコネクタ3段 | A→B→C 状態 | A→B, B→C の2本の破線コネクタが表示 |
| U5 | Inspector親ドロップダウン | Cを選択 → 親タスクドロップダウン | A, B, その他タスクが選択肢。C自身は除外 |
| U6 | 作成シート親選択 | タスク作成シート → 親タスク | 全タスクが選択肢に表示 |
| U7 | リペアレント | B(parent=A)をDの子に変更 | B.parent→D、CはBの子のまま |

**ロールバック:** `git revert` で Phase 3 コミットを取り消し

---

## デプロイ手順

1. Phase 1 ブランチを `develop` にマージ
2. Supabase migration を実行 (`supabase db push` or Dashboard)
3. 本番DBでT1-T6のSQL検証を実行
4. Phase 2 ブランチを `develop` にマージ
5. Phase 3 ブランチを `develop` にマージ
6. `develop` をデプロイ、U1-U7の手動検証
7. 問題があれば Phase 3 → 2 → 1 の逆順で revert

**互換性ウィンドウ:** Phase 1 (DB変更) 後〜Phase 2 (Client変更) 前は、旧クライアントが1階層制約を持つがDBは許可する状態。これは安全（クライアントが制限的なだけ）。

---

## Affected Files (完全リスト)

| File | Phase | Change |
|------|-------|--------|
| `supabase/migrations/20260308_multi_level_hierarchy.sql` | 1 | 旧トリガーDROP + 新トリガー作成 |
| `src/lib/hooks/useTasks.ts` | 2 | validateParentTask: 循環+深さ+サブツリー深さチェック |
| `src/lib/gantt/treeUtils.ts` | 2 | 再帰ツリー、getDescendantIds/getAncestorIds追加 |
| `src/__tests__/lib/gantt/treeUtils.test.ts` | 2 | 新規: 多階層ユニットテスト |
| `src/components/gantt/GanttChart.tsx` | 3 | eligibility + サイドバー多段インデント |
| `src/app/.../GanttPageClient.tsx` | 3 | parentTaskOptions → getEligibleParents |
| `packages/mcp-server/src/tools/tasks.ts` | 3 | description更新 |
| `src/app/.../TasksPageClient.tsx` | - | 変更不要 (getEligibleParents内部変更で対応) |
| `src/components/task/TaskInspector.tsx` | - | 変更不要 (props受取のみ) |
| `src/components/task/TaskCreateSheet.tsx` | - | 変更不要 |
| `packages/cli/src/commands/task.ts` | - | 変更不要 |
| `src/lib/slack/modals.ts` | - | 変更不要 |

## Risks

| リスク | 影響 | 対策 |
|--------|------|------|
| パフォーマンス | 深い再帰 O(n*d) | 50タスク×10階層=500回走査。問題なし |
| 循環参照 | 無限ループ | DBトリガー + クライアントvisited Set + safety break |
| 既存データ | 破壊的変更 | 現在の1階層データはそのまま動作 |
| 中間タスク削除 | 孫がトップレベル昇格 | SET NULL は意図的設計 |
| RLS | トリガー内SELECT | トリガーはオーナー権限で実行（RLSバイパス） |
| サブツリー深さ超過 | DB未検証 | クライアント側で `getMaxDescendantDepth` チェック |

## Out of Scope

- タスク折りたたみ（将来対応）
- ドラッグで階層順序変更（将来対応）
- WBS番号付け（将来対応）
- 中間タスク削除時の自動再接続（将来対応）
- バルク親子設定（将来対応）
