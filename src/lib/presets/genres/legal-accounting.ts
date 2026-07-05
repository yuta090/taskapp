/**
 * 士業（法律・会計・税理士）プリセット
 * 契約書チェックリスト, 確認事項一覧, 期日管理表
 */

import type { PresetDefinition, PresetWikiPage, PresetSampleTask } from '../index'
import type { SpecPageRef } from '@/lib/wiki/defaultTemplate'

function generateContractChecklistBody(): string {
  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '契約書チェックリスト' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '契約書の確認項目を管理してください。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '基本情報' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '契約種別: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '当事者: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '契約期間: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '確認項目' }] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: '項目', styles: { bold: true } }], [{ type: 'text', text: '確認者', styles: { bold: true } }], [{ type: 'text', text: 'ステータス', styles: { bold: true } }], [{ type: 'text', text: '備考', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: '契約条件' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '未確認' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: '免責事項' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '未確認' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: '解約条件' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '未確認' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: '秘密保持' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '未確認' }], [{ type: 'text', text: '' }]] },
    ] } },
  ])
}

function generateConfirmationListBody(): string {
  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '確認事項一覧' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'クライアントへの確認事項を管理してください。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'paragraph', content: [] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: '確認事項', styles: { bold: true } }], [{ type: 'text', text: '確認先', styles: { bold: true } }], [{ type: 'text', text: '期限', styles: { bold: true } }], [{ type: 'text', text: '回答', styles: { bold: true } }], [{ type: 'text', text: 'ステータス', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '未回答' }]] },
    ] } },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '確認方法' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '対面 / 電話 / メール / チャット' }] },
  ])
}

function generateDeadlineTableBody(): string {
  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '期日管理表' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '重要な期日を管理してください。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'paragraph', content: [] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: '項目', styles: { bold: true } }], [{ type: 'text', text: '期日', styles: { bold: true } }], [{ type: 'text', text: '担当', styles: { bold: true } }], [{ type: 'text', text: '提出先', styles: { bold: true } }], [{ type: 'text', text: 'ステータス', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '未着手' }]] },
    ] } },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '注意事項' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '法定期限は厳守（遅延不可）', styles: { bold: true } }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '提出前に必ずダブルチェックを実施' }] },
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
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '案件概要' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '依頼者: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '案件種別: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '受任日: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '担当者: ', styles: { bold: true } }, { type: 'text', text: '' }] },
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
  { title: '契約書チェックリスト', tags: ['士業', '契約', 'テンプレート'], generateBody: () => generateContractChecklistBody() },
  { title: '確認事項一覧', tags: ['士業', '確認', 'テンプレート'], generateBody: () => generateConfirmationListBody() },
  { title: '期日管理表', tags: ['士業', '期日', 'テンプレート'], generateBody: () => generateDeadlineTableBody() },
  { title: 'プロジェクトホーム', tags: ['ホーム', 'テンプレート'], generateBody: generateHomeBody, isHome: true },
]

const sampleTasks: PresetSampleTask[] = [
  {
    title: '契約書ドラフトのご確認',
    description:
      'これはサンプルタスクです。自由に編集・削除できます。\n\nボール（担当）をクライアントに渡すと、一覧にアンバー色の「クライアント確認待ち」表示が出ます。タスクを開いてボールを社内に戻す操作を試してみてください。',
    ball: 'client',
    status: 'in_progress',
    clientScope: 'deliverable',
    milestoneName: '書類作成',
  },
  {
    title: '提出書類の最終チェック',
    description:
      'これはサンプルタスクです。自由に編集・削除できます。\n\n期限日とマイルストーンが設定されています。ステータスを変更すると保存ボタンなしでその場に反映されます（楽観的更新）。ガントチャートでの表示も確認してみてください。',
    ball: 'internal',
    status: 'todo',
    clientScope: 'internal',
    milestoneName: '提出',
    dueInDays: 7,
  },
  {
    title: '関連資料の収集',
    description:
      'これはサンプルタスクです。自由に編集・削除できます。\n\nまだ着手前のタスクです。ステータスのアイコンをクリックして「進行中」に変更する操作を試してみてください。',
    ball: 'internal',
    status: 'backlog',
    clientScope: 'internal',
    milestoneName: '調査',
  },
  {
    title: '方針検討メモの作成',
    description:
      'これはサンプルタスクです。自由に編集・削除できます。\n\nタスクをクリックしてインスペクターを開き、担当者や説明文を編集する操作を試してみてください。',
    ball: 'internal',
    status: 'backlog',
    clientScope: 'internal',
    milestoneName: '方針確定',
  },
]

export const legalAccountingPreset: PresetDefinition = {
  genre: 'legal_accounting',
  label: '士業',
  description: '契約書・期日管理・確認事項の標準構成',
  icon: 'Scales',
  wikiPages,
  milestones: [
    { name: '受任', orderKey: 1 },
    { name: '調査', orderKey: 2 },
    { name: '方針確定', orderKey: 3 },
    { name: '書類作成', orderKey: 4 },
    { name: '提出', orderKey: 5 },
    { name: '完了', orderKey: 6 },
  ],
  sampleTasks,
  recommendedIntegrations: ['google_calendar', 'slack'],
  defaultSettings: { ownerFieldEnabled: true },
}
