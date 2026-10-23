import { dehydrate, QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { shouldPersistQuery } from './persistPolicy'

/** 端末に書き出される（dehydrate される）キーの先頭だけを集める */
async function persistedHeads(keys: (readonly unknown[])[]): Promise<string[]> {
  const client = new QueryClient()
  for (const queryKey of keys) await client.prefetchQuery({ queryKey, queryFn: async () => ({ ok: true }) })
  return dehydrate(client, { shouldDehydrateQuery: shouldPersistQuery }).queries.map((q) => String(q.queryKey[0]))
}

describe('shouldPersistQuery（端末に取り置くもの）', () => {
  it('Wiki の本文つきページは端末に書かない（本文は大きく、取り置き全体が膨らむため）', async () => {
    const heads = await persistedHeads([['wikiPage', 'u', 'o', 'p']])
    expect(heads).toEqual([])
  })

  it('Wiki の一覧（wikiPages・複数形）は本文を持たないので書く。本文つきの wikiPage（単数形）とは別', async () => {
    const heads = await persistedHeads([
      ['wikiPages', 'u', 'o', 's'],
      ['wikiPage', 'u', 'o', 'p'],
    ])
    expect(heads).toEqual(['wikiPages'])
  })

  it('議事録の本文つきは端末に書かない（会議の一覧は本文を持たないので書く）', async () => {
    const heads = await persistedHeads([
      ['meetingMinutes', 'u', 'o', 'm'],
      ['meetings', 'u', 'o', 's'],
    ])
    expect(heads).toEqual(['meetings'])
  })

  it('題名だけの軽い問い合わせや、一覧・タスクは今までどおり書く', async () => {
    const heads = await persistedHeads([
      ['wikiTitle', 'u', 'o', 'p'],
      ['myTasks', 'u', 'o'],
      ['task', 'u', 't'],
      ['wikiPage', 'u', 'o', 'p'],
    ])
    expect(heads).toEqual(['wikiTitle', 'myTasks', 'task'])
  })

  it('失敗した問い合わせは書かない（react-query の既定どおり）', async () => {
    const client = new QueryClient()
    await client.prefetchQuery({
      queryKey: ['myTasks', 'u', 'o'],
      queryFn: async () => {
        throw new Error('offline')
      },
      retry: false,
    })
    expect(dehydrate(client, { shouldDehydrateQuery: shouldPersistQuery }).queries).toEqual([])
  })
})
