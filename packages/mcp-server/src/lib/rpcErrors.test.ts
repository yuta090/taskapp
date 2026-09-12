import { describe, it, expect } from 'vitest'
import { mapRaiseExceptionError, mapConfirmProposalError } from './rpcErrors.js'

/**
 * DB の断りの理由（RAISE EXCEPTION の文言・rpc_confirm_proposal_slot_as の jsonb の
 * error コード）を、呼んだ人に見せてよい決まった日本語(ToolUserError)に置き換える。
 * 認識できない理由は、中身を隠した一般的なエラーのまま返す。
 */

describe('mapRaiseExceptionError', () => {
  it('会議が見つからない場合は404', () => {
    const err = mapRaiseExceptionError('Meeting not found: abc-123', '会議の開始に失敗しました')
    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
  })

  it('会議を終了する権限が無い場合は403', () => {
    const err = mapRaiseExceptionError('Not authorized to end this meeting', '会議の終了に失敗しました')
    expect(err).toMatchObject({ name: 'ToolUserError', status: 403 })
  })

  it('会議を開始する権限が無い場合は403', () => {
    const err = mapRaiseExceptionError('Not authorized to access this meeting', '会議の開始に失敗しました')
    expect(err).toMatchObject({ name: 'ToolUserError', status: 403 })
  })

  it('会議が進行中でないのに終了しようとすると409で現在の状態を日本語で含める', () => {
    const err = mapRaiseExceptionError(
      'Meeting can only end from in_progress status, current: planned',
      '会議の終了に失敗しました'
    )
    expect(err).toMatchObject({ name: 'ToolUserError', status: 409 })
    expect((err as Error).message).toContain('開始前')
    expect((err as Error).message).not.toContain('planned')
  })

  it('会議が計画中でないのに開始しようとすると409で現在の状態を日本語で含める', () => {
    const err = mapRaiseExceptionError(
      'Meeting can only start from planned status, current: ended',
      '会議の開始に失敗しました'
    )
    expect(err).toMatchObject({ name: 'ToolUserError', status: 409 })
    expect((err as Error).message).toContain('終了済み')
    expect((err as Error).message).not.toContain('ended')
  })

  it('タスクが見つからない場合は404', () => {
    const err = mapRaiseExceptionError('Task not found: abc-123', 'ボール移動に失敗しました')
    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
  })

  it('タスクへの権限が無い場合は403', () => {
    const err = mapRaiseExceptionError('Not authorized to access this task', 'ボール移動に失敗しました')
    expect(err).toMatchObject({ name: 'ToolUserError', status: 403 })
  })

  it('レビューが見つからない場合は404', () => {
    const err = mapRaiseExceptionError('No review found for task: abc-123', 'レビューの承認に失敗しました')
    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
  })

  it('レビューへの権限が無い場合は403', () => {
    const err = mapRaiseExceptionError('Not authorized to access this review', 'レビューの承認に失敗しました')
    expect(err).toMatchObject({ name: 'ToolUserError', status: 403 })
  })

  it('レビュアーでない人が承認/ブロックしようとすると403', () => {
    const err = mapRaiseExceptionError('User is not a reviewer for this task', 'レビューの承認に失敗しました')
    expect(err).toMatchObject({ name: 'ToolUserError', status: 403 })
  })

  it('社内の管理者/編集者でない人がレビューを依頼しようとすると403', () => {
    const err = mapRaiseExceptionError(
      'Insufficient permissions: you must be an admin or editor in this space',
      'レビューの開始に失敗しました'
    )
    expect(err).toMatchObject({ name: 'ToolUserError', status: 403 })
  })

  it('認識できない理由は、そのまま一般的なエラー（中身を隠す）にする', () => {
    const err = mapRaiseExceptionError('some unexpected internal detail', 'ボール移動に失敗しました')
    expect(err).not.toMatchObject({ name: 'ToolUserError' })
    expect((err as Error).message).toBe('ボール移動に失敗しました')
  })
})

describe('mapConfirmProposalError', () => {
  it('proposal_not_found は404', () => {
    const err = mapConfirmProposalError({ error: 'proposal_not_found' })
    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
  })

  it('not_authorized は403', () => {
    const err = mapConfirmProposalError({ error: 'not_authorized' })
    expect(err).toMatchObject({ name: 'ToolUserError', status: 403 })
  })

  it('proposal_not_open は409で現在の状態を日本語で含める', () => {
    const err = mapConfirmProposalError({ error: 'proposal_not_open', current_status: 'cancelled' })
    expect(err).toMatchObject({ name: 'ToolUserError', status: 409 })
    expect((err as Error).message).toContain('キャンセル済み')
    expect((err as Error).message).not.toContain('cancelled')
  })

  it('slot_not_found は404', () => {
    const err = mapConfirmProposalError({ error: 'slot_not_found' })
    expect(err).toMatchObject({ name: 'ToolUserError', status: 404 })
  })

  it('not_all_agreed は409', () => {
    const err = mapConfirmProposalError({ error: 'not_all_agreed' })
    expect(err).toMatchObject({ name: 'ToolUserError', status: 409 })
  })

  it('認識できない理由は、そのまま一般的なエラー（中身を隠す）にする', () => {
    const err = mapConfirmProposalError({ error: 'something_new' })
    expect(err).not.toMatchObject({ name: 'ToolUserError' })
  })

  it('data自体が無ければ一般的なエラー', () => {
    const err = mapConfirmProposalError(null)
    expect(err).not.toMatchObject({ name: 'ToolUserError' })
  })
})
