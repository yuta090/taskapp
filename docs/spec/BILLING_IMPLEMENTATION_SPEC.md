# 課金制限実装 + Freeプラン制限強化 仕様書

**Version**: 1.0
**Status**: Draft
**Priority**: CRITICAL
**Estimated Effort**: 3-5日
**Branches**: `feat/billing-limits`, `feat/free-plan-restrictions`

---

## 1. 目的

収益化の基盤を構築する。具体的には:
- `useBillingLimits`のスタブ実装を実際のRPC呼び出しに置換
- Freeプラン制限を強化して有料化への導線を確保
- アップグレード誘導UIの実装

## 2. 背景

### 現状の問題
- `useBillingLimits.ts` が常に `null` を返すスタブ → 制限チェック無効
- Freeプラン制限（PJ5/メンバー5/クライアント5）が緩すぎ → 有料化動機なし
- 制限到達時のアップグレード誘導がない

### コスト分析に基づく料金戦略

| プラン | 月額（税込） | 年額（税込） |
|--------|-------------|-------------|
| Free | 0円 | 0円 |
| Pro | 1,980円 | 19,800円 |
| Enterprise | 49,800円 | 498,000円 |

**損益分岐点**: Pro 4社契約（月7,920円）で黒字化
**インフラコスト**: Supabase Pro $25/月 + Vercel $20/月 = 約7,250円/月

## 3. スコープ

### 3.1 useBillingLimits 実装（Branch: `feat/billing-limits`）

#### 3.1.1 DB確認

`org_billing` テーブルと `plans` テーブルの構造を確認し、以下のデータが取得可能か検証:
- 現在のプラン名（free/pro/enterprise）
- 各リソースの上限値
- 現在の使用量

#### 3.1.2 RPC関数（必要な場合）

```sql
-- 組織の使用量を一括取得するRPC
CREATE OR REPLACE FUNCTION rpc_get_org_usage(p_org_id uuid)
RETURNS json AS $$
  SELECT json_build_object(
    'projects', (SELECT count(*) FROM spaces WHERE org_id = p_org_id AND deleted_at IS NULL),
    'members', (SELECT count(*) FROM org_memberships WHERE org_id = p_org_id),
    'clients', (SELECT count(DISTINCT ci.user_id)
                FROM space_memberships ci
                JOIN spaces s ON s.id = ci.space_id
                WHERE s.org_id = p_org_id AND ci.role = 'client'),
    'storage_bytes', 0 -- Storage未使用のため0固定
  );
$$ LANGUAGE sql SECURITY DEFINER;
```

#### 3.1.3 Hook実装

```typescript
// src/lib/hooks/useBillingLimits.ts
export function useBillingLimits(orgId?: string) {
  const [limits, setLimits] = useState<BillingLimits | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Supabase lazy useRef パターン
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (!supabaseRef.current) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const fetch = useCallback(async () => {
    if (!orgId) return
    // org_billingとplansからプラン情報取得
    // rpc_get_org_usageで使用量取得
    // BillingLimitsオブジェクトを構築
  }, [orgId, supabase])

  // isAtLimit, getRemainingCount を実装
  const isAtLimit = useCallback((type: ResourceType): boolean => {
    if (!limits) return false
    return limits.usage[type] >= limits.plan[type]
  }, [limits])

  return { limits, loading, error, refresh: fetch, isAtLimit, getRemainingCount }
}
```

#### 3.1.4 BillingLimits型定義

> **既存UIとの互換方針**: 現在の `useBillingLimits.ts` スタブは `BillingLimits` 型を `{plan_name, projects_used, projects_limit, members_used, members_limit, ...}` のフラット構造で定義している。実装版でも **このフラット構造を維持** し、既存のUI側コード（呼び出し側）が型変更なしで動作するようにする。内部的にネストされたデータは Hook 内でフラット化して返す。

```typescript
type ResourceType = 'projects' | 'members' | 'clients' | 'storage'

// 既存スタブとの互換性を維持するフラット構造
interface BillingLimits {
  plan_name: 'free' | 'pro' | 'enterprise'
  projects_used: number
  projects_limit: number
  members_used: number
  members_limit: number
  clients_used: number
  clients_limit: number
  tasks_used: number
  tasks_limit: number
  meetings_used: number
  meetings_limit: number
  storage_used_bytes: number
  storage_limit_bytes: number
}
```

