'use client'

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  FIRST_TOUCH_COOKIE,
  decodeFirstTouchCookie,
  buildAcquisitionRecord,
  type FirstTouch,
  type AcquisitionRecord,
} from '@/lib/acquisition/firstTouch'

/** document.cookie 形式の文字列から first-touch cookie を取り出す（無ければ null） */
export function readFirstTouchCookie(cookieString: string): FirstTouch | null {
  const prefix = `${FIRST_TOUCH_COOKIE}=`
  for (const part of cookieString.split(';')) {
    const trimmed = part.trim()
    if (trimmed.startsWith(prefix)) return decodeFirstTouchCookie(trimmed.slice(prefix.length))
  }
  return null
}

/** cookie → RPC に渡す形。cookie が無ければ channel=direct（RPC 側で登録時 metadata から補完する） */
export function buildAcquisitionPayload(cookieString: string): AcquisitionRecord {
  return buildAcquisitionRecord(readFirstTouchCookie(cookieString))
}

/**
 * 組織作成の直後に、作成者（オーナー）として流入経路を記録する。
 * 分析のための記録なので、失敗してもオンボーディングは止めない（警告ログのみ）。
 */
export async function recordOrgAcquisition(
  supabase: SupabaseClient,
  orgId: string,
  cookieString: string = typeof document === 'undefined' ? '' : document.cookie,
): Promise<void> {
  try {
    const { error } = await supabase.rpc('rpc_record_org_acquisition', {
      p_org_id: orgId,
      p_data: buildAcquisitionPayload(cookieString),
    })
    if (error) console.warn('Failed to record org acquisition:', error.message)
  } catch (err) {
    console.warn('Failed to record org acquisition:', err)
  }
}
