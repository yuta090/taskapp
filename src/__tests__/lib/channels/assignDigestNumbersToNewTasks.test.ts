import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * 一覧番号（digest_number）の採番。
 *
 * ここが壊れると、利用者が手元で見ている一覧の番号と実物がズレて、
 * 「完了 3」で別のタスクが消えるという最悪の事故になる。
 *
 * ⚠ **採番の中身は SQL（RPC）に移した**。アプリで「最大を読む → +1 して書く」をやっていた頃は、
 *   同じグループでほぼ同時に「タスク追加」された2件に同じ番号が付き、その番号で「完了N」を送ると
 *   2件とも完了したうえで「既に完了済み」と返っていた（読みと書きの間にロックが無いため）。
 *   いまは channel_groups の行を FOR UPDATE でロックする RPC の中で完結する。
 *
 * したがってこのファイルが見るのは2つ:
 *   1. アプリ⇔DBのつなぎ目 — 正しいRPCを正しい引数で呼び、失敗を握り潰さず、戻りを正しく変換するか
 *   2. 採番の約束が SQL 側に書かれたままか — マイグレーションの中身を読む番人
 *      （SQLの実挙動はユニットテストでは動かせないので、消えたら気付ける形にしておく）
 */

type RpcRow = {
  id: string
  title: string
  digest_number: number
  due_date: string | null
  due_time: string | null
  assignee_hint: string | null
}

let rpcResponse: { data: RpcRow[] | null; error: { message: string } | null }
/** 実際に飛んだ RPC 呼び出し（名前と引数）を記録する。 */
let rpcCalls: Array<{ name: string; args: Record<string, unknown> }>

const rpcMock = vi.fn(async (name: string, args: Record<string, unknown>) => {
  rpcCalls.push({ name, args })
  return rpcResponse
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ rpc: rpcMock })),
}))

const store = await import('@/lib/channels/store')

beforeEach(() => {
  rpcCalls = []
  rpcResponse = { data: [], error: null }
  rpcMock.mockClear()
})

describe('assignDigestNumbersToNewTasks（その場の登録・「一覧」で使う採番）', () => {
  it('採番専用のRPCを、そのグループと読み取り上限つきで呼ぶ', async () => {
    await store.assignDigestNumbersToNewTasks('grp-1')

    expect(rpcCalls).toEqual([
      {
        name: 'rpc_assign_digest_numbers',
        args: { p_group_id: 'grp-1', p_limit: store.ASSIGN_DIGEST_NUMBERS_MAX_ROWS },
      },
    ])
  })

  it('番号の総入れ替え（再採番）のRPCは絶対に呼ばない', async () => {
    await store.assignDigestNumbersToNewTasks('grp-1')

    // ここから総入れ替えを呼ぶと、手元の一覧の番号が別のタスクを指すようになる。
    expect(rpcCalls.map((c) => c.name)).not.toContain('rpc_clear_and_renumber_digest_tasks')
  })

  it('DBの返り（snake_case）をアプリの形に変換する', async () => {
    rpcResponse = {
      data: [
        {
          id: 't-1',
          title: '見積もりを送る',
          digest_number: 7,
          due_date: '2026-08-01',
          due_time: '17:00',
          assignee_hint: '山田',
        },
      ],
      error: null,
    }

    const result = await store.assignDigestNumbersToNewTasks('grp-1')

    expect(result).toEqual([
      {
        id: 't-1',
        title: '見積もりを送る',
        digestNumber: 7,
        dueDate: '2026-08-01',
        dueTime: '17:00',
        assigneeHint: '山田',
      },
    ])
  })

  it('1件も無ければ空で返す（エラーではない）', async () => {
    rpcResponse = { data: [], error: null }
    await expect(store.assignDigestNumbersToNewTasks('grp-1')).resolves.toEqual([])
  })

  it('失敗したら例外にする（番号が分からないまま案内しない）', async () => {
    rpcResponse = { data: null, error: { message: 'db down' } }

    // 空配列で返すと「タスク0件」と区別できず、嘘の一覧を返してしまう。
    await expect(store.assignDigestNumbersToNewTasks('grp-1')).rejects.toThrow(/db down/)
  })
})

describe('clearAndRenumberOpenDigestTasks（配信直前の総入れ替え）', () => {
  it('総入れ替え専用のRPCを呼ぶ（クリアと採番を別々に投げない）', async () => {
    await store.clearAndRenumberOpenDigestTasks('grp-1')

    // クリアと採番を別の命令で投げると、その隙間に「タスク追加」が割り込んで番号が重複する。
    expect(rpcCalls).toEqual([
      { name: 'rpc_clear_and_renumber_digest_tasks', args: { p_group_id: 'grp-1' } },
    ])
  })

  it('失敗したら例外にする（旧番号のまま配信しない）', async () => {
    rpcResponse = { data: null, error: { message: 'db down' } }

    // 誤配信より欠配信を選ぶ。cron 側でこの回の配信をスキップさせる。
    await expect(store.clearAndRenumberOpenDigestTasks('grp-1')).rejects.toThrow(/db down/)
  })
})

/**
 * 採番の約束は SQL の中にある。ユニットテストでは SQL を動かせないので、
 * **約束が書かれたまま残っているか**だけをソースを読んで確かめる番人を置く。
 * 消えたときに気付けることが目的であって、SQLの正しさの証明ではない。
 */
describe('採番の約束が SQL に書かれたまま残っているか', () => {
  const sql = fs.readFileSync(
    path.resolve(
      __dirname,
      '../../../../supabase/migrations/20260731231645_digest_number_atomic.sql',
    ),
    'utf8',
  )

  it('2つの採番RPCが定義されている', () => {
    expect(sql).toContain('function public.rpc_assign_digest_numbers')
    expect(sql).toContain('function public.rpc_clear_and_renumber_digest_tasks')
  })

  it('どちらもグループ行をロックしてから読み書きする（同時実行を直列化する）', () => {
    const bodies = sql.split('create or replace function').slice(1)
    expect(bodies).toHaveLength(2)
    for (const body of bodies) {
      expect(body).toContain('from public.channel_groups g')
      expect(body).toContain('for update')
    }
  })

  it('同じ番号を2件に配れないよう、DB側に一意制約がある（すり抜けの最後の砦）', () => {
    expect(sql).toContain('create unique index')
    expect(sql).toContain('channel_digest_tasks_group_open_number_unique')
    expect(sql).toContain("where status = 'open' and digest_number is not null")
  })

  it('追加採番は「番号がまだ無い行」だけを対象にする（既存の番号を動かさない）', () => {
    const assign = sql.slice(sql.indexOf('rpc_assign_digest_numbers'))
    expect(assign.slice(0, assign.indexOf('rpc_clear_and_renumber'))).toContain(
      'digest_number is null',
    )
  })

  it('再採番の並びは、期限の早い順→期限なしは最後→登録の古い順', () => {
    expect(sql).toContain("(dt.due_date + coalesce(dt.due_time, '23:59'::time)) asc nulls last")
  })

  it('service_role だけが実行できる（外から叩けない）', () => {
    expect(sql).toContain('revoke execute on function public.rpc_assign_digest_numbers')
    expect(sql).toContain('revoke execute on function public.rpc_clear_and_renumber_digest_tasks')
    expect((sql.match(/to service_role;/g) ?? []).length).toBe(2)
  })
})
