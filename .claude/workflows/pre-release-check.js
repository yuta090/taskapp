export const meta = {
  name: 'pre-release-check',
  description: 'リリース/PR前の一括チェック。機械検査・UI準拠・索引同期はHaiku、コードレビューはOpus、重大懸念はメイン(Fable)へエスカレーション',
  whenToUse: 'develop→main のPR前や大きめの変更の締めに、机を整えてから最終判断者(Opus/Fable)に渡すための下ごしらえ一括実行。',
  phases: [
    { title: 'Checks', detail: '機械検査・UI準拠・索引同期・コードレビューを並列' },
    { title: 'Report', detail: '結果統合とメイン切替の要否判定（Opus）', model: 'opus' },
  ],
}

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    findings: { type: 'array', items: { type: 'object', properties: {
      severity: { type: 'string' }, detail: { type: 'string' }, file: { type: 'string' },
      needsFable: { type: 'boolean' },
    }, required: ['detail'] } },
  }, required: ['findings'],
}

phase('Checks')
const [lintTest, designSys, docIndex, codeReview] = await parallel([
  // 機械検査（Haiku）
  () => agent(
    'lint とテストを実行して結果を機械的に報告: `npm run lint`, `npm run test:run`。失敗・警告を findings に列挙。ok は全て緑なら true。判断・修正はしない。',
    { label: 'check:lint-test', phase: 'Checks', model: 'haiku', effort: 'low', schema: FINDINGS_SCHEMA }
  ),
  // UI準拠（Haiku）: design-system-checker
  () => agent(
    '`git diff --name-only` のUIファイル（.tsx/.css, components/app配下）を対象にデザインシステム準拠を検査し、違反を findings に列挙。',
    { agentType: 'design-system-checker', label: 'check:design-system', phase: 'Checks', schema: FINDINGS_SCHEMA }
  ),
  // 索引同期（Haiku）: doc-index-updater（検査のみ、Editせず差分報告）
  () => agent(
    'docs/ の実ファイルと docs/SPEC_INDEX.md の記載の差分（未記載仕様・版数/パス不一致・リンク切れ）を検出して findings に列挙する。この実行では Edit せず差分の報告のみ。',
    { agentType: 'doc-index-updater', label: 'check:doc-index', phase: 'Checks', schema: FINDINGS_SCHEMA }
  ),
  // コードレビュー（Opus）: code-reviewer
  () => agent(
    '現在の git 差分をレビューし、重大な問題を findings に列挙。重大セキュリティ/新規RLS設計に関わるものは needsFable=true。',
    { agentType: 'code-reviewer', label: 'check:code-review', phase: 'Checks', schema: FINDINGS_SCHEMA }
  ),
])

phase('Report')
const groups = { lintTest, designSys, docIndex, codeReview }
const all = Object.values(groups).filter(Boolean).flatMap(g => g.findings || [])
const blocking = all.filter(f => (f.severity || '').toLowerCase().includes('critical') || (f.severity || '').toLowerCase().includes('high'))
const escalate = all.filter(f => f.needsFable)
log(`全指摘 ${all.length} 件 / ブロッキング ${blocking.length} 件 / Fableエスカレーション ${escalate.length} 件`)
return {
  green: all.length === 0,
  blocking,
  escalate,
  byGroup: {
    lintTest: lintTest?.findings?.length || 0,
    designSys: designSys?.findings?.length || 0,
    docIndex: docIndex?.findings?.length || 0,
    codeReview: codeReview?.findings?.length || 0,
  },
}
