/**
 * Seed comprehensive test data for TaskApp
 *
 * Usage:
 *   npx ts-node scripts/seed-test-data.ts
 *
 * Or add to package.json:
 *   "seed:test": "ts-node scripts/seed-test-data.ts"
 *
 * Prerequisites:
 *   - Supabase local instance running (npx supabase start)
 *   - .env.local with SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_SERVICE_KEY) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY not found in .env.local')
  console.error('Get it from: npx supabase status')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

// Fixed UUIDs for test data
const IDS = {
  org: '00000000-0000-0000-0000-000000000001',
  space: '00000000-0000-0000-0000-000000000010',
  milestones: {
    phase1: '00000000-0000-0000-0000-000000000100',
    phase2: '00000000-0000-0000-0000-000000000101',
    phase3: '00000000-0000-0000-0000-000000000102',
  },
  users: {
    demo: '11111111-1111-1111-1111-111111111111',
    staff1: '22222222-2222-2222-2222-222222222222',
    staff2: '33333333-3333-3333-3333-333333333333',
    client1: '44444444-4444-4444-4444-444444444444',
    client2: '55555555-5555-5555-5555-555555555555',
  },
  tasks: {
    design: 'aaaaaaaa-0001-0000-0000-000000000001',
    wireframe: 'aaaaaaaa-0002-0000-0000-000000000002',
    logo: 'aaaaaaaa-0003-0000-0000-000000000003',
    api: 'aaaaaaaa-0004-0000-0000-000000000004',
    mobile: 'aaaaaaaa-0005-0000-0000-000000000005',
    seo: 'aaaaaaaa-0006-0000-0000-000000000006',
    hosting: 'aaaaaaaa-0007-0000-0000-000000000007',
    domain: 'aaaaaaaa-0008-0000-0000-000000000008',
    content: 'aaaaaaaa-0009-0000-0000-000000000009',
    analytics: 'aaaaaaaa-0010-0000-0000-000000000010',
    specNav: 'aaaaaaaa-0011-0000-0000-000000000011',
    specPayment: 'aaaaaaaa-0012-0000-0000-000000000012',
    // クライアント確認待ち追加
    colorScheme: 'aaaaaaaa-0013-0000-0000-000000000013',
    copyReview: 'aaaaaaaa-0014-0000-0000-000000000014',
    priceConfirm: 'aaaaaaaa-0015-0000-0000-000000000015',
    launchDate: 'aaaaaaaa-0016-0000-0000-000000000016',
    photoSelect: 'aaaaaaaa-0017-0000-0000-000000000017',
    contractTerms: 'aaaaaaaa-0018-0000-0000-000000000018',
    brandGuide: 'aaaaaaaa-0019-0000-0000-000000000019',
    targetAudience: 'aaaaaaaa-0020-0000-0000-000000000020',
    // 完了タスク追加
    kickoffDone: 'aaaaaaaa-0021-0000-0000-000000000021',
    requirementsDone: 'aaaaaaaa-0022-0000-0000-000000000022',
    competitorDone: 'aaaaaaaa-0023-0000-0000-000000000023',
    personaDone: 'aaaaaaaa-0024-0000-0000-000000000024',
    sitemapDone: 'aaaaaaaa-0025-0000-0000-000000000025',
    brandingDone: 'aaaaaaaa-0026-0000-0000-000000000026',
    prototypeDone: 'aaaaaaaa-0027-0000-0000-000000000027',
    testingDone: 'aaaaaaaa-0028-0000-0000-000000000028',
    securityDone: 'aaaaaaaa-0029-0000-0000-000000000029',
    trainingDone: 'aaaaaaaa-0030-0000-0000-000000000030',
    // 進行中タスク追加
    frontendDev: 'aaaaaaaa-0031-0000-0000-000000000031',
    backendDev: 'aaaaaaaa-0032-0000-0000-000000000032',
    databaseDesign: 'aaaaaaaa-0033-0000-0000-000000000033',
    // バックログ追加
    maintenance: 'aaaaaaaa-0034-0000-0000-000000000034',
    documentation: 'aaaaaaaa-0035-0000-0000-000000000035',
  },
  meetings: {
    kickoff: 'bbbbbbbb-0001-0000-0000-000000000001',
    design: 'bbbbbbbb-0002-0000-0000-000000000002',
    next: 'bbbbbbbb-0003-0000-0000-000000000003',
  },
  reviews: {
    hosting: 'cccccccc-0001-0000-0000-000000000001',
    seo: 'cccccccc-0002-0000-0000-000000000002',
  },
}

// Dynamic user IDs - will be populated from existing users or newly created
const USER_IDS: Record<string, string> = {}

async function createTestUsers() {
  console.log('Creating test users...')

  const users = [
    { key: 'demo', email: 'demo@example.com', password: 'demo1234', name: '田中 太郎' },
    { key: 'staff1', email: 'staff1@example.com', password: 'staff1234', name: '佐藤 花子' },
    { key: 'staff2', email: 'staff2@example.com', password: 'staff2345', name: '山田 次郎' },
    { key: 'client1', email: 'client1@client.com', password: 'client1234', name: '鈴木 一郎' },
    { key: 'client2', email: 'client2@client.com', password: 'client2345', name: '高橋 美咲' },
  ]

  for (const user of users) {
    try {
      // First, try to find existing user by email
      const { data: existingUsers } = await supabase.auth.admin.listUsers()
      const existing = existingUsers?.users?.find(u => u.email === user.email)

      if (existing) {
        USER_IDS[user.key] = existing.id
        console.log(`  User ${user.email} exists (ID: ${existing.id.slice(0, 8)}...)`)
        continue
      }

      // Create new user
      const { data, error } = await supabase.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: true,
        user_metadata: { name: user.name },
      })

      if (error) {
        console.error(`  Failed to create user ${user.email}:`, error.message)
      } else if (data?.user) {
        USER_IDS[user.key] = data.user.id
        console.log(`  Created user: ${user.email} (ID: ${data.user.id.slice(0, 8)}...)`)
      }
    } catch (err) {
      console.error(`  Error creating user ${user.email}:`, err)
    }
  }

  // Verify we have all required users
  const requiredKeys = ['demo', 'staff1', 'staff2', 'client1', 'client2']
  const missing = requiredKeys.filter(k => !USER_IDS[k])
  if (missing.length > 0) {
    console.error(`  Missing users: ${missing.join(', ')}`)
    throw new Error('Required users not available')
  }
}

async function seedOrganization() {
  console.log('Seeding organization...')

  const { error } = await supabase
    .from('organizations')
    .upsert({ id: IDS.org, name: 'デモ組織' })

  if (error) console.error('  Error:', error.message)
  else console.log('  Organization created')
}

async function seedProfiles() {
  console.log('Seeding profiles...')

  const profiles = [
    { id: USER_IDS.demo, display_name: '田中 太郎', avatar_url: null },
    { id: USER_IDS.staff1, display_name: '佐藤 花子', avatar_url: null },
    { id: USER_IDS.staff2, display_name: '山田 次郎', avatar_url: null },
    { id: USER_IDS.client1, display_name: '鈴木 一郎', avatar_url: null },
    { id: USER_IDS.client2, display_name: '高橋 美咲', avatar_url: null },
  ]

  const { error } = await supabase.from('profiles').upsert(profiles)
  if (error) console.error('  Error:', error.message)
  else console.log('  Profiles created')
}

async function seedOrgMemberships() {
  console.log('Seeding org memberships...')

  const memberships = [
    { org_id: IDS.org, user_id: USER_IDS.demo, role: 'owner' },
    { org_id: IDS.org, user_id: USER_IDS.staff1, role: 'member' },
    { org_id: IDS.org, user_id: USER_IDS.staff2, role: 'member' },
    { org_id: IDS.org, user_id: USER_IDS.client1, role: 'client' },
    { org_id: IDS.org, user_id: USER_IDS.client2, role: 'client' },
  ]

  // Delete existing memberships for this org
  await supabase.from('org_memberships').delete().eq('org_id', IDS.org)

  const { error } = await supabase.from('org_memberships').insert(memberships)
  if (error) console.error('  Error:', error.message)
  else console.log('  Org memberships created')
}

async function seedSpace() {
  console.log('Seeding space...')

  const { error } = await supabase
    .from('spaces')
    .upsert({ id: IDS.space, org_id: IDS.org, type: 'project', name: 'Webリニューアル' })

  if (error) console.error('  Error:', error.message)
  else console.log('  Space created')
}

async function seedSpaceMemberships() {
  console.log('Seeding space memberships...')

  const memberships = [
    { space_id: IDS.space, user_id: USER_IDS.demo, role: 'admin' },
    { space_id: IDS.space, user_id: USER_IDS.staff1, role: 'editor' },
    { space_id: IDS.space, user_id: USER_IDS.staff2, role: 'editor' },
    { space_id: IDS.space, user_id: USER_IDS.client1, role: 'client' },
    { space_id: IDS.space, user_id: USER_IDS.client2, role: 'client' },
  ]

  // Delete existing memberships for this space
  await supabase.from('space_memberships').delete().eq('space_id', IDS.space)

  const { error } = await supabase.from('space_memberships').insert(memberships)
  if (error) console.error('  Error:', error.message)
  else console.log('  Space memberships created')
}

async function seedMilestones() {
  console.log('Seeding milestones...')

  const milestones = [
    { id: IDS.milestones.phase1, org_id: IDS.org, space_id: IDS.space, name: 'フェーズ1: 要件定義', due_date: '2024-03-01', order_key: 1 },
    { id: IDS.milestones.phase2, org_id: IDS.org, space_id: IDS.space, name: 'フェーズ2: 設計', due_date: '2024-04-01', order_key: 2 },
    { id: IDS.milestones.phase3, org_id: IDS.org, space_id: IDS.space, name: 'フェーズ3: 開発', due_date: '2024-05-01', order_key: 3 },
  ]

  const { error } = await supabase.from('milestones').upsert(milestones)
  if (error) console.error('  Error:', error.message)
  else console.log('  Milestones created')
}

async function seedTasks() {
  console.log('Seeding tasks...')

  const tasks = [
    // クライアント確認待ち (ball=client)
    {
      id: IDS.tasks.design,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase2,
      title: 'トップページデザイン案の確認',
      description: 'デザイナーが作成したトップページのデザイン案をクライアントにご確認いただきたいです。3案ご用意しました。',
      status: 'in_progress',
      ball: 'client',
      origin: 'internal',
      type: 'task',
      due_date: '2024-02-20',
      assignee_id: USER_IDS.staff1,
      created_by: USER_IDS.demo,
    },
    // 検討中タスク
    {
      id: IDS.tasks.wireframe,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase1,
      title: 'ワイヤーフレーム作成方針',
      description: 'PC/SP両方のワイヤーフレームを作成する方針について検討中です。',
      status: 'considering',
      ball: 'internal',
      origin: 'client',
      type: 'task',
      due_date: '2024-02-15',
      assignee_id: USER_IDS.demo,
      created_by: USER_IDS.demo,
    },
    // クライアント起案
    {
      id: IDS.tasks.logo,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase2,
      title: 'ロゴの刷新検討',
      description: '現行ロゴを刷新したいとのご要望。ブランドイメージを維持しつつモダンに。',
      status: 'backlog',
      ball: 'internal',
      origin: 'client',
      type: 'task',
      due_date: '2024-03-01',
      assignee_id: USER_IDS.staff1,
      created_by: USER_IDS.client1,
    },
    // 進行中
    {
      id: IDS.tasks.api,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase3,
      title: 'API設計・実装',
      description: 'REST APIの設計とバックエンド実装を行います。',
      status: 'in_progress',
      ball: 'internal',
      origin: 'internal',
      type: 'task',
      due_date: '2024-04-15',
      assignee_id: USER_IDS.staff2,
      created_by: USER_IDS.demo,
    },
    // クライアント確認待ち
    {
      id: IDS.tasks.mobile,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase2,
      title: 'スマホ対応の優先度確認',
      description: 'SP対応の優先度についてご確認ください。レスポンシブ or ネイティブアプリ？',
      status: 'todo',
      ball: 'client',
      origin: 'internal',
      type: 'task',
      due_date: '2024-02-25',
      assignee_id: USER_IDS.demo,
      created_by: USER_IDS.demo,
    },
    // 完了
    {
      id: IDS.tasks.seo,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase1,
      title: 'SEO要件の整理',
      description: 'SEO対策の要件を整理しました。キーワード選定完了。',
      status: 'done',
      ball: 'internal',
      origin: 'internal',
      type: 'task',
      due_date: '2024-02-01',
      assignee_id: USER_IDS.demo,
      created_by: USER_IDS.demo,
    },
    // レビュー待ち
    {
      id: IDS.tasks.hosting,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase3,
      title: 'ホスティング環境の選定',
      description: 'AWS vs GCP vs Vercel の比較検討結果をレビューしてください。',
      status: 'in_review',
      ball: 'internal',
      origin: 'internal',
      type: 'task',
      due_date: '2024-03-10',
      assignee_id: USER_IDS.staff2,
      created_by: USER_IDS.staff2,
    },
    // 緊急
    {
      id: IDS.tasks.domain,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase3,
      title: '【緊急】ドメイン名の最終決定',
      description: '公開予定日が迫っています。ドメイン名を至急ご決定ください。',
      status: 'todo',
      ball: 'client',
      origin: 'internal',
      type: 'task',
      due_date: '2024-02-10',
      assignee_id: USER_IDS.demo,
      created_by: USER_IDS.demo,
    },
    // 未着手
    {
      id: IDS.tasks.content,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase2,
      title: 'コンテンツ原稿の作成',
      description: '各ページのコンテンツ原稿を作成します。',
      status: 'backlog',
      ball: 'internal',
      origin: 'internal',
      type: 'task',
      due_date: '2024-03-15',
      created_by: USER_IDS.demo,
    },
    // アナリティクス
    {
      id: IDS.tasks.analytics,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase3,
      title: 'Google Analytics設定',
      description: 'GA4の設定とイベントトラッキングの実装。',
      status: 'todo',
      ball: 'internal',
      origin: 'internal',
      type: 'task',
      due_date: '2024-04-20',
      assignee_id: USER_IDS.staff2,
      created_by: USER_IDS.demo,
    },
    // SPEC タスク（検討中）
    {
      id: IDS.tasks.specNav,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase2,
      title: 'ナビゲーション構造の決定',
      description: 'メインナビゲーションの構造を決定する必要があります。',
      status: 'considering',
      ball: 'client',
      origin: 'internal',
      type: 'spec',
      spec_path: '/spec/navigation#main-nav',
      decision_state: 'considering',
      due_date: '2024-02-28',
      assignee_id: USER_IDS.demo,
      created_by: USER_IDS.demo,
    },
    // SPEC タスク（決定済み）
    {
      id: IDS.tasks.specPayment,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase3,
      title: '決済方式の仕様',
      description: 'クレジットカード決済の仕様が決定しました。',
      status: 'in_progress',
      ball: 'internal',
      origin: 'client',
      type: 'spec',
      spec_path: '/spec/payment#credit-card',
      decision_state: 'decided',
      due_date: '2024-04-01',
      assignee_id: USER_IDS.staff2,
      created_by: USER_IDS.client1,
    },
    // ========================================
    // クライアント確認待ちタスク（ball=client）追加
    // ========================================
    {
      id: IDS.tasks.colorScheme,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase2,
      title: 'カラースキームの最終確認',
      description: 'サイト全体のカラーパレットをご確認ください。メイン、サブ、アクセントカラーの3案をご用意しました。',
      status: 'in_progress',
      ball: 'client',
      origin: 'internal',
      type: 'task',
      due_date: '2024-02-18',
      assignee_id: USER_IDS.staff1,
      created_by: USER_IDS.demo,
    },
    {
      id: IDS.tasks.copyReview,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase2,
      title: 'キャッチコピーの確認',
      description: 'トップページのキャッチコピー案を5パターンご用意しました。ブランドイメージに合うものをお選びください。',
      status: 'todo',
      ball: 'client',
      origin: 'internal',
      type: 'task',
      due_date: '2024-02-22',
      assignee_id: USER_IDS.demo,
      created_by: USER_IDS.demo,
    },
    {
      id: IDS.tasks.priceConfirm,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase1,
      title: '料金プランの表示方法確認',
      description: '料金プランの見せ方について、表形式とカード形式の2パターンをご提案します。',
      status: 'in_progress',
      ball: 'client',
      origin: 'internal',
      type: 'task',
      due_date: '2024-02-25',
      assignee_id: USER_IDS.demo,
      created_by: USER_IDS.staff1,
    },
    {
      id: IDS.tasks.launchDate,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase3,
      title: '公開日の最終決定',
      description: '開発スケジュールに基づき、3月末または4月中旬の公開日をご検討ください。',
      status: 'todo',
      ball: 'client',
      origin: 'internal',
      type: 'task',
      due_date: '2024-02-28',
      assignee_id: USER_IDS.demo,
      created_by: USER_IDS.demo,
    },
    {
      id: IDS.tasks.photoSelect,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase2,
      title: 'メインビジュアル写真の選定',
      description: 'トップページのヒーローセクションに使用する写真候補を10枚ご用意しました。',
      status: 'in_progress',
      ball: 'client',
      origin: 'internal',
      type: 'task',
      due_date: '2024-02-19',
      assignee_id: USER_IDS.staff1,
      created_by: USER_IDS.staff1,
    },
    {
      id: IDS.tasks.contractTerms,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase1,
      title: '利用規約の文言確認',
      description: '法務部門と調整した利用規約のドラフトです。内容をご確認ください。',
      status: 'todo',
      ball: 'client',
      origin: 'internal',
      type: 'task',
      due_date: '2024-03-05',
      assignee_id: USER_IDS.demo,
      created_by: USER_IDS.demo,
    },
    {
      id: IDS.tasks.brandGuide,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase2,
      title: 'ブランドガイドラインの確認',
      description: 'ロゴ使用規定、カラー、フォントのガイドラインをまとめました。',
      status: 'in_progress',
      ball: 'client',
      origin: 'internal',
      type: 'task',
      due_date: '2024-02-23',
      assignee_id: USER_IDS.staff1,
      created_by: USER_IDS.demo,
    },
    {
      id: IDS.tasks.targetAudience,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase1,
      title: 'ターゲットユーザー層の確認',
      description: 'ペルソナ設定に基づくターゲット層の定義をご確認ください。マーケティング戦略に影響します。',
      status: 'todo',
      ball: 'client',
      origin: 'client',
      type: 'task',
      due_date: '2024-02-16',
      assignee_id: USER_IDS.demo,
      created_by: USER_IDS.client1,
    },
    // ========================================
    // 完了タスク（status=done）追加
    // ========================================
    {
      id: IDS.tasks.kickoffDone,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase1,
      title: 'キックオフミーティング実施',
      description: 'プロジェクト開始のキックオフミーティングを実施しました。',
      status: 'done',
      ball: 'internal',
      origin: 'internal',
      type: 'task',
      due_date: '2024-01-15',
      assignee_id: USER_IDS.demo,
      created_by: USER_IDS.demo,
    },
    {
      id: IDS.tasks.requirementsDone,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase1,
      title: '要件定義書の作成完了',
      description: '機能要件・非機能要件を網羅した要件定義書を作成しました。',
      status: 'done',
      ball: 'internal',
      origin: 'internal',
      type: 'task',
      due_date: '2024-01-25',
      assignee_id: USER_IDS.demo,
      created_by: USER_IDS.demo,
    },
    {
      id: IDS.tasks.competitorDone,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase1,
      title: '競合サイト調査完了',
      description: '主要競合5社のWebサイトを調査し、レポートを作成しました。',
      status: 'done',
      ball: 'internal',
      origin: 'internal',
      type: 'task',
      due_date: '2024-01-20',
      assignee_id: USER_IDS.staff1,
      created_by: USER_IDS.demo,
    },
    {
      id: IDS.tasks.personaDone,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase1,
      title: 'ペルソナ設計完了',
      description: '3つのユーザーペルソナを定義しました。',
      status: 'done',
      ball: 'internal',
      origin: 'internal',
      type: 'task',
      due_date: '2024-01-22',
      assignee_id: USER_IDS.staff1,
      created_by: USER_IDS.demo,
    },
    {
      id: IDS.tasks.sitemapDone,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase1,
      title: 'サイトマップ作成完了',
      description: 'サイト構造を定義したサイトマップを作成しました。',
      status: 'done',
      ball: 'internal',
      origin: 'internal',
      type: 'task',
      due_date: '2024-01-28',
      assignee_id: USER_IDS.demo,
      created_by: USER_IDS.demo,
    },
    {
      id: IDS.tasks.brandingDone,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase2,
      title: 'ブランディング方針決定',
      description: 'ブランドの方向性とトーン&マナーを決定しました。',
      status: 'done',
      ball: 'internal',
      origin: 'client',
      type: 'task',
      due_date: '2024-02-01',
      assignee_id: USER_IDS.staff1,
      created_by: USER_IDS.client1,
    },
    {
      id: IDS.tasks.prototypeDone,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase2,
      title: 'プロトタイプ作成完了',
      description: '主要画面のインタラクティブプロトタイプを作成しました。',
      status: 'done',
      ball: 'internal',
      origin: 'internal',
      type: 'task',
      due_date: '2024-02-05',
      assignee_id: USER_IDS.staff1,
      created_by: USER_IDS.demo,
    },
    {
      id: IDS.tasks.testingDone,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase1,
      title: 'ユーザビリティテスト完了',
      description: '5名のユーザーによるユーザビリティテストを実施しました。',
      status: 'done',
      ball: 'internal',
      origin: 'internal',
      type: 'task',
      due_date: '2024-02-08',
      assignee_id: USER_IDS.staff1,
      created_by: USER_IDS.demo,
    },
    {
      id: IDS.tasks.securityDone,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase3,
      title: 'セキュリティ要件定義完了',
      description: 'OWASP Top 10に基づくセキュリティ要件を定義しました。',
      status: 'done',
      ball: 'internal',
      origin: 'internal',
      type: 'task',
      due_date: '2024-02-10',
      assignee_id: USER_IDS.staff2,
      created_by: USER_IDS.demo,
    },
    {
      id: IDS.tasks.trainingDone,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase1,
      title: 'チーム研修完了',
      description: 'プロジェクトで使用するツール・技術の研修を実施しました。',
      status: 'done',
      ball: 'internal',
      origin: 'internal',
      type: 'task',
      due_date: '2024-01-18',
      assignee_id: USER_IDS.demo,
      created_by: USER_IDS.demo,
    },
    // ========================================
    // 進行中タスク追加
    // ========================================
    {
      id: IDS.tasks.frontendDev,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase3,
      title: 'フロントエンド開発',
      description: 'React/Next.jsを使用したフロントエンド実装を進めています。',
      status: 'in_progress',
      ball: 'internal',
      origin: 'internal',
      type: 'task',
      due_date: '2024-04-10',
      assignee_id: USER_IDS.staff2,
      created_by: USER_IDS.demo,
    },
    {
      id: IDS.tasks.backendDev,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase3,
      title: 'バックエンド開発',
      description: 'APIサーバーの実装を進めています。認証機能は完了。',
      status: 'in_progress',
      ball: 'internal',
      origin: 'internal',
      type: 'task',
      due_date: '2024-04-15',
      assignee_id: USER_IDS.staff2,
      created_by: USER_IDS.demo,
    },
    {
      id: IDS.tasks.databaseDesign,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase3,
      title: 'データベース設計・構築',
      description: 'PostgreSQLのスキーマ設計とマイグレーション作成中。',
      status: 'in_progress',
      ball: 'internal',
      origin: 'internal',
      type: 'task',
      due_date: '2024-03-20',
      assignee_id: USER_IDS.staff2,
      created_by: USER_IDS.demo,
    },
    // ========================================
    // バックログ追加
    // ========================================
    {
      id: IDS.tasks.maintenance,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase3,
      title: '保守運用計画策定',
      description: '公開後の保守運用体制と計画を策定します。',
      status: 'backlog',
      ball: 'internal',
      origin: 'internal',
      type: 'task',
      due_date: '2024-04-25',
      assignee_id: USER_IDS.demo,
      created_by: USER_IDS.demo,
    },
    {
      id: IDS.tasks.documentation,
      org_id: IDS.org,
      space_id: IDS.space,
      milestone_id: IDS.milestones.phase3,
      title: '運用マニュアル作成',
      description: 'クライアント向けの運用マニュアルを作成します。',
      status: 'backlog',
      ball: 'internal',
      origin: 'internal',
      type: 'task',
      due_date: '2024-04-30',
      created_by: USER_IDS.demo,
    },
  ]

  const { error } = await supabase.from('tasks').upsert(tasks)
  if (error) console.error('  Error:', error.message)
  else console.log('  Tasks created')
}

async function seedTaskOwners() {
  console.log('Seeding task owners...')

  const owners = [
    // 既存タスク
    { org_id: IDS.org, space_id: IDS.space, task_id: IDS.tasks.design, side: 'client', user_id: USER_IDS.client1 },
    { org_id: IDS.org, space_id: IDS.space, task_id: IDS.tasks.design, side: 'internal', user_id: USER_IDS.staff1 },
    { org_id: IDS.org, space_id: IDS.space, task_id: IDS.tasks.mobile, side: 'client', user_id: USER_IDS.client1 },
    { org_id: IDS.org, space_id: IDS.space, task_id: IDS.tasks.mobile, side: 'client', user_id: USER_IDS.client2 },
    { org_id: IDS.org, space_id: IDS.space, task_id: IDS.tasks.mobile, side: 'internal', user_id: USER_IDS.demo },
    { org_id: IDS.org, space_id: IDS.space, task_id: IDS.tasks.domain, side: 'client', user_id: USER_IDS.client1 },
    { org_id: IDS.org, space_id: IDS.space, task_id: IDS.tasks.domain, side: 'internal', user_id: USER_IDS.demo },
    { org_id: IDS.org, space_id: IDS.space, task_id: IDS.tasks.specNav, side: 'client', user_id: USER_IDS.client1 },
    { org_id: IDS.org, space_id: IDS.space, task_id: IDS.tasks.specNav, side: 'internal', user_id: USER_IDS.demo },
    // クライアント確認待ちタスク
    { org_id: IDS.org, space_id: IDS.space, task_id: IDS.tasks.colorScheme, side: 'client', user_id: USER_IDS.client1 },
    { org_id: IDS.org, space_id: IDS.space, task_id: IDS.tasks.colorScheme, side: 'internal', user_id: USER_IDS.staff1 },
    { org_id: IDS.org, space_id: IDS.space, task_id: IDS.tasks.copyReview, side: 'client', user_id: USER_IDS.client1 },
    { org_id: IDS.org, space_id: IDS.space, task_id: IDS.tasks.copyReview, side: 'client', user_id: USER_IDS.client2 },
    { org_id: IDS.org, space_id: IDS.space, task_id: IDS.tasks.copyReview, side: 'internal', user_id: USER_IDS.demo },
    { org_id: IDS.org, space_id: IDS.space, task_id: IDS.tasks.priceConfirm, side: 'client', user_id: USER_IDS.client1 },
    { org_id: IDS.org, space_id: IDS.space, task_id: IDS.tasks.priceConfirm, side: 'internal', user_id: USER_IDS.demo },
    { org_id: IDS.org, space_id: IDS.space, task_id: IDS.tasks.launchDate, side: 'client', user_id: USER_IDS.client1 },
    { org_id: IDS.org, space_id: IDS.space, task_id: IDS.tasks.launchDate, side: 'client', user_id: USER_IDS.client2 },
    { org_id: IDS.org, space_id: IDS.space, task_id: IDS.tasks.launchDate, side: 'internal', user_id: USER_IDS.demo },
    { org_id: IDS.org, space_id: IDS.space, task_id: IDS.tasks.photoSelect, side: 'client', user_id: USER_IDS.client1 },
    { org_id: IDS.org, space_id: IDS.space, task_id: IDS.tasks.photoSelect, side: 'internal', user_id: USER_IDS.staff1 },
    { org_id: IDS.org, space_id: IDS.space, task_id: IDS.tasks.contractTerms, side: 'client', user_id: USER_IDS.client1 },
    { org_id: IDS.org, space_id: IDS.space, task_id: IDS.tasks.contractTerms, side: 'internal', user_id: USER_IDS.demo },
    { org_id: IDS.org, space_id: IDS.space, task_id: IDS.tasks.brandGuide, side: 'client', user_id: USER_IDS.client1 },
    { org_id: IDS.org, space_id: IDS.space, task_id: IDS.tasks.brandGuide, side: 'internal', user_id: USER_IDS.staff1 },
    { org_id: IDS.org, space_id: IDS.space, task_id: IDS.tasks.targetAudience, side: 'client', user_id: USER_IDS.client1 },
    { org_id: IDS.org, space_id: IDS.space, task_id: IDS.tasks.targetAudience, side: 'internal', user_id: USER_IDS.demo },
  ]

  // Delete existing and insert new
  for (const owner of owners) {
    await supabase
      .from('task_owners')
      .delete()
      .eq('task_id', owner.task_id)
      .eq('side', owner.side)
      .eq('user_id', owner.user_id)
  }

  const { error } = await supabase.from('task_owners').insert(owners)
  if (error) console.error('  Error:', error.message)
  else console.log('  Task owners created')
}

async function seedNotifications() {
  console.log('Seeding notifications...')

  const now = new Date()
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString()
  const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()

  const notifications = [
    // Demo user への通知
    {
      org_id: IDS.org,
      space_id: IDS.space,
      to_user_id: USER_IDS.demo,
      channel: 'in_app',
      type: 'review_request',
      dedupe_key: `review_request_${IDS.tasks.hosting}`,
      payload: {
        title: 'レビュー依頼',
        message: '山田次郎さんが「ホスティング環境の選定」のレビューを依頼しました',
        task_id: IDS.tasks.hosting,
        task_title: 'ホスティング環境の選定',
        from_user_name: '山田 次郎',
        link: `/${IDS.org}/project/${IDS.space}?task=${IDS.tasks.hosting}`,
      },
      created_at: hoursAgo(2),
    },
    {
      org_id: IDS.org,
      space_id: IDS.space,
      to_user_id: USER_IDS.demo,
      channel: 'in_app',
      type: 'client_question',
      dedupe_key: `client_question_${IDS.tasks.design}_1`,
      payload: {
        title: 'クライアントからの質問',
        message: '鈴木一郎さんが「トップページデザイン案の確認」について質問があります',
        task_id: IDS.tasks.design,
        task_title: 'トップページデザイン案の確認',
        from_user_name: '鈴木 一郎',
        question: 'A案とB案の制作費用の違いを教えてください',
        link: `/${IDS.org}/project/${IDS.space}?task=${IDS.tasks.design}`,
      },
      created_at: hoursAgo(4),
    },
    {
      org_id: IDS.org,
      space_id: IDS.space,
      to_user_id: USER_IDS.demo,
      channel: 'in_app',
      type: 'task_assigned',
      dedupe_key: `task_assigned_${IDS.tasks.wireframe}`,
      payload: {
        title: 'タスクが割り当てられました',
        message: '「ワイヤーフレーム作成方針」があなたに割り当てられました',
        task_id: IDS.tasks.wireframe,
        task_title: 'ワイヤーフレーム作成方針',
        link: `/${IDS.org}/project/${IDS.space}?task=${IDS.tasks.wireframe}`,
      },
      created_at: daysAgo(1),
    },
    {
      org_id: IDS.org,
      space_id: IDS.space,
      to_user_id: USER_IDS.demo,
      channel: 'in_app',
      type: 'due_date_reminder',
      dedupe_key: `due_date_${IDS.tasks.domain}`,
      payload: {
        title: '期限が近づいています',
        message: '「ドメイン名の最終決定」の期限が2日後です',
        task_id: IDS.tasks.domain,
        task_title: 'ドメイン名の最終決定',
        due_date: '2024-02-10',
        link: `/${IDS.org}/project/${IDS.space}?task=${IDS.tasks.domain}`,
      },
      created_at: hoursAgo(6),
    },
    {
      org_id: IDS.org,
      space_id: IDS.space,
      to_user_id: USER_IDS.demo,
      channel: 'in_app',
      type: 'meeting_reminder',
      dedupe_key: `meeting_reminder_${IDS.meetings.next}`,
      payload: {
        title: '会議リマインダー',
        message: '「次回定例会議」が明日 10:00 に予定されています',
        meeting_id: IDS.meetings.next,
        meeting_title: '次回定例会議',
        scheduled_at: '2024-02-20T10:00:00+09:00',
        link: `/${IDS.org}/project/${IDS.space}/meetings?meeting=${IDS.meetings.next}`,
      },
      created_at: hoursAgo(12),
    },
    {
      org_id: IDS.org,
      space_id: IDS.space,
      to_user_id: USER_IDS.demo,
      channel: 'in_app',
      type: 'spec_decision_needed',
      dedupe_key: `spec_decision_${IDS.tasks.specNav}`,
      payload: {
        title: '仕様決定が必要です',
        message: '「ナビゲーション構造の決定」についてクライアント様の決定をお待ちしています',
        task_id: IDS.tasks.specNav,
        task_title: 'ナビゲーション構造の決定',
        spec_path: '/spec/navigation#main-nav',
        link: `/${IDS.org}/project/${IDS.space}?task=${IDS.tasks.specNav}`,
      },
      created_at: hoursAgo(3),
    },
    {
      org_id: IDS.org,
      space_id: IDS.space,
      to_user_id: USER_IDS.demo,
      channel: 'in_app',
      type: 'task_completed',
      dedupe_key: `task_completed_${IDS.tasks.seo}`,
      payload: {
        title: 'タスク完了',
        message: '「SEO要件の整理」が完了しました',
        task_id: IDS.tasks.seo,
        task_title: 'SEO要件の整理',
        link: `/${IDS.org}/project/${IDS.space}?task=${IDS.tasks.seo}`,
      },
      created_at: daysAgo(3),
      read_at: daysAgo(2),
    },
    {
      org_id: IDS.org,
      space_id: IDS.space,
      to_user_id: USER_IDS.demo,
      channel: 'in_app',
      type: 'ball_passed',
      dedupe_key: `ball_passed_${IDS.tasks.logo}`,
      payload: {
        title: 'タスクがあなたに戻りました',
        message: '鈴木一郎さんが「ロゴの刷新検討」のボールをあなたに渡しました',
        task_id: IDS.tasks.logo,
        task_title: 'ロゴの刷新検討',
        from_user_name: '鈴木 一郎',
        comment: 'ロゴ案について社内で検討しました。方向性は承認です。',
        link: `/${IDS.org}/project/${IDS.space}?task=${IDS.tasks.logo}`,
      },
      created_at: hoursAgo(1),
    },
    // Staff1 への通知
    {
      org_id: IDS.org,
      space_id: IDS.space,
      to_user_id: USER_IDS.staff1,
      channel: 'in_app',
      type: 'review_request',
      dedupe_key: `review_request_staff1_${IDS.tasks.hosting}`,
      payload: {
        title: 'レビュー依頼',
        message: '山田次郎さんが「ホスティング環境の選定」のレビューを依頼しました',
        task_id: IDS.tasks.hosting,
        task_title: 'ホスティング環境の選定',
        from_user_name: '山田 次郎',
        link: `/${IDS.org}/project/${IDS.space}?task=${IDS.tasks.hosting}`,
      },
      created_at: hoursAgo(2),
    },
    {
      org_id: IDS.org,
      space_id: IDS.space,
      to_user_id: USER_IDS.staff1,
      channel: 'in_app',
      type: 'client_feedback',
      dedupe_key: `client_feedback_${IDS.tasks.design}`,
      payload: {
        title: 'クライアントフィードバック',
        message: '高橋美咲さんが「トップページデザイン案の確認」にコメントしました',
        task_id: IDS.tasks.design,
        task_title: 'トップページデザイン案の確認',
        from_user_name: '高橋 美咲',
        comment: 'B案の色味をもう少し明るくできますか？',
        link: `/${IDS.org}/project/${IDS.space}?task=${IDS.tasks.design}`,
      },
      created_at: hoursAgo(0.5),
    },
    // Client1 への通知
    {
      org_id: IDS.org,
      space_id: IDS.space,
      to_user_id: USER_IDS.client1,
      channel: 'in_app',
      type: 'confirmation_request',
      dedupe_key: `confirmation_${IDS.tasks.design}`,
      payload: {
        title: 'ご確認依頼',
        message: '「トップページデザイン案の確認」についてご確認をお願いします',
        task_id: IDS.tasks.design,
        task_title: 'トップページデザイン案の確認',
        from_user_name: '田中 太郎',
        link: `/${IDS.org}/project/${IDS.space}?task=${IDS.tasks.design}`,
      },
      created_at: hoursAgo(5),
    },
    {
      org_id: IDS.org,
      space_id: IDS.space,
      to_user_id: USER_IDS.client1,
      channel: 'in_app',
      type: 'confirmation_request',
      dedupe_key: `confirmation_${IDS.tasks.mobile}`,
      payload: {
        title: 'ご確認依頼',
        message: '「スマホ対応の優先度確認」についてご確認をお願いします',
        task_id: IDS.tasks.mobile,
        task_title: 'スマホ対応の優先度確認',
        from_user_name: '田中 太郎',
        link: `/${IDS.org}/project/${IDS.space}?task=${IDS.tasks.mobile}`,
      },
      created_at: daysAgo(1),
    },
    {
      org_id: IDS.org,
      space_id: IDS.space,
      to_user_id: USER_IDS.client1,
      channel: 'in_app',
      type: 'urgent_confirmation',
      dedupe_key: `urgent_${IDS.tasks.domain}`,
      payload: {
        title: '【緊急】ご確認依頼',
        message: '「ドメイン名の最終決定」について至急ご確認をお願いします',
        task_id: IDS.tasks.domain,
        task_title: 'ドメイン名の最終決定',
        from_user_name: '田中 太郎',
        urgent: true,
        link: `/${IDS.org}/project/${IDS.space}?task=${IDS.tasks.domain}`,
      },
      created_at: hoursAgo(3),
    },
  ]

  // Delete existing and insert new
  for (const notification of notifications) {
    await supabase
      .from('notifications')
      .delete()
      .eq('to_user_id', notification.to_user_id)
      .eq('channel', notification.channel)
      .eq('dedupe_key', notification.dedupe_key)
  }

  const { error } = await supabase.from('notifications').insert(notifications)
  if (error) console.error('  Error:', error.message)
  else console.log(`  ${notifications.length} notifications created`)
}

async function seedMeetings() {
  console.log('Seeding meetings...')

  const meetings = [
    {
      id: IDS.meetings.kickoff,
      org_id: IDS.org,
      space_id: IDS.space,
      title: 'キックオフミーティング',
      held_at: '2024-01-15T10:00:00+09:00',
      status: 'ended',
      started_at: '2024-01-15T10:00:00+09:00',
      ended_at: '2024-01-15T11:30:00+09:00',
      minutes_md: '# キックオフミーティング議事録\n\n## 参加者\n- 田中太郎（PM）\n- 鈴木一郎（クライアント）\n\n## 決定事項\n- プロジェクト開始日: 2024/1/15\n- 納期: 2024/5/1',
      summary_subject: 'キックオフミーティング完了',
      summary_body: 'プロジェクトのキックオフミーティングを実施しました。',
      created_by: USER_IDS.demo,
    },
    {
      id: IDS.meetings.design,
      org_id: IDS.org,
      space_id: IDS.space,
      title: 'デザインレビュー会議',
      held_at: '2024-02-10T14:00:00+09:00',
      status: 'ended',
      started_at: '2024-02-10T14:00:00+09:00',
      ended_at: '2024-02-10T15:00:00+09:00',
      minutes_md: '# デザインレビュー\n\n## 確認事項\n- トップページデザイン案A/B/Cを提示\n- クライアント様にて検討中',
      summary_subject: 'デザインレビュー完了',
      summary_body: 'デザイン案3点を提示。クライアント様にてご検討いただきます。',
      created_by: USER_IDS.demo,
    },
    {
      id: IDS.meetings.next,
      org_id: IDS.org,
      space_id: IDS.space,
      title: '次回定例会議',
      held_at: '2024-02-20T10:00:00+09:00',
      status: 'planned',
      created_by: USER_IDS.demo,
    },
  ]

  const { error } = await supabase.from('meetings').upsert(meetings)
  if (error) console.error('  Error:', error.message)
  else console.log('  Meetings created')
}

async function main() {
  console.log('='.repeat(50))
  console.log('Seeding comprehensive test data for TaskApp')
  console.log('='.repeat(50))

  try {
    await createTestUsers()
    await seedProfiles()
    await seedOrganization()
    await seedOrgMemberships()
    await seedSpace()
    await seedSpaceMemberships()
    await seedMilestones()
    await seedTasks()
    await seedTaskOwners()
    await seedMeetings()
    await seedNotifications()

    console.log('='.repeat(50))
    console.log('Done! Test data seeded successfully.')
    console.log('')
    console.log('Test accounts:')
    console.log('  demo@example.com / demo1234 (Internal PM)')
    console.log('  staff1@example.com / staff1234 (Designer)')
    console.log('  staff2@example.com / staff2345 (Developer)')
    console.log('  client1@client.com / client1234 (Client PM)')
    console.log('  client2@client.com / client2345 (Client Approver)')
    console.log('='.repeat(50))
  } catch (err) {
    console.error('Fatal error:', err)
    process.exit(1)
  }
}

main()
