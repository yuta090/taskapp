import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// -- mocks --------------------------------------------------------------

const mockGetUser = vi.fn()
const mockRpc = vi.fn()
const mockSpaceSingle = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      rpc: mockRpc,
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: mockSpaceSingle,
          })),
        })),
      })),
    }),
  ),
}))

const mockUpdateHomeLinks = vi.fn()
vi.mock('@/lib/presets/homeLinks', () => ({
  updateHomePageSpecLinks: (...args: unknown[]) => mockUpdateHomeLinks(...args),
}))

const mockCreateSampleTasks = vi.fn()
vi.mock('@/lib/presets/sampleTasks', () => ({
  createSampleTasks: (...args: unknown[]) => mockCreateSampleTasks(...args),
}))

import { POST as createWithPreset } from '@/app/api/spaces/create-with-preset/route'
import { POST as applyPreset } from '@/app/api/spaces/[spaceId]/apply-preset/route'

const ORG_ID = '11111111-2222-3333-4444-555555555555'
const SPACE_ID = 'space-1'

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function loggedIn() {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdateHomeLinks.mockResolvedValue(true)
  mockCreateSampleTasks.mockResolvedValue(0)
})

// -- create-with-preset --------------------------------------------------

describe('POST /api/spaces/create-with-preset', () => {
  const url = 'http://localhost/api/spaces/create-with-preset'
  const validBody = { name: '新規PJ', presetGenre: 'design', orgId: ORG_ID }

  it('未ログインは401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await createWithPreset(jsonRequest(url, validBody))
    expect(res.status).toBe(401)
  })

  it('不正JSONは400', async () => {
    loggedIn()
    const req = new NextRequest(url, { method: 'POST', body: 'not-json' })
    const res = await createWithPreset(req)
    expect(res.status).toBe(400)
  })

  it.each([
    ['nameなし', { presetGenre: 'design', orgId: ORG_ID }],
    ['name空白のみ', { name: '   ', presetGenre: 'design', orgId: ORG_ID }],
    ['orgIdなし', { name: 'PJ', presetGenre: 'design' }],
    ['orgIdがUUIDでない', { name: 'PJ', presetGenre: 'design', orgId: 'abc' }],
    ['未知のpresetGenre', { name: 'PJ', presetGenre: 'hacking', orgId: ORG_ID }],
  ])('%s は400', async (_label, body) => {
    loggedIn()
    const res = await createWithPreset(jsonRequest(url, body))
    expect(res.status).toBe(400)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('RPCエラーは500', async () => {
    loggedIn()
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const res = await createWithPreset(jsonRequest(url, validBody))
    expect(res.status).toBe(500)
  })

  it.each([
    ['authentication_required', 401],
    ['not_org_member', 403],
    ['plan_limit_exceeded', 400],
  ])('RPCがok:false(%s)なら%iを返す', async (errorMsg, expected) => {
    loggedIn()
    mockRpc.mockResolvedValue({ data: { ok: false, error: errorMsg }, error: null })
    const res = await createWithPreset(jsonRequest(url, validBody))
    expect(res.status).toBe(expected)
  })

  it('成功時はspace情報と件数を返し、ホームリンクを実IDで更新する', async () => {
    loggedIn()
    mockRpc.mockResolvedValue({
      data: { ok: true, space_id: 'space-9', milestones_created: 5, wiki_pages_created: 4 },
      error: null,
    })

    const res = await createWithPreset(jsonRequest(url, validBody))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.space).toMatchObject({ id: 'space-9', org_id: ORG_ID, preset_genre: 'design' })
    expect(json.milestonesCreated).toBe(5)
    expect(json.wikiPagesCreated).toBe(4)

    // homeLinks は (client, preset, orgId, realSpaceId) で呼ばれる
    expect(mockUpdateHomeLinks).toHaveBeenCalledTimes(1)
    const [, preset, orgId, spaceId] = mockUpdateHomeLinks.mock.calls[0]
    expect(preset.genre).toBe('design')
    expect(orgId).toBe(ORG_ID)
    expect(spaceId).toBe('space-9')
  })

  it('成功時はサンプルタスクを作成し、件数をレスポンスに含める', async () => {
    loggedIn()
    mockRpc.mockResolvedValue({
      data: { ok: true, space_id: 'space-9', milestones_created: 5, wiki_pages_created: 4 },
      error: null,
    })
    mockCreateSampleTasks.mockResolvedValue(4)

    const res = await createWithPreset(jsonRequest(url, validBody))
    const json = await res.json()
    expect(json.sampleTasksCreated).toBe(4)

    // createSampleTasks は (client, preset, orgId, realSpaceId, userId) で呼ばれる
    expect(mockCreateSampleTasks).toHaveBeenCalledTimes(1)
    const [, preset, orgId, spaceId, userId] = mockCreateSampleTasks.mock.calls[0]
    expect(preset.genre).toBe('design')
    expect(orgId).toBe(ORG_ID)
    expect(spaceId).toBe('space-9')
    expect(userId).toBe('user-1')
  })

  it('サンプルタスク作成が失敗（0件）でもレスポンス自体は200のまま', async () => {
    loggedIn()
    mockRpc.mockResolvedValue({
      data: { ok: true, space_id: 'space-9' },
      error: null,
    })
    mockCreateSampleTasks.mockResolvedValue(0)

    const res = await createWithPreset(jsonRequest(url, validBody))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.sampleTasksCreated).toBe(0)
  })

  it('RPCへ渡すwiki_pagesにはホームが1件だけ含まれる', async () => {
    loggedIn()
    mockRpc.mockResolvedValue({
      data: { ok: true, space_id: 'space-9' },
      error: null,
    })

    await createWithPreset(jsonRequest(url, validBody))

    const params = mockRpc.mock.calls[0][1]
    const homes = params.p_wiki_pages.filter((p: { is_home: boolean }) => p.is_home)
    expect(homes).toHaveLength(1)
    expect(params.p_org_id).toBe(ORG_ID)
  })
})

