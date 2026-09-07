import { describe, expect, it } from 'vitest'
import {
  getOccurrenceForPeriod,
  getOccurrencesInRange,
  getRelevantOccurrence,
  getReminderThresholdMs,
  paymentKey,
} from './schedule'
import type { Debt } from './types'

function baseDebt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: 'd1',
    user_id: 'u1',
    type: 'credit_card',
    name: 'Thẻ VIB',
    amount: 3500000,
    due_day: 9,
    due_time: null,
    account_number: '0123456789',
    bank_name: 'VIB',
    account_holder: 'Nguyen Van A',
    counterparty_name: null,
    principal_amount: null,
    interest_rate_pct: null,
    repayment_mode: null,
    start_date: null,
    due_date: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('getOccurrenceForPeriod', () => {
  it('computes the due date for a normal day-of-month', () => {
    const occ = getOccurrenceForPeriod(baseDebt(), 2026, 8) // September (0-indexed)
    expect(occ?.dueAt.getFullYear()).toBe(2026)
    expect(occ?.dueAt.getMonth()).toBe(8)
    expect(occ?.dueAt.getDate()).toBe(9)
    expect(occ?.period).toBe('2026-09')
    expect(occ?.amount).toBe(3500000)
  })

  it('clamps due_day=31 to the last day of February', () => {
    const occ = getOccurrenceForPeriod(baseDebt({ due_day: 31 }), 2026, 1) // February
    expect(occ?.dueAt.getDate()).toBe(28)
  })

  it('computes recurring interest for lend_out (principal x rate)', () => {
    const debt = baseDebt({
      type: 'lend_out',
      repayment_mode: 'recurring',
      amount: null,
      principal_amount: 5000000,
      interest_rate_pct: 2,
      due_day: 15,
    })
    const occ = getOccurrenceForPeriod(debt, 2026, 8)
    expect(occ?.amount).toBe(100000) // 5,000,000 * 2%
    expect(occ?.isReceivable).toBe(true)
  })

  it('computes one_time principal+interest over elapsed months', () => {
    const debt = baseDebt({
      type: 'borrow_in',
      repayment_mode: 'one_time',
      amount: null,
      principal_amount: 5000000,
      interest_rate_pct: 2,
      start_date: '2026-09-01',
      due_date: '2026-11-20',
    })
    const occ = getOccurrenceForPeriod(debt, 2026, 10) // November
    // 2026-09-01 -> 2026-11-20 spans 3 calendar months (Sep, Oct, Nov partial rounds up)
    expect(occ?.amount).toBe(5300000) // 5,000,000 + 5,000,000*2%*3
    expect(occ?.period).toBe('2026-11-20')
  })

  it('returns null for one_time debts outside the given month', () => {
    const debt = baseDebt({
      type: 'lend_out',
      repayment_mode: 'one_time',
      due_date: '2026-11-20',
    })
    expect(getOccurrenceForPeriod(debt, 2026, 8)).toBeNull()
  })
})

describe('getRelevantOccurrence', () => {
  it('returns the current month when unpaid', () => {
    const now = new Date(2026, 8, 5) // Sep 5, before due day 9
    // created_at is this same month: there's no earlier period that could
    // ever have been overdue, so the 1-month lookback must not invent one.
    const debt = baseDebt({ created_at: '2026-09-01T00:00:00Z' })
    const occ = getRelevantOccurrence(debt, new Set(), now)
    expect(occ?.period).toBe('2026-09')
  })

  it('falls back to last month when it is overdue and unpaid', () => {
    const now = new Date(2026, 9, 3) // Oct 3 — September's due day 9 has passed unpaid
    const occ = getRelevantOccurrence(baseDebt(), new Set(), now)
    expect(occ?.period).toBe('2026-09')
  })

  it('advances to the current month once the previous one is paid', () => {
    const now = new Date(2026, 9, 3) // Oct 3
    const paid = new Set([paymentKey('d1', '2026-09')])
    const occ = getRelevantOccurrence(baseDebt(), paid, now)
    expect(occ?.period).toBe('2026-10')
  })

  it('returns null once a one_time debt is paid', () => {
    const debt = baseDebt({ type: 'lend_out', repayment_mode: 'one_time', due_date: '2026-09-09' })
    const paid = new Set([paymentKey('d1', '2026-09-09')])
    expect(getRelevantOccurrence(debt, paid, new Date(2026, 8, 5))).toBeNull()
  })

  it('returns null for inactive debts', () => {
    expect(getRelevantOccurrence(baseDebt({ is_active: false }), new Set(), new Date(2026, 8, 5))).toBeNull()
  })

  it('surfaces an unpaid previous month even when the current month is already paid', () => {
    const now = new Date(2026, 9, 3) // Oct 3
    const paid = new Set([paymentKey('d1', '2026-10')]) // this month paid, last month is not
    const occ = getRelevantOccurrence(baseDebt(), paid, now)
    expect(occ?.period).toBe('2026-09')
  })
})

describe('getOccurrencesInRange', () => {
  it('finds occurrences across a range spanning two months', () => {
    // due_day=2: September's occurrence (Sep 2) falls before the range and
    // is excluded; only October's (Oct 2) lands inside [Sep 28, Oct 4].
    // This proves the range collector actually checks both months, not
    // just the range's start month.
    const debt = baseDebt({ due_day: 2 })
    const rangeStart = new Date(2026, 8, 28)
    const rangeEnd = new Date(2026, 9, 4)
    const results = getOccurrencesInRange([debt], new Set(), rangeStart, rangeEnd)
    expect(results).toHaveLength(1)
    expect(results[0].occurrence.period).toBe('2026-10')
  })
})

describe('getReminderThresholdMs', () => {
  it('is 2 days before due for credit_card', () => {
    const debt = baseDebt()
    const occ = getOccurrenceForPeriod(debt, 2026, 8)!
    const threshold = getReminderThresholdMs(debt, occ)
    expect(occ.dueAt.getTime() - threshold).toBe(2 * 24 * 60 * 60 * 1000)
  })

  it('is 24 hours before due for loan/lend_out/borrow_in', () => {
    const debt = baseDebt({ type: 'loan', due_time: '16:00' })
    const occ = getOccurrenceForPeriod(debt, 2026, 8)!
    const threshold = getReminderThresholdMs(debt, occ)
    expect(occ.dueAt.getTime() - threshold).toBe(24 * 60 * 60 * 1000)
  })
})
