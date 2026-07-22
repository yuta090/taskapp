import { describe, it, expect } from 'vitest'
import { TASK_SYNC_ADAPTERS, getTaskSyncAdapter, implementedTaskSyncProviders } from '@/lib/task-sync/adapters'
import { getIntegration } from '@/lib/integrations/registry'

/**
 * アダプタ登録表の不変条件。DB の provider 列が形式チェックだけになるため、
 * 「どの provider が実際に繋がるか」の真実源はここになる。カタログ（registry.ts）との
 * 食い違いは、UIで「使える」と見せているのに繋がらない（またはその逆）事故になる。
 */

describe('アダプタ登録表', () => {
  it('キーと各アダプタの id が一致する（表の引き間違いを構造的に防ぐ）', () => {
    for (const [key, adapter] of Object.entries(TASK_SYNC_ADAPTERS)) {
      expect(adapter!.id, `${key} maps to adapter id ${adapter!.id}`).toBe(key)
    }
  })

  // sink(通知連携)と task-sync(双方向同期)を兼ねる provider。カタログ上のカテゴリ見出しは
  // 既存の data_export のまま（sink動線・UIを壊さない）が、アダプタとしては実装済み。
  const SINK_AND_TASK_SYNC_EXCEPTIONS: readonly string[] = ['notion']

  it('登録済みの provider は全てカタログの task_sync に存在する（明示された例外を除く）', () => {
    for (const id of implementedTaskSyncProviders()) {
      if (SINK_AND_TASK_SYNC_EXCEPTIONS.includes(id)) continue
      const def = getIntegration(id)
      expect(def, `${id} missing from registry`).not.toBeNull()
      expect(def!.category, `${id} should be task_sync`).toBe('task_sync')
    }
  })

  it('例外のprovider(notion)はカタログに存在しconnectorKindでアダプタと結びつく', () => {
    for (const id of SINK_AND_TASK_SYNC_EXCEPTIONS) {
      const def = getIntegration(id)
      expect(def, `${id} missing from registry`).not.toBeNull()
      expect(def!.connectorKind, `${id} should declare connectorKind`).toBe(id)
    }
  })

  it('未対応の provider は null を返す（未知の値で落ちない）', () => {
    expect(getTaskSyncAdapter('unknown_tool')).toBeNull()
    // gtasks/multica は既存の専用ワーカーが担当するため、この経路には載せない（二重取り込み防止）。
    expect(getTaskSyncAdapter('google_tasks')).toBeNull()
    expect(getTaskSyncAdapter('multica')).toBeNull()
  })

  it('全アダプタが必須の宣言（認証方式・接続先境界・差分粒度）を持つ', () => {
    for (const adapter of Object.values(TASK_SYNC_ADAPTERS)) {
      expect(adapter!.authKind, `${adapter!.id} authKind`).toBeTruthy()
      expect(adapter!.hostPolicy?.kind, `${adapter!.id} hostPolicy`).toBeTruthy()
      expect(adapter!.cursorGranularity, `${adapter!.id} cursorGranularity`).toBeTruthy()
    }
  })

  /**
   * カタログ（registry）の鮮度SLAと、アダプタが宣言する実ポーリング間隔の整合。
   *
   * AI秘書の期限リマインドは `pollFreshnessSlaMinutes` を「この期限は N 分以内に同期済み」の
   * 根拠に使う（src/lib/reminders/dueReminderStaleness.ts）。ここが実態より甘いと、
   * **外部ツールで既に完了・期限変更されているタスクについて相手を催促する**という、
   * 製品として一番やってはいけない誤爆になる。
   */
  describe('期限リマインドの鮮度宣言と実ポーリング間隔の整合', () => {
    it('期限の正本になるツールは、SLAが実ポーリング間隔の2倍以上ある', () => {
      const CRON_INTERVAL_MINUTES = 15 // supabase/migrations/20260721200902_task_sync_cron.sql
      for (const [id, adapter] of Object.entries(TASK_SYNC_ADAPTERS)) {
        const caps = getIntegration(id)?.capabilities
        if (!caps?.dueImport) continue
        const effectiveInterval = adapter!.minPollIntervalMinutes ?? CRON_INTERVAL_MINUTES
        expect(caps.pollFreshnessSlaMinutes, `${id} SLA missing`).toBeGreaterThanOrEqual(
          effectiveInterval * 2,
        )
      }
    })

    it('半日を超える間隔でしか取り込めないツールは期限の正本にしない（古い期限で催促しない）', () => {
      // 呼び出し回数の上限が厳しく低頻度でしか回せないツール（Jooto 等）は、期限が古すぎて
      // 催促の根拠にできない。取り込みと完了の書き戻しはするが、リマインドには使わない。
      const HALF_DAY = 12 * 60
      for (const [id, adapter] of Object.entries(TASK_SYNC_ADAPTERS)) {
        if ((adapter!.minPollIntervalMinutes ?? 0) <= HALF_DAY) continue
        const caps = getIntegration(id)?.capabilities
        expect(caps?.dueImport, `${id} polls rarely but claims due authority`).toBe(false)
        expect(caps?.dueFreshness, `${id} polls rarely but claims freshness`).toBe('none')
      }
    })
  })

  it('接続先が可変なアダプタ以外は fixed を宣言する（宣言漏れで任意ホストに開かない）', () => {
    for (const adapter of Object.values(TASK_SYNC_ADAPTERS)) {
      const kind = adapter!.hostPolicy.kind
      expect(['fixed', 'vendor-domain', 'any-https']).toContain(kind)
      if (kind === 'vendor-domain') {
        // 許可サフィックスは必ず先頭ドット付き（ドット境界一致のため。'backlog.jp' だと
        // 'evil-backlog.jp' が通ってしまう）。
        for (const suffix of adapter!.hostPolicy.kind === 'vendor-domain'
          ? adapter!.hostPolicy.allowedSuffixes
          : []) {
          expect(suffix.startsWith('.'), `${adapter!.id} suffix ${suffix} must start with a dot`).toBe(true)
        }
      }
    }
  })
})
