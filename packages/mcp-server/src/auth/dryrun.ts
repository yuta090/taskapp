/**
 * Dry Run / Confirm Module
 *
 * 破壊的操作の2段階確認を提供
 */

import { getSupabaseClient } from '../supabase/client.js'
import type { AuthContext } from './authorize.js'
import { translateDryRunBusinessError } from '../lib/rpcErrors.js'

export interface DryRunResult {
  success: boolean
  dryRun: true
  affectedCount: number
  resourceType: string
  resourceIds: string[]
  confirmToken: string
  expiresInSeconds: number
  message: string
  error?: string
}

export interface ConfirmResult {
  success: boolean
  deletedCount?: number
  resourceType?: string
  error?: string
}

/**
 * 削除のdry runを実行
 * 実際には削除せず、影響件数と確認トークンを返す
 */
export async function dryRunDelete(params: {
  ctx: AuthContext
  spaceId: string
  resourceType: string
  resourceIds: string[]
}): Promise<DryRunResult> {
  const supabase = getSupabaseClient()

  const { data, error } = await supabase.rpc('mcp_dry_run_delete', {
    p_key_id: params.ctx.keyId,
    p_space_id: params.spaceId,
    p_resource_type: params.resourceType,
    p_resource_ids: params.resourceIds,
  })

  if (error) {
    // 詳しい内容はサーバーの記録だけに残し、呼んだ人には決まった日本語を返す
    console.error('mcp_dry_run_delete failed:', error.code, error.message)
    return {
      success: false,
      dryRun: true,
      affectedCount: 0,
      resourceType: params.resourceType,
      resourceIds: params.resourceIds,
      confirmToken: '',
      expiresInSeconds: 0,
      message: '',
      error: '削除の下見に失敗しました。しばらくしてからやり直してください',
    }
  }

  return {
    success: data.success,
    dryRun: true,
    affectedCount: data.affected_count,
    resourceType: data.resource_type,
    resourceIds: data.resource_ids,
    confirmToken: data.confirm_token,
    expiresInSeconds: data.expires_in_seconds,
    message: data.message,
    error: translateDryRunBusinessError(data.error),
  }
}

/**
 * 確認トークンを使用して実際の削除を実行
 */
export async function confirmDelete(params: {
  ctx: AuthContext
  confirmToken: string
}): Promise<ConfirmResult> {
  const supabase = getSupabaseClient()

  const { data, error } = await supabase.rpc('mcp_confirm_delete', {
    p_key_id: params.ctx.keyId,
    p_confirm_token: params.confirmToken,
  })

  if (error) {
    // 詳しい内容はサーバーの記録だけに残し、呼んだ人には決まった日本語を返す
    console.error('mcp_confirm_delete failed:', error.code, error.message)
    return {
      success: false,
      error: '削除の確定に失敗しました。しばらくしてからやり直してください',
    }
  }

  return {
    success: data.success,
    deletedCount: data.deleted_count,
    resourceType: data.resource_type,
    error: translateDryRunBusinessError(data.error),
  }
}
