import { describe, it, expect } from 'vitest'
import { parseTaskImportCsv, planTaskImport, type PlanInput } from './taskImportPlan.js'

const CSV_HEADER = 'title,description,status,ball,origin,client_scope,start_date,due_date,assignee,client_owners,internal_owners,parent,priority,milestone'

function csv(...rows: string[]): string {
  return [CSV_HEADER, ...rows].join('\n') + '\n'
}

function makeInput(rows: ReturnType<typeof parseTaskImportCsv>['rows'], over: Partial<PlanInput> = {}): PlanInput {
  let n = 0
  return {
    rows,
    existingTasks: new Map(),
    users: {
      byEmail: new Map([
        ['takahashi@example.com', 'u-taka'],
        ['tanaka@example.com', 'u-tanaka'],
      ]),
      byName: new Map([
        ['高橋', ['u-taka']],
        ['田中', ['u-tanaka']],
        ['宮田', ['u-miyata-1', 'u-miyata-2']],
      ]),
    },
    milestones: new Map([['フェーズ1', 'm-1']]),
    newId: () => `id-${++n}`,
    ...over,
  }
}

describe('parseTaskImportCsv', () => {
  it('英語の見出しで各列を読み取る', () => {
    const { rows, ignoredColumns, errors } = parseTaskImportCsv(csv(
      'A,説明A,todo,internal,internal,internal,2026-09-01,2026-09-05,takahashi@example.com,,,,2,フェーズ1',
    ))
    expect(errors).toEqual([])
    expect(ignoredColumns).toEqual([])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      line: 2,
      title: 'A',
      description: '説明A',
      status: 'todo',
      ball: 'internal',
      origin: 'internal',
      clientScope: 'internal',
      startDate: '2026-09-01',
      dueDate: '2026-09-05',
      assignee: 'takahashi@example.com',
      priority: 2,
      milestone: 'フェーズ1',
    })
  })

  it('日本語の見出し（書き出しCSVと同じ語）と日本語の値も受け付ける', () => {
    const text = 'タイトル,状態,ボール,公開範囲,期限,担当者,相手先担当,親タスク\n' +
      'B,確認待ち,相手先,公開,2026/9/5,高橋,田中,大項目X\n'
    const { rows, errors } = parseTaskImportCsv(text)
    expect(errors).toEqual([])
    expect(rows[0]).toMatchObject({
      title: 'B',
      status: 'in_review',
      ball: 'client',
      clientScope: 'deliverable',
      dueDate: '2026-09-05',
      assignee: '高橋',
      clientOwners: ['田中'],
      parent: '大項目X',
    })
  })

  it('複数人は「・」「;」「、」区切りで分ける', () => {
    const { rows } = parseTaskImportCsv('title,internal_owners\nC,高橋・宮田;田中、佐藤\n')
    expect(rows[0].internalOwners).toEqual(['高橋', '宮田', '田中', '佐藤'])
  })

  it('title 列が無ければ全体エラー', () => {
    const { errors } = parseTaskImportCsv('description\nfoo\n')
    expect(errors[0].message).toMatch(/title/)
  })

  it('知らない列は無視し、名前を報告する', () => {
    const { ignoredColumns, rows } = parseTaskImportCsv('title,備考,更新日\nD,memo,2026-09-01\n')
    expect(ignoredColumns).toEqual(['備考', '更新日'])
    expect(rows[0].title).toBe('D')
  })

  it('不正な値は行番号つきのエラーにする（タイトル空・状態・日付・優先度）', () => {
    const { errors } = parseTaskImportCsv(csv(
      ',x,todo,internal,internal,internal,,,,,,,,',
      'E,,flying,internal,internal,internal,,2026-13-45,,,,,9,',
    ))
    const lines = errors.map((e) => [e.line, e.message])
    expect(lines).toEqual([
      [2, expect.stringMatching(/title/)],
      [3, expect.stringMatching(/status.*flying/)],
      [3, expect.stringMatching(/due_date/)],
      [3, expect.stringMatching(/priority/)],
    ])
  })

  it('開始日が期限より後ならエラー', () => {
    const { errors } = parseTaskImportCsv(csv('F,,,,,,2026-09-10,2026-09-01,,,,,,'))
    expect(errors).toEqual([{ line: 2, title: 'F', message: expect.stringMatching(/start_date.*due_date/) }])
  })

  it('500行を超えるCSVは拒否する', () => {
    const many = Array.from({ length: 501 }, (_, i) => `T${i}`)
    const { errors } = parseTaskImportCsv(['title', ...many].join('\n'))
    expect(errors[0].message).toMatch(/500/)
  })
})

