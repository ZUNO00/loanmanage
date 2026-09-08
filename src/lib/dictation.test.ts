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

  it('parses the "củ" amount unit (worth 1,000,000)', () => {
    expect(parseDictation('nợ 5 củ').amount).toBe(5000000)
  })

  it('does not misclassify an ordinary loan sentence that merely contains "cho" elsewhere', () => {
    const result = parseDictation(
      'vay ngân hàng Vietcombank 20 triệu, nhớ đừng quên trả cho đúng hẹn',
    )
    expect(result.type).toBe('loan')
  })

  it('resolves a day/month with no year to this year, or next year if already past', () => {
    // These two assertions are relative to "now" — the test fixes both
    // sides of the comparison using the same Date.now(), so it holds on
    // any run date.
    const future = new Date()
    future.setDate(future.getDate() + 30)
    const futureStr = `${String(future.getDate()).padStart(2, '0')}/${String(future.getMonth() + 1).padStart(2, '0')}`
    const result = parseDictation(`hẹn ngày ${futureStr}`)
    expect(result.date).toBe(
      `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`,
    )
  })

  it('parses verbose "ngày D tháng M năm Y" and "ngày D tháng M" (no year)', () => {
    expect(parseDictation('họp ngày 20 tháng 9 năm 2027').date).toBe('2027-09-20')
    const now = new Date()
    const verbose = parseDictation('họp ngày 20 tháng 9')
    const expectedYear = new Date(now.getFullYear(), 8, 20) < new Date(now.getFullYear(), now.getMonth(), now.getDate())
      ? now.getFullYear() + 1
      : now.getFullYear()
    expect(verbose.date).toBe(`${expectedYear}-09-20`)
  })

  it('resolves "hôm nay" and "ngày mai" to concrete dates', () => {
    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    expect(parseDictation('hẹn hôm nay lúc 3h').date).toBe(todayStr)

    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
    expect(parseDictation('nhắc tôi ngày mai nhé').date).toBe(tomorrowStr)
  })

  it('does not let an amount range like "5-6 triệu" hijack a "ngày mai" reminder', () => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
    expect(parseDictation('vay 5-6 triệu, hẹn trả ngày mai').date).toBe(tomorrowStr)
  })
})
