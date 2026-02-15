import { createClient } from '@supabase/supabase-js'
import { getSlackClientForOrg } from './client'
import type { SupabaseClient } from '@supabase/supabase-js'

let _supabaseAdmin: ReturnType<typeof createClient> | null = null
function getSupabaseAdmin() {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _supabaseAdmin
}

export interface TaskAppUser {
  userId: string
  displayName: string
}

/**
 * Slack ユーザーID から TaskApp ユーザーを解決する
 * Slack users.info API でメールを取得し、auth.users + profiles で照合
 */
export async function resolveTaskAppUser(
  slackUserId: string,
  orgId: string,
): Promise<TaskAppUser | null> {
  try {
    // Slack API でユーザー情報を取得
    const slackClient = await getSlackClientForOrg(orgId)
    const slackUser = await slackClient.users.info({ user: slackUserId })

    const email = slackUser.user?.profile?.email
    if (!email) return null

    // admin API でメールからユーザーを検索
    const { data: authData, error: authError } =
      await (getSupabaseAdmin() as SupabaseClient).auth.admin.listUsers()

    if (authError || !authData?.users) return null

    const authUser = authData.users.find((u: { email?: string }) => u.email === email)
    if (!authUser) return null

    // profiles テーブルから display_name を取得
    const { data: profile, error: profileError } = await (getSupabaseAdmin() as SupabaseClient)
      .from('profiles' as never)
      .select('display_name' as never)
      .eq('id' as never, authUser.id as never)
      .single()

    if (profileError || !profile) {
      return { userId: authUser.id, displayName: email.split('@')[0] }
    }

    const row = profile as unknown as { display_name: string }
    return {
      userId: authUser.id,
      displayName: row.display_name || email.split('@')[0],
    }
  } catch {
    return null
  }
}
