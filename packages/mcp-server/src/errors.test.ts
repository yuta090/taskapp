import { describe, it, expect } from 'vitest'
import { ToolUserError } from './errors.js'

/**
 * ToolUserError は呼んだ人にそのまま見せる文言（message/status）に加え、
 * 原因（DBの生のエラー等）を cause として保持できる。cause は呼んだ人には返らず、
 * /api/tools・/api/mcp の利用記録（error_detail）にだけ使われる。
 */
describe('ToolUserError', () => {
  it('cause を渡さなくても今まで通り動く', () => {
    const err = new ToolUserError('見つかりません', 404)
    expect(err.message).toBe('見つかりません')
    expect(err.status).toBe(404)
    expect(err.cause).toBeUndefined()
  })

  it('cause を渡すと保持する', () => {
    const dbError = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }
    const err = new ToolUserError('見つかりません', 404, { cause: dbError })
    expect(err.cause).toEqual(dbError)
  })
})
