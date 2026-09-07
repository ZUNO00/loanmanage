import { describe, expect, it } from 'vitest'
import { computeDashboardSummary } from './dashboard'
import type { Debt } from './types'

function debt(overrides: Partial<Debt>): Debt {
  return {
    id: overrides.id ?? 'd',
    user_id: 'u1',
    type: 'credit_card',
    name: 'x',
    amount: null,
    due_day: null,
    due_time: null,
    account_number: null,
    bank_name: null,
    account_holder: null,
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

describe('computeDashboardSummary', () => {
  const now = new Date(2026, 8, 5) // Sep 5, 2026

  it('sums payable vs receivable for the current month', () => {
    const debts = [
      debt({ id: 'card', type: 'credit_card', amount: 3500000, due_day: 20 }),
      debt({ id: 'lend', type: 'lend_out', repayment_mode: 'recurring', principal_amount: 5000000, interest_rate_pct: 2, due_day: 15 }),
    ]
    const summary = computeDashboardSummary(debts, new Set(), now)
    expect(summary.totalPayableThisMonth).toBe(3500000)
    expect(summary.totalReceivableThisMonth).toBe(100000)
    expect(summary.net).toBe(100000 - 3500000)
  })

  it('lists overdue unpaid occurrences', () => {
    const debts = [debt({ id: 'overdue', type: 'loan', amount: 1000000, due_day: 1, due_time: '08:00' })]
    const summary = computeDashboardSummary(debts, new Set(), now)
    expect(summary.overdue).toHaveLength(1)
    expect(summary.overdue[0].debt.id).toBe('overdue')
  })

  it('excludes paid occurrences from overdue', () => {
    // created_at this same month: no earlier period could legitimately be
    // overdue, so paying the current period must clear the debt entirely.
    const debts = [debt({ id: 'paid', type: 'loan', amount: 1000000, due_day: 1, due_time: '08:00', created_at: '2026-09-01T00:00:00Z' })]
    const summary = computeDashboardSummary(debts, new Set(['paid:2026-09']), now)
    expect(summary.overdue).toHaveLength(0)
  })
})
