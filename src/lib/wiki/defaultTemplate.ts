/**
 * Default wiki page template (BlockNote JSON)
 * Auto-created when a project's wiki is first accessed with 0 pages.
 */

// BlockNote block structure
interface TemplateBlock {
  type: string
  content?: (
    | { type: 'text'; text: string; styles?: Record<string, boolean | string> }
    | { type: 'link'; href: string; content: { type: 'text'; text: string; styles?: Record<string, boolean | string> }[] }
  )[]
  props?: Record<string, unknown>
  children?: TemplateBlock[]
}

export const DEFAULT_WIKI_TITLE = 'プロジェクトホーム'

export const DEFAULT_WIKI_TAGS = ['ホーム', 'テンプレート']

/**
 * Generate default wiki body as BlockNote JSON string.
 * Accepts orgId and spaceId to create correct internal links.
 */
export function generateDefaultWikiBody(orgId: string, spaceId: string): string {
  const basePath = `/${orgId}/project/${spaceId}`

  const blocks: TemplateBlock[] = [
    // --- Project Overview ---
    {
      type: 'heading',
      props: { level: 2 },
      content: [{ type: 'text', text: 'プロジェクト概要' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'このページはプロジェクトのホームページです。チームメンバーやクライアントが最初に確認する情報をまとめてください。', styles: { italic: true, textColor: 'gray' } },
      ],
    },
    {
      type: 'bulletListItem',
      content: [
        { type: 'text', text: 'プロジェクト名: ', styles: { bold: true } },
        { type: 'text', text: '（ここに記入）' },
      ],
    },
    {
      type: 'bulletListItem',
      content: [
        { type: 'text', text: '目的・ゴール: ', styles: { bold: true } },
        { type: 'text', text: '（ここに記入）' },
      ],
    },
    {
      type: 'bulletListItem',
      content: [
        { type: 'text', text: 'スコープ: ', styles: { bold: true } },
        { type: 'text', text: '（ここに記入）' },
      ],
    },
    {
      type: 'bulletListItem',
      content: [
        { type: 'text', text: '期間: ', styles: { bold: true } },
        { type: 'text', text: '（開始日 〜 終了予定日）' },
      ],
    },
    // Spacer
    { type: 'paragraph', content: [] },

    // --- Team & Contacts ---
    {
      type: 'heading',
      props: { level: 2 },
      content: [{ type: 'text', text: '体制・連絡先' }],
    },
    {
      type: 'table',
      content: {
        type: 'tableContent',
        rows: [
          {
            cells: [
              [{ type: 'text', text: '役割', styles: { bold: true } }],
              [{ type: 'text', text: '担当者', styles: { bold: true } }],
              [{ type: 'text', text: '連絡先', styles: { bold: true } }],
            ],
          },
          {
            cells: [
              [{ type: 'text', text: 'PM' }],
              [{ type: 'text', text: '（名前）' }],
              [{ type: 'text', text: '' }],
            ],
          },
          {
            cells: [
              [{ type: 'text', text: '開発リーダー' }],
              [{ type: 'text', text: '（名前）' }],
              [{ type: 'text', text: '' }],
            ],
          },
          {
            cells: [
              [{ type: 'text', text: 'クライアント担当' }],
              [{ type: 'text', text: '（名前）' }],
              [{ type: 'text', text: '' }],
            ],
          },
        ],
      } as unknown,
    },
    // Spacer
    { type: 'paragraph', content: [] },

    // --- Specs & Documents ---
    {
      type: 'heading',
      props: { level: 2 },
      content: [{ type: 'text', text: '仕様・ドキュメント' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'プロジェクトに関連する仕様書やドキュメントへのリンクを整理してください。', styles: { italic: true, textColor: 'gray' } },
      ],
    },
    {
      type: 'bulletListItem',
      content: [
        { type: 'text', text: 'API仕様書: ', styles: { bold: true } },
        { type: 'text', text: '（リンクを追加）' },
      ],
    },
    {
      type: 'bulletListItem',
      content: [
        { type: 'text', text: 'DB設計書: ', styles: { bold: true } },
        { type: 'text', text: '（リンクを追加）' },
      ],
    },
    {
      type: 'bulletListItem',
      content: [
        { type: 'text', text: 'UI仕様書: ', styles: { bold: true } },
        { type: 'text', text: '（リンクを追加）' },
      ],
    },
    {
      type: 'bulletListItem',
      content: [
        { type: 'text', text: 'その他: ', styles: { bold: true } },
        { type: 'text', text: '（リンクを追加）' },
      ],
    },
    // Spacer
    { type: 'paragraph', content: [] },

    // --- Key Decisions ---
    {
      type: 'heading',
      props: { level: 2 },
      content: [{ type: 'text', text: '重要な決定事項' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'プロジェクトの重要な決定事項を記録してください。議事録から転記するのがおすすめです。', styles: { italic: true, textColor: 'gray' } },
      ],
    },
    {
      type: 'table',
      content: {
        type: 'tableContent',
        rows: [
          {
            cells: [
              [{ type: 'text', text: '日付', styles: { bold: true } }],
              [{ type: 'text', text: '決定内容', styles: { bold: true } }],
              [{ type: 'text', text: '背景・理由', styles: { bold: true } }],
              [{ type: 'text', text: '決定者', styles: { bold: true } }],
            ],
          },
          {
            cells: [
              [{ type: 'text', text: '' }],
              [{ type: 'text', text: '' }],
              [{ type: 'text', text: '' }],
              [{ type: 'text', text: '' }],
            ],
          },
        ],
      } as unknown,
    },
    // Spacer
    { type: 'paragraph', content: [] },

    // --- Quick Links ---
    {
      type: 'heading',
      props: { level: 2 },
      content: [{ type: 'text', text: '関連ページ' }],
    },
    {
      type: 'bulletListItem',
      content: [
        {
          type: 'link',
          href: `${basePath}/tasks`,
          content: [{ type: 'text', text: 'タスク一覧' }],
        },
        { type: 'text', text: ' — プロジェクトのタスクを管理' },
      ],
    },
    {
      type: 'bulletListItem',
      content: [
        {
          type: 'link',
          href: `${basePath}/meetings`,
          content: [{ type: 'text', text: '議事録' }],
        },
        { type: 'text', text: ' — 会議の記録と決定事項' },
      ],
    },
    {
      type: 'bulletListItem',
      content: [
        {
          type: 'link',
          href: `${basePath}/settings`,
          content: [{ type: 'text', text: 'プロジェクト設定' }],
        },
        { type: 'text', text: ' — メンバー管理・マイルストーン' },
      ],
    },
  ]

  return JSON.stringify(blocks)
}
