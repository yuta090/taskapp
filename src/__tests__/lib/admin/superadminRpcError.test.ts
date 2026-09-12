import { describe, it, expect } from 'vitest'
import { isMfaPendingRpcError } from '@/lib/admin/superadminRpcError'

describe('isMfaPendingRpcError', () => {
  it('code=42501 かつ message=mfa_required のときだけ true', () => {
    expect(isMfaPendingRpcError({ code: '42501', message: 'mfa_required' })).toBe(true)
  })

  it('42501でも message が違えば別の理由（例: 関数の実行権が無い）なのでfalse', () => {
    expect(isMfaPendingRpcError({ code: '42501', message: 'permission denied for function rpc_is_superadmin' })).toBe(
      false
    )
  })

  it('42501以外・無ければfalse', () => {
    expect(isMfaPendingRpcError({ code: 'PGRST116', message: 'mfa_required' })).toBe(false)
    expect(isMfaPendingRpcError(null)).toBe(false)
    expect(isMfaPendingRpcError(undefined)).toBe(false)
    expect(isMfaPendingRpcError({})).toBe(false)
  })
})
