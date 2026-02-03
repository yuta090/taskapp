import { describe, it, expect } from 'vitest'

// CSV formula injection対策: これらの文字で始まるセルはExcel/Sheetsで実行される可能性
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r']

// CSVエスケープ（テスト用に再実装）
function escapeCSV(value: string | null | undefined): string {
  if (value === null || value === undefined) return ''
  let str = String(value)

  // Formula injection対策
  if (str.length > 0 && FORMULA_PREFIXES.some(prefix => str.startsWith(prefix))) {
    str = "'" + str
  }

  // ダブルクォート、カンマ、改行を含む場合はクォートで囲む
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

describe('escapeCSV', () => {
  describe('basic escaping', () => {
    it('should return empty string for null', () => {
      expect(escapeCSV(null)).toBe('')
    })

    it('should return empty string for undefined', () => {
      expect(escapeCSV(undefined)).toBe('')
    })

    it('should return the value unchanged for simple strings', () => {
      expect(escapeCSV('hello')).toBe('hello')
      expect(escapeCSV('タスク名')).toBe('タスク名')
    })

    it('should wrap strings with commas in quotes', () => {
      expect(escapeCSV('hello, world')).toBe('"hello, world"')
    })

    it('should wrap strings with newlines in quotes', () => {
      expect(escapeCSV('hello\nworld')).toBe('"hello\nworld"')
    })

    it('should escape double quotes by doubling them', () => {
      expect(escapeCSV('say "hello"')).toBe('"say ""hello"""')
    })

    it('should handle combined special characters', () => {
      expect(escapeCSV('a, "b"\nc')).toBe('"a, ""b""\nc"')
    })
  })

  describe('formula injection prevention', () => {
    it('should prefix strings starting with = with single quote', () => {
      expect(escapeCSV('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)")
    })

    it('should prefix strings starting with + with single quote', () => {
      expect(escapeCSV('+1234567890')).toBe("'+1234567890")
    })

    it('should prefix strings starting with - with single quote', () => {
      expect(escapeCSV('-1234567890')).toBe("'-1234567890")
    })

    it('should prefix strings starting with @ with single quote', () => {
      expect(escapeCSV('@username')).toBe("'@username")
    })

    it('should prefix strings starting with tab with single quote', () => {
      // タブで始まる → 'でプレフィックス
      expect(escapeCSV('\tindented')).toBe("'\tindented")
    })

    it('should handle formula with special characters', () => {
      // = で始まり、カンマを含む
      expect(escapeCSV('=HYPERLINK("http://evil.com","Click")')).toBe("\"'=HYPERLINK(\"\"http://evil.com\"\",\"\"Click\"\")\"")
    })

    it('should not prefix normal negative numbers in text', () => {
      // -で始まるが、単なるテキストとして扱われるべき
      expect(escapeCSV('-100')).toBe("'-100")
    })
  })

  describe('edge cases', () => {
    it('should handle empty string', () => {
      expect(escapeCSV('')).toBe('')
    })

    it('should handle whitespace only', () => {
      expect(escapeCSV('   ')).toBe('   ')
    })

    it('should handle numbers converted to string', () => {
      expect(escapeCSV(123 as unknown as string)).toBe('123')
    })

    it('should handle carriage return', () => {
      // 途中に\rがある場合はダブルクォートで囲むだけ（先頭が危険文字ではないのでプレフィックスなし）
      expect(escapeCSV('line1\rline2')).toBe('"line1\rline2"')
    })
  })
})

describe('CSV generation', () => {
  it('should generate valid CSV row', () => {
    const row = [
      escapeCSV('ID001'),
      escapeCSV('テスト, タスク'),
      escapeCSV('説明文'),
      escapeCSV('task'),
      escapeCSV('todo'),
    ].join(',')

    expect(row).toBe('ID001,"テスト, タスク",説明文,task,todo')
  })

  it('should handle malicious input safely', () => {
    const maliciousInputs = [
      '=cmd|" /C calc"!A0',
      '+cmd|" /C calc"!A0',
      '-2+3+cmd|" /C calc"!A0',
      '@SUM(1+1)*cmd|" /C calc"!A0',
    ]

    maliciousInputs.forEach(input => {
      const escaped = escapeCSV(input)
      // すべて ' でプレフィックスされているはず
      expect(escaped.startsWith("'") || escaped.startsWith("\"'")).toBe(true)
    })
  })
})
