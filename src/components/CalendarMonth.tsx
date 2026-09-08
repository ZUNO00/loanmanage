'use client'

import { useMemo, useState } from 'react'
import type { Debt, DebtPayment, Note } from '@/lib/types'
import { getOccurrencesInRange, paymentKey } from '@/lib/schedule'
import { formatMoney } from '@/lib/money'

interface Props {
  debts: Debt[]
  payments: DebtPayment[]
  notes: Note[]
  onMarkPaid: (debtId: string, period: string) => Promise<void>
}

const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

export function CalendarMonth({ debts, payments, notes, onMarkPaid }: Props) {
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

  function notesOn(day: Date) {
    return notes.filter((n) => new Date(n.note_at).toDateString() === day.toDateString())
  }

  const selectedOccurrences = selectedDay ? occurrencesOn(selectedDay) : []
  const selectedNotes = selectedDay ? notesOn(selectedDay) : []
  const today = new Date()

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
          const dayNotes = notesOn(day)
          const isToday = day.toDateString() === today.toDateString()
          const isSelected = selectedDay?.toDateString() === day.toDateString()
          type Item = { key: string; label: string; colorClass: string }
          const debtItems: Item[] = dayOccurrences.map((o) => ({
            key: o.debt.id + o.occurrence.period,
            label: o.debt.name,
            colorClass: o.paid
              ? 'bg-border text-text-muted line-through'
              : o.occurrence.isReceivable
                ? 'bg-receivable text-bg'
                : 'bg-gradient-to-r from-urgent-from to-urgent-to text-white',
          }))
          const noteItems: Item[] = dayNotes.map((n) => ({
            key: n.id,
            label: n.title,
            colorClass: 'bg-note text-white',
          }))
          const items = [...debtItems, ...noteItems]
          const visible = items.slice(0, 3)
          const hiddenCount = items.length - visible.length
          return (
            <button
              key={i}
              onClick={() => setSelectedDay(day)}
              className={`aspect-square overflow-hidden rounded-lg bg-surface p-1 text-left text-[10px] ring-2 ${isSelected ? 'ring-text' : isToday ? 'ring-text-muted' : 'ring-transparent'}`}
            >
              <div className="mb-0.5 text-xs font-semibold text-text">{day.getDate()}</div>
              <div className="flex flex-col gap-0.5">
                {visible.map((item) => (
                  <div key={item.key} className={`truncate rounded px-1 leading-tight ${item.colorClass}`}>
                    {item.label}
                  </div>
                ))}
                {hiddenCount > 0 && <div className="px-1 leading-tight text-text-muted">+{hiddenCount} khác</div>}
              </div>
            </button>
          )
        })}
      </div>

      {selectedDay && (
        <div className="mt-4 rounded-xl bg-surface p-4">
          <p className="mb-2 font-semibold text-text">Ngày {selectedDay.getDate()}/{selectedDay.getMonth() + 1}</p>
          {selectedOccurrences.length === 0 && selectedNotes.length === 0 && <p className="text-text-muted">Không có khoản nào.</p>}
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
          {selectedNotes.map((note) => (
            <div key={note.id} className="mb-2 rounded-lg bg-bg p-3">
              <p className="text-text">{note.title}</p>
              <p className="text-sm text-text-muted">
                {new Date(note.note_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
