import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import { getManifest } from '@/lib/cli-manifest'

/**
 * CLI に配るコマンド一覧（マニフェスト）の整合性。
 * CLI 側(packages/cli/src/manifest-validator.ts)が弾く形になっていないことを、
 * サーバー側の生成物に対して固定する。
 */
describe('cli-manifest', () => {
  const manifest = getManifest()

  it('checksum は commands の JSON の sha256 と一致する（CLI側の verifyChecksum と同じ計算）', () => {
    const computed = createHash('sha256').update(JSON.stringify(manifest.commands)).digest('hex')
    expect(manifest.checksum).toBe(`sha256:${computed}`)
  })

  it('全コマンド/オプションの名前と param は CLI 側の検証パターンを満たす', () => {
    const NAME_RE = /^[a-z][a-z0-9-]*$/
    const PARAM_RE = /^[a-zA-Z][a-zA-Z0-9]*$/
    const TOOL_RE = /^[a-z][a-z_]*$/
    for (const cmd of manifest.commands) {
      expect(cmd.name).toMatch(NAME_RE)
      for (const sub of cmd.subcommands ?? []) {
        expect(sub.name).toMatch(NAME_RE)
        expect(sub.tool).toMatch(TOOL_RE)
        for (const opt of sub.options) expect(opt.param).toMatch(PARAM_RE)
        if (sub.stdinFormat === 'text') expect(sub.stdinParam).toMatch(PARAM_RE)
      }
    }
  })

  it('task import が CSV テキストを stdin/--file で受ける形で定義されている', () => {
    const task = manifest.commands.find((c) => c.name === 'task')!
    const imp = task.subcommands!.find((s) => s.name === 'import')!
    expect(imp).toMatchObject({ tool: 'task_import', stdinMode: true, stdinFormat: 'text', stdinParam: 'csv' })
    const flags = imp.options.map((o) => o.flags)
    expect(flags).toEqual(expect.arrayContaining(['-s, --space-id <uuid>', '--stdin', '--no-dry-run']))
    const dry = imp.options.find((o) => o.param === 'dryRun')!
    expect(dry.type).toBe('negatable')
  })
})
