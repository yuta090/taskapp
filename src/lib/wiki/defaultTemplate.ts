/**
 * Default wiki page templates (BlockNote JSON)
 * Auto-created when a project's wiki is first accessed with 0 pages.
 */

// BlockNote block structure — content is loosely typed to support
// various block types (paragraph, table, etc.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TemplateBlock = Record<string, any>

// ---------------------------------------------------------------------------
// Home page
// ---------------------------------------------------------------------------

export const DEFAULT_WIKI_TITLE = 'プロジェクトホーム'
export const DEFAULT_WIKI_TAGS = ['ホーム', 'テンプレート']

/** Spec page link info passed after spec pages are created */
export interface SpecPageRef {
  id: string
  title: string
}

/**
 * Generate default wiki body as BlockNote JSON string.
 * Accepts specPages to create auto-links to the generated spec wiki pages.
 */
export function generateDefaultWikiBody(
  orgId: string,
  spaceId: string,
  specPages?: SpecPageRef[],
): string {
  const basePath = `/${orgId}/project/${spaceId}`
  const wikiPath = `${basePath}/wiki`

  // Build spec document links — either real links or placeholders
  const specBlocks: TemplateBlock[] = specPages && specPages.length > 0
    ? specPages.map(spec => ({
        type: 'bulletListItem',
        content: [
          {
            type: 'link',
            href: `${wikiPath}?page=${spec.id}`,
            content: [{ type: 'text', text: spec.title }],
          },
        ],
      }))
    : [
        { type: 'bulletListItem', content: [{ type: 'text', text: '（仕様書ページが生成されませんでした）' }] },
      ]

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
      },
    },
    // Spacer
    { type: 'paragraph', content: [] },

    // --- Specs & Documents (auto-linked) ---
    {
      type: 'heading',
      props: { level: 2 },
      content: [{ type: 'text', text: '仕様・ドキュメント' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '各仕様書はWikiページとして管理されています。クリックして編集してください。', styles: { italic: true, textColor: 'gray' } },
      ],
    },
    ...specBlocks,
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
      },
    },
    // Spacer
    { type: 'paragraph', content: [] },

    // --- Meetings Block (dynamic) ---
    {
      type: 'heading',
      props: { level: 2 },
      content: [{ type: 'text', text: '最新の議事録' }],
    },
    {
      type: 'meetingsList',
      props: { orgId, spaceId, limit: '5' },
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
          href: `${basePath}`,
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

// ---------------------------------------------------------------------------
// Spec page templates
// ---------------------------------------------------------------------------

export interface SpecTemplate {
  title: string
  tags: string[]
  generateBody: () => string
}

export const SPEC_TEMPLATES: SpecTemplate[] = [
  {
    title: 'API仕様書',
    tags: ['仕様書', 'API'],
    generateBody: () => JSON.stringify([
      {
        type: 'heading',
        props: { level: 2 },
        content: [{ type: 'text', text: 'API仕様書' }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'プロジェクトのAPI仕様をここに記載してください。', styles: { italic: true, textColor: 'gray' } },
        ],
      },
      { type: 'paragraph', content: [] },
      // Base URL
      {
        type: 'heading',
        props: { level: 3 },
        content: [{ type: 'text', text: 'ベースURL' }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'https://api.example.com/v1', styles: { code: true } }],
      },
      { type: 'paragraph', content: [] },
      // Auth
      {
        type: 'heading',
        props: { level: 3 },
        content: [{ type: 'text', text: '認証' }],
      },
      {
        type: 'bulletListItem',
        content: [
          { type: 'text', text: '認証方式: ', styles: { bold: true } },
          { type: 'text', text: '（Bearer Token / API Key / OAuth 等）' },
        ],
      },
      { type: 'paragraph', content: [] },
      // Endpoints
      {
        type: 'heading',
        props: { level: 3 },
        content: [{ type: 'text', text: 'エンドポイント一覧' }],
      },
      {
        type: 'table',
        content: {
          type: 'tableContent',
          rows: [
            {
              cells: [
                [{ type: 'text', text: 'メソッド', styles: { bold: true } }],
                [{ type: 'text', text: 'パス', styles: { bold: true } }],
                [{ type: 'text', text: '説明', styles: { bold: true } }],
                [{ type: 'text', text: '認証', styles: { bold: true } }],
              ],
            },
            {
              cells: [
                [{ type: 'text', text: 'GET' }],
                [{ type: 'text', text: '/example' }],
                [{ type: 'text', text: '' }],
                [{ type: 'text', text: '必要' }],
              ],
            },
            {
              cells: [
                [{ type: 'text', text: 'POST' }],
                [{ type: 'text', text: '/example' }],
                [{ type: 'text', text: '' }],
                [{ type: 'text', text: '必要' }],
              ],
            },
          ],
        },
      },
      { type: 'paragraph', content: [] },
      // Error codes
      {
        type: 'heading',
        props: { level: 3 },
        content: [{ type: 'text', text: 'エラーコード' }],
      },
      {
        type: 'table',
        content: {
          type: 'tableContent',
          rows: [
            {
              cells: [
                [{ type: 'text', text: 'コード', styles: { bold: true } }],
                [{ type: 'text', text: '意味', styles: { bold: true } }],
                [{ type: 'text', text: '対処法', styles: { bold: true } }],
              ],
            },
            {
              cells: [
                [{ type: 'text', text: '400' }],
                [{ type: 'text', text: 'Bad Request' }],
                [{ type: 'text', text: 'リクエストパラメータを確認' }],
              ],
            },
            {
              cells: [
                [{ type: 'text', text: '401' }],
                [{ type: 'text', text: 'Unauthorized' }],
                [{ type: 'text', text: '認証トークンを確認' }],
              ],
            },
            {
              cells: [
                [{ type: 'text', text: '500' }],
                [{ type: 'text', text: 'Internal Server Error' }],
                [{ type: 'text', text: 'サーバー側の問題' }],
              ],
            },
          ],
        },
      },
    ] as TemplateBlock[]),
  },
  {
    title: 'DB設計書',
    tags: ['仕様書', 'DB'],
    generateBody: () => JSON.stringify([
      {
        type: 'heading',
        props: { level: 2 },
        content: [{ type: 'text', text: 'DB設計書' }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'データベースのテーブル定義とリレーションをここに記載してください。', styles: { italic: true, textColor: 'gray' } },
        ],
      },
      { type: 'paragraph', content: [] },
      // ER overview
      {
        type: 'heading',
        props: { level: 3 },
        content: [{ type: 'text', text: 'テーブル一覧' }],
      },
      {
        type: 'table',
        content: {
          type: 'tableContent',
          rows: [
            {
              cells: [
                [{ type: 'text', text: 'テーブル名', styles: { bold: true } }],
                [{ type: 'text', text: '説明', styles: { bold: true } }],
                [{ type: 'text', text: '主なカラム', styles: { bold: true } }],
              ],
            },
            {
              cells: [
                [{ type: 'text', text: '（テーブル名）' }],
                [{ type: 'text', text: '' }],
                [{ type: 'text', text: '' }],
              ],
            },
          ],
        },
      },
      { type: 'paragraph', content: [] },
      // Table detail template
      {
        type: 'heading',
        props: { level: 3 },
        content: [{ type: 'text', text: 'テーブル定義（テンプレート）' }],
      },
      {
        type: 'table',
        content: {
          type: 'tableContent',
          rows: [
            {
              cells: [
                [{ type: 'text', text: 'カラム名', styles: { bold: true } }],
                [{ type: 'text', text: '型', styles: { bold: true } }],
                [{ type: 'text', text: 'NOT NULL', styles: { bold: true } }],
                [{ type: 'text', text: '説明', styles: { bold: true } }],
              ],
            },
            {
              cells: [
                [{ type: 'text', text: 'id' }],
                [{ type: 'text', text: 'uuid' }],
                [{ type: 'text', text: 'YES' }],
                [{ type: 'text', text: 'Primary Key' }],
              ],
            },
            {
              cells: [
                [{ type: 'text', text: 'created_at' }],
                [{ type: 'text', text: 'timestamptz' }],
                [{ type: 'text', text: 'YES' }],
                [{ type: 'text', text: '作成日時' }],
              ],
            },
          ],
        },
      },
      { type: 'paragraph', content: [] },
      // Relationships
      {
        type: 'heading',
        props: { level: 3 },
        content: [{ type: 'text', text: 'リレーション' }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '主要なテーブル間のリレーションを記載してください。', styles: { italic: true, textColor: 'gray' } },
        ],
      },
      {
        type: 'bulletListItem',
        content: [{ type: 'text', text: '（テーブルA）→（テーブルB）: 1対多' }],
      },
      { type: 'paragraph', content: [] },
      // Indexes
      {
        type: 'heading',
        props: { level: 3 },
        content: [{ type: 'text', text: 'インデックス' }],
      },
      {
        type: 'table',
        content: {
          type: 'tableContent',
          rows: [
            {
              cells: [
                [{ type: 'text', text: 'テーブル', styles: { bold: true } }],
                [{ type: 'text', text: 'カラム', styles: { bold: true } }],
                [{ type: 'text', text: '種類', styles: { bold: true } }],
                [{ type: 'text', text: '目的', styles: { bold: true } }],
              ],
            },
            {
              cells: [
                [{ type: 'text', text: '' }],
                [{ type: 'text', text: '' }],
                [{ type: 'text', text: 'UNIQUE / INDEX' }],
                [{ type: 'text', text: '' }],
              ],
            },
          ],
        },
      },
    ] as TemplateBlock[]),
  },
  {
    title: 'UI仕様書',
    tags: ['仕様書', 'UI'],
    generateBody: () => JSON.stringify([
      {
        type: 'heading',
        props: { level: 2 },
        content: [{ type: 'text', text: 'UI仕様書' }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '画面一覧とUI仕様をここに記載してください。', styles: { italic: true, textColor: 'gray' } },
        ],
      },
      { type: 'paragraph', content: [] },
      // Screen list
      {
        type: 'heading',
        props: { level: 3 },
        content: [{ type: 'text', text: '画面一覧' }],
      },
      {
        type: 'table',
        content: {
          type: 'tableContent',
          rows: [
            {
              cells: [
                [{ type: 'text', text: '画面名', styles: { bold: true } }],
                [{ type: 'text', text: 'パス', styles: { bold: true } }],
                [{ type: 'text', text: '説明', styles: { bold: true } }],
                [{ type: 'text', text: 'ステータス', styles: { bold: true } }],
              ],
            },
            {
              cells: [
                [{ type: 'text', text: '（画面名）' }],
                [{ type: 'text', text: '/path' }],
                [{ type: 'text', text: '' }],
                [{ type: 'text', text: '設計中 / 実装済み' }],
              ],
            },
          ],
        },
      },
      { type: 'paragraph', content: [] },
      // Design system
      {
        type: 'heading',
        props: { level: 3 },
        content: [{ type: 'text', text: 'デザインシステム' }],
      },
      {
        type: 'bulletListItem',
        content: [
          { type: 'text', text: 'カラーパレット: ', styles: { bold: true } },
          { type: 'text', text: '（Figmaリンク等を追加）' },
        ],
      },
      {
        type: 'bulletListItem',
        content: [
          { type: 'text', text: 'フォント: ', styles: { bold: true } },
          { type: 'text', text: '（フォント指定）' },
        ],
      },
      {
        type: 'bulletListItem',
        content: [
          { type: 'text', text: 'コンポーネント一覧: ', styles: { bold: true } },
          { type: 'text', text: '（Storybookリンク等を追加）' },
        ],
      },
      { type: 'paragraph', content: [] },
      // Screen detail template
      {
        type: 'heading',
        props: { level: 3 },
        content: [{ type: 'text', text: '画面仕様（テンプレート）' }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '以下のテンプレートを各画面ごとにコピーして使用してください。', styles: { italic: true, textColor: 'gray' } },
        ],
      },
      {
        type: 'bulletListItem',
        content: [
          { type: 'text', text: '画面名: ', styles: { bold: true } },
        ],
      },
      {
        type: 'bulletListItem',
        content: [
          { type: 'text', text: '目的: ', styles: { bold: true } },
        ],
      },
      {
        type: 'bulletListItem',
        content: [
          { type: 'text', text: 'ユーザーアクション: ', styles: { bold: true } },
        ],
      },
      {
        type: 'bulletListItem',
        content: [
          { type: 'text', text: '表示データ: ', styles: { bold: true } },
        ],
      },
      {
        type: 'bulletListItem',
        content: [
          { type: 'text', text: 'バリデーション: ', styles: { bold: true } },
        ],
      },
      {
        type: 'bulletListItem',
        content: [
          { type: 'text', text: 'エラー表示: ', styles: { bold: true } },
        ],
      },
    ] as TemplateBlock[]),
  },
]
