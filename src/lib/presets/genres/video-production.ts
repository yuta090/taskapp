/**
 * 映像・コンテンツ制作 プリセット
 * 企画書/構成表, 制作進行表, 納品仕様書
 */

import type { PresetDefinition, PresetWikiPage } from '../index'
import type { SpecPageRef } from '@/lib/wiki/defaultTemplate'

function generatePlanBody(): string {
  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '企画書 / 構成表' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '映像・コンテンツの企画内容をまとめてください。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '企画概要' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: 'タイトル: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '目的・ゴール: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: 'ターゲット: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '尺・フォーマット: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '納品形式: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '構成表' }] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: 'シーン', styles: { bold: true } }], [{ type: 'text', text: '内容', styles: { bold: true } }], [{ type: 'text', text: '尺', styles: { bold: true } }], [{ type: 'text', text: '備考', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: 'オープニング' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: '本編' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: 'エンディング' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
    ] } },
  ])
}

function generateProgressBody(): string {
  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '制作進行表' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '制作の進行状況を管理してください。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'paragraph', content: [] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: '工程', styles: { bold: true } }], [{ type: 'text', text: '担当', styles: { bold: true } }], [{ type: 'text', text: '開始日', styles: { bold: true } }], [{ type: 'text', text: '期限', styles: { bold: true } }], [{ type: 'text', text: 'ステータス', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: '企画・構成' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: '素材収集・ロケハン' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: '撮影・収録' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: '編集・MA' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: 'クライアント確認' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: '修正・仕上げ' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: '納品' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
    ] } },
  ])
}

function generateDeliverySpecBody(): string {
  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '納品仕様書' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '納品物の仕様を定義してください。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '納品物一覧' }] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: '成果物', styles: { bold: true } }], [{ type: 'text', text: 'フォーマット', styles: { bold: true } }], [{ type: 'text', text: '解像度/品質', styles: { bold: true } }], [{ type: 'text', text: '備考', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: '本編' }], [{ type: 'text', text: 'MP4 / MOV' }], [{ type: 'text', text: '1920x1080' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: 'テロップなし版' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '（必要に応じて）' }]] },
      { cells: [[{ type: 'text', text: 'サムネイル' }], [{ type: 'text', text: 'PNG / JPG' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
    ] } },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '納品方法' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '納品先: ', styles: { bold: true } }, { type: 'text', text: '（クラウドストレージ / データ便 等）' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '納品日: ', styles: { bold: true } }, { type: 'text', text: '' }] },
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
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '制作概要' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: 'タイトル: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: 'クライアント: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '納品日: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '制作チーム: ', styles: { bold: true } }, { type: 'text', text: '' }] },
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
  { title: '企画書/構成表', tags: ['映像', '企画', 'テンプレート'], generateBody: () => generatePlanBody() },
  { title: '制作進行表', tags: ['映像', '進行管理', 'テンプレート'], generateBody: () => generateProgressBody() },
  { title: '納品仕様書', tags: ['映像', '納品', 'テンプレート'], generateBody: () => generateDeliverySpecBody() },
  { title: 'プロジェクトホーム', tags: ['ホーム', 'テンプレート'], generateBody: generateHomeBody, isHome: true },
]

export const videoProductionPreset: PresetDefinition = {
  genre: 'video_production',
  label: '映像制作',
  description: '企画・制作進行・納品仕様の管理',
  icon: 'FilmSlate',
  wikiPages,
  milestones: [
    { name: '企画', orderKey: 1 },
    { name: '撮影/制作', orderKey: 2 },
    { name: '初稿', orderKey: 3 },
    { name: '修正', orderKey: 4 },
    { name: '納品', orderKey: 5 },
  ],
  recommendedIntegrations: ['slack'],
  defaultSettings: { ownerFieldEnabled: null },
}
