import { describe, it, expect } from 'vitest'
import { API_KEY_ACTION_OPTIONS, API_KEY_ACTION_VALUES } from '@/lib/api-keys/actionOptions'

/**
 * APIキーの「許可する操作」の選択肢。
 * DB の CHECK 制約（api_keys.allowed_actions <@ {read,write,delete,bulk}）と CLI/MCP の
 * ActionType（read/write/delete/bulk）に合わせて4つ全部を画面から選べること。
 * 以前は bulk だけ画面に無く、一括系ツール（task_import / client_invite_bulk_create）を
 * 使えるキーを画面から作れなかった。
 */
describe('API_KEY_ACTION_OPTIONS', () => {
  it('read/write/delete/bulk の4つを、この順で提供する', () => {
    expect(API_KEY_ACTION_OPTIONS.map((o) => o.value)).toEqual(['read', 'write', 'delete', 'bulk'])
    expect(API_KEY_ACTION_VALUES).toEqual(['read', 'write', 'delete', 'bulk'])
  })

  it('bulk は「一括操作」として、何ができるかが日本語で説明されている', () => {
    const bulk = API_KEY_ACTION_OPTIONS.find((o) => o.value === 'bulk')!
    expect(bulk.label).toBe('一括操作')
    expect(bulk.description).toMatch(/CSV/)
    expect(bulk.description).toMatch(/招待/)
  })

  it('read だけが必須（外せない）', () => {
    expect(API_KEY_ACTION_OPTIONS.filter((o) => o.required).map((o) => o.value)).toEqual(['read'])
  })
})
