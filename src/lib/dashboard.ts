import type { Debt } from './types'
import { getOccurrencesInRange, getRelevantOccurrence, paymentKey, type Occurrence } from './schedule'

export interface DashboardSummary {
  totalPayableThisMonth: number
  totalReceivableThisMonth: number
  net: number
  monthlyInterestReceivable: number
  monthlyInterestPayable: number
  overdue: Array<{ debt: Debt; occurrence: Occurrence }>
}

export function computeDashboardSummary(debts: Debt[], paidKeys: Set<string>, now: Date = new Date()): DashboardSummary {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
  const thisMonth = getOccurrencesInRange(debts, paidKeys, monthStart, monthEnd)

  let totalPayableThisMonth = 0
  let totalReceivableThisMonth = 0
  for (const { debt, occurrence } of thisMonth) {
    if (occurrence.isReceivable) totalReceivableThisMonth += occurrence.amount
    else totalPayableThisMonth += occurrence.amount
  }

  let monthlyInterestReceivable = 0
  let monthlyInterestPayable = 0
  for (const debt of debts) {
    if (!debt.is_active || debt.repayment_mode !== 'recurring') continue
    const interest = ((debt.principal_amount ?? 0) * (debt.interest_rate_pct ?? 0)) / 100
    if (debt.type === 'lend_out') monthlyInterestReceivable += interest
    if (debt.type === 'borrow_in') monthlyInterestPayable += interest
  }

  // Reuse getRelevantOccurrence (not a raw range scan) so each debt
  // contributes at most one overdue row — the same "current unpaid period"
  // the reminder Edge Function nags about, not every stale month at once.
  const overdue: Array<{ debt: Debt; occurrence: Occurrence }> = []
  for (const debt of debts) {
    const occurrence = getRelevantOccurrence(debt, paidKeys, now)
    if (occurrence && occurrence.dueAt < now) overdue.push({ debt, occurrence })
  }

  return {
    totalPayableThisMonth,
    totalReceivableThisMonth,
    net: totalReceivableThisMonth - totalPayableThisMonth,
    monthlyInterestReceivable,
    monthlyInterestPayable,
    overdue,
  }
}

export { paymentKey }
