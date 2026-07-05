/**
 * Web/アプリ開発 プリセット
 * Based on existing defaultTemplate.ts — API仕様書, DB設計書, UI仕様書 + インフラ構成図
 */

import type { PresetDefinition, PresetWikiPage, PresetSampleTask } from '../index'
import type { SpecPageRef } from '@/lib/wiki/defaultTemplate'

// Re-use existing spec template generators from defaultTemplate.ts
import { SPEC_TEMPLATES, generateDefaultWikiBody } from '@/lib/wiki/defaultTemplate'

// ---------------------------------------------------------------------------
// Additional wiki: Infrastructure page
// ---------------------------------------------------------------------------

function generateInfraBody(): string {
  return JSON.stringify([
    {
      type: 'heading',
      props: { level: 2 },
      content: [{ type: 'text', text: 'インフラ構成図' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'プロジェクトのインフラ構成をここに記載してください。', styles: { italic: true, textColor: 'gray' } },
      ],
    },
    { type: 'paragraph', content: [] },
    {
      type: 'heading',
      props: { level: 3 },
      content: [{ type: 'text', text: '環境一覧' }],
    },
    {
      type: 'table',
      content: {
        type: 'tableContent',
        rows: [
          {
            cells: [
              [{ type: 'text', text: '環境', styles: { bold: true } }],
              [{ type: 'text', text: 'URL', styles: { bold: true } }],
              [{ type: 'text', text: 'プロバイダ', styles: { bold: true } }],
              [{ type: 'text', text: '備考', styles: { bold: true } }],
            ],
          },
          {
            cells: [
              [{ type: 'text', text: '本番' }],
              [{ type: 'text', text: '' }],
              [{ type: 'text', text: '' }],
              [{ type: 'text', text: '' }],
            ],
          },
          {
            cells: [
              [{ type: 'text', text: 'ステージング' }],
              [{ type: 'text', text: '' }],
              [{ type: 'text', text: '' }],
              [{ type: 'text', text: '' }],
            ],
          },
          {
            cells: [
              [{ type: 'text', text: '開発' }],
              [{ type: 'text', text: '' }],
              [{ type: 'text', text: '' }],
              [{ type: 'text', text: '' }],
            ],
          },
        ],
      },
    },
    { type: 'paragraph', content: [] },
    {
      type: 'heading',
      props: { level: 3 },
      content: [{ type: 'text', text: 'サービス構成' }],
    },
    {
      type: 'table',
      content: {
        type: 'tableContent',
        rows: [
          {
            cells: [
              [{ type: 'text', text: 'サービス', styles: { bold: true } }],
              [{ type: 'text', text: '用途', styles: { bold: true } }],
              [{ type: 'text', text: 'プラン', styles: { bold: true } }],
              [{ type: 'text', text: '月額目安', styles: { bold: true } }],
            ],
          },
          {
            cells: [
              [{ type: 'text', text: '（サービス名）' }],
              [{ type: 'text', text: '' }],
              [{ type: 'text', text: '' }],
              [{ type: 'text', text: '' }],
            ],
          },
        ],
      },
    },
    { type: 'paragraph', content: [] },
    {
      type: 'heading',
      props: { level: 3 },
      content: [{ type: 'text', text: 'CI/CD' }],
    },
    {
      type: 'bulletListItem',
      content: [
        { type: 'text', text: 'リポジトリ: ', styles: { bold: true } },
        { type: 'text', text: '（GitHubリンク）' },
      ],
    },
    {
      type: 'bulletListItem',
      content: [
        { type: 'text', text: 'ブランチ戦略: ', styles: { bold: true } },
        { type: 'text', text: '（main / develop / feature）' },
      ],
    },
    {
      type: 'bulletListItem',
      content: [
        { type: 'text', text: 'デプロイ方法: ', styles: { bold: true } },
        { type: 'text', text: '（GitHub Actions / Vercel 等）' },
      ],
    },
  ])
}

// ---------------------------------------------------------------------------
// Wiki pages
// ---------------------------------------------------------------------------

const wikiPages: PresetWikiPage[] = [
  // Spec pages (non-home) — reuse existing SPEC_TEMPLATES
  ...SPEC_TEMPLATES.map(spec => ({
    title: spec.title,
    tags: [...spec.tags, 'テンプレート'],
    generateBody: () => spec.generateBody(),
  })),
  // Infrastructure page
  {
    title: 'インフラ構成図',
    tags: ['仕様書', 'インフラ', 'テンプレート'],
    generateBody: () => generateInfraBody(),
  },
  // Home page (created last, receives spec page links)
  {
    title: 'プロジェクトホーム',
    tags: ['ホーム', 'テンプレート'],
    generateBody: (orgId: string, spaceId: string, specPages?: SpecPageRef[]) =>
      generateDefaultWikiBody(orgId, spaceId, specPages),
    isHome: true,
  },
]

// ---------------------------------------------------------------------------
// Sample tasks
// ---------------------------------------------------------------------------

const sampleTasks: PresetSampleTask[] = [
  {
    title: 'トップページデザインのご確認',
    description:
      'これはサンプルタスクです。自由に編集・削除できます。\n\nボール（担当）をクライアントに渡すと、一覧にアンバー色の「クライアント確認待ち」表示が出ます。タスクを開いてボールを社内に戻す操作を試してみてください。',
    ball: 'client',
    status: 'in_progress',
    clientScope: 'deliverable',
    milestoneName: '設計',
  },
  {
    title: '本番環境の環境変数設定',
    description:
      'これはサンプルタスクです。自由に編集・削除できます。\n\n期限日とマイルストーンが設定されています。ステータスを変更すると保存ボタンなしでその場に反映されます（楽観的更新）。ガントチャートでの表示も確認してみてください。',
    ball: 'internal',
    status: 'todo',
    clientScope: 'internal',
    milestoneName: '開発',
    dueInDays: 10,
  },
  {
    title: 'APIエンドポイント一覧の洗い出し',
    description:
      'これはサンプルタスクです。自由に編集・削除できます。\n\nまだ着手前のタスクです。ステータスのアイコンをクリックして「進行中」に変更する操作を試してみてください。',
    ball: 'internal',
    status: 'backlog',
    clientScope: 'internal',
    milestoneName: '要件定義',
  },
  {
    title: 'リリース手順書の作成',
    description:
      'これはサンプルタスクです。自由に編集・削除できます。\n\nタスクをクリックしてインスペクターを開き、担当者や説明文を編集する操作を試してみてください。',
    ball: 'internal',
    status: 'backlog',
    clientScope: 'internal',
    milestoneName: 'リリース',
  },
]

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const webDevelopmentPreset: PresetDefinition = {
  genre: 'web_development',
  label: 'Web/アプリ開発',
  description: 'API・DB・UI仕様書とインフラ構成図付き',
  icon: 'Globe',
  wikiPages,
  milestones: [
    { name: '要件定義', orderKey: 1 },
    { name: '設計', orderKey: 2 },
    { name: '開発', orderKey: 3 },
    { name: 'テスト', orderKey: 4 },
    { name: 'リリース', orderKey: 5 },
  ],
  sampleTasks,
  recommendedIntegrations: ['github', 'slack'],
  defaultSettings: { ownerFieldEnabled: null },
}
