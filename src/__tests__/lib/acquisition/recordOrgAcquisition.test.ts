import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  readFirstTouchCookie,
  buildAcquisitionPayload,
  recordOrgAcquisition,
} from '@/lib/acquisition/recordOrgAcquisition'
import { encodeFirstTouchCookie } from '@/lib/acquisition/firstTouch'

const NOW = '2026-09-07T10:00:00.000Z'
const COOKIE = encodeFirstTouchCookie({ utm_source: 'google', utm_medium: 'cpc', landing_path: '/lp1', at: NOW })

describe('readFirstTouchCookie', () => {
  it('他の cookie に混じっていても取り出せる', () => {
    const ft = readFirstTouchCookie(`activeOrgId=abc; agentpm_ft=${COOKIE}; other=1`)
    expect(ft?.utm_source).toBe('google')
  })

  it('無ければ null', () => {
    expect(readFirstTouchCookie('activeOrgId=abc')).toBeNull()
    expect(readFirstTouchCookie('')).toBeNull()
  })
})

describe('buildAcquisitionPayload', () => {
  it('cookie から流入経路つきの記録を作る', () => {
    expect(buildAcquisitionPayload(`agentpm_ft=${COOKIE}`)).toEqual({
      channel: 'paid_ad',
      utm_source: 'google',
      utm_medium: 'cpc',
      landing_path: '/lp1',
      first_touch_at: NOW,
    })
  })

  it('cookie が無ければ direct（RPC 側で登録時の metadata から補完する）', () => {
    expect(buildAcquisitionPayload('')).toEqual({ channel: 'direct' })
  })
})

describe('recordOrgAcquisition', () => {
  it('オーナーとして RPC を呼ぶ', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null })
    await recordOrgAcquisition({ rpc } as unknown as SupabaseClient, 'org-1', `agentpm_ft=${COOKIE}`)
    expect(rpc).toHaveBeenCalledWith('rpc_record_org_acquisition', {
      p_org_id: 'org-1',
      p_data: expect.objectContaining({ channel: 'paid_ad', utm_source: 'google' }),
    })
  })

  it('失敗しても例外を投げない（オンボーディングを止めない）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rpc = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(recordOrgAcquisition({ rpc } as unknown as SupabaseClient, 'org-1', '')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
