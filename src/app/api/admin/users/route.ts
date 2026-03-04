import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

async function verifySuperadmin(): Promise<boolean> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false

  const { data: profile } = await (supabase as SupabaseClient)
    .from('profiles')
    .select('is_superadmin')
    .eq('id', user.id)
    .single()

  return !!profile?.is_superadmin
}

// POST /api/admin/users - Create a new user
export async function POST(request: NextRequest) {
  const isSuperadmin = await verifySuperadmin()
  if (!isSuperadmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { email, password, displayName } = await request.json()

    if (!email || !password) {
      return NextResponse.json({ error: 'email and password required' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // プロフィール更新
    if (data.user && displayName) {
      await admin
        .from('profiles')
        .update({ display_name: displayName })
        .eq('id', data.user.id)
    }

    return NextResponse.json({ user: data.user })
  } catch (err: unknown) {
    console.error('Admin user creation error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