describe('planTaskImport', () => {
  it('既定値: status=todo / ball=internal / origin=internal / client_scope=internal', () => {
    const { rows } = parseTaskImportCsv('title\nG\n')
    const plan = planTaskImport(makeInput(rows))
    expect(plan.errors).toEqual([])
    expect(plan.tasks).toHaveLength(1)
    expect(plan.tasks[0]).toMatchObject({
      id: 'id-1', title: 'G', status: 'todo', ball: 'internal', origin: 'internal',
      clientScope: 'internal', parentId: null, depth: 0, autoParent: false,
    })
  })

  it('担当者はメール（大文字小文字無視）または表示名で解決する', () => {
    const { rows } = parseTaskImportCsv('title,assignee,internal_owners\nH,Takahashi@Example.com,田中\n')
    const plan = planTaskImport(makeInput(rows))
    expect(plan.errors).toEqual([])
    expect(plan.tasks[0].assigneeId).toBe('u-taka')
    expect(plan.tasks[0].internalOwnerIds).toEqual(['u-tanaka'])
  })

  it('見つからない人・同名が複数いる人はエラー', () => {
    const { rows } = parseTaskImportCsv('title,assignee\nI,佐藤\nJ,宮田\n')
    const plan = planTaskImport(makeInput(rows))
    expect(plan.errors).toEqual([
      { line: 2, title: 'I', message: expect.stringMatching(/佐藤/) },
      { line: 3, title: 'J', message: expect.stringMatching(/宮田.*複数/) },
    ])
    expect(plan.tasks).toEqual([])
  })

  it('ball=client なのに相手先担当が居ない行はエラー', () => {
    const { rows } = parseTaskImportCsv('title,ball\nK,client\n')
    const plan = planTaskImport(makeInput(rows))
    expect(plan.errors[0].message).toMatch(/client_owners/)
  })

  it('同じタイトルのタスクがスペースに既にあれば作らずスキップする', () => {
    const { rows } = parseTaskImportCsv('title\nL\nM\n')
    const plan = planTaskImport(makeInput(rows, { existingTasks: new Map([['L', 't-existing']]) }))
    expect(plan.skipped).toEqual([{ line: 2, title: 'L', reason: expect.stringMatching(/既に/) }])
    expect(plan.tasks.map((t) => t.title)).toEqual(['M'])
  })

  it('CSV内でタイトルが重複したら後の行をエラーにする', () => {
    const { rows } = parseTaskImportCsv('title\nN\nN\n')
    const plan = planTaskImport(makeInput(rows))
    expect(plan.errors).toEqual([{ line: 3, title: 'N', message: expect.stringMatching(/重複/) }])
  })

  it('親タスク: CSV内の行→その行 / 既存タスク→既存id / どちらにも無い→自動で親を作る', () => {
    const { rows } = parseTaskImportCsv(csv(
      'P-root,,,,,,,,,,,,,',
      'child1,,,,,,,,,,,P-root,,',
      'child2,,,,,,,,,,,既存親,,',
      'child3,,,,,deliverable,,,,,,新しい大項目,,',
      'child4,,,,,,,,,,,新しい大項目,,',
    ))
    const plan = planTaskImport(makeInput(rows, { existingTasks: new Map([['既存親', 't-parent']]) }))
    expect(plan.errors).toEqual([])
    const byTitle = Object.fromEntries(plan.tasks.map((t) => [t.title, t]))
    expect(byTitle['child1'].parentId).toBe(byTitle['P-root'].id)
    expect(byTitle['child2'].parentId).toBe('t-parent')
    const auto = byTitle['新しい大項目']
    expect(auto).toMatchObject({ autoParent: true, line: null, status: 'todo', clientScope: 'deliverable' })
    expect(byTitle['child3'].parentId).toBe(auto.id)
    expect(byTitle['child4'].parentId).toBe(auto.id)
    expect(plan.autoParents).toEqual([auto.title])
    // 親→子の順（depth 昇順）に並ぶ
    const depths = plan.tasks.map((t) => t.depth)
    expect(depths).toEqual([...depths].sort((a, b) => a - b))
    expect(byTitle['child1'].depth).toBe(1)
  })

  it('親がスキップ（既存）された行の子は、その既存タスクに繋ぐ', () => {
    const { rows } = parseTaskImportCsv(csv(
      'Q-root,,,,,,,,,,,,,',
      'q-child,,,,,,,,,,,Q-root,,',
    ))
    const plan = planTaskImport(makeInput(rows, { existingTasks: new Map([['Q-root', 't-q']]) }))
    expect(plan.tasks).toHaveLength(1)
    expect(plan.tasks[0].parentId).toBe('t-q')
  })

  it('親子の循環と自分自身を親にする行はエラー', () => {
    const { rows } = parseTaskImportCsv(csv(
      'R1,,,,,,,,,,,R2,,',
      'R2,,,,,,,,,,,R1,,',
      'R3,,,,,,,,,,,R3,,',
    ))
    const plan = planTaskImport(makeInput(rows))
    expect(plan.errors.map((e) => e.title).sort()).toEqual(['R1', 'R2', 'R3'])
  })

  it('階層が10段を超える行はエラー', () => {
    const lines = ['T0,,,,,,,,,,,,,']
    for (let i = 1; i <= 11; i++) lines.push(`T${i},,,,,,,,,,,T${i - 1},,`)
    const { rows } = parseTaskImportCsv(csv(...lines))
    const plan = planTaskImport(makeInput(rows))
    expect(plan.errors).toEqual([{ line: 13, title: 'T11', message: expect.stringMatching(/10/) }])
  })

  it('マイルストーンは名前で解決する', () => {
    const { rows } = parseTaskImportCsv('title,milestone\nU,フェーズ1\n')
    const plan = planTaskImport(makeInput(rows))
    expect(plan.errors).toEqual([])
    expect(plan.tasks[0].milestoneId).toBe('m-1')
  })

  it('無いマイルストーンはエラーにし、1件でもエラーがあれば作成対象を空にする（全か無か）', () => {
    const { rows } = parseTaskImportCsv('title,milestone\nU,フェーズ1\nV,フェーズ9\n')
    const plan = planTaskImport(makeInput(rows))
    expect(plan.errors).toEqual([{ line: 3, title: 'V', message: expect.stringMatching(/フェーズ9/) }])
    expect(plan.tasks).toEqual([])
  })
})
