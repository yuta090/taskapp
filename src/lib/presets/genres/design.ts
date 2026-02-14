/**
 * デザイン制作 プリセット
 * デザインブリーフ, スタイルガイド, 成果物一覧
 */

import type { PresetDefinition, PresetWikiPage } from '../index'
import type { SpecPageRef } from '@/lib/wiki/defaultTemplate'

function generateBriefBody(): string {
  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'デザインブリーフ' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'クライアントの要望とデザイン方針をまとめてください。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: 'プロジェクト背景' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: 'ブランド/サービス名: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: 'ターゲット層: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '競合: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: 'デザイン要件' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: 'トーン & マナー: ', styles: { bold: true } }, { type: 'text', text: '（例: モダン、温かみ、高級感）' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: 'カラー方針: ', styles: { bold: true } }, { type: 'text', text: '（既存ブランドカラー or 自由）' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '参考デザイン: ', styles: { bold: true } }, { type: 'text', text: '（URLを貼付）' }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '納品物' }] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: '成果物', styles: { bold: true } }], [{ type: 'text', text: '形式', styles: { bold: true } }], [{ type: 'text', text: '納品日', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: '' }], [{ type: 'text', text: 'Figma / AI / PDF' }], [{ type: 'text', text: '' }]] },
    ] } },
  ])
}

function generateStyleGuideBody(): string {
  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'スタイルガイド' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'デザインの統一基準をここにまとめてください。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: 'カラーパレット' }] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: '用途', styles: { bold: true } }], [{ type: 'text', text: 'カラーコード', styles: { bold: true } }], [{ type: 'text', text: '備考', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: 'プライマリ' }], [{ type: 'text', text: '#' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: 'セカンダリ' }], [{ type: 'text', text: '#' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: 'アクセント' }], [{ type: 'text', text: '#' }], [{ type: 'text', text: '' }]] },
    ] } },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: 'タイポグラフィ' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '見出しフォント: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '本文フォント: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: 'フォントサイズ基準: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: 'アイコン・イラスト' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: 'アイコンセット: ', styles: { bold: true } }, { type: 'text', text: '（Phosphor / Lucide 等）' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: 'イラストスタイル: ', styles: { bold: true } }, { type: 'text', text: '' }] },
  ])
}

function generateDeliverablesBody(): string {
  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '成果物一覧' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '制作物の進捗と納品状況を管理してください。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'paragraph', content: [] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: '成果物', styles: { bold: true } }], [{ type: 'text', text: '担当', styles: { bold: true } }], [{ type: 'text', text: 'ステータス', styles: { bold: true } }], [{ type: 'text', text: 'リンク', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '制作中 / レビュー中 / 完了' }], [{ type: 'text', text: '' }]] },
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
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'デザインプロジェクト' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: 'クライアント: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '案件内容: ', styles: { bold: true } }, { type: 'text', text: '' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '期間: ', styles: { bold: true } }, { type: 'text', text: '' }] },
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
  { title: 'デザインブリーフ', tags: ['デザイン', 'ブリーフ', 'テンプレート'], generateBody: () => generateBriefBody() },
  { title: 'スタイルガイド', tags: ['デザイン', 'スタイル', 'テンプレート'], generateBody: () => generateStyleGuideBody() },
  { title: '成果物一覧', tags: ['デザイン', '成果物', 'テンプレート'], generateBody: () => generateDeliverablesBody() },
  { title: 'プロジェクトホーム', tags: ['ホーム', 'テンプレート'], generateBody: generateHomeBody, isHome: true },
]

export const designPreset: PresetDefinition = {
  genre: 'design',
  label: 'デザイン制作',
  description: 'ブリーフ・スタイルガイド・成果物管理',
  icon: 'Palette',
  wikiPages,
  milestones: [
    { name: 'ヒアリング', orderKey: 1 },
    { name: 'コンセプト', orderKey: 2 },
    { name: '制作', orderKey: 3 },
    { name: '修正', orderKey: 4 },
    { name: '納品', orderKey: 5 },
  ],
  recommendedIntegrations: ['slack'],
  defaultSettings: { ownerFieldEnabled: null },
}
