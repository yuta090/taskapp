import { test, expect } from './fixtures'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fillLoginAndSubmit } from './login'

/**
 * 社内承認を「受信箱で押す」ところだけ、実ブラウザで通しで確かめる。
 *
 * 2026-09-18 に本番で「受信箱で承認を押してもステータスが変わらない」と報告が上がったとき、
 * **この一連を通す E2E が1本も無かった**。承認は画面・CLI・チャットのどこからでも動く中核で、
 * しかも「承認がそろうまで完了にできない」関所（enforce_review_gate）と組みになっている。
 * ここで押さえるのは3つ:
 *   1. 承認が終わるまでタスクを完了にできず、**その理由が画面に出る**
 *   2. 受信箱の「承認する」を押すと承認が入る
 *   3. 承認がそろうと、そのままタスクが完了になる（DB の _review_approve_impl）
 *
 * 依頼を作るところは画面ではなくサーバー側（rpc_review_open_as）で用意する。画面から作ると
 * 2人分のログインと十数回の遷移で6分の上限を超えるため、**確かめたい「押す」ところに絞る**。
 *
 * 承認者は自分以外の社内メンバーでなければならないので、テスト組織の佐藤花子で入り直す
 * （パスワードは seed と同じ DEMO_SEED_PASSWORD）。
 */

const ORG = '00000000-0000-0000-0000-000000000001'
const SPACE = '00000000-0000-0000-0000-000000000010'

const REQUESTER_EMAIL = process.env.E2E_EMAIL || 'demo@example.com'
const APPROVER_EMAIL = process.env.E2E_APPROVER_EMAIL || 'staff1@example.com'
const APPROVER_PASSWORD = process.env.DEMO_SEED_PASSWORD || 'staff1234'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

// 同時に走っても混ざらないよう、毎回変える
const TASK_TITLE = `[E2E] 社内承認の通し ${Date.now()}`

// 承認者としてログインし直すので、社内の storageState は使わない（portal-smoke と同じ流儀）
test.use({ storageState: { cookies: [], origins: [] } })

let admin: SupabaseClient
let taskId = ''

async function userIdOf(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) throw new Error(`ユーザー一覧を取れません: ${error.message}`)
  const user = data.users.find((u) => u.email === email)
  if (!user) throw new Error(`テスト組織に ${email} がいません（seed-test-data.ts を流してください）`)
  return user.id
}

test.beforeAll(async () => {
  test.skip(
    !SUPABASE_URL || !SERVICE_ROLE_KEY,
    'NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が無いので飛ばす'
  )
  admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  const requesterId = await userIdOf(REQUESTER_EMAIL)
  const approverId = await userIdOf(APPROVER_EMAIL)

  const { data: task, error: taskError } = await admin
    .from('tasks')
    .insert({
      org_id: ORG,
      space_id: SPACE,
      title: TASK_TITLE,
      status: 'in_progress',
      ball: 'internal',
      origin: 'internal',
      type: 'task',
      client_scope: 'internal',
      created_by: requesterId,
      assignee_id: requesterId,
    })
    .select('id')
    .single()
  if (taskError || !task) throw new Error(`タスクを作れません: ${taskError?.message}`)
  taskId = (task as { id: string }).id

  // 依頼は本番と同じ道（道具用の rpc_review_open_as）で作る。通知もここで生まれる
  const { error: openError } = await admin.rpc('rpc_review_open_as', {
    p_actor: requesterId,
    p_task_id: taskId,
    p_reviewer_ids: [approverId],
  })
  if (openError) throw new Error(`社内承認を依頼できません: ${openError.message}`)
})

test.afterAll(async () => {
  if (!admin || !taskId) return
  await admin.from('notifications').delete().eq('payload->>task_id', taskId)
  await admin.from('tasks').delete().eq('id', taskId)
})

test.describe('社内承認: 受信箱で承認する', () => {
  test('承認が終わるまで完了にできず、承認するとタスクが完了になる', async ({ page }) => {
    // hydration 前に入力すると値が消えて送信自体が起きない（tests/e2e/login.ts 参照）
    await fillLoginAndSubmit(page, '', APPROVER_EMAIL, APPROVER_PASSWORD)
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })

    await page.goto('/inbox')
    // 受信箱の既定は「未読のみ」。一度開くと既読になって消えるので、確実に出しておく
    await page.getByRole('button', { name: 'すべて', exact: true }).first().click()

    const notice = page.getByText(`社内承認の依頼: 「${TASK_TITLE}」`).first()
    await expect(notice).toBeVisible({ timeout: 30_000 })
    await notice.click()

    // 依頼を出した時点でタスクは「社内承認中」になっている
    const statusButton = page.getByRole('button', { name: /社内承認中/ })
    await expect(statusButton).toBeVisible({ timeout: 20_000 })

    // 1. 承認より先に完了にしようとすると断られ、理由が画面に出る
    await statusButton.click()
    await page.getByRole('button', { name: '完了', exact: true }).click()
    await expect(
      page.getByText('社内の承認が終わっていないので、まだ完了にできません')
    ).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: /社内承認中/ })).toBeVisible()

    // 2. 承認する。ボタンは testid で取る —「承認するか、理由を添えて差し戻してください」
    //    という本文を持つ通知の行も、役割＋名前では一緒に引っかかるため
    await page.getByTestId('inbox-review-approve').click()

    // 3. 承認がそろったので、DB 側がそのままタスクを完了にする
    await expect(page.getByTestId('inbox-review-result')).toContainText(
      '承認しました。タスクを完了にしました',
      { timeout: 20_000 }
    )

    // 画面の言い分だけでなく、保存された結果も見る
    const { data: saved } = await admin
      .from('tasks')
      .select('status, completed_at')
      .eq('id', taskId)
      .single()
    expect((saved as { status: string } | null)?.status).toBe('done')
    expect((saved as { completed_at: string | null } | null)?.completed_at).toBeTruthy()

    const { data: review } = await admin
      .from('reviews')
      .select('status, review_approvals(state)')
      .eq('task_id', taskId)
      .single()
    expect((review as { status: string } | null)?.status).toBe('approved')
    expect(
      (review as { review_approvals: { state: string }[] } | null)?.review_approvals.map((a) => a.state)
    ).toEqual(['approved'])
  })
})
