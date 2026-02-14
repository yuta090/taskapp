/**
 * コンサルティング プリセット
 * 調査レポート, 提案資料, 議事録テンプレート
 */

import type { PresetDefinition, PresetWikiPage } from '../index'
import type { SpecPageRef } from '@/lib/wiki/defaultTemplate'

function generateResearchBody(): string {
  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '調査レポート' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '調査結果と分析をここに記載してください。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '調査概要' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '調査目的: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '調査方法: ', styles: { bold: true } }, { type: 'text', text: '（インタビュー / アンケート / データ分析 等）' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '調査期間: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '主な発見' }] },
    { type: 'numberedListItem', content: [{ type: 'text', text: '（発見1）' }] },
    { type: 'numberedListItem', content: [{ type: 'text', text: '（発見2）' }] },
    { type: 'numberedListItem', content: [{ type: 'text', text: '（発見3）' }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: 'データ・エビデンス' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '定量データやグラフをここに添付してください。', styles: { italic: true, textColor: 'gray' } }] },
  ])
}

function generateProposalBody(): string {
  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '提案資料' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'クライアントへの提案内容をまとめてください。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '課題整理' }] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: '課題', styles: { bold: true } }], [{ type: 'text', text: '影響度', styles: { bold: true } }], [{ type: 'text', text: '緊急度', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: '' }], [{ type: 'text', text: '高/中/低' }], [{ type: 'text', text: '高/中/低' }]] },
    ] } },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '提案内容' }] },
    { type: 'numberedListItem', content: [{ type: 'text', text: '施策1: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'numberedListItem', content: [{ type: 'text', text: '施策2: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '期待効果' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '（定量的な効果を記載）' }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: 'スケジュール・費用' }] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: 'フェーズ', styles: { bold: true } }], [{ type: 'text', text: '期間', styles: { bold: true } }], [{ type: 'text', text: '概算費用', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
    ] } },
  ])
}

function generateMeetingTemplateBody(): string {
  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '議事録テンプレート' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'このテンプレートをコピーして各会議の議事録を作成してください。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '会議情報' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '日時: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '参加者: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '議題: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '議論内容' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '（議論の要約を記載）' }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '決定事項' }] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: '決定内容', styles: { bold: true } }], [{ type: 'text', text: '担当', styles: { bold: true } }], [{ type: 'text', text: '期限', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
    ] } },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: 'Next Action' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '（次のアクションを記載）' }] },
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
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'コンサルティングプロジェクト' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: 'クライアント: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: 'テーマ: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '期間: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: 'ゴール: ', styles: { bold: true } }, { type: 'text', text: '' }] },
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
  { title: '調査レポート', tags: ['コンサル', '調査', 'テンプレート'], generateBody: () => generateResearchBody() },
  { title: '提案資料', tags: ['コンサル', '提案', 'テンプレート'], generateBody: () => generateProposalBody() },
  { title: '議事録テンプレート', tags: ['コンサル', '議事録', 'テンプレート'], generateBody: () => generateMeetingTemplateBody() },
  { title: 'プロジェクトホーム', tags: ['ホーム', 'テンプレート'], generateBody: generateHomeBody, isHome: true },
]

export const consultingPreset: PresetDefinition = {
  genre: 'consulting',
  label: 'コンサルティング',
  description: '調査・提案・議事録の標準構成',
  icon: 'Briefcase',
  wikiPages,
  milestones: [
    { name: '現状分析', orderKey: 1 },
    { name: '課題整理', orderKey: 2 },
    { name: '提案', orderKey: 3 },
    { name: '実行支援', orderKey: 4 },
    { name: '効果測定', orderKey: 5 },
  ],
  recommendedIntegrations: ['google_calendar', 'slack'],
  defaultSettings: { ownerFieldEnabled: true },
}
