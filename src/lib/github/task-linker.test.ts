import { describe, it, expect, vi } from 'vitest'
import { extractTaskIds, linkPRToTasks } from './task-linker'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * extractTaskIds — PRタイトル/本文/ブランチ名から TP-番号 を拾う。
 * 決まり: 直前が英数字でない(行頭・記号・日本語・全角かっこ・/ など) + TP- + 数字 + 直後が数字でない。
 * 大文字小文字は区別しない。結果は 'TP-<数字>' の形に正規化し、重複を除く。
 */
describe('extractTaskIds', () => {
  it('日本語が直後に続いても拾う', () => {
    expect(extractTaskIds('TP-42の修正')).toEqual(['TP-42'])
  })

  it('読点区切りの複数番号を両方拾う', () => {
    expect(extractTaskIds('TP-42、TP-43')).toEqual(['TP-42', 'TP-43'])
  })

  it('全角かっこで囲まれていても拾う', () => {
    expect(extractTaskIds('（TP-42）')).toEqual(['TP-42'])
  })

  it('ブランチ名 feat/TP-42-x から拾う', () => {
    expect(extractTaskIds('feat/TP-42-x')).toEqual(['TP-42'])
  })

  it('小文字の tp-42-x（ブランチ名想定）も拾う（大文字小文字を区別しない）', () => {
    expect(extractTaskIds('tp-42-x')).toEqual(['TP-42'])
  })

  it('既存: #TP-042 形式', () => {
    expect(extractTaskIds('feat: ログイン修正 #TP-042')).toEqual(['TP-042'])
  })

  it('既存: [TP-123] 形式', () => {
    expect(extractTaskIds('fix: [TP-123] バグ修正')).toEqual(['TP-123'])
  })

  it('既存: 行頭の TP-001 形式', () => {
    expect(extractTaskIds('TP-001 対応')).toEqual(['TP-001'])
  })

  it('HTTP-001 は誤検出しない（直前が英字）', () => {
    expect(extractTaskIds('HTTP-001 エラー')).toEqual([])
  })

  it('STP-1 は誤検出しない（直前が英字）', () => {
    expect(extractTaskIds('STP-1 の対応')).toEqual([])
  })

  it('数字の無い TP- は拾わない', () => {
    expect(extractTaskIds('TP- は識別子のプレフィックスです')).toEqual([])
  })

  it('該当なしのときは空配列', () => {
    expect(extractTaskIds('特に関係の無い文章です')).toEqual([])
  })

  it('重複は除く', () => {
    expect(extractTaskIds('TP-42 TP-42')).toEqual(['TP-42'])
  })
})

/**
 * linkPRToTasks — タイトル・本文にタスクIDが無くても、ブランチ名(第7引数)から拾えること。
 * GITHUB_ISSUES_LINK_SPEC の紐付け先探索(tasks→space_github_repos→task_github_links)は
 * そのまま。実DBは使わず、呼び出し列を検証する最小のフェイクチェーンで代替する。
 */
function makeFakeSupabase() {
  const upsertCalls: Array<[Record<string, unknown>, Record<string, unknown>]> = []
  const from = vi.fn((table: string) => {
    if (table === 'tasks') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { id: 'task-1', space_id: 'space-1' }, error: null }),
            }),
          }),
        }),
      }
    }
    if (table === 'space_github_repos') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { id: 'link-1' }, error: null }),
            }),
          }),
        }),
      }
    }
    if (table === 'task_github_links') {
      return {
        upsert: (payload: Record<string, unknown>, opts: Record<string, unknown>) => {
          upsertCalls.push([payload, opts])
          return Promise.resolve({ error: null })
        },
      }
    }
    throw new Error(`unexpected table: ${table}`)
  })
  return { supabase: { from } as unknown as SupabaseClient, upsertCalls }
}

describe('linkPRToTasks — ブランチ名からもタスクIDを拾う', () => {
  it('タイトル・本文に無くても、ブランチ名(feat/tp-42-login)にあれば TP-42 に紐づく', async () => {
    const { supabase, upsertCalls } = makeFakeSupabase()

    const result = await linkPRToTasks(
      supabase,
      'org-1',
      'repo-1',
      'pr-1',
      'fix: login bug',
      null,
      'feat/tp-42-login'
    )

    expect(result.linkedTasks).toEqual(['TP-42'])
    expect(upsertCalls).toHaveLength(1)
    expect(upsertCalls[0][0]).toMatchObject({ task_id: 'task-1', github_pr_id: 'pr-1' })
  })

  it('ブランチ名が無くても従来通りタイトル/本文だけで動く（後方互換）', async () => {
    const { supabase, upsertCalls } = makeFakeSupabase()

    const result = await linkPRToTasks(supabase, 'org-1', 'repo-1', 'pr-1', 'TP-42 の修正', null)

    expect(result.linkedTasks).toEqual(['TP-42'])
    expect(upsertCalls).toHaveLength(1)
  })
})
