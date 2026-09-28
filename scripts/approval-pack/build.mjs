/**
 * 稟議パックの資料4点を作り直す。
 *
 *   npm run build:approval-pack
 *
 * 数字はすべて src/lib/pricing/facts.json（正本）から読む。ここに数字を直接書かない。
 * 作ったあと public/docs/manifest.json に「どの数字で作ったか」を残す。
 * テスト（src/__tests__/lib/pricing/pricing-facts.test.ts）が正本と manifest を突き合わせるので、
 * 正本を直して作り直さないと落ちる。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FACTS = JSON.parse(readFileSync(path.join(ROOT, 'src/lib/pricing/facts.json'), 'utf8'))
const OUT = path.join(ROOT, 'public/docs')
const TMP = path.join(ROOT, '.approval-pack-tmp')
mkdirSync(OUT, { recursive: true })
mkdirSync(TMP, { recursive: true })

const yen = (v) => (v === null ? '個別見積り' : `¥${v.toLocaleString('ja-JP')}`)
const lim = (v, u) => (v === null ? '無制限' : `${v.toLocaleString('ja-JP')}${u}`)
const A = FACTS.competitorA
const P = FACTS.agentpm

/* ── 共通の見た目 ── */
const CSS = readFileSync(path.join(ROOT, 'scripts/approval-pack/print.css'), 'utf8')

const mark = (v) => {
  if (!v) return ''
  const sym = v[0]
  const rest = v.slice(1).trim()
  const cls = { '◎': 'mark-o', '○': 'mark-c', '△': 'mark-t', '×': 'mark-x' }[sym] || ''
  return `<span class="${cls}">${sym}</span>${rest ? `<span class="sub"> ${rest}</span>` : ''}`
}
const table = (cols, rows) => {
  const head = `<tr><th style="width:31%">機能</th>${cols
    .map((c, i) => `<th class="c${i === 0 ? ' own' : ''}">${c}</th>`)
    .join('')}</tr>`
  const body = rows
    .map(([label, vals]) =>
      `<tr><td>${label}</td>${vals.map((v, i) => `<td class="c${i === 0 ? ' own' : ''}">${mark(v)}</td>`).join('')}</tr>`)
    .join('')
  return `<table>${head}${body}</table>`
}

/* ── 1. 比較表 ── */
const PM_COLS = ['AgentPM', 'A社', 'B社', 'C社', 'D社', 'E社']
const PM_ROWS = [
  ['相手先専用の画面がある', ['◎', '×', '×', '△ 共有リンクのみ', '△ 公開ページのみ', '○ 英語のみ']],
  ['相手先は何人招いても無料', ['◎', '○ 人数無制限プラン', '× 1人ごと', '× 1人ごと', '× 1人ごと', '× 1人ごと']],
  ['承認はメールから1クリック', ['◎', '×', '×', '×', '×', '△']],
  ['ボール管理（次に動く人）', ['◎', '×', '×', '×', '×', '△']],
  ['見積もり→承認→請求', ['◎', '×', '×', '×', '×', '○']],
  ['代理店モード（原価と売値を分ける）', ['◎', '×', '×', '×', '×', '△']],
  ['仕様書・議事録・証跡が同じ場所', ['◎', '△ 別の場所', '△ 別の製品', '△ 文書機能のみ', '◎', '△']],
  ['チャットの会話から自動でタスク化', ['◎', '×', '×', '△ 手動で登録', '○ チャット・メール', '×']],
  ['ガント・バーンダウン', ['◎', '○ 上位プラン', '○', '△ ロードマップ', '△', '○']],
  ['日本語のUIと国内サポート', ['◎', '◎', '△ 翻訳ベース', '× 英語のみ', '○', '× 英語のみ']],
  ['AIから直接操作（MCP・CLI）', ['○', '○', '◎', '◎', '◎', '×']],
  ['人数が増えても定額', [`○ ${lim(P.pro.maxMembers, '名')}まで`, '◎ 人数無制限', '× 1人ごと', '× 1人ごと', '× 1人ごと', '× 1人ごと']],
  ['SSO/SAML・細かい権限管理', ['× 検討中', '○ 上位プラン', '◎', '○', '○', '○']],
]
const CHAT_COLS = ['AgentPM', 'F社', 'G社', 'H社', 'I社']
const CHAT_ROWS = [
  ['相手先とのグループに入れる', ['◎', '○ LINEのみ', '△ 社内中心', '△ 社内中心', '×']],
  ['LINEグループに対応', ['◎', '◎', '×', '×', '×']],
  ['そのほかのチャット（Slack・Teams 等）', ['○', '△ 転送のみ', '◎ 自社内', '◎ 自社内', '○ 一部のみ']],
  ['自社の名前で相手に届く', ['◎ 自社LINE', '× 共通Bot固定', '◎', '◎', '×']],
  ['拾ったタスクが案件の進行に乗る', ['◎', '△ カンバン止まり', '×', '△', '○']],
  ['期限リマインドと完了の確認', ['◎', '△', '×', '×', '△']],
  ['承認と決定事項の証跡', ['◎', '×', '×', '×', '×']],
]

