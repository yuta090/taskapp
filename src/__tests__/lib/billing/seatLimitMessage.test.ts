import { describe, it, expect } from 'vitest'
import { seatLimitFromRpcError } from '@/lib/billing/seatLimitMessage'

/**
 * DB(rpc_check_org_limits経由)が投げる英語例外を、日本語の案内＋402に畳めていることを固定する。
 * RPC側の文言は複数バリエーションが実在するため、両方を回帰対象にする:
 *   - 'Organization has reached member limit'（20240103_000_auth_billing.sql の accept 経路）
 *   - 'Organization has reached member limit. Please upgrade your plan.'（create 経路）
 */
describe('seatLimitFromRpcError', () => {
  it.each([
    'Organization has reached member limit',
    'Organization has reached member limit. Please upgrade your plan.',
  ])('メンバー枠の例外(%s)を member_limit_reached に分類する', (msg) => {
    const info = seatLimitFromRpcError(msg, 'create')
    expect(info?.code).toBe('member_limit_reached')
    expect(info?.status).toBe(402)
    expect(info?.message).toContain('メンバー')
  })

  it.each([
    'Organization has reached client limit',
    'Organization has reached client limit. Please upgrade your plan.',
  ])('相手先枠の例外(%s)を client_limit_reached に分類する', (msg) => {
    expect(seatLimitFromRpcError(msg, 'create')?.code).toBe('client_limit_reached')
  })

  it('招待する側と招待される側で案内を出し分ける（本人にできることが違う）', () => {
    const create = seatLimitFromRpcError('Organization has reached member limit', 'create')
    const accept = seatLimitFromRpcError('Organization has reached member limit', 'accept')
    expect(create?.message).toContain('アップグレード')
    expect(accept?.message).toContain('管理者')
    expect(create?.message).not.toBe(accept?.message)
  })

  it('人数枠と無関係なエラーは null（従来どおりの扱いに戻す）', () => {
    expect(seatLimitFromRpcError('invite expired', 'create')).toBeNull()
    expect(seatLimitFromRpcError('already a member', 'create')).toBeNull()
    expect(seatLimitFromRpcError(null, 'create')).toBeNull()
    expect(seatLimitFromRpcError(undefined, 'accept')).toBeNull()
  })
})
