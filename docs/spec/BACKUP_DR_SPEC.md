# バックアップ・災害復旧 + ヘルスチェック仕様書

**Version**: 1.0
**Status**: Draft
**Priority**: HIGH
**Estimated Effort**: 1日
**Branch**: `feat/health-check`

---

## 1. 目的

データ喪失リスクを排除し、システム障害を早期検知する。
現状、バックアップ/PITR/ヘルスチェックがゼロで、障害発生時に事業継続不能になるリスクがある。

## 2. スコープ

### やること
- ヘルスチェックAPIエンドポイント（`/api/health`）の実装
- Supabase PITR有効化の手順書作成
- 週次バックアップスクリプトの作成

### やらないこと
- 自動フェイルオーバー（Supabase側の責務）
- マルチリージョン冗長化（Phase 2以降）

## 3. 技術仕様

### 3.1 ヘルスチェックAPI（Branch: `feat/health-check`）

#### エンドポイント

```
GET /api/health
```

#### レスポンス

```json
// 正常時 (200)
{
  "status": "healthy",
  "timestamp": "2026-02-15T12:00:00+09:00",
  "checks": {
    "database": { "status": "up", "latency_ms": 45 },
    "auth": { "status": "up", "latency_ms": 120 }
  },
  "version": "1.0.0"
}

// 異常時 (503)
{
  "status": "unhealthy",
  "timestamp": "2026-02-15T12:00:00+09:00",
  "checks": {
    "database": { "status": "down", "error": "connection timeout" },
    "auth": { "status": "up", "latency_ms": 120 }
  },
  "version": "1.0.0"
}
```

#### 実装

```typescript
// src/app/api/health/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const checks: Record<string, { status: string; latency_ms?: number; error?: string }> = {}
  let isHealthy = true

  // DB チェック
  const dbStart = Date.now()
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { error } = await supabase.from('organizations').select('id').limit(1)
    if (error) throw error
    checks.database = { status: 'up', latency_ms: Date.now() - dbStart }
  } catch (e: unknown) {
    isHealthy = false
    checks.database = {
      status: 'down',
      latency_ms: Date.now() - dbStart,
      error: e instanceof Error ? e.message : 'unknown error'
    }
  }

  // Auth チェック
  const authStart = Date.now()
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! }
    })
    if (!res.ok) throw new Error(`Auth health: ${res.status}`)
    checks.auth = { status: 'up', latency_ms: Date.now() - authStart }
  } catch (e: unknown) {
    isHealthy = false
    checks.auth = {
      status: 'down',
      latency_ms: Date.now() - authStart,
      error: e instanceof Error ? e.message : 'unknown error'
    }
  }

  // タイムスタンプ生成: toISOString() はUTC変換により日本時間で日付ずれを起こすため使用禁止
  // Intl.DateTimeFormat で ISO 8601 + タイムゾーンオフセット形式を生成
  const now = new Date()
  const timestamp = now.toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).replace(' ', 'T') + '+09:00'

  return NextResponse.json(
    {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp,
      checks,
      version: process.env.npm_package_version || '1.0.0'
    },
    { status: isHealthy ? 200 : 503 }
  )
}
```

#### セキュリティ

**レートリミット**: 既存の `src/lib/rate-limit.ts` (`checkRateLimit` / `getClientIp`) を使用して実装する。新規のレートリミット機構は作成しない。

```typescript
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

/** Rate limit: 60 health check requests per IP per minute */
const HEALTH_RATE_LIMIT = {
  maxRequests: 60,
  windowMs: 60 * 1000, // 1分
}

export async function GET(request: Request) {
  // レートリミットチェック
  const clientIp = getClientIp(request)
  const rateLimitKey = `health:${clientIp}`
  const rateResult = checkRateLimit(rateLimitKey, HEALTH_RATE_LIMIT)

  if (!rateResult.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((rateResult.resetAt - Date.now()) / 1000)),
        },
      }
    )
  }

  // ... 既存のヘルスチェックロジック
}
```

- エラー詳細は内部情報を漏洩しない程度に抑制
- Service Role Keyはサーバーサイドのみで使用

---

### 3.2 PITR有効化手順書

Supabaseダッシュボードでの手動設定手順を記録:

1. Supabase Dashboard → Project → Database → Backups
2. Point-in-Time Recovery を有効化
3. 保持期間: **7日間**（Pro プランの上限）
4. 有効化後、Recovery Time Objective (RTO): ~15分

#### 復旧手順

```
1. Supabase Dashboard → Backups → Point-in-Time Recovery
2. 復旧日時を選択（最大7日前まで）
3. 「Restore」をクリック
4. 新しいプロジェクトとして復元される
5. DNS切り替えまたは環境変数を更新して切り替え
```

---

### 3.3 週次バックアップスクリプト

**ファイル**: `scripts/backup-db.sh`

```bash
#!/bin/bash
# TaskApp DB Weekly Backup
# 環境変数: SUPABASE_DB_URL, BACKUP_DIR

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="taskapp_backup_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "Starting backup at $(date)..."
pg_dump "$SUPABASE_DB_URL" \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  | gzip > "${BACKUP_DIR}/${FILENAME}"

echo "Backup completed: ${FILENAME}"

# 30日以上前のバックアップを削除
find "$BACKUP_DIR" -name "taskapp_backup_*.sql.gz" -mtime +30 -delete
echo "Old backups cleaned up."
```

#### 実行方法
- 手動: `SUPABASE_DB_URL=postgresql://... ./scripts/backup-db.sh`
- 自動: cron or GitHub Actions (weekly)

## 4. 制約

- `/api/health` はpublicエンドポイント（認証不要）
- レートリミットは既存の `src/lib/rate-limit.ts` を使用して実装（新規レートリミット機構は作成しない）
- ヘルスチェックのレスポンスにDBの内容やユーザー情報を含めない
- **`toISOString()` は使用禁止**（プロジェクトルール: UTC変換により日本時間で日付ずれが発生するため）。タイムスタンプ生成には `toLocaleString` + タイムゾーン指定、または `formatDateToLocalString`（`@/lib/gantt/dateUtils`）を使用する
- バックアップスクリプトはSupabaseの直接接続URLが必要（pooler不可）

## 5. 検証方法

### 5.1 ヘルスチェック
- [ ] `GET /api/health` が200を返す
- [ ] Supabase停止時に503を返す
- [ ] レスポンスにlatencyが含まれる
- [ ] レスポンスの`timestamp`が`toISOString()`ではなくJST形式（`+09:00`付き）であること
- [ ] レートリミット超過時に429を返すこと（`src/lib/rate-limit.ts`の`checkRateLimit`使用）
- [ ] 429レスポンスに`Retry-After`ヘッダーが含まれること

### 5.2 バックアップ
- [ ] バックアップスクリプトが正常に実行される
- [ ] `npm run build` / `npm run lint` が成功する

### 5.3 DR検証（運用要件）
- [ ] **四半期ごとのリストア演習**: 四半期に1回、PITRまたは週次バックアップからのリストアをステージング環境で実施し、手順書の有効性を確認する
- [ ] **RPO/RTO実測記録**: リストア演習時に以下を測定・記録する
  - **RPO（Recovery Point Objective）実測値**: データ喪失量（最新バックアップからの経過時間）
  - **RTO（Recovery Time Objective）実測値**: 復旧完了までの所要時間
  - 記録場所: `docs/dr/` 配下にリストア演習レポートとして保存
  - 目標値: RPO < 24時間（週次バックアップ）/ < 5分（PITR有効時）、RTO < 30分
