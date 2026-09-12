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

describe('cli-manifest: file upload', () => {
  const manifest = getManifest()
  const file = manifest.commands.find((c) => c.name === 'file')!

  it('file upload は 3 段階アップロード（uploadMode + completeTool）として定義されている', () => {
    const up = file.subcommands!.find((s) => s.name === 'upload')!
    expect(up).toMatchObject({ tool: 'file_upload_url', uploadMode: true, completeTool: 'file_upload_complete' })
    const flags = up.options.map((o) => o.flags)
    expect(flags).toEqual(expect.arrayContaining(['-s, --space-id <uuid>', '-f, --file <path>', '--name <name>', '--mime-type <type>']))
    expect(up.options.find((o) => o.param === 'file')!.required).toBe(true)
  })

  it('file list は file_list を read で呼ぶ', () => {
    const ls = file.subcommands!.find((s) => s.name === 'list')!
    expect(ls.tool).toBe('file_list')
  })
})

describe('cli-manifest: notices（CLI に出すお知らせ）', () => {
  const manifest = getManifest()

  it('notices は id(一意・英数字と . _ -)・date(YYYY-MM-DD)・message(空でない)を持つ', () => {
    expect(Array.isArray(manifest.notices)).toBe(true)
    const ids = manifest.notices.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const n of manifest.notices) {
      expect(n.id).toMatch(/^[A-Za-z0-9._-]{1,64}$/)
      expect(n.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(n.message.length).toBeGreaterThan(0)
      expect(n.message.length).toBeLessThanOrEqual(500)
    }
  })

  it('サーバーが残すお知らせは直近 10 件まで(古いものは消してよい: 一度出した分は各利用者の既読に残る)', () => {
    expect(manifest.notices.length).toBeLessThanOrEqual(10)
  })

  it('notices は checksum の対象外(commands だけ)なので、旧 CLI は無視して動ける', () => {
    const computed = createHash('sha256').update(JSON.stringify(manifest.commands)).digest('hex')
    expect(manifest.checksum).toBe(`sha256:${computed}`)
  })

  it('wiki create/update は本文を --file / --stdin のテキストで受け、task update は --wiki-page-id を持つ', () => {
    const wiki = manifest.commands.find((c) => c.name === 'wiki')!
    for (const name of ['create', 'update']) {
      const sub = wiki.subcommands!.find((s) => s.name === name)!
      expect(sub).toMatchObject({ stdinMode: true, stdinFormat: 'text', stdinParam: 'body' })
      expect(sub.options.map((o) => o.flags)).toEqual(expect.arrayContaining(['--stdin', '--format <fmt>', '--body <body>']))
    }
    const task = manifest.commands.find((c) => c.name === 'task')!
    const update = task.subcommands!.find((s) => s.name === 'update')!
    expect(update.options.some((o) => o.param === 'wikiPageId')).toBe(true)
  })

  it('file list / update があり、update は --file-id 必須で --description を持つ', () => {
    const file = manifest.commands.find((c) => c.name === 'file')!
    expect(file.subcommands!.map((s) => s.name)).toEqual(expect.arrayContaining(['list', 'upload', 'update']))
    const update = file.subcommands!.find((s) => s.name === 'update')!
    expect(update.tool).toBe('file_update')
    expect(update.options.find((o) => o.param === 'fileId')?.required).toBe(true)
    expect(update.options.some((o) => o.param === 'description')).toBe(true)
  })
})

/**
 * 作成時のステータス指定。以前は作成すると必ず「未着手(backlog)」になり、
 * 「最初から着手中で作る」には作成→update の2回叩きが要った。
 */
describe('cli-manifest: task create --status', () => {
  const manifest = getManifest()
  const create = manifest.commands
    .find((c) => c.name === 'task')!
    .subcommands!.find((s) => s.name === 'create')!

  it('task create が --status を受け取り、update と同じ 6 種から選ばせる', () => {
    const status = create.options.find((o) => o.param === 'status')
    expect(status).toBeDefined()
    expect(status!.flags).toBe('--status <status>')
    expect(status!.choices).toEqual([
      'backlog', 'todo', 'in_progress', 'in_review', 'done', 'considering',
    ])
  })
})

/**
 * Wiki の「フォルダ分け(親ページ)・マイルストーン紐づけ・ピン留め」は API 側では受け付けるのに、
 * CLI に配るコマンド一覧に載っていなかったため、CLI からは一切指定できなかった
 * （CLI のコマンドはこの manifest だけで決まる。packages/cli/src/commands/* は配線されていない）。
 */
