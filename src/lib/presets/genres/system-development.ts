/**
 * 業務システム開発 プリセット
 * 要件定義書, DB設計書, 画面一覧, テスト計画書
 */

import type { PresetDefinition, PresetWikiPage } from '../index'
import type { SpecPageRef } from '@/lib/wiki/defaultTemplate'

// Reuse DB設計書 from existing templates
import { SPEC_TEMPLATES } from '@/lib/wiki/defaultTemplate'

const dbTemplate = SPEC_TEMPLATES.find(s => s.title === 'DB設計書')!

function generateRequirementsBody(): string {
  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '要件定義書' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'プロジェクトの要件をここに記載してください。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '業務要件' }] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: 'No.', styles: { bold: true } }], [{ type: 'text', text: '要件名', styles: { bold: true } }], [{ type: 'text', text: '詳細', styles: { bold: true } }], [{ type: 'text', text: '優先度', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: '1' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '高/中/低' }]] },
    ] } },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '非機能要件' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '性能: ', styles: { bold: true } }, { type: 'text', text: '（レスポンスタイム、同時接続数等）' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '可用性: ', styles: { bold: true } }, { type: 'text', text: '（稼働率、復旧時間等）' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: 'セキュリティ: ', styles: { bold: true } }, { type: 'text', text: '（認証方式、暗号化等）' }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '前提条件・制約' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '（前提条件を記載）' }] },
  ])
}

function generateScreenListBody(): string {
  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '画面一覧' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '各画面の仕様を記載してください。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'paragraph', content: [] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: 'No.', styles: { bold: true } }], [{ type: 'text', text: '画面名', styles: { bold: true } }], [{ type: 'text', text: '機能概要', styles: { bold: true } }], [{ type: 'text', text: 'ステータス', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: '1' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '設計中' }]] },
    ] } },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '画面遷移図' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '主要な画面遷移フローを記載してください。', styles: { italic: true, textColor: 'gray' } }] },
  ])
}

function generateTestPlanBody(): string {
  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'テスト計画書' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'テスト方針と計画をここに記載してください。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: 'テスト方針' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: 'テスト範囲: ', styles: { bold: true } }, { type: 'text', text: '（対象機能を記載）' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: 'テスト環境: ', styles: { bold: true } }, { type: 'text', text: '（環境情報を記載）' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: 'テスト期間: ', styles: { bold: true } }, { type: 'text', text: '（日程を記載）' }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: 'テストケース' }] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: 'No.', styles: { bold: true } }], [{ type: 'text', text: 'テスト項目', styles: { bold: true } }], [{ type: 'text', text: '期待結果', styles: { bold: true } }], [{ type: 'text', text: '結果', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: '1' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }], [{ type: 'text', text: 'OK/NG' }]] },
    ] } },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '不具合管理' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '不具合はタスクとして管理してください。', styles: { italic: true, textColor: 'gray' } }] },
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
    : [{ type: 'bulletListItem', content: [{ type: 'text', text: '（仕様書ページが生成されませんでした）' }] }]

  return JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'プロジェクト概要' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'プロジェクトの概要情報をまとめてください。', styles: { italic: true, textColor: 'gray' } }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: 'システム名: ', styles: { bold: true } }, { type: 'text', text: '（ここに記入）' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '目的: ', styles: { bold: true } }, { type: 'text', text: '（ここに記入）' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '対象ユーザー: ', styles: { bold: true } }, { type: 'text', text: '（ここに記入）' }] },
    { type: 'bulletListItem', content: [{ type: 'text', text: '期間: ', styles: { bold: true } }, { type: 'text', text: '（開始日 〜 終了予定日）' }] },
    { type: 'paragraph', content: [] },
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '体制' }] },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ type: 'text', text: '役割', styles: { bold: true } }], [{ type: 'text', text: '担当者', styles: { bold: true } }], [{ type: 'text', text: '連絡先', styles: { bold: true } }]] },
      { cells: [[{ type: 'text', text: 'PM' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: 'SE' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
      { cells: [[{ type: 'text', text: 'クライアント' }], [{ type: 'text', text: '' }], [{ type: 'text', text: '' }]] },
    ] } },
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
  { title: '要件定義書', tags: ['仕様書', '要件', 'テンプレート'], generateBody: () => generateRequirementsBody() },
  { title: 'DB設計書', tags: [...dbTemplate.tags, 'テンプレート'], generateBody: () => dbTemplate.generateBody() },
  { title: '画面一覧', tags: ['仕様書', '画面', 'テンプレート'], generateBody: () => generateScreenListBody() },
  { title: 'テスト計画書', tags: ['仕様書', 'テスト', 'テンプレート'], generateBody: () => generateTestPlanBody() },
  { title: 'プロジェクトホーム', tags: ['ホーム', 'テンプレート'], generateBody: generateHomeBody, isHome: true },
]

export const systemDevelopmentPreset: PresetDefinition = {
  genre: 'system_development',
  label: '業務システム開発',
  description: '要件定義からテストまでの標準ドキュメント構成',
  icon: 'Server',
  wikiPages,
  milestones: [
    { name: '要件定義', orderKey: 1 },
    { name: '基本設計', orderKey: 2 },
    { name: '詳細設計', orderKey: 3 },
    { name: '開発', orderKey: 4 },
    { name: 'テスト', orderKey: 5 },
    { name: '運用開始', orderKey: 6 },
  ],
  recommendedIntegrations: ['github', 'slack'],
  defaultSettings: { ownerFieldEnabled: null },
}
