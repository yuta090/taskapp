/**
 * 建設・建築・内装 プリセット
 * 設計概要, 仕様書, 変更履歴, 検査チェックリスト
 */

import type { PresetDefinition, PresetWikiPage } from '../index'
import type { SpecPageRef } from '@/lib/wiki/defaultTemplate'

function generateDesignOverviewBody(): string {
  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '設計概要' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '建築・設計の基本情報を記載してください。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '基本情報' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '物件名: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '所在地: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '用途: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '構造・規模: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '延床面積: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '関係者' }] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: '役割', styles: { bold: true } }], [{ type: 'text', text: '会社名', styles: { bold: true } }], [{ type: 'text', text: '担当者', styles: { bold: true } }], [{ type: 'text', text: '連絡先', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: '施主' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: '設計' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: '施工' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
    ] } },
  ])
}

function generateSpecDocBody(): string {
  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '仕様書' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '建材・設備の仕様を管理してください。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '主要仕様' }] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: '部位', styles: { bold: true } }], [{ type: 'text', text: '仕様', styles: { bold: true } }], [{ type: 'text', text: 'メーカー/品番', styles: { bold: true } }], [{ type: 'text', text: '承認', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: '外壁' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '未承認' }]] },
      { cells: [[{ type: 'text', text: '内装（床）' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '未承認' }]] },
      { cells: [[{ type: 'text', text: '内装（壁）' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '未承認' }]] },
      { cells: [[{ type: 'text', text: '設備' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '未承認' }]] },
    ] } },
  ])
}

function generateChangeLogBody(): string {
  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '変更履歴' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '設計変更・仕様変更の履歴を記録してください。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'paragraph', content: [] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: '日付', styles: { bold: true } }], [{ type: 'text', text: '変更内容', styles: { bold: true } }], [{ type: 'text', text: '理由', styles: { bold: true } }], [{ type: 'text', text: '承認者', styles: { bold: true } }], [{ type: 'text', text: '費用影響', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
    ] } },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '変更管理ルール' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '施主承認が必要な変更は必ず書面で記録', styles: { bold: true } }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '費用増減がある場合は見積書を添付' }] },
  ])
}

function generateInspectionBody(): string {
  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '検査チェックリスト' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '各フェーズの検査項目を管理してください。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '中間検査' }] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: '検査項目', styles: { bold: true } }], [{ type: 'text', text: '基準', styles: { bold: true } }], [{ type: 'text', text: '結果', styles: { bold: true } }], [{ type: 'text', text: '検査日', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: '基礎' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '未検査' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: '構造躯体' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '未検査' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: '防水' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '未検査' }], [{ type: 'text', text: '' }]] },
    ] } },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '竣工検査' }] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: '検査項目', styles: { bold: true } }], [{ type: 'text', text: '基準', styles: { bold: true } }], [{ type: 'text', text: '結果', styles: { bold: true } }], [{ type: 'text', text: '検査日', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: '外装' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '未検査' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: '内装' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '未検査' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: '設備動作' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '未検査' }], [{ type: 'text', text: '' }]] },
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
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '工事概要' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '物件名: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '施主: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '工期: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '施工会社: ', styles: { bold: true } }, { type: 'text', text: '' }] },
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
  { title: '設計概要', tags: ['建設', '設計', 'テンプレート'], generateBody: () => generateDesignOverviewBody() },
  { title: '仕様書', tags: ['建設', '仕様', 'テンプレート'], generateBody: () => generateSpecDocBody() },
  { title: '変更履歴', tags: ['建設', '変更管理', 'テンプレート'], generateBody: () => generateChangeLogBody() },
  { title: '検査チェックリスト', tags: ['建設', '検査', 'テンプレート'], generateBody: () => generateInspectionBody() },
  { title: 'プロジェクトホーム', tags: ['ホーム', 'テンプレート'], generateBody: generateHomeBody, isHome: true },
]

export const constructionPreset: PresetDefinition = {
  genre: 'construction',
  label: '建設・建築',
  description: '設計・施工・検査の進行管理',
  icon: 'HardHat',
  wikiPages,
  milestones: [
    { name: '設計', orderKey: 1 },
    { name: '申請', orderKey: 2 },
    { name: '着工', orderKey: 3 },
    { name: '中間検査', orderKey: 4 },
    { name: '竣工', orderKey: 5 },
    { name: '引渡し', orderKey: 6 },
  ],
  recommendedIntegrations: ['google_calendar', 'slack'],
  defaultSettings: { ownerFieldEnabled: true },
}
