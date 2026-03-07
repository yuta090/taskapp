import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const SPACE_ID = 'dddddddd-0000-0000-0000-000000000001'

async function getUserId(email) {
  const { data } = await supabase.auth.admin.listUsers()
  const u = data?.users?.find((x) => x.email === email)
  if (!u) throw new Error(`User ${email} not found`)
  return u.id
}

async function main() {
  console.log('Resolving user IDs...')
  const demoId = await getUserId('demo@example.com')
  const staff1Id = await getUserId('staff1@example.com')
  const client1Id = await getUserId('client1@client.com')
  const vendor1Id = await getUserId('vendor1@vendor.com')
  const vendor2Id = await getUserId('vendor2@vendor.com')

  console.log('  demo:', demoId)
  console.log('  staff1:', staff1Id)
  console.log('  client1:', client1Id)
  console.log('  vendor1:', vendor1Id)
  console.log('  vendor2:', vendor2Id)

  // 1. Agency Mode Space
  console.log('\nCreating agency space...')
  const { error: spaceErr } = await supabase.from('spaces').upsert({
    id: SPACE_ID,
    org_id: ORG_ID,
    type: 'project',
    name: 'CM動画制作プロジェクト',
    agency_mode: true,
    default_margin_rate: 35.0,
    vendor_settings: { show_client_name: false, allow_client_comments: false },
  })
  if (spaceErr) console.error('  Space error:', spaceErr.message)
  else console.log('  Space created (agency_mode=true)')

  // 2. Org Memberships for vendors
  console.log('\nSetting org memberships...')
  for (const uid of [vendor1Id, vendor2Id]) {
    const { error } = await supabase
      .from('org_memberships')
      .upsert({ org_id: ORG_ID, user_id: uid, role: 'client' }, { onConflict: 'org_id,user_id' })
    if (error) console.error('  Org membership error:', error.message)
  }
  console.log('  Vendor org memberships OK')

  // 3. Space Memberships
  console.log('\nSetting space memberships...')
  await supabase.from('space_memberships').delete().eq('space_id', SPACE_ID)
  const members = [
    { space_id: SPACE_ID, user_id: demoId, role: 'admin' },
    { space_id: SPACE_ID, user_id: staff1Id, role: 'editor' },
    { space_id: SPACE_ID, user_id: client1Id, role: 'client' },
    { space_id: SPACE_ID, user_id: vendor1Id, role: 'vendor' },
    { space_id: SPACE_ID, user_id: vendor2Id, role: 'vendor' },
  ]
  const { error: memErr } = await supabase.from('space_memberships').insert(members)
  if (memErr) console.error('  Membership error:', memErr.message)
  else console.log('  5 members assigned')

  // 4. Milestones
  console.log('\nCreating milestones...')
  await supabase.from('milestones').delete().eq('space_id', SPACE_ID)
  const now = new Date()
  const milestones = [
    { id: 'eeeeeeee-0001-0000-0000-000000000001', org_id: ORG_ID, space_id: SPACE_ID, name: 'プリプロダクション', status: 'done', due_date: dateOffset(now, -14), order_key: 1 },
    { id: 'eeeeeeee-0002-0000-0000-000000000001', org_id: ORG_ID, space_id: SPACE_ID, name: '撮影・制作', status: 'in_progress', due_date: dateOffset(now, 14), order_key: 2 },
    { id: 'eeeeeeee-0003-0000-0000-000000000001', org_id: ORG_ID, space_id: SPACE_ID, name: 'ポストプロダクション', status: 'backlog', due_date: dateOffset(now, 30), order_key: 3 },
    { id: 'eeeeeeee-0004-0000-0000-000000000001', org_id: ORG_ID, space_id: SPACE_ID, name: '納品・検収', status: 'backlog', due_date: dateOffset(now, 45), order_key: 4 },
  ]
  const { error: msErr } = await supabase.from('milestones').insert(milestones)
  if (msErr) console.error('  Milestone error:', msErr.message)
  else console.log('  4 milestones created')

  // 5. Tasks
  console.log('\nCreating tasks...')
  await supabase.from('tasks').delete().eq('space_id', SPACE_ID)
  const tasks = [
    // vendor ball
    { id: 'ffffffff-0001-0000-0000-000000000001', org_id: ORG_ID, space_id: SPACE_ID, title: 'ロケハン候補地リスト作成', status: 'in_progress', ball: 'vendor', origin: 'internal', type: 'task', due_date: dateOffset(now, 3), assignee_id: vendor1Id, milestone_id: 'eeeeeeee-0002-0000-0000-000000000001', created_by: demoId },
    { id: 'ffffffff-0002-0000-0000-000000000001', org_id: ORG_ID, space_id: SPACE_ID, title: 'キャスティング候補者リスト', status: 'todo', ball: 'vendor', origin: 'internal', type: 'task', due_date: dateOffset(now, 5), assignee_id: vendor2Id, milestone_id: 'eeeeeeee-0002-0000-0000-000000000001', created_by: demoId },
    { id: 'ffffffff-0003-0000-0000-000000000001', org_id: ORG_ID, space_id: SPACE_ID, title: '撮影スケジュール案の作成', status: 'todo', ball: 'vendor', origin: 'internal', type: 'task', due_date: dateOffset(now, 7), assignee_id: vendor1Id, milestone_id: 'eeeeeeee-0002-0000-0000-000000000001', created_by: demoId },
    // agency ball
    { id: 'ffffffff-0004-0000-0000-000000000001', org_id: ORG_ID, space_id: SPACE_ID, title: 'クライアント向けコンテ修正', status: 'in_progress', ball: 'agency', origin: 'internal', type: 'task', due_date: dateOffset(now, 2), assignee_id: staff1Id, milestone_id: 'eeeeeeee-0002-0000-0000-000000000001', created_by: demoId },
    { id: 'ffffffff-0005-0000-0000-000000000001', org_id: ORG_ID, space_id: SPACE_ID, title: 'ベンダー見積もり確認・承認', status: 'todo', ball: 'agency', origin: 'internal', type: 'task', due_date: dateOffset(now, 4), assignee_id: demoId, milestone_id: 'eeeeeeee-0002-0000-0000-000000000001', created_by: demoId },
    // client ball
    { id: 'ffffffff-0006-0000-0000-000000000001', org_id: ORG_ID, space_id: SPACE_ID, title: '絵コンテ最終承認', status: 'considering', ball: 'client', origin: 'internal', type: 'task', due_date: dateOffset(now, 1), milestone_id: 'eeeeeeee-0002-0000-0000-000000000001', created_by: demoId },
    { id: 'ffffffff-0007-0000-0000-000000000001', org_id: ORG_ID, space_id: SPACE_ID, title: 'ナレーション原稿承認', status: 'considering', ball: 'client', origin: 'internal', type: 'task', due_date: dateOffset(now, -2), milestone_id: 'eeeeeeee-0002-0000-0000-000000000001', created_by: demoId },
    // internal ball
    { id: 'ffffffff-0008-0000-0000-000000000001', org_id: ORG_ID, space_id: SPACE_ID, title: '楽曲ライセンス契約手配', status: 'in_progress', ball: 'internal', origin: 'internal', type: 'task', due_date: dateOffset(now, 10), assignee_id: demoId, milestone_id: 'eeeeeeee-0003-0000-0000-000000000001', created_by: demoId },
    // done
    { id: 'ffffffff-0009-0000-0000-000000000001', org_id: ORG_ID, space_id: SPACE_ID, title: 'プロジェクトキックオフ', status: 'done', ball: 'internal', origin: 'internal', type: 'task', due_date: dateOffset(now, -20), milestone_id: 'eeeeeeee-0001-0000-0000-000000000001', created_by: demoId },
    { id: 'ffffffff-0010-0000-0000-000000000001', org_id: ORG_ID, space_id: SPACE_ID, title: '企画書・コンセプト作成', status: 'done', ball: 'internal', origin: 'internal', type: 'task', due_date: dateOffset(now, -15), milestone_id: 'eeeeeeee-0001-0000-0000-000000000001', created_by: demoId },
    { id: 'ffffffff-0011-0000-0000-000000000001', org_id: ORG_ID, space_id: SPACE_ID, title: '予算概算提出', status: 'done', ball: 'internal', origin: 'client', type: 'task', due_date: dateOffset(now, -10), milestone_id: 'eeeeeeee-0001-0000-0000-000000000001', created_by: demoId },
  ]
  const { error: taskErr } = await supabase.from('tasks').insert(tasks)
  if (taskErr) console.error('  Task error:', taskErr.message)
  else console.log('  11 tasks created')

  // 6. Task Pricing
  console.log('\nCreating task pricing...')
  await supabase.from('task_pricing').delete().in('task_id', [
    'ffffffff-0001-0000-0000-000000000001',
    'ffffffff-0002-0000-0000-000000000001',
    'ffffffff-0004-0000-0000-000000000001',
    'ffffffff-0011-0000-0000-000000000001',
  ])
  const pricing = [
    // vendor submitted, awaiting agency approval
    { org_id: ORG_ID, space_id: SPACE_ID, task_id: 'ffffffff-0001-0000-0000-000000000001', cost_hours: 40, cost_unit_price: 5000, sell_mode: 'margin', margin_rate: 35, sell_total: 270000, vendor_submitted_at: new Date(now.getTime() - 86400000).toISOString() },
    // no pricing yet
    { org_id: ORG_ID, space_id: SPACE_ID, task_id: 'ffffffff-0002-0000-0000-000000000001', cost_hours: 24, cost_unit_price: 4500, sell_mode: 'margin', margin_rate: 35 },
    // agency approved, awaiting client approval
    { org_id: ORG_ID, space_id: SPACE_ID, task_id: 'ffffffff-0004-0000-0000-000000000001', cost_hours: 60, cost_unit_price: 5500, sell_mode: 'margin', margin_rate: 30, sell_total: 429000, vendor_submitted_at: new Date(now.getTime() - 5*86400000).toISOString(), agency_approved_at: new Date(now.getTime() - 3*86400000).toISOString() },
    // fully approved (fixed price)
    { org_id: ORG_ID, space_id: SPACE_ID, task_id: 'ffffffff-0011-0000-0000-000000000001', cost_hours: 30, cost_unit_price: 5000, sell_mode: 'fixed', sell_total: 250000, vendor_submitted_at: new Date(now.getTime() - 15*86400000).toISOString(), agency_approved_at: new Date(now.getTime() - 13*86400000).toISOString(), client_approved_at: new Date(now.getTime() - 10*86400000).toISOString() },
  ]
  const { error: priceErr } = await supabase.from('task_pricing').insert(pricing)
  if (priceErr) console.error('  Pricing error:', priceErr.message)
  else console.log('  4 pricing records created')

  // 7. Summary
  console.log('\n=== Agency Test Data Summary ===')
  console.log('Space: CM動画制作プロジェクト (agency_mode=true)')
  console.log('Margin rate: 35%')
  console.log('Tasks: 11 (3 vendor, 2 agency, 2 client, 1 internal, 3 done)')
  console.log('Pricing: 4 records (various approval states)')
  console.log('')
  console.log('Login accounts:')
  console.log('  Agency PM:   demo@example.com / demo1234')
  console.log('  Designer:    staff1@example.com / staff1234')
  console.log('  Client:      client1@client.com / client1234')
  console.log('  Vendor Dir:  vendor1@vendor.com / vendor1234')
  console.log('  Vendor Des:  vendor2@vendor.com / vendor2345')
}

function dateOffset(base, days) {
  const d = new Date(base.getTime() + days * 86400000)
  return d.toISOString().split('T')[0]
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
