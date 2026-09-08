import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FileDescriptionInput } from '@/components/files/FileDescriptionInput'

/**
 * 説明文の入力欄。書きかけの文字は「この部品の中だけ」で持つ。
 * 親（一覧）が持つと、1文字打つたびに全部の行を作り直すことになる。
 */

const onCommit = vi.fn()
const onCancel = vi.fn()

beforeEach(() => vi.clearAllMocks())

function renderInput(initialValue = '') {
  return render(
    <FileDescriptionInput
      testId="file-description-input-f1"
      initialValue={initialValue}
      onCommit={onCommit}
      onCancel={onCancel}
    />
  )
}

describe('FileDescriptionInput', () => {
  it('もとの説明を入れた状態で開く', () => {
    renderInput('もとの説明')
    expect((screen.getByTestId('file-description-input-f1') as HTMLInputElement).value).toBe('もとの説明')
  })

  it('打っている間は親に知らせない(親を再描画させない)', () => {
    renderInput('')
    fireEvent.change(screen.getByTestId('file-description-input-f1'), { target: { value: 'あ' } })
    fireEvent.change(screen.getByTestId('file-description-input-f1'), { target: { value: 'あい' } })

    expect(onCommit).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('Enter で前後の空白を落として渡す', () => {
    renderInput('')
    const input = screen.getByTestId('file-description-input-f1')
    fireEvent.change(input, { target: { value: '  毎月の元データ  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onCommit).toHaveBeenCalledWith('毎月の元データ')
  })

  it('空にして Enter すると null(説明を消す)を渡す', () => {
    renderInput('もとの説明')
    const input = screen.getByTestId('file-description-input-f1')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onCommit).toHaveBeenCalledWith(null)
  })

  it('中身が変わっていなければ保存せず閉じるだけ', () => {
    renderInput('もとの説明')
    fireEvent.keyDown(screen.getByTestId('file-description-input-f1'), { key: 'Enter' })

    expect(onCommit).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalled()
  })

  it('Esc は保存しない', () => {
    renderInput('もとの説明')
    const input = screen.getByTestId('file-description-input-f1')
    fireEvent.change(input, { target: { value: '書きかけ' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onCommit).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalled()
  })

  it('よそを押して外れたときも保存する', () => {
    renderInput('')
    const input = screen.getByTestId('file-description-input-f1')
    fireEvent.change(input, { target: { value: '書いた' } })
    fireEvent.blur(input)

    expect(onCommit).toHaveBeenCalledWith('書いた')
  })

  it('Esc のあとに外れても二重に保存しない', () => {
    renderInput('もとの説明')
    const input = screen.getByTestId('file-description-input-f1')
    fireEvent.change(input, { target: { value: '書きかけ' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.blur(input)

    expect(onCommit).not.toHaveBeenCalled()
  })
})
