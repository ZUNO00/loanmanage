import type { Debt } from './types'

export interface Occurrence {
  dueAt: Date
  period: string
  amount: number
  isReceivable: boolean
}

export function paymentKey(debtId: string, period: string): string {
  return `${debtId}:${period}`
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(year, monthIndex0 + 1, 0).getDate()
}

function isRecurring(debt: Debt): boolean {
  return debt.type === 'credit_card' || debt.type === 'loan' || debt.repayment_mode === 'recurring'
}

function monthsBetween(startDate: string | null, dueDate: string): number {
  if (!startDate) return 1
  const [sy, sm, sd] = startDate.split('-').map(Number)
  const [ey, em, ed] = dueDate.split('-').map(Number)
  let months = (ey - sy) * 12 + (em - sm)
  if (ed > sd) months += 1
  return Math.max(1, months)
}

function computeAmount(debt: Debt, months = 1): number {
  if (debt.type === 'lend_out' || debt.type === 'borrow_in') {
    const interest = ((debt.principal_amount ?? 0) * (debt.interest_rate_pct ?? 0)) / 100 * months
    return debt.repayment_mode === 'one_time'
      ? Math.round((debt.principal_amount ?? 0) + interest)
      : Math.round(interest)
  }
  return debt.amount ?? 0
}

function combine(year: number, monthIndex0: number, day: number, time: string | null): Date {
  const [h, m] = (time ?? '00:00').split(':').map(Number)
  return new Date(year, monthIndex0, day, h || 0, m || 0)
}

/** Occurrence of a debt within one specific calendar month — pure, no
 * dependency on "now" or payment status. Used to render any month browsed
 * on the calendar, and as the building block for the functions below. */
export function getOccurrenceForPeriod(debt: Debt, year: number, monthIndex0: number): Occurrence | null {
  if (isRecurring(debt)) {
    if (!debt.due_day) return null
    const day = Math.min(debt.due_day, daysInMonth(year, monthIndex0))
    const period = `${year}-${String(monthIndex0 + 1).padStart(2, '0')}`
    return { dueAt: combine(year, monthIndex0, day, debt.due_time), period, amount: computeAmount(debt), isReceivable: debt.type === 'lend_out' }
  }
  if (!debt.due_date) return null
  const [dy, dm, dd] = debt.due_date.split('-').map(Number)
  if (dy !== year || dm - 1 !== monthIndex0) return null
  const months = monthsBetween(debt.start_date, debt.due_date)
  return { dueAt: combine(dy, dm - 1, dd, debt.due_time), period: debt.due_date, amount: computeAmount(debt, months), isReceivable: debt.type === 'lend_out' }
}

/** The occurrence that should currently be surfaced on the dashboard/for
 * reminders: for recurring debts, the earliest of {previous month, current
 * month} that isn't yet paid AND isn't from before the debt existed; for
 * one_time debts, the single due date if unpaid.
 * ponytail: only looks back 1 month, not an unbounded scan — reminders nag
 * every 15min so nothing can silently go unpaid for a long stretch without
 * the user noticing; extend the lookback if that assumption ever breaks. */
export function getRelevantOccurrence(debt: Debt, paidKeys: Set<string>, now: Date = new Date()): Occurrence | null {
  if (!debt.is_active) return null
  const createdAt = new Date(debt.created_at)
  if (!isRecurring(debt)) {
    if (!debt.due_date) return null
    const [y, m] = debt.due_date.split('-').map(Number)
    const occ = getOccurrenceForPeriod(debt, y, m - 1)
    return occ && !paidKeys.has(paymentKey(debt.id, occ.period)) ? occ : null
  }
  // Check the previous month FIRST and independently of whether the
  // current month is paid — otherwise a debt paid promptly this month
  // while last month's occurrence was somehow missed would report nothing
  // due at all, hiding a genuinely unpaid period.
  const prevRef = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const prevMonth = getOccurrenceForPeriod(debt, prevRef.getFullYear(), prevRef.getMonth())
  if (prevMonth && prevMonth.dueAt >= createdAt && !paidKeys.has(paymentKey(debt.id, prevMonth.period))) {
    return prevMonth
  }
  const thisMonth = getOccurrenceForPeriod(debt, now.getFullYear(), now.getMonth())
  if (thisMonth && !paidKeys.has(paymentKey(debt.id, thisMonth.period))) {
    return thisMonth
  }
  return null
}

/** All occurrences of the given debts whose due datetime falls within
 * [rangeStart, rangeEnd] — used for the calendar month grid, the home
 * page's 7-day strip, and "overdue" scans. */
export function getOccurrencesInRange(
  debts: Debt[],
  paidKeys: Set<string>,
  rangeStart: Date,
  rangeEnd: Date,
): Array<{ debt: Debt; occurrence: Occurrence; paid: boolean }> {
  const months = new Set<string>()
  const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1)
  while (cursor <= rangeEnd) {
    months.add(`${cursor.getFullYear()}-${cursor.getMonth()}`)
    cursor.setMonth(cursor.getMonth() + 1)
  }
  const results: Array<{ debt: Debt; occurrence: Occurrence; paid: boolean }> = []
  for (const debt of debts) {
    if (!debt.is_active) continue
    for (const key of months) {
      const [y, m] = key.split('-').map(Number)
      const occ = getOccurrenceForPeriod(debt, y, m)
      if (occ && occ.dueAt >= rangeStart && occ.dueAt <= rangeEnd) {
        results.push({ debt, occurrence: occ, paid: paidKeys.has(paymentKey(debt.id, occ.period)) })
      }
    }
  }
  return results
}

export function getReminderThresholdMs(debt: Debt, occurrence: Occurrence): number {
  const oneDay = 24 * 60 * 60 * 1000
  return occurrence.dueAt.getTime() - (debt.type === 'credit_card' ? 2 * oneDay : oneDay)
}
