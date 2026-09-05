/**
 * 新規事業・サービス立ち上げ プリセット
 * 事業仮説シート, 商品・提供条件シート, 販売準備チェックリスト, 事業開始判定
 *
 * 既存ジャンルは「受けた仕事を納める」型（要件→制作→納品）。こちらは「売り物を作って、
 * 売れるかを決める」型で、ニーズ検証→商品化→販売準備→提案・受注→初回提供→事業開始判定と進む。
 * セミナー・研修・コンサル商材は提供形式の違いであり進行構造は同じなので、1つのジャンルにまとめる
 * （2026-09-06 判断。固有タスクが半数を超えるようになったら派生を検討する）。
 */

import type { PresetDefinition, PresetWikiPage, PresetSampleTask } from '../index'
import type { SpecPageRef } from '@/lib/wiki/defaultTemplate'

function generateHypothesisBody(): string {
  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '事業仮説シート' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '「誰の・どんな困りごとを・何で解決して・いくらで売るか」を1枚にまとめます。検証で分かったことがあれば上書きしてください。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '対象顧客' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '業種・規模: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '決裁者・窓口: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '優先セグメント: ', styles: { bold: true } }, { type: 'text', text: '（例: 県内 / 従業員50名以上 / 既存接点あり）' }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '解決する課題' }] },
    { type: 'numberedListItem', content: [{ type: 'text', text: '（課題1）' }] },
    { type: 'numberedListItem', content: [{ type: 'text', text: '（課題2）' }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '提供するもの' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '提供形式: ', styles: { bold: true } }, { type: 'text', text: '（セミナー / 研修 / コンサルティング / 導入支援 / ツール）' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '相手が得る結果: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '検証したい仮説' }] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: '仮説', styles: { bold: true } }], [{ type: 'text', text: '確かめ方', styles: { bold: true } }], [{ type: 'text', text: '結果', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: '（例: 個別相談に進む率が20%以上）' }], [{ type: 'text', text: '（例: セミナー参加者アンケート）' }], [{ type: 'text', text: '' }]] },
    ] } },
  ])
}

function generateOfferBody(): string {
  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '商品・提供条件シート' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '売り物の中身と条件を確定させるページです。相手先に見せる前提で書き、決まっていない欄は「未決」と明記してください。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '商品一覧' }] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: '商品ID', styles: { bold: true } }], [{ type: 'text', text: '名前', styles: { bold: true } }], [{ type: 'text', text: '提供形式', styles: { bold: true } }], [{ type: 'text', text: '価格', styles: { bold: true } }], [{ type: 'text', text: '状態', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: 'P01' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '確定 / 未決' }]] },
    ] } },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '標準で含むもの・含まないもの' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '含む: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '含まない（別見積）: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '導入条件' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '前提（相手側に必要なもの）: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '期間・体制: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '契約・法務（知財・保守・データの持ち主）: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '使える助成金・補助金: ', styles: { bold: true } }, { type: 'text', text: '' }] },
  ])
}

function generateSalesReadinessBody(): string {
  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '販売準備チェックリスト' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '「集客 → 相談 → 提案 → 受注 → 提供開始」の各段で、無いと止まるものを揃えます。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '集客' }] },
    { type: 'checkListItem', props: { checked: false }, content: [{ type: 'text', text: '対象リスト（誰に案内するか）' }] },
    { type: 'checkListItem', props: { checked: false }, content: [{ type: 'text', text: '案内文・申込フォーム' }] },
    { type: 'checkListItem', props: { checked: false }, content: [{ type: 'text', text: 'セミナー/説明会の日程と会場・配信' }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '相談・提案' }] },
    { type: 'checkListItem', props: { checked: false }, content: [{ type: 'text', text: 'ヒアリング項目（相談で必ず聞くこと）' }] },
    { type: 'checkListItem', props: { checked: false }, content: [{ type: 'text', text: '提案書・見積の雛形' }] },
    { type: 'checkListItem', props: { checked: false }, content: [{ type: 'text', text: '顧客ステータスの定義（相談予定 / 提案中 / 受注 / 保留 など）' }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '受注・提供開始' }] },
    { type: 'checkListItem', props: { checked: false }, content: [{ type: 'text', text: '契約書雛形（法務確認済み）' }] },
    { type: 'checkListItem', props: { checked: false }, content: [{ type: 'text', text: '請求・入金確認の手順' }] },
    { type: 'checkListItem', props: { checked: false }, content: [{ type: 'text', text: 'キックオフまでの通しリハーサル' }] },
  ])
}

function generateGoNoGoBody(): string {
  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '事業開始判定' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '「本格的に始める / 形を変えて続ける / やめる」を決めるページです。判定基準は検証を始める前に決めておきます。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '判定基準（事前に決める）' }] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: '指標', styles: { bold: true } }], [{ type: 'text', text: '目標', styles: { bold: true } }], [{ type: 'text', text: '実績', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: '（例: 初回受注件数）' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: '（例: 1件あたり粗利）' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
    ] } },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '検証で分かったこと' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '（事実と数字で書く）' }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '判定' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '結論: ', styles: { bold: true } }, { type: 'text', text: '本格開始 / 修正して継続 / 中止' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '判定日・判定者: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '次に決めること: ', styles: { bold: true } }, { type: 'text', text: '' }] },
  ])
}

