import { NextRequest, NextResponse } from 'next/server'
import { mfaGuardResponse } from '@/lib/auth/apiMfaGuard'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

import { UUID_REGEX } from '@/lib/uuid'
import { isTabularFile, MAX_TABLE_FILE_BYTES } from '@/lib/table/tableModel'

// GET: 表ビュー用に、表として扱えるファイル(.csv/.tsv)の生バイトをそのまま返す。
// 可視性はRLSに従う(見えなければ404)。download と違い署名URLへ飛ばさず自分で返すのは、
// ブラウザから fetch で読むときに Storage 側の CORS に依存させないため。
// 文字コード判定と表への変換はクライアント側(src/lib/table)で行う。
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
    // 二要素認証: 登録済み × コード未入力(aal1) は service role で触る前に弾く（RLS 経由でない経路の防衛）
    const mfaBlock = await mfaGuardResponse(supabase as SupabaseClient)
    if (mfaBlock) return mfaBlock

    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'Invalid file ID' }, { status: 400 })
    }

    const { data: file, error: fileError } = await (supabase as SupabaseClient)
      .from('files')
      .select('id, name, mime_type, size_bytes, status, storage_path')
      .eq('id', id)
      .single()

    if (fileError || !file || file.status !== 'ready') {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    if (!isTabularFile(file.name, file.mime_type ?? '')) {
      return NextResponse.json({ error: 'File is not tabular' }, { status: 415 })
    }

    if (typeof file.size_bytes === 'number' && file.size_bytes > MAX_TABLE_FILE_BYTES) {
      return NextResponse.json({ error: 'File too large for table view' }, { status: 413 })
    }

    const admin = createAdminClient()
    const { data: blob, error: downloadError } = await admin.storage
      .from('space-files')
      .download(file.storage_path)

    if (downloadError || !blob) {
      console.error('File content download error:', downloadError)
      return NextResponse.json({ error: 'Failed to read file' }, { status: 500 })
    }

    // DB の size_bytes が NULL のファイルが素通りしないよう、実サイズでもう一度確認する
    if (blob.size > MAX_TABLE_FILE_BYTES) {
      return NextResponse.json({ error: 'File too large for table view' }, { status: 413 })
    }

    // - text/plain: CDN の自動圧縮(gzip/brotli)が効く(CSV は5〜10倍縮む)。中身の解釈は
    //   ブラウザ側が arrayBuffer で読んで自前で文字コード判定するので Content-Type に依存しない
    // - stream: 丸ごと組み立てず流す(応答サイズ上限の緩和・メモリ節約)
    // - 同じ id の中身は変わらない(差し替えは別 id)ため本人限定で 1 時間キャッシュ可
    return new NextResponse(blob.stream(), {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (error) {
    console.error('File content error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
