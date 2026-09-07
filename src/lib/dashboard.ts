import type { Debt } from './types'
import { getOccurrenceForPeriod, getOccurrencesInRange, getRelevantOccurrence, paymentKey, type Occurrence } from './schedule'

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

  // Only unpaid occurrences count toward "still owed this month" — a bill
  // paid on the 2nd shouldn't keep inflating what's left to pay/collect
  // for the rest of the month.
  let totalPayableThisMonth = 0
  let totalReceivableThisMonth = 0
  for (const { occurrence, paid } of thisMonth) {
    if (paid) continue
    if (occurrence.isReceivable) totalReceivableThisMonth += occurrence.amount
    else totalPayableThisMonth += occurrence.amount
  }

  // Reuse getOccurrenceForPeriod (the same canonical, rounded calculation
  // the calendar/overdue list use) instead of re-deriving the interest
  // formula here — that would silently drift from schedule.ts's rounding
  // for non-integer products, and would miss one_time debts entirely
  // (their whole accrued interest counts in the month their due_date
  // falls in, per spec, not just recurring debts).
  let monthlyInterestReceivable = 0
  let monthlyInterestPayable = 0
  for (const debt of debts) {
    if (!debt.is_active || (debt.type !== 'lend_out' && debt.type !== 'borrow_in')) continue
    const occ = getOccurrenceForPeriod(debt, now.getFullYear(), now.getMonth())
    if (!occ) continue
    const interest = debt.repayment_mode === 'one_time' ? occ.amount - (debt.principal_amount ?? 0) : occ.amount
    if (debt.type === 'lend_out') monthlyInterestReceivable += interest
    else monthlyInterestPayable += interest
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
