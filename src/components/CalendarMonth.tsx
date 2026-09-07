'use client'

import { useMemo, useState } from 'react'
import type { Debt, DebtPayment } from '@/lib/types'
import { getOccurrencesInRange, paymentKey } from '@/lib/schedule'
import { formatMoney } from '@/lib/money'

interface Props {
  debts: Debt[]
  payments: DebtPayment[]
  onMarkPaid: (debtId: string, period: string) => Promise<void>
}

const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

export function CalendarMonth({ debts, payments, onMarkPaid }: Props) {
  const [cursor, setCursor] = useState(() => new Date())
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)

  const paidKeys = useMemo(() => new Set(payments.map((p) => paymentKey(p.debt_id, p.period))), [payments])

  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59)
  const monthStartMs = monthStart.getTime()
  const monthEndMs = monthEnd.getTime()
  const occurrences = useMemo(
    () => getOccurrencesInRange(debts, paidKeys, monthStart, monthEnd),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- monthStart/monthEnd are new Date objects every render; monthStartMs/monthEndMs is their real value for memoization
    [debts, paidKeys, monthStartMs, monthEndMs],
  )

  const leadingBlanks = (monthStart.getDay() + 6) % 7 // Monday-first
  const daysInMonth = monthEnd.getDate()
  const cells: (Date | null)[] = [
    ...Array(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(cursor.getFullYear(), cursor.getMonth(), i + 1)),
  ]

  function occurrencesOn(day: Date) {
    return occurrences.filter((o) => o.occurrence.dueAt.toDateString() === day.toDateString())
  }

  const selectedOccurrences = selectedDay ? occurrencesOn(selectedDay) : []

  return (
    <div className="flex-1">
      <div className="mb-3 flex items-center justify-between">
        <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="rounded-lg bg-surface px-3 py-1 text-text">‹</button>
        <p className="font-semibold text-text">Tháng {cursor.getMonth() + 1}/{cursor.getFullYear()}</p>
        <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="rounded-lg bg-surface px-3 py-1 text-text">›</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-text-muted">
        {WEEKDAY_LABELS.map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />
          const dayOccurrences = occurrencesOn(day)
          const hasUnpaid = dayOccurrences.some((o) => !o.paid)
          return (
            <button
              key={i}
              onClick={() => setSelectedDay(day)}
              className={`aspect-square rounded-lg p-1 text-left text-xs ${hasUnpaid ? 'bg-gradient-to-br from-urgent-from to-urgent-to text-white' : dayOccurrences.length ? 'bg-border text-text' : 'bg-surface text-text-muted'}`}
            >
              {day.getDate()}
            </button>
          )
        })}
      </div>

      {selectedDay && (
        <div className="mt-4 rounded-xl bg-surface p-4">
          <p className="mb-2 font-semibold text-text">Ngày {selectedDay.getDate()}/{selectedDay.getMonth() + 1}</p>
          {selectedOccurrences.length === 0 && <p className="text-text-muted">Không có khoản nào.</p>}
          {selectedOccurrences.map(({ debt, occurrence, paid }) => (
            <div key={debt.id + occurrence.period} className="mb-2 flex items-center justify-between rounded-lg bg-bg p-3">
              <div>
                <p className="text-text">{debt.name}</p>
                <p className="text-sm text-text-muted">{formatMoney(occurrence.amount)}đ</p>
              </div>
              <div className="flex gap-2">
                {debt.account_number && (
                  <button
                    onClick={() => navigator.clipboard.writeText(debt.account_number!)}
                    className="rounded-lg bg-border px-2 py-1 text-xs text-text"
                  >
                    Copy STK
                  </button>
                )}
                {!paid && (
                  <button
                    onClick={() => onMarkPaid(debt.id, occurrence.period)}
                    className="rounded-lg bg-receivable px-2 py-1 text-xs text-bg"
                  >
                    Đã đóng
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
