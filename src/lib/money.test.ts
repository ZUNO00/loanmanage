import { describe, expect, it } from 'vitest'
import { formatMoney, parseMoneyDigits, formatMoneyInput } from './money'

describe('formatMoney', () => {
  it('formats with Vietnamese thousand separators', () => {
    expect(formatMoney(14000000)).toBe('14.000.000')
    expect(formatMoney(0)).toBe('0')
  })
})

describe('parseMoneyDigits', () => {
  it('strips separators back to a plain number', () => {
    expect(parseMoneyDigits('14.000.000')).toBe(14000000)
    expect(parseMoneyDigits('')).toBe(0)
  })
})

describe('formatMoneyInput', () => {
  it('reformats a raw typed value live', () => {
    expect(formatMoneyInput('14000000')).toBe('14.000.000')
  })
})
