/**
 * Wiki の本文を描く共通部品（Wiki 画面と、議事録の上に重ねた Wiki の両方が使う）。
 *
 * 同時編集の組み立て（useMinutesCollab）を Wiki のページの部屋につなぎ、保存のフック
 * （useWikiBodySave）へ「いま書記か」を渡す。確かめたいのは配線だけなので、同時編集の
 * 中身とエディタは差し替える。
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import * as Y from 'yjs'
import { WikiBodyEditor } from '@/components/wiki/WikiBodyEditor'

const PAGE = '11111111-1111-4111-8111-111111111111'
const BODY = JSON.stringify([{ id: 'a', type: 'paragraph', content: [], children: [] }])

type CollabResult = Record<string, unknown>
let collabOptions: Record<string, unknown> | undefined
const registerSeeder = vi.fn()
const setEditing = vi.fn()
let isApplyingRemote = false
const meta = new Y.Doc().getMap('meta')
let collabResult: CollabResult

function baseCollab(overrides: CollabResult = {}): CollabResult {
  return {
    others: [],
    setEditing,
    active: true,
    pending: false,
    solo: false,
    isScribe: false,
    fragment: new Y.Doc().getXmlFragment('minutes'),
    awareness: {},
    meta,
    isApplyingRemote: () => isApplyingRemote,
    synced: true,
    colorIndex: 0,
    degradedReason: null,
    registerSeeder,
    requestRoomReload: vi.fn(),
    ...overrides,
  }
}

vi.mock('@/lib/hooks/useMinutesCollab', () => ({
  useMinutesCollab: (options: Record<string, unknown>) => {
    collabOptions = options
    return collabResult
  },
}))

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'u-self', email: 'self@example.com', user_metadata: { name: '自分' } } }),
}))

vi.mock('@/lib/collab/flag', () => ({ isCollabEnabledForOrg: () => true }))

let editorProps: Record<string, unknown> | undefined
vi.mock('@/components/wiki/WikiEditorDynamic', () => ({
  WikiEditorDynamic: (props: Record<string, unknown>) => {
    editorProps = props
    return <div data-testid="wiki-editor" />
  },
}))

function bodySave() {
  return {
    handleChange: vi.fn(),
    setCollab: vi.fn(),
    registerEditorApi: vi.fn(),
    takeOverAsScribe: vi.fn(async () => {}),
  }
}

function renderEditor(save = bodySave(), onRequestReload = vi.fn()) {
  const utils = render(
    <WikiBodyEditor
      orgId="org-1"
      spaceId="space-1"
      pageId={PAGE}
      initialBody={BODY}
      basisUpdatedAt="t0"
      canEdit
      bodySave={save}
      onRequestReload={onRequestReload}
    />
  )
  return { ...utils, save, onRequestReload }
}

beforeEach(() => {
  vi.clearAllMocks()
  collabOptions = undefined
  editorProps = undefined
  isApplyingRemote = false
  collabResult = baseCollab()
})

describe('WikiBodyEditor', () => {
  it('Wiki のページの部屋（wiki-page:<ページID>）に入る', () => {
    renderEditor()
    expect(collabOptions).toMatchObject({ meetingId: PAGE, topicPrefix: 'wiki-page:', collabAllowed: true })
  })

  it('保存のフックへ「同時編集中か・書記か・部屋の覚え書き」を渡す', () => {
    const { save } = renderEditor()
    expect(save.setCollab).toHaveBeenLastCalledWith({ active: true, isScribe: false, meta })
  })

  it('同時編集中はエディタに器を渡し、本文は種まきで入れる（開いたときの本文と更新時刻を使う）', () => {
    const { save } = renderEditor()
    expect(editorProps!.collaboration).toMatchObject({ fragment: collabResult.fragment, userName: '自分' })
    const api = { replaceContent: vi.fn(), appendBlocks: vi.fn(), seedCollabDoc: vi.fn(() => 'hash-1') }
    act(() => (editorProps!.registerApi as (a: unknown) => void)(api))
    expect(save.registerEditorApi).toHaveBeenCalledWith(api)
    const seeder = registerSeeder.mock.calls.at(-1)?.[0] as (doc: Y.Doc) => unknown
    const doc = new Y.Doc()
    expect(seeder(doc)).toEqual({ seedHash: 'hash-1', basis: 't0' })
    expect(api.seedCollabDoc).toHaveBeenCalledWith(doc, BODY)
  })

  it('1人で書く形なら、器を渡さず本文をそのまま載せる', () => {
    collabResult = baseCollab({ active: false, solo: true, fragment: null, awareness: null, isScribe: true })
    renderEditor()
    expect(editorProps!.collaboration).toBeUndefined()
    expect(editorProps!.initialContent).toBe(BODY)
  })

  it('本文が器に届くまでは書けない', () => {
    collabResult = baseCollab({ synced: false })
    renderEditor()
    expect(editorProps!.editable).toBe(false)
  })

  it('書記になったら、保存のフックに引き継ぎを頼む', () => {
    const { save, rerender } = renderEditor()
    expect(save.takeOverAsScribe).not.toHaveBeenCalled()
    collabResult = baseCollab({ isScribe: true })
    rerender(
      <WikiBodyEditor
        orgId="org-1"
        spaceId="space-1"
        pageId={PAGE}
        initialBody={BODY}
        basisUpdatedAt="t0"
        canEdit
        bodySave={save}
        onRequestReload={vi.fn()}
      />
    )
    expect(save.takeOverAsScribe).toHaveBeenCalledWith(PAGE)
  })

  it('本文が二重になったら、1回だけ読み直しを頼む', () => {
    collabResult = baseCollab({ degradedReason: 'duplicate-seed', active: false })
    const { onRequestReload } = renderEditor()
    expect(onRequestReload).toHaveBeenCalledTimes(1)
  })

  it('打った分は保存のフックへ渡し、「書いています」を立てる。相手の文字が流れ込んだ分では立てない', () => {
    const { save } = renderEditor()
    const onChange = editorProps!.onChange as (content: string) => void
    isApplyingRemote = true
    act(() => onChange('[1]'))
    expect(setEditing).not.toHaveBeenCalledWith(true)
    isApplyingRemote = false
    act(() => onChange('[2]'))
    expect(setEditing).toHaveBeenCalledWith(true)
    expect(save.handleChange).toHaveBeenCalledWith(PAGE, '[1]')
    expect(save.handleChange).toHaveBeenCalledWith(PAGE, '[2]')
  })

  it('ほかの人が書いていれば「〇〇さんが書いています」を出す', () => {
    collabResult = baseCollab({ others: [{ userId: 'u2', name: '佐藤', editing: true, joinedAt: 1, collab: true }] })
    renderEditor()
    expect(screen.getByTestId('wiki-presence-banner')).toHaveTextContent('佐藤さんが書いています')
  })

  it('1人で書く形に戻ったら、その理由をページの言葉で出す', () => {
    collabResult = baseCollab({ degradedReason: 'too-large', active: false })
    renderEditor()
    expect(screen.getByTestId('wiki-collab-degraded-notice')).toHaveTextContent('ページが長くなったので')
  })
})