// -- apply-preset ----------------------------------------------------------

describe('POST /api/spaces/[spaceId]/apply-preset', () => {
  const url = `http://localhost/api/spaces/${SPACE_ID}/apply-preset`
  const params = { params: Promise.resolve({ spaceId: SPACE_ID }) }

  it('未ログインは401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await applyPreset(jsonRequest(url, { presetGenre: 'design' }), params)
    expect(res.status).toBe(401)
  })

  it('blankプリセットの適用は400', async () => {
    loggedIn()
    const res = await applyPreset(jsonRequest(url, { presetGenre: 'blank' }), params)
    expect(res.status).toBe(400)
  })

  it('未知のジャンルは400', async () => {
    loggedIn()
    const res = await applyPreset(jsonRequest(url, { presetGenre: 'nope' }), params)
    expect(res.status).toBe(400)
  })

  it('スペースが見つからなければ404', async () => {
    loggedIn()
    mockSpaceSingle.mockResolvedValue({ data: null })
    const res = await applyPreset(jsonRequest(url, { presetGenre: 'design' }), params)
    expect(res.status).toBe(404)
  })

  it.each([
    ['insufficient_permissions', 403],
    ['space_not_found', 404],
    ['space_not_empty', 409],
    ['preset_already_applied', 409],
    ['unknown_reason', 400],
  ])('RPCがok:false(%s)なら%iを返す', async (errorMsg, expected) => {
    loggedIn()
    mockSpaceSingle.mockResolvedValue({ data: { org_id: ORG_ID } })
    mockRpc.mockResolvedValue({ data: { ok: false, error: errorMsg }, error: null })
    const res = await applyPreset(jsonRequest(url, { presetGenre: 'design' }), params)
    expect(res.status).toBe(expected)
  })

  it('成功時は件数を返し、ホームリンクを更新する', async () => {
    loggedIn()
    mockSpaceSingle.mockResolvedValue({ data: { org_id: ORG_ID } })
    mockRpc.mockResolvedValue({
      data: { ok: true, milestones_created: 5, wiki_pages_created: 4 },
      error: null,
    })

    const res = await applyPreset(jsonRequest(url, { presetGenre: 'design' }), params)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.milestonesCreated).toBe(5)
    expect(json.wikiPagesCreated).toBe(4)
    expect(mockUpdateHomeLinks).toHaveBeenCalledTimes(1)
  })
})
