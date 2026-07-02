export const meta = {
  name: 'review-changes',
  description: '現在の差分を多観点でレビューし、各指摘を検証してから返す（観点ごとにモデルを振り分け）',
  whenToUse: 'PR前・コミット前に差分をまとめてレビューしたいとき。機械検査はHaiku、コード判断はOpus、重大設計はメイン(Fable)へエスカレーション。',
  phases: [
    { title: 'Collect', detail: '差分と対象ファイルを機械的に収集', model: 'haiku' },
    { title: 'Review', detail: '観点ごとに並列レビュー（設計/UI/機械検査）' },
    { title: 'Verify', detail: '各指摘を敵対的に検証（Opus）', model: 'opus' },
    { title: 'Synthesize', detail: '確定指摘の統合とエスカレーション判定（Opus）', model: 'opus' },
  ],
}

// 1) 収集: 差分を機械的に集める（Haiku）
phase('Collect')
const diff = await agent(
  '`git diff` と `git diff --stat`（対象ブランチ）を実行し、変更ファイル一覧と各ファイルの変更概要（追加/削除行・変更の意図の推測なし・事実のみ）を返す。判断はしない。',
  { label: 'collect:diff', phase: 'Collect', effort: 'low', schema: {
    type: 'object',
    properties: {
      files: { type: 'array', items: { type: 'object', properties: {
        path: { type: 'string' }, added: { type: 'number' }, removed: { type: 'number' },
      }, required: ['path'] } },
      summary: { type: 'string' },
    }, required: ['files'],
  } }
)

const uiFiles = (diff?.files || []).map(f => f.path).filter(p => /\.(tsx|css)$/.test(p) || /components|app\//.test(p))

// 2) レビュー: 観点ごとに並列。モデルは各エージェント定義に従う（自動振り分け）
phase('Review')
const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: { type: 'object', properties: {
      severity: { type: 'string' }, file: { type: 'string' }, line: { type: 'number' },
      problem: { type: 'string' }, suggestion: { type: 'string' },
      needsFable: { type: 'boolean', description: '型なし×失敗コスト大×全体俯瞰の設計判断が必要か' },
    }, required: ['severity', 'file', 'problem'] } },
  }, required: ['findings'],
}

const reviews = await parallel([
  // コード判断（Opus）: code-reviewer 定義に従う
  () => agent(
    '現在の git 差分をレビューせよ。正しさ→セキュリティ→効率→保守性の順。TaskApp固有ルール（toISOString禁止・RLS・ball/origin/type整合）も見る。重大セキュリティ/新規RLS設計に触れる懸念は needsFable=true にする。',
    { agentType: 'code-reviewer', label: 'review:code', phase: 'Review', schema: FINDINGS_SCHEMA }
  ),
  // UI準拠（Haiku）: design-system-checker 定義に従う
  () => uiFiles.length
    ? agent(
        `次のUI差分ファイルがデザインシステムに準拠しているか検査せよ: ${uiFiles.join(', ')}。違反を findings に列挙（needsFable は常に false）。`,
        { agentType: 'design-system-checker', label: 'review:design-system', phase: 'Review', schema: FINDINGS_SCHEMA }
      )
    : Promise.resolve({ findings: [] }),
  // 機械検査（Haiku）: lint/test 結果の解釈
  () => agent(
    '`npm run lint` と `npm test -- --run`（またはtest:run）を実行し、失敗・警告を findings として機械的に列挙する。原因の推測や修正はしない。needsFable は false。',
    { label: 'review:lint-test', phase: 'Review', model: 'haiku', effort: 'low', schema: FINDINGS_SCHEMA }
  ),
]).then(rs => rs.filter(Boolean).flatMap(r => r.findings || []))

// 3) 検証: 各指摘を敵対的に検証（Opus）。0件なら検証スキップ
phase('Verify')
if (reviews.length === 0) {
  log('指摘なし。検証をスキップします。')
  return { confirmed: [], escalate: [], note: 'no findings' }
}

const verified = await parallel(reviews.map(f => () =>
  agent(
    `次の指摘が本当に問題か、反証を試みて検証せよ。曖昧なら real=false 寄りに倒す。\n指摘: ${JSON.stringify(f)}`,
    { label: `verify:${f.file}`, phase: 'Verify', model: 'opus', schema: {
      type: 'object', properties: { real: { type: 'boolean' }, reason: { type: 'string' } }, required: ['real'],
    } }
  ).then(v => ({ ...f, verdict: v }))
))

// 4) 統合（Opus）
phase('Synthesize')
const confirmed = verified.filter(Boolean).filter(f => f.verdict?.real)
const escalate = confirmed.filter(f => f.needsFable)
log(`確定指摘 ${confirmed.length} 件 / うち Fable エスカレーション ${escalate.length} 件`)
return { confirmed, escalate }
