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

  it('登録済みの provider は全てカタログの task_sync に存在する', () => {
    for (const id of implementedTaskSyncProviders()) {
      const def = getIntegration(id)
      expect(def, `${id} missing from registry`).not.toBeNull()
      expect(def!.category, `${id} should be task_sync`).toBe('task_sync')
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
