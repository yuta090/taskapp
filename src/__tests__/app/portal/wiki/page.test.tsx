import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * `/portal/wiki` — 相手先ポータルのWiki一覧。wiki_page_publicationsと
 * milestone_publicationsの間には外部キーが無い(どちらもmilestones/organizations
 * を指すだけ)ため、埋め込み(milestone_publications!inner)は使えない。先に公開中の
 * マイルストーンIDを引いてから、それでwiki_page_publications側を絞る。
 *
 * isPortalSectionEnabled・milestone_publications・actionCountは互いに依存しない
 * ので同じPromise.allで並べて読む(直列4段に保つ)。
 */

const mockUser = { id: 'client-user-1' }
const PROJECT = { id: 'space-1', name: 'プロジェクト', orgId: 'org-1' }

let authResponse: { data: { user: typeof mockUser | null } }
let sectionEnabledResponse: boolean
let milestonePubsResponse: { data: Array<{ milestone_id: string }> | null; error: null | { message: string } }
let wikiPagesResponse: { data: unknown[] | null; error: null | { message: string } }
let wikiFromCalled: boolean
let milestonePubsEqArgs: unknown[][]
let wikiInArgs: unknown[][]
let wikiOrderArgs: unknown[][]

class RedirectSignal extends Error {
  constructor(public destination: string) {
    super('NEXT_REDIRECT')
  }
}

const redirectMock = vi.fn((destination: string) => {
  throw new RedirectSignal(destination)
})
vi.mock('next/navigation', () => ({
  redirect: (destination: string) => redirectMock(destination),
}))

vi.mock('@/lib/portal/getClientProjects', async () => {
  const actual = await vi.importActual<typeof import('@/lib/portal/getClientProjects')>(
    '@/lib/portal/getClientProjects',
  )
  return {
    ...actual,
    getClientProjects: vi.fn(() => Promise.resolve([PROJECT])),
  }
})

const isPortalSectionEnabledMock = vi.fn((..._args: unknown[]) => Promise.resolve(sectionEnabledResponse))
vi.mock('@/lib/portal/checkPortalSection', () => ({
  isPortalSectionEnabled: (...args: unknown[]) => isPortalSectionEnabledMock(...args),
}))

vi.mock('@/app/portal/wiki/PortalWikiClient', () => ({
  PortalWikiClient: (props: { wikiPages: Array<{ title: string }> }) => (
    <div data-testid="portal-wiki-client">{props.wikiPages.map((p) => p.title).join(',')}</div>
  ),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        getUser: vi.fn(() => Promise.resolve(authResponse)),
      },
      from: vi.fn((table: string) => {
        if (table === 'milestone_publications') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((...args1: unknown[]) => {
                milestonePubsEqArgs.push(args1)
                return {
                  eq: vi.fn((...args2: unknown[]) => {
                    milestonePubsEqArgs.push(args2)
                    return Promise.resolve(milestonePubsResponse)
                  }),
                }
              }),
            })),
          }
        }
        if (table === 'wiki_page_publications') {
          wikiFromCalled = true
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn((...args1: unknown[]) => {
                  wikiInArgs.push(args1)
                  return {
                    in: vi.fn((...args2: unknown[]) => {
                      wikiInArgs.push(args2)
                      return {
                        order: vi.fn((...args3: unknown[]) => {
                          wikiOrderArgs.push(args3)
                          return Promise.resolve(wikiPagesResponse)
                        }),
                      }
                    }),
                  }
                }),
              })),
            })),
          }
        }
        if (table === 'tasks') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  neq: vi.fn(() => Promise.resolve({ count: 0, error: null })),
                })),
              })),
            })),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })
  ),
}))

const { default: PortalWikiPage } = await import('@/app/portal/wiki/page')

function renderPage() {
  return PortalWikiPage({ searchParams: Promise.resolve({}) })
}

describe('PortalWikiPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authResponse = { data: { user: mockUser } }
    sectionEnabledResponse = true
    milestonePubsResponse = { data: [], error: null }
    wikiPagesResponse = { data: [], error: null }
    wikiFromCalled = false
    milestonePubsEqArgs = []
    wikiInArgs = []
    wikiOrderArgs = []
  })

  it('公開中のマイルストーンを先に引き、milestone_idとspace_idの両方でwiki_page_publicationsを絞る', async () => {
    milestonePubsResponse = { data: [{ milestone_id: 'ms-1' }], error: null }
    wikiPagesResponse = {
      data: [
        { id: 'wp-1', published_title: 'タイトル1', published_body: '本文', published_at: '2026-01-01T00:00:00' },
      ],
      error: null,
    }

    const result = await renderPage()

    expect(milestonePubsEqArgs).toEqual([
      ['org_id', PROJECT.orgId],
      ['is_published', true],
    ])
    expect(wikiFromCalled).toBe(true)
    // どちらかが抜けると、公開していないマイルストーン/他プロジェクトのページが漏れる
    expect(wikiInArgs).toEqual([
      ['milestone_id', ['ms-1']],
      ['wiki_pages.space_id', [PROJECT.id]],
    ])
    expect(wikiOrderArgs).toEqual([['published_at', { ascending: false }]])
    // published_title → title への詰め替え
    expect((result as { props: { wikiPages: Array<{ title: string }> } }).props.wikiPages).toEqual([
      expect.objectContaining({ title: 'タイトル1' }),
    ])
  })

  it('公開中のマイルストーンが0件なら、wiki_page_publicationsは問い合わせず空の一覧を返す', async () => {
    milestonePubsResponse = { data: [], error: null }

    const result = await renderPage()

    expect(wikiFromCalled).toBe(false)
    expect((result as { props: { wikiPages: unknown[] } }).props.wikiPages).toEqual([])
  })

  // isPortalSectionEnabledはmilestone_publications/actionCountと同じPromise.allに
  // 入っている(依存しないため)。無効なときに問い合わせが無駄になっても、
  // Wikiのデータを描いてしまわないことを確かめる
  it('セクションが無効なときは/portalへredirectし、Wikiのデータは描かない', async () => {
    sectionEnabledResponse = false
    milestonePubsResponse = { data: [{ milestone_id: 'ms-1' }], error: null }
    wikiPagesResponse = {
      data: [{ id: 'wp-1', published_title: '見えてはいけないタイトル', published_body: '', published_at: '2026-01-01T00:00:00' }],
      error: null,
    }

    await expect(renderPage()).rejects.toBeInstanceOf(RedirectSignal)
    expect(redirectMock).toHaveBeenCalledWith('/portal')
  })
})
