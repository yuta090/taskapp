import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Missing SUPABASE env vars in .env.local')
  process.exit(1)
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function main() {
  // 1. Test service role key
  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .select('id, name')
    .limit(1)
  if (orgErr) {
    console.error('Service key invalid:', orgErr.message)
    process.exit(1)
  }
  console.log('Service key OK! Org:', org[0]?.name)

  // 2. Ensure vendor users exist and are confirmed
  const vendorUsers = [
    { email: 'vendor1@vendor.com', password: 'vendor1234', name: '中村 健太' },
    { email: 'vendor2@vendor.com', password: 'vendor2345', name: '松本 理恵' },
  ]

  for (const vu of vendorUsers) {
    const { data: list } = await supabase.auth.admin.listUsers()
    const existing = list?.users?.find((u) => u.email === vu.email)

    if (existing) {
      console.log(`  ${vu.email} exists (${existing.id})`)
      if (!existing.email_confirmed_at) {
        const { error: confirmErr } = await supabase.auth.admin.updateUserById(
          existing.id,
          { email_confirm: true }
        )
        if (confirmErr) console.error('    Confirm error:', confirmErr.message)
        else console.log('    -> Email confirmed!')
      } else {
        console.log('    Already confirmed')
      }
    } else {
      const { data: created, error: createErr } =
        await supabase.auth.admin.createUser({
          email: vu.email,
          password: vu.password,
          email_confirm: true,
          user_metadata: { name: vu.name },
        })
      if (createErr) {
        console.error(`  Create ${vu.email} error:`, createErr.message)
      } else {
        console.log(`  Created ${vu.email} (${created.user.id})`)
      }
    }
  }

  // 3. Create profiles for vendor users
  const { data: allUsers } = await supabase.auth.admin.listUsers()
  const v1 = allUsers?.users?.find((u) => u.email === 'vendor1@vendor.com')
  const v2 = allUsers?.users?.find((u) => u.email === 'vendor2@vendor.com')

  if (v1) {
    await supabase
      .from('profiles')
      .upsert({ id: v1.id, display_name: '中村 健太' })
    console.log('  Profile: 中村 健太')
  }
  if (v2) {
    await supabase
      .from('profiles')
      .upsert({ id: v2.id, display_name: '松本 理恵' })
    console.log('  Profile: 松本 理恵')
  }

  // 4. Verify login works
  console.log('\nTesting login...')
  const { data: loginData, error: loginErr } =
    await supabase.auth.signInWithPassword({
      email: 'vendor1@vendor.com',
      password: 'vendor1234',
    })
  if (loginErr) console.error('Login test FAILED:', loginErr.message)
  else console.log('Login test OK:', loginData.user?.id)

  // 5. Get all user IDs for seed reference
  console.log('\n--- User IDs for seed ---')
  const emails = [
    'demo@example.com',
    'staff1@example.com',
    'client1@client.com',
    'vendor1@vendor.com',
    'vendor2@vendor.com',
  ]
  for (const email of emails) {
    const u = allUsers?.users?.find((x) => x.email === email)
    if (u) console.log(`  ${email}: ${u.id}`)
    else console.log(`  ${email}: NOT FOUND`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
