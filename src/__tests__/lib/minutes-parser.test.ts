import { describe, it, expect } from 'vitest'
import {
  parseSpecLine,
  parseMinutes,
  addTaskMarker,
  updateMinutesWithMarkers,
  parseDueDateToISO,
} from '@/lib/minutes-parser'

describe('minutes-parser', () => {
  describe('parseSpecLine', () => {
    it('parses a basic SPEC line', () => {
      const line = '- [ ] SPEC(/spec/REVIEW_SPEC.md#meeting-minutes): 仕様を決める'
      const result = parseSpecLine(line, 0)

      expect(result).not.toBeNull()
      expect(result?.specPath).toBe('/spec/REVIEW_SPEC.md#meeting-minutes')
      expect(result?.title).toBe('仕様を決める')
      expect(result?.hasMarker).toBe(false)
      expect(result?.existingTaskId).toBeNull()
    })

    it('parses SPEC line with due date (Japanese parentheses)', () => {
      const line = '- [ ] SPEC(/spec/AUTH.md#login): ログイン仕様（期限: 02/15, 担当: 田中）'
      const result = parseSpecLine(line, 0)

      expect(result).not.toBeNull()
      expect(result?.specPath).toBe('/spec/AUTH.md#login')
      expect(result?.title).toBe('ログイン仕様')
      expect(result?.dueDate).toBe('02/15')
      expect(result?.assignee).toBe('田中')
    })

    it('parses SPEC line with due date (ASCII parentheses)', () => {
      const line = '- [ ] SPEC(/spec/API.md#endpoint): API設計 (期限: 2024/03/01, 担当: 山田)'
      const result = parseSpecLine(line, 0)

      expect(result).not.toBeNull()
      expect(result?.specPath).toBe('/spec/API.md#endpoint')
      expect(result?.title).toBe('API設計')
      expect(result?.dueDate).toBe('2024/03/01')
      expect(result?.assignee).toBe('山田')
    })

    it('detects existing task marker', () => {
      const line = '- [ ] SPEC(/spec/UI.md#modal): モーダル設計 <!--task:t123-->'
      const result = parseSpecLine(line, 5)

      expect(result).not.toBeNull()
      expect(result?.hasMarker).toBe(true)
      expect(result?.existingTaskId).toBe('t123')
      expect(result?.lineIndex).toBe(5)
    })

    it('returns null for non-SPEC lines', () => {
      expect(parseSpecLine('- [ ] TODO: 普通のタスク', 0)).toBeNull()
      expect(parseSpecLine('## 見出し', 0)).toBeNull()
      expect(parseSpecLine('- 箇条書き', 0)).toBeNull()
    })

    it('returns null for invalid spec_path format', () => {
      // Missing /spec/ prefix
      expect(parseSpecLine('- [ ] SPEC(/docs/file.md#anchor): test', 0)).toBeNull()
      // Missing # anchor
      expect(parseSpecLine('- [ ] SPEC(/spec/file.md): test', 0)).toBeNull()
      // Empty anchor (strict validation)
      expect(parseSpecLine('- [ ] SPEC(/spec/file.md#): test', 0)).toBeNull()
      // Empty file before #
      expect(parseSpecLine('- [ ] SPEC(/spec/#anchor): test', 0)).toBeNull()
      // Whitespace in spec_path
      expect(parseSpecLine('- [ ] SPEC(/spec/file name.md#anchor): test', 0)).toBeNull()
    })

    it('handles trailing whitespace in marker detection', () => {
      const lineWithTrailingSpace = '- [ ] SPEC(/spec/UI.md#modal): モーダル設計 <!--task:t123-->   '
      const result = parseSpecLine(lineWithTrailingSpace, 0)

      expect(result).not.toBeNull()
      expect(result?.hasMarker).toBe(true)
      expect(result?.existingTaskId).toBe('t123')
    })

    it('rejects checked checkbox (only unchecked are processed)', () => {
      // Checked checkboxes should be skipped
      expect(parseSpecLine('- [x] SPEC(/spec/DONE.md#task): 完了済み', 0)).toBeNull()
      expect(parseSpecLine('- [X] SPEC(/spec/DONE.md#task): 完了済み', 0)).toBeNull()
    })
  })

  describe('parseMinutes', () => {
    it('parses multiple SPEC lines from markdown', () => {
      const markdown = `# 会議: テスト会議
日時: 2024/02/01 10:00

## 決定事項
- 機能Aを実装する

## 未決事項
- [ ] SPEC(/spec/FEATURE_A.md#design): 機能A設計（期限: 02/15）
- [ ] TODO: 通常タスク
- [ ] SPEC(/spec/FEATURE_B.md#api): 機能B API設計 <!--task:existing123-->

## メモ
- その他のメモ`

      const result = parseMinutes(markdown)

      expect(result.specLines).toHaveLength(2)
      expect(result.newSpecLines).toHaveLength(1)
      expect(result.existingSpecLines).toHaveLength(1)

      expect(result.newSpecLines[0].specPath).toBe('/spec/FEATURE_A.md#design')
      expect(result.existingSpecLines[0].existingTaskId).toBe('existing123')
    })

    it('handles empty markdown', () => {
      const result = parseMinutes('')
      expect(result.specLines).toHaveLength(0)
      expect(result.newSpecLines).toHaveLength(0)
      expect(result.existingSpecLines).toHaveLength(0)
    })

    it('handles markdown with no SPEC lines', () => {
      const markdown = `# 会議メモ
- [ ] TODO: タスク1
- [ ] TODO: タスク2`

      const result = parseMinutes(markdown)
      expect(result.specLines).toHaveLength(0)
    })
  })

  describe('addTaskMarker', () => {
    it('adds marker to line without marker', () => {
      const line = '- [ ] SPEC(/spec/test.md#anchor): タイトル'
      const result = addTaskMarker(line, 'task-uuid-123')

      expect(result).toBe('- [ ] SPEC(/spec/test.md#anchor): タイトル <!--task:task-uuid-123-->')
    })

    it('replaces existing marker', () => {
      const line = '- [ ] SPEC(/spec/test.md#anchor): タイトル <!--task:old-id-->'
      const result = addTaskMarker(line, 'new-id')

      expect(result).toBe('- [ ] SPEC(/spec/test.md#anchor): タイトル <!--task:new-id-->')
    })

    it('preserves leading indentation', () => {
      const line = '  - [ ] SPEC(/spec/test.md#anchor): ネストされたタスク'
      const result = addTaskMarker(line, 'nested-id')

      expect(result).toBe('  - [ ] SPEC(/spec/test.md#anchor): ネストされたタスク <!--task:nested-id-->')
    })

    it('removes trailing whitespace before adding marker', () => {
      const line = '- [ ] SPEC(/spec/test.md#anchor): タイトル   '
      const result = addTaskMarker(line, 'uuid')

      expect(result).toBe('- [ ] SPEC(/spec/test.md#anchor): タイトル <!--task:uuid-->')
    })
  })

  describe('updateMinutesWithMarkers', () => {
    it('updates multiple lines with markers', () => {
      const markdown = `Line 0
- [ ] SPEC(/spec/a.md#x): Task A
Line 2
- [ ] SPEC(/spec/b.md#y): Task B
Line 4`

      const mappings = new Map<number, string>([
        [1, 'uuid-a'],
        [3, 'uuid-b'],
      ])

      const result = updateMinutesWithMarkers(markdown, mappings)
      const lines = result.split('\n')

      expect(lines[1]).toContain('<!--task:uuid-a-->')
      expect(lines[3]).toContain('<!--task:uuid-b-->')
      expect(lines[0]).toBe('Line 0')
      expect(lines[4]).toBe('Line 4')
    })

    it('handles empty mappings', () => {
      const markdown = 'Line 1\nLine 2'
      const result = updateMinutesWithMarkers(markdown, new Map())
      expect(result).toBe(markdown)
    })
  })

  describe('parseDueDateToISO', () => {
    it('parses MM/DD format', () => {
      // Using a fixed reference year for deterministic tests
      const result = parseDueDateToISO('02/15', 2024)
      expect(result).toBe('2024-02-15')
    })

    it('parses YYYY/MM/DD format', () => {
      const result = parseDueDateToISO('2024/03/20', 2024)
      expect(result).toBe('2024-03-20')
    })

    it('handles single-digit month/day', () => {
      const result = parseDueDateToISO('3/5', 2024)
      expect(result).toBe('2024-03-05')
    })

    it('returns null for invalid date', () => {
      expect(parseDueDateToISO('invalid', 2024)).toBeNull()
      expect(parseDueDateToISO('', 2024)).toBeNull()
    })

    it('returns null for out-of-range month/day', () => {
      expect(parseDueDateToISO('13/15', 2024)).toBeNull() // Month > 12
      expect(parseDueDateToISO('0/15', 2024)).toBeNull()  // Month < 1
      expect(parseDueDateToISO('02/32', 2024)).toBeNull() // Day > 31
      expect(parseDueDateToISO('02/0', 2024)).toBeNull()  // Day < 1
    })

    it('returns null for invalid dates like Feb 30', () => {
      expect(parseDueDateToISO('02/30', 2024)).toBeNull()
      expect(parseDueDateToISO('02/31', 2024)).toBeNull()
      expect(parseDueDateToISO('04/31', 2024)).toBeNull() // April has 30 days
    })

    it('handles leap year correctly', () => {
      // 2024 is a leap year
      expect(parseDueDateToISO('02/29', 2024)).toBe('2024-02-29')
      // 2023 is not a leap year
      expect(parseDueDateToISO('02/29', 2023)).toBeNull()
    })
  })
})
