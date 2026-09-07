import { describe, expect, it } from 'vitest'
import { parseDictation } from './dictation'

describe('parseDictation', () => {
  it('parses a full free-form sentence', () => {
    const result = parseDictation(
      'ngân hàng BIDV số tài khoản 19029384756 nợ 4 triệu ngày 20/11/2026 lúc 4h chiều phải trả',
    )
    expect(result.bankName).toBe('BIDV')
    expect(result.accountNumber).toBe('19029384756')
    expect(result.amount).toBe(4000000)
    expect(result.date).toBe('2026-11-20')
    expect(result.time).toBe('16:00')
    expect(result.type).toBe('loan')
  })

  it('recognizes credit card and k-unit amounts', () => {
    const result = parseDictation('thẻ tín dụng nợ 14k')
    expect(result.type).toBe('credit_card')
    expect(result.amount).toBe(14000)
  })

  it('recognizes lend_out vs borrow_in', () => {
    expect(parseDictation('cho Minh vay 2 triệu').type).toBe('lend_out')
    expect(parseDictation('mượn Lan 500k').type).toBe('borrow_in')
  })

  it('leaves fields undefined when not recognized', () => {
    const result = parseDictation('không rõ thông tin gì cả')
    expect(result.amount).toBeUndefined()
    expect(result.date).toBeUndefined()
  })
})