function generateHomeBody(orgId: string, spaceId: string, specPages?: SpecPageRef[]): string {
  const basePath = `/${orgId}/project/${spaceId}`
  const wikiPath = `${basePath}/wiki`

  const specBlocks = specPages && specPages.length > 0
    ? specPages.map(spec => ({
        type: 'bulletListItem',
        content: [{ type: 'link', href: `${wikiPath}?page=${spec.id}`, content: [{ type: 'text', text: spec.title }] }],
      }))
    : [{ type: 'bulletListItem', content: [{ type: 'text', text: '（ドキュメントリンク未設定）' }] }]

  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '新規事業・サービス立ち上げ' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '相手先: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '売り物（一言で）: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '対象顧客: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '事業開始判定の予定日: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'ドキュメント' }] },
    ...specBlocks,
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '関連ページ' }] },
    { type: 'bulletListItem', content: [{ type: 'link', href: basePath, content: [{ type: 'text', text: 'タスク一覧' }] }] },
    { type: 'bulletListItem', content: [{ type: 'link', href: `${basePath}/meetings`, content: [{ type: 'text', text: '議事録' }] }] },
  ])
}

const wikiPages: PresetWikiPage[] = [
  { title: '事業仮説シート', tags: ['新規事業', '仮説', 'テンプレート'], generateBody: () => generateHypothesisBody() },
  { title: '商品・提供条件シート', tags: ['新規事業', '商品化', 'テンプレート'], generateBody: () => generateOfferBody() },
  { title: '販売準備チェックリスト', tags: ['新規事業', '販売準備', 'テンプレート'], generateBody: () => generateSalesReadinessBody() },
  { title: '事業開始判定', tags: ['新規事業', '判定', 'テンプレート'], generateBody: () => generateGoNoGoBody() },
  { title: 'プロジェクトホーム', tags: ['ホーム', 'テンプレート'], generateBody: generateHomeBody, isHome: true },
]

const sampleTasks: PresetSampleTask[] = [
  {
    title: '対象顧客と解決する課題のご確認',
    description:
      'これはサンプルタスクです。自由に編集・削除できます。\n\n事業仮説シートの「対象顧客」「解決する課題」を相手先に確認してもらう段です。ボール（担当）を相手先に渡すと、一覧にアンバー色の「クライアント確認待ち」表示が出ます。タスクを開いてボールを社内に戻す操作を試してみてください。',
    ball: 'client',
    status: 'in_progress',
    clientScope: 'deliverable',
    milestoneName: '仮説設計',
  },
  {
    title: '検証セミナー／ヒアリングの実施計画',
    description:
      'これはサンプルタスクです。自由に編集・削除できます。\n\n期限日とマイルストーンが設定されています。ステータスを変更すると保存ボタンなしでその場に反映されます（楽観的更新）。ガントチャートでの表示も確認してみてください。',
    ball: 'internal',
    status: 'todo',
    clientScope: 'internal',
    milestoneName: '顧客検証',
    dueInDays: 7,
  },
  {
    title: '価格・提供範囲・導入条件の整理',
    description:
      'これはサンプルタスクです。自由に編集・削除できます。\n\nまだ着手前のタスクです。商品・提供条件シートの「未決」欄を埋める作業です。ステータスのアイコンをクリックして「進行中」に変更する操作を試してみてください。',
    ball: 'internal',
    status: 'backlog',
    clientScope: 'internal',
    milestoneName: '商品化',
  },
  {
    title: '事業開始判定の基準を決める',
    description:
      'これはサンプルタスクです。自由に編集・削除できます。\n\n「いくつ受注できたら本格開始か」を検証の前に決めておくタスクです。タスクをクリックしてインスペクターを開き、担当者や説明文を編集する操作を試してみてください。',
    ball: 'internal',
    status: 'backlog',
    clientScope: 'internal',
    milestoneName: '事業開始判定',
  },
]

export const newBusinessPreset: PresetDefinition = {
  genre: 'new_business',
  label: '新規事業・サービス立ち上げ',
  description: 'セミナー・研修・コンサル商材などを検証し、商品化から販売・初回提供までを進める',
  icon: 'RocketLaunch',
  wikiPages,
  milestones: [
    { name: '仮説設計', orderKey: 1 },
    { name: '顧客検証', orderKey: 2 },
    { name: '商品化', orderKey: 3 },
    { name: '販売準備', orderKey: 4 },
    { name: '提案・受注', orderKey: 5 },
    { name: '初回提供', orderKey: 6 },
    { name: '事業開始判定', orderKey: 7 },
  ],
  sampleTasks,
  recommendedIntegrations: ['google_calendar', 'slack', 'video_conference'],
  defaultSettings: { ownerFieldEnabled: true },
}
