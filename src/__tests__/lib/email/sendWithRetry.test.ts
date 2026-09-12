import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendEmailWithRetry } from '@/lib/email/sendWithRetry'
import type { Resend } from 'resend'

/**
 * Resend の送信回数の上限(429・error.name === 'rate_limit_exceeded')にかかったときだけ、
 * 間隔を空けて数回だけ数え直す。上限以外の理由はそのまま返す（無限に粘らない）。
 */
describe('sendEmailWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function makeResend(sendMock: ReturnType<typeof vi.fn>): Resend {
    return { emails: { send: sendMock } } as unknown as Resend
  }

  it('最初から成功すれば、そのまま返す（待たない）', async () => {
    const send = vi.fn().mockResolvedValue({ data: { id: 'm1' }, error: null })
    const result = await sendEmailWithRetry(makeResend(send), { from: 'a', to: 'b', subject: 's', html: 'h' } as never)

    expect(result).toEqual({ data: { id: 'm1' }, error: null })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('rate_limit_exceededなら間隔をあけて数え直し、そのあと成功すれば返す', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { name: 'rate_limit_exceeded', message: 'Too many requests' } })
      .mockResolvedValueOnce({ data: { id: 'm2' }, error: null })

    const promise = sendEmailWithRetry(makeResend(send), { from: 'a', to: 'b', subject: 's', html: 'h' } as never)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toEqual({ data: { id: 'm2' }, error: null })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('statusCode=429（name は rate_limit_exceeded 以外）でも数え直す', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { name: 'application_error', statusCode: 429, message: 'Too many requests' } })
      .mockResolvedValueOnce({ data: { id: 'm3' }, error: null })

    const promise = sendEmailWithRetry(makeResend(send), { from: 'a', to: 'b', subject: 's', html: 'h' } as never)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toEqual({ data: { id: 'm3' }, error: null })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('rate_limit_exceeded以外のエラーは数え直さずそのまま返す', async () => {
    const send = vi.fn().mockResolvedValue({ data: null, error: { name: 'validation_error', message: '宛先が不正です' } })
    const result = await sendEmailWithRetry(makeResend(send), { from: 'a', to: 'b', subject: 's', html: 'h' } as never)

    expect(result.error).toMatchObject({ name: 'validation_error' })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('上限回数を数え直しても続けて断られたら、最後の失敗をそのまま返す', async () => {
    const send = vi.fn().mockResolvedValue({ data: null, error: { name: 'rate_limit_exceeded', message: 'Too many requests' } })

    const promise = sendEmailWithRetry(makeResend(send), { from: 'a', to: 'b', subject: 's', html: 'h' } as never, 3)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.error).toMatchObject({ name: 'rate_limit_exceeded' })
    // 最初の1回 + リトライ3回 = 4回
    expect(send).toHaveBeenCalledTimes(4)
  })
})
