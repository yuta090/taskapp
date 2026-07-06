import { describe, it, expect } from 'vitest'
import { formatFileSize } from './format'

describe('formatFileSize', () => {
  it('returns "0 B" for zero bytes', () => {
    expect(formatFileSize(0)).toBe('0 B')
  })

  it('formats bytes below 1KB as B', () => {
    expect(formatFileSize(512)).toBe('512 B')
  })

  it('formats kilobytes with one decimal', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB')
  })

  it('formats megabytes', () => {
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5 MB')
  })

  it('formats gigabytes', () => {
    expect(formatFileSize(2 * 1024 * 1024 * 1024)).toBe('2 GB')
  })
})
