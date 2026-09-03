import { describe, expect, it } from 'vitest'
import { formatBytes, formatSpeed } from '../src/shared/format'

describe('formatBytes / formatSpeed (M1-3)', () => {
  it('renders MB and GB with sensible precision', () => {
    expect(formatBytes(0)).toBe('0 MB')
    expect(formatBytes(412 * 1024 * 1024)).toBe('412.0 MB')
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe('1.50 GB')
  })

  it('renders speed in MB/s and falls back to KB/s', () => {
    expect(formatSpeed(2.1 * 1024 * 1024)).toBe('2.1 MB/s')
    expect(formatSpeed(512 * 1024)).toBe('512 KB/s')
    expect(formatSpeed(0)).toBe('')
  })
})
