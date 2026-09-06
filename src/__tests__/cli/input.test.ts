import { describe, it, expect } from 'vitest'
import { buildParams, buildStdinParams, mergeCliOptions, optionKey, stripBom } from '../../../packages/cli/src/input'
import type { ManifestOption } from '../../../packages/cli/src/manifest-validator'

/**
 * CLI(packages/cli)の stdin/--file 入力の組み立て。CLI パッケージには単体テストの足場が無いため、
 * 依存ゼロの純粋関数だけをルートの vitest から直接読んで固定する。
 */
const spaceOpt: ManifestOption = { flags: '-s, --space-id <uuid>', param: 'spaceId', resolve: 'spaceId' }
const importSub = {
  name: 'import',
  stdinFormat: 'text' as const,
  stdinParam: 'csv',
  options: [
    spaceOpt,
    { flags: '--stdin', param: 'stdin', type: 'bool' as const },
    { flags: '--no-dry-run', param: 'dryRun', type: 'negatable' as const },
  ],
}

describe('buildStdinParams (text)', () => {
  it('CSV テキストをそのまま stdinParam に入れ、spaceId と --no-dry-run を添える', () => {
    const params = buildStdinParams(importSub, 'title\nA\n', { stdin: true, dryRun: false }, 'space-1')
    expect(params).toEqual({ csv: 'title\nA\n', spaceId: 'space-1', dryRun: false })
  })

  it('BOM 付きファイルでも先頭の BOM を落とす', () => {
    const params = buildStdinParams(importSub, '﻿title\nA\n', {}, 'space-1')
    expect(params.csv).toBe('title\nA\n')
  })

  it('空入力はエラー（無言で空のCSVをサーバーに送らない）', () => {
    expect(() => buildStdinParams(importSub, '   \n', {}, 'space-1')).toThrow(/空/)
  })

  it('dryRun を指定しなければ params に含めない（サーバー既定の dryRun=true に任せる）', () => {
    const params = buildStdinParams(importSub, 'title\nA\n', { stdin: true }, 'space-1')
    expect(params).not.toHaveProperty('dryRun')
  })
})

describe('buildStdinParams (json, 既存の scheduling 系の挙動を維持)', () => {
  const sub = { name: 'create', options: [spaceOpt, { flags: '--stdin', param: 'stdin', type: 'bool' as const }] }

  it('JSON を土台にし、stdin に spaceId が無ければ CLI 側の値を入れる', () => {
    expect(buildStdinParams(sub, '{"title":"x"}', { stdin: true }, 'space-1')).toEqual({ title: 'x', spaceId: 'space-1' })
  })

  it('stdin の spaceId は上書きしない', () => {
    expect(buildStdinParams(sub, '{"spaceId":"from-stdin"}', {}, 'space-1')).toEqual({ spaceId: 'from-stdin' })
  })

  it('配列や文字列の JSON は拒否する', () => {
    expect(() => buildStdinParams(sub, '[1]', {}, undefined)).toThrow(/オブジェクト/)
  })
})

describe('mergeCliOptions', () => {
  it('CLI オプションは stdin 側に同じキーが無いときだけ足す', () => {
    const options: ManifestOption[] = [{ flags: '--title <t>', param: 'title' }, { flags: '--due-date <d>', param: 'dueDate' }]
    const out = mergeCliOptions(options, { title: 'cli', dueDate: '2026-09-01' }, { title: 'stdin' }, undefined)
    expect(out).toEqual({ title: 'stdin', dueDate: '2026-09-01' })
  })
})

describe('stripBom', () => {
  it('BOM が無ければそのまま', () => {
    expect(stripBom('abc')).toBe('abc')
  })
})

describe('optionKey', () => {
  it('通常のフラグは camelCase', () => {
    expect(optionKey({ flags: '--due-date <d>' })).toBe('dueDate')
    expect(optionKey({ flags: '-s, --space-id <uuid>' })).toBe('spaceId')
  })

  it('否定形(--no-xxx)は Commander が格納する正の名前にする（--no-dry-run → dryRun）', () => {
    expect(optionKey({ flags: '--no-dry-run', type: 'negatable' })).toBe('dryRun')
    expect(optionKey({ flags: '--no-include-invites', type: 'negatable' })).toBe('includeInvites')
  })
})

describe('buildParams (通常モード)', () => {
  const options: ManifestOption[] = [
    spaceOpt,
    { flags: '--ball <side>', param: 'ball' },
    { flags: '--limit <n>', param: 'limit', type: 'int' },
    { flags: '--no-dry-run', param: 'dryRun', type: 'negatable' },
    { flags: '--user-ids <ids...>', param: 'userIds', type: 'string[]' },
  ]

  it('-s を省略しても、解決済みの既定スペースIDが params に入る（defaultSpaceId が死んでいたバグの回帰）', () => {
    const params = buildParams(options, { limit: '50' }, 'space-default')
    expect(params).toEqual({ spaceId: 'space-default', limit: 50 })
  })

  it('スペースIDが解決できないときは spaceId を送らない（サーバー側の Required で分かる）', () => {
    expect(buildParams(options, { ball: 'client' }, undefined)).toEqual({ ball: 'client' })
  })

  it('型変換: int / negatable / string[]', () => {
    const params = buildParams(options, { limit: '10', dryRun: false, userIds: 'u1' }, 's')
    expect(params).toEqual({ spaceId: 's', limit: 10, dryRun: false, userIds: ['u1'] })
  })

  it('不正な整数はエラー', () => {
    expect(() => buildParams(options, { limit: 'abc' }, 's')).toThrow(/Invalid integer/)
  })
})