#### 3.1.5 データ取得方針

> **Hookから直接RPCに一本化する**: `/api/billing/limits` のようなAPI Routeは作成せず、`useBillingLimits` Hook内からSupabase RPCを直接呼び出す方式に統一する。理由:
> - API Routeを中間に挟む必要性がない（認証はSupabase RLSで担保）
> - RTT削減（ブラウザ → Supabase直接 vs ブラウザ → Next.js API → Supabase）
> - 既存の `useTasks` / `useMeetings` 等の他Hookと同じパターンを踏襲

---

### 3.2 Freeプラン制限強化（Branch: `feat/free-plan-restrictions`）

#### 制限値の変更

| リソース | 現在 | 変更後 | 根拠 |
|---------|------|--------|------|
| プロジェクト | 5 | **3** | 競合Free(Asana:2名,Monday:2名)より緩いが試用に十分 |
| 内部メンバー | 5 | **3** | 3名で小チーム試用可能 |
| クライアント | 5 | **2** | ポータル体験に最低限 |
| タスク/PJ | 無制限 | **100** | Linear Free: 250参考 |
| ガントチャート | あり | **なし** | Pro差別化 |
| バーンダウン | あり | **なし** | Pro差別化 |
| MCP Server | あり | **なし** | Pro差別化 |

#### plansテーブルの更新SQL

> **実カラム名確認済み**: `src/types/database.ts` の `plans` テーブル定義に基づく。カラム名は `projects_limit`, `members_limit`, `clients_limit`, `storage_limit_bytes`。`max_tasks_per_project` カラムは現在存在しないため、ALTER TABLE で追加する。

```sql
-- plansテーブルにtasks_per_project_limitカラムを追加
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS tasks_per_project_limit integer NULL;

-- Freeプランの制限値を更新
UPDATE plans SET
  projects_limit = 3,
  members_limit = 3,
  clients_limit = 2,
  tasks_per_project_limit = 100
WHERE name = 'free';
```

> **注意**: `plans.id` の値はUUID等の可能性があるため、`WHERE name = 'free'` で特定する。実データを確認の上、適切なWHERE句を使用すること。

#### 機能制限の実装

ガントチャート、バーンダウン、MCP Serverへのアクセスを制限:

```typescript
// ページまたはコンポーネントレベルで制限
const { limits, isAtLimit } = useBillingLimits(orgId)

if (limits?.plan.name === 'free') {
  return <UpgradePrompt feature="ガントチャート" />
}
```

---

### 3.3 アップグレード誘導UI

#### 制限到達時のUI

リソース上限に達した場合、操作をブロックしアップグレードを促す:

```tsx
function UpgradePrompt({ feature }: { feature: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center">
      <h3 className="text-lg font-semibold text-gray-900">
        {feature}はProプランで利用できます
      </h3>
      <p className="mt-2 text-sm text-gray-600">
        月額1,980円（税込）で全機能をご利用いただけます
      </p>
      <a
        href="/settings/billing"
        className="mt-4 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
      >
        プランをアップグレード
      </a>
    </div>
  )
}
```

#### 使用量バー表示

設定画面の課金ページに使用量プログレスバーを表示:

```
プロジェクト: [██████████░░] 2/3
メンバー:     [████████░░░░] 2/3
クライアント: [████░░░░░░░░] 1/2
```

80%到達で黄色、100%で赤色表示。

---

## 4. 制約

- `any`型は使わない
- Supabaseクライアントはlazy useRefパターン
- 既存のorg_billing/plansテーブル構造を可能な限り活用
- 新規テーブルは最小限
- Freeプラン制限変更は既存ユーザーに事前通知が必要（UI上のバナー等）

## 5. 完了条件

- `src/lib/hooks/useBillingLimits.ts` 内の全 `eslint-disable` コメントが除去されていること（現在2箇所: `@typescript-eslint/no-unused-vars` x2）。実装によりスタブが不要になるため、eslint抑制は不要となる。

## 6. 検証方法

- [ ] Freeプランで4つ目のプロジェクト作成がブロックされる
- [ ] Freeプランでガントチャートにアクセスするとアップグレード誘導が表示される
- [ ] 使用量が正しく表示される
- [ ] Proプランでは全制限が解除される
- [ ] `useBillingLimits.ts` に `eslint-disable` コメントが残っていないこと
- [ ] `npm run build` / `npm run lint` が成功する