const priceRow = (size, own, ownPlan, now, nowPlan, next, nextPlan) =>
  `<tr><td>${size}</td><td class="c own"><b>${own}</b><span class="sub"> ${ownPlan}</span></td>` +
  `<td class="c">${now}<span class="sub"> ${nowPlan}</span></td>` +
  `<td class="c">${next}<span class="sub"> ${nextPlan}</span></td></tr>`

const compareHtml = `<!doctype html><html lang="ja"><meta charset="utf-8">
<title>AgentPM 比較表</title><style>${CSS}</style>
<div class="brand"><b>AgentPM</b><span>比較表 ／ ${FACTS.asOf.replace('-', '年')}月時点</span></div>
<h1>ツール比較表</h1>
<p class="lead">受託・制作・代理店など、相手先がいる仕事で必要になる機能で比べました。社名は伏せています（各社の許諾を取っていないため）。</p>
<p class="legend">◎ 特に優れている　○ 対応　△ 一部対応　× 非対応</p>
<h2>プロジェクト管理ツールと比べる</h2>${table(PM_COLS, PM_ROWS)}
<h2>チャット連携のツールと比べる</h2>
<p class="note" style="margin-bottom:2mm">上の表とは別の製品なので、記号もF社から改めています。G社・H社・I社は、自社で使っているチャットの中だけで動きます。相手先が同じツールを使っていなければ届きません。</p>
${table(CHAT_COLS, CHAT_ROWS)}
<h2>月額の比較（${FACTS.taxNote}）</h2>
<table>
<tr><th style="width:28%">チーム規模</th><th class="c own">AgentPM</th><th class="c">A社（現行）</th><th class="c">A社（${A.from2027.effectiveFrom.slice(0, 4)}年1月〜）</th></tr>
${priceRow(`${P.free.maxMembers}名 / ${P.free.maxProjects}プロジェクト`, yen(P.free.monthlyYen), P.free.label, yen(A.current.cheapest.monthlyYen), A.current.cheapest.label, yen(A.from2027.cheapest.monthlyYen), A.from2027.cheapest.label)}
${priceRow('10名 / 20プロジェクト', yen(P.pro.monthlyYen), P.pro.label, yen(A.current.standard.monthlyYen), A.current.standard.label, yen(A.from2027.cheapest.monthlyYen), A.from2027.cheapest.label)}
${priceRow(`${P.pro.maxMembers}名 / ${P.pro.maxProjects}プロジェクト`, yen(P.pro.monthlyYen), P.pro.label, yen(A.current.standard.monthlyYen), A.current.standard.label, yen(A.from2027.standard.monthlyYen), A.from2027.standard.label)}
${priceRow('50名以上', yen(P.enterprise.monthlyYen), P.enterprise.label, yen(A.current.standard.monthlyYen), A.current.standard.label, yen(A.from2027.standard.monthlyYen), A.from2027.standard.label)}
</table>
<p class="note">50名を超えるチームなら、${A.from2027.effectiveFrom.slice(0, 4)}年の改定前まではA社の標準プラン（${yen(A.current.standard.monthlyYen)}・人数無制限）のほうが安く済みます。AgentPMが有利になるのは${P.pro.maxMembers}名までか、改定後です。</p>
<p class="note">AgentPM ${P.pro.label} は${lim(P.pro.maxMembers, '名')}・${lim(P.pro.maxProjects, 'プロジェクト')}まで。相手先（クライアント）の人数は、どのプランでも料金に影響しません。</p>
<div class="foot">${FACTS.asOf.replace('-', '年')}月時点、各社公式サイトの公開情報に基づく当社調べです。各社の価格・条件は変更される場合があります。最新は agentpm.app/compare をご覧ください。<br>株式会社ソレカラ ／ support@agentpm.app</div></html>`