describe('cli-manifest: wiki update の構造オプション', () => {
  const manifest = getManifest()
  const update = manifest.commands
    .find((c) => c.name === 'wiki')!
    .subcommands!.find((s) => s.name === 'update')!
  const byParam = (p: string) => update.options.filter((o) => o.param === p)

  it('親ページ・マイルストーンを指定できる（none で解除）', () => {
    expect(byParam('parentPageId').map((o) => o.flags)).toEqual(['--parent-page-id <id>'])
    expect(byParam('milestoneId').map((o) => o.flags)).toEqual(['--milestone-id <id>'])
  })

  it('ピン留めは --pinned / --no-pinned の対で指定できる', () => {
    const pinned = byParam('pinned')
    expect(pinned.map((o) => o.flags)).toEqual(['--pinned', '--no-pinned'])
    expect(pinned[0].type).toBe('bool')
    expect(pinned[1].type).toBe('negatable')
  })

  it('invite グループがあり、既定は社内メンバー招待（相手先は --role client）', () => {
    const invite = manifest.commands.find((c) => c.name === 'invite')!
    expect(invite.subcommands!.map((s) => s.name)).toEqual(['create', 'list', 'resend'])
    const create = invite.subcommands!.find((s) => s.name === 'create')!
    expect(create.tool).toBe('client_invite_create')
    const role = create.options.find((o) => o.param === 'role')!
    expect(role.default).toBe('member')
    expect(role.choices).toEqual(expect.arrayContaining(['member', 'client']))
    expect(create.options.find((o) => o.param === 'email')?.required).toBe(true)
  })

  it('client invite-create からも role を選べる（既定は相手先のまま）', () => {
    const client = manifest.commands.find((c) => c.name === 'client')!
    const create = client.subcommands!.find((s) => s.name === 'invite-create')!
    expect(create.options.find((o) => o.param === 'role')?.default).toBe('client')
  })

  it('task update でメール指定の担当割り当てができる（招待中の人も含む）', () => {
    const task = manifest.commands.find((c) => c.name === 'task')!
    const update = task.subcommands!.find((s) => s.name === 'update')!
    expect(update.options.some((o) => o.param === 'assigneeEmail')).toBe(true)
    expect(update.options.some((o) => o.param === 'assigneeInviteId')).toBe(true)
  })
})

/**
 * task list / list-my の --offset。limit の上限(100)しか無く、100件を超えるプロジェクトの
 * 「続きから取る」手段が CLI に無かった。
 */
describe('cli-manifest: task list --offset', () => {
  const manifest = getManifest()
  const task = manifest.commands.find((c) => c.name === 'task')!

  it('task list に --offset <n>（int・既定0）がある', () => {
    const list = task.subcommands!.find((s) => s.name === 'list')!
    const offset = list.options.find((o) => o.param === 'offset')
    expect(offset).toBeDefined()
    expect(offset!.flags).toBe('--offset <n>')
    expect(offset!.type).toBe('int')
    expect(offset!.default).toBe('0')
  })

  it('task list-my にも --offset <n>（int・既定0）がある', () => {
    const listMy = task.subcommands!.find((s) => s.name === 'list-my')!
    const offset = listMy.options.find((o) => o.param === 'offset')
    expect(offset).toBeDefined()
    expect(offset!.flags).toBe('--offset <n>')
    expect(offset!.type).toBe('int')
    expect(offset!.default).toBe('0')
  })
})

/**
 * activity log の案内が、実際のサーバー側の動き（packages/mcp-server/src/tools/activity.ts）と
 * 食い違っていた: --actor-type は選べる体裁だが記録は常に ai・--entity-table は
 * 許可リストの8表以外は400で断られるのに、案内にその一覧が無かった。
 */
describe('cli-manifest: activity log の案内', () => {
  const manifest = getManifest()
  const activity = manifest.commands.find((c) => c.name === 'activity')!
  const log = activity.subcommands!.find((s) => s.name === 'log')!

  it('--actor-type は、選んでも記録は常に ai であることが説明に書かれている', () => {
    const actorType = log.options.find((o) => o.param === 'actorType')!
    expect(actorType.description!.toLowerCase()).toContain('always')
    expect(actorType.description!.toLowerCase()).toContain('ai')
  })

  it('--entity-table の説明に、受け付ける8表が並んでいる', () => {
    const entityTable = log.options.find((o) => o.param === 'entityTable')!
    for (const table of [
      'tasks',
      'milestones',
      'meetings',
      'wiki_pages',
      'reviews',
      'task_comments',
      'files',
      'scheduling_proposals',
    ]) {
      expect(entityTable.description!).toContain(table)
    }
  })
})
