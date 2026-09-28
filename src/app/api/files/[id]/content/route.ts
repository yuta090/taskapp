import { NextRequest, NextResponse } from 'next/server'
import { mfaGuardResponse } from '@/lib/auth/apiMfaGuard'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

import { UUID_REGEX } from '@/lib/uuid'
import { isTabularFile, MAX_TABLE_FILE_BYTES } from '@/lib/table/tableModel'
import { fetchStorageObject } from '@/lib/supabase/storageObject'

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
    const mfaBlock = await mfaGuardResponse(supabase as SupabaseClient, user)
    if (mfaBlock) return mfaBlock

    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'Invalid file ID' }, { status: 400 })
    }

    const { data: file, error: fileError } = await (supabase as SupabaseClient)
      .from('files')
      .select('id, name, mime_type, size_bytes, status, storage_path, updated_at')
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

    // 版(updated_at)を付けて取りにいく。storage.download() は上書き直後に古い中身を
    // 返し続けることがあり、「直して読み込み直すと元に戻る」ように見える
    // (理由と実測は src/lib/supabase/storageObject.ts のコメント)
    const objectRes = await fetchStorageObject('space-files', file.storage_path, file.updated_at)

    if (!objectRes.ok || !objectRes.body) {
      console.error('File content download error:', objectRes.status)
      return NextResponse.json({ error: 'Failed to read file' }, { status: 500 })
    }

    // DB の size_bytes が NULL のファイルが素通りしないよう、実サイズでもう一度確認する
    const contentLength = Number(objectRes.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_TABLE_FILE_BYTES) {
      return NextResponse.json({ error: 'File too large for table view' }, { status: 413 })
    }

    // - text/plain: CDN の自動圧縮(gzip/brotli)が効く(CSV は5〜10倍縮む)。中身の解釈は
    //   ブラウザ側が arrayBuffer で読んで自前で文字コード判定するので Content-Type に依存しない
    // - stream: 丸ごと組み立てず流す(応答サイズ上限の緩和・メモリ節約)
    // - no-cache: 表の編集(PUT)で**同じ id のまま中身が変わる**ようになったため、
    //   以前の「本人限定で1時間キャッシュ」は使えない(直した直後に再読み込みすると
    //   ブラウザが古い中身を出してしまう)。store はしてよいが必ず問い合わせ直す。
    //   同じ画面を開いている間の取得回数は useFileTable の staleTime が抑える。
    return new NextResponse(objectRes.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-cache',
        // 直したものを保存する(PUT)ときの基準。中身と版を同じ応答で渡すことで、
        // 「読んだ中身」と「基準の版」がずれないようにする
        ...(file.updated_at ? { 'X-Updated-At': String(file.updated_at) } : {}),
      },
    })
  } catch (error) {
    console.error('File content error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT: 表として直した中身で、同じファイル(同じ id・同じ置き場所)を書き換える。
//
// 設計上の要点:
// - 直せるのは社内メンバーだけ。相手先(client/vendor)は 403(PATCH と同じ判定)。
// - 保存には必ず「基準の updated_at」(X-Base-Updated-At)を付ける。ズレていたら 409 で
//   止める。無条件の上書きは、同時に直した相手の変更を黙って消すため許さない。
// - 順番は **DB が先・Storage が後**。逆にすると、競合に気づく前に相手のバイトを
//   上書きしてしまう(DB が 0 行で止まっても、もうファイルは壊れている)。
// - 中身(CSV テキスト)の組み立てはブラウザ側(src/lib/table/serializeDelimited)で行い、
//   ここは受け取ったバイトをそのまま置く。GET と対称。
export async function PUT(
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
    const mfaBlock = await mfaGuardResponse(supabase as SupabaseClient, user)
    if (mfaBlock) return mfaBlock

    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'Invalid file ID' }, { status: 400 })
    }

    const baseUpdatedAt = request.headers.get('x-base-updated-at')
    if (!baseUpdatedAt) {
      return NextResponse.json({ error: 'X-Base-Updated-At header is required' }, { status: 400 })
    }

    const body = await request.arrayBuffer()
    if (body.byteLength === 0) {
      return NextResponse.json({ error: 'Empty content' }, { status: 400 })
    }
    if (body.byteLength > MAX_TABLE_FILE_BYTES) {
      return NextResponse.json({ error: 'File too large for table view' }, { status: 413 })
    }

    const { data: file, error: fileError } = await (supabase as SupabaseClient)
      .from('files')
      .select('id, space_id, name, mime_type, status, storage_path')
      .eq('id', id)
      .single()

    if (fileError || !file || file.status !== 'ready') {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    if (!isTabularFile(file.name, file.mime_type ?? '')) {
      return NextResponse.json({ error: 'File is not tabular' }, { status: 415 })
    }

    // 内部ロールのみ許可(client/vendor は 403)。PATCH(公開トグル・リネーム)と同じ扱い
    const { data: internalMembership } = await (supabase as SupabaseClient)
      .from('space_memberships')
      .select('id')
      .eq('space_id', file.space_id)
      .eq('user_id', user.id)
      .neq('role', 'client')
      .neq('role', 'vendor')
      .single()

    if (!internalMembership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // 基準の updated_at を条件に付けて先に行を押さえる。updated_at はトリガーで進むので、
    // 0 行なら「自分が読んでから誰かが保存した」(または行が消えた)ということ。
    const { data: updatedRows, error: updateError } = await (supabase as SupabaseClient)
      .from('files')
      .update({ size_bytes: body.byteLength })
      .eq('id', id)
      .eq('updated_at', baseUpdatedAt)
      .select('id, updated_at')

    if (updateError) {
      console.error('File content update error:', updateError)
      return NextResponse.json({ error: 'Failed to save file' }, { status: 500 })
    }

    const rows = (updatedRows ?? []) as Array<{ id: string; updated_at: string }>
    const updated = rows.at(0)
    if (!updated) {
      return NextResponse.json(
        { error: 'このファイルは、別の場所で更新されています' },
        { status: 409 }
      )
    }

    const admin = createAdminClient()
    const { error: uploadError } = await admin.storage
      .from('space-files')
      .upload(file.storage_path, body, {
        upsert: true,
        contentType: file.mime_type || 'text/csv',
      })

    if (uploadError) {
      console.error('File content upload error:', uploadError)
      // 行の版はもう進んでいる。同じ基準でやり直すと必ず 409 になり、書きかけが
      // 行き止まりになるため、新しい版を返して「この基準でやり直せる」ようにする。
      return NextResponse.json(
        { error: 'Failed to write file', updatedAt: updated.updated_at },
        { status: 500 }
      )
    }

    return NextResponse.json({ updatedAt: updated.updated_at, sizeBytes: body.byteLength })
  } catch (error) {
    console.error('File content save error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
