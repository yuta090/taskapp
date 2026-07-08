import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

import { UUID_REGEX } from '@/lib/uuid'

const SIGNED_URL_TTL_SECONDS = 60

// GET: 署名URLへの302リダイレクト。Wikiリンクとして貼られる安定したURL。
// 可視性はRLSに従う(見えなければ404)。pending状態のファイルも404扱いにする。
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'Invalid file ID' }, { status: 400 })
    }

    const { data: file, error: fileError } = await (supabase as SupabaseClient)
      .from('files')
      .select('id, name, status, storage_path')
      .eq('id', id)
      .single()

    if (fileError || !file || file.status !== 'ready') {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    const admin = createAdminClient()
    const { data: signed, error: signedError } = await admin.storage
      .from('space-files')
      .createSignedUrl(file.storage_path, SIGNED_URL_TTL_SECONDS, { download: file.name })

    if (signedError || !signed) {
      console.error('Signed download URL error:', signedError)
      return NextResponse.json({ error: 'Failed to create download URL' }, { status: 500 })
    }

    return NextResponse.redirect(signed.signedUrl, 302)
  } catch (error) {
    console.error('Download file error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