/* ── 2. セキュリティチェックシート ── */
const SEC = JSON.parse(readFileSync(path.join(ROOT, 'scripts/approval-pack/security.json'), 'utf8'))
const STYLE = { 対応: 'mark-o', 検討中: 'mark-t', 未取得: 'mark-x' }
const secBody = SEC.sections
  .map(
    (s) =>
      `<h2>${s.title}</h2><table><tr><th style="width:28%">項目</th><th class="c" style="width:12%">状況</th><th>内容</th></tr>` +
      s.items.map((i) => `<tr><td>${i.name}</td><td class="c"><span class="${STYLE[i.status]}">${i.status}</span></td><td>${i.desc}</td></tr>`).join('') +
      `</table>`,
  )
  .join('')
const securityHtml = `<!doctype html><html lang="ja"><meta charset="utf-8">
<title>AgentPM セキュリティチェックシート</title><style>${CSS}</style>
<div class="brand"><b>AgentPM</b><span>セキュリティチェックシート ／ ${FACTS.asOf.replace('-', '年')}月時点</span></div>
<h1>セキュリティ対応状況</h1>
<p class="lead">情報システム部門・総務部門のご確認用にまとめました。すでに動いているものと、これから対応するものを分けて記載しています。未対応の項目は「検討中」「未取得」と明記し、時期はお約束していません。</p>
${secBody}
<div class="foot">本書は${FACTS.asOf.replace('-', '年')}月時点の実装状況です。内容は変更される場合があります。<br>ご不明な点、貴社の様式での回答が必要な場合はお問い合わせください。<br>株式会社ソレカラ ／ support@agentpm.app ／ agentpm.app/security</div></html>`

writeFileSync(path.join(TMP, 'compare.html'), compareHtml)
writeFileSync(path.join(TMP, 'security.html'), securityHtml)

/* ── PDF に変換 ── */
const browser = await chromium.launch()
const page = await browser.newPage()
for (const [src, dest] of [['compare', 'agentpm-comparison.pdf'], ['security', 'agentpm-security.pdf']]) {
  await page.goto(`file://${path.join(TMP, `${src}.html`)}`, { waitUntil: 'networkidle' })
  await page.pdf({
    path: path.join(OUT, dest),
    format: 'A4',
    printBackground: true,
    margin: { top: '16mm', right: '14mm', bottom: '14mm', left: '14mm' },
  })
  console.log(`  ${dest}`)
}
await browser.close()

/* ── Excel 2点（openpyxl。正本を引数で渡す） ── */
execFileSync('python3', [path.join(ROOT, 'scripts/approval-pack/build_xlsx.py'), ROOT], { stdio: 'inherit' })

/* ── どの数字で作ったかを残す ── */
const manifest = {
  _readme: 'build:approval-pack が書き出す。手で編集しない。テストが facts.json と突き合わせる。',
  generatedFrom: 'src/lib/pricing/facts.json',
  asOf: FACTS.asOf,
  numbers: {
    proMonthlyYen: P.pro.monthlyYen,
    proMaxMembers: P.pro.maxMembers,
    proMaxProjects: P.pro.maxProjects,
    freeMaxMembers: P.free.maxMembers,
    freeMaxProjects: P.free.maxProjects,
    aCurrentCheapest: A.current.cheapest.monthlyYen,
    aCurrentStandard: A.current.standard.monthlyYen,
    aNextCheapest: A.from2027.cheapest.monthlyYen,
    aNextStandard: A.from2027.standard.monthlyYen,
    tcoHourlyYen: FACTS.tco.hourlyYen,
    tcoProjects: FACTS.tco.projects,
    tcoReductionRate: FACTS.tco.reductionRate,
  },
  files: ['agentpm-comparison.pdf', 'agentpm-security.pdf', 'agentpm-roi.xlsx', 'agentpm-migration-plan.xlsx'],
}
writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log('  manifest.json')
console.log('稟議パックを作り直しました。')
