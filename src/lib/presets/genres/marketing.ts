/**
 * マーケティング プリセット
 * キャンペーン計画, KPI管理, コンテンツカレンダー
 */

import type { PresetDefinition, PresetWikiPage } from '../index'
import type { SpecPageRef } from '@/lib/wiki/defaultTemplate'

function generateCampaignBody(): string {
  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'キャンペーン計画' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'キャンペーンの企画内容をまとめてください。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '概要' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: 'キャンペーン名: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '目的: ', styles: { bold: true } }, { type: 'text', text: '（認知向上 / リード獲得 / CV促進 等）' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: 'ターゲット: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '実施期間: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '予算: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: 'チャネル' }] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: 'チャネル', styles: { bold: true } }], [{ type: 'text', text: '施策', styles: { bold: true } }], [{ type: 'text', text: '予算配分', styles: { bold: true } }], [{ type: 'text', text: '担当', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: 'Web広告' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: 'SNS' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: 'メール' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
    ] } },
  ])
}

function generateKpiBody(): string {
  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'KPI管理' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '目標と実績を管理してください。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: 'KPI一覧' }] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: '指標', styles: { bold: true } }], [{ type: 'text', text: '目標', styles: { bold: true } }], [{ type: 'text', text: '実績', styles: { bold: true } }], [{ type: 'text', text: '達成率', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: 'PV' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: 'CV数' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: 'CPA' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: 'ROAS' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
    ] } },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '週次レポート' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '週ごとの進捗をここに追記してください。', styles: { italic: true, textColor: 'gray' } }] },
  ])
}

function generateContentCalendarBody(): string {
  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'コンテンツカレンダー' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'コンテンツの公開スケジュールを管理してください。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'paragraph', content: [] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: '公開日', styles: { bold: true } }], [{ type: 'text', text: 'タイトル', styles: { bold: true } }], [{ type: 'text', text: 'チャネル', styles: { bold: true } }], [{ type: 'text', text: 'ステータス', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: 'ブログ / SNS / メール' }], [{ type: 'text', text: '企画 / 制作中 / 公開済み' }]] },
    ] } },
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
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'マーケティングプロジェクト' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: 'プロジェクト名: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '期間: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '総予算: ', styles: { bold: true } }, { type: 'text', text: '' }] },
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
  { title: 'キャンペーン計画', tags: ['マーケ', '計画', 'テンプレート'], generateBody: () => generateCampaignBody() },
  { title: 'KPI管理', tags: ['マーケ', 'KPI', 'テンプレート'], generateBody: () => generateKpiBody() },
  { title: 'コンテンツカレンダー', tags: ['マーケ', 'コンテンツ', 'テンプレート'], generateBody: () => generateContentCalendarBody() },
  { title: 'プロジェクトホーム', tags: ['ホーム', 'テンプレート'], generateBody: generateHomeBody, isHome: true },
]

export const marketingPreset: PresetDefinition = {
  genre: 'marketing',
  label: 'マーケティング',
  description: 'キャンペーン企画・KPI・コンテンツ管理',
  icon: 'Megaphone',
  wikiPages,
  milestones: [
    { name: '企画', orderKey: 1 },
    { name: '制作', orderKey: 2 },
    { name: '実施', orderKey: 3 },
    { name: '分析', orderKey: 4 },
    { name: '改善', orderKey: 5 },
  ],
  recommendedIntegrations: ['slack'],
  defaultSettings: { ownerFieldEnabled: null },
}
