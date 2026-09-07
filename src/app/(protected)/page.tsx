'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Debt, DebtPayment } from '@/lib/types'
import { listAllActiveDebts, listPayments, markPaid } from '@/lib/debts'
import { getOccurrencesInRange, paymentKey } from '@/lib/schedule'
import { computeDashboardSummary } from '@/lib/dashboard'
import { formatMoney } from '@/lib/money'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/AuthProvider'
import { WeekStrip } from '@/components/WeekStrip'
import { SummaryCards } from '@/components/SummaryCards'
import { CalendarMonth } from '@/components/CalendarMonth'

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export default function HomePage() {
  const { session } = useAuth()
  const [debts, setDebts] = useState<Debt[]>([])
  const [payments, setPayments] = useState<DebtPayment[]>([])
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()))
  const [error, setError] = useState<string | null>(null)
  const supabase = getSupabaseClient()

  async function refresh() {
    try {
      const [d, p] = await Promise.all([listAllActiveDebts(supabase), listPayments(supabase)])
      setDebts(d)
      setPayments(p)
    } catch {
      setError('Không tải được dữ liệu, thử tải lại trang.')
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount, no data-fetching library in this stack
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const paidKeys = useMemo(() => new Set(payments.map((p) => paymentKey(p.debt_id, p.period))), [payments])

  const weekDays = useMemo(() => {
    const today = startOfDay(new Date())
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i)
      const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59)
      const hasUnpaid = getOccurrencesInRange(debts, paidKeys, date, dayEnd).some((o) => !o.paid)
      return { date, hasUnpaid }
    })
  }, [debts, paidKeys])

  const selectedOccurrences = useMemo(() => {
    const dayEnd = new Date(selectedDay.getFullYear(), selectedDay.getMonth(), selectedDay.getDate(), 23, 59, 59)
    return getOccurrencesInRange(debts, paidKeys, selectedDay, dayEnd)
  }, [debts, paidKeys, selectedDay])

  const summary = useMemo(() => computeDashboardSummary(debts, paidKeys), [debts, paidKeys])

  async function handleMarkPaid(debtId: string, period: string) {
    try {
      setError(null)
      await markPaid(supabase, debtId, session!.user.id, period)
      await refresh()
    } catch {
      setError('Không đánh dấu đã đóng được, thử lại.')
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4 lg:flex-row">
      <div className="flex flex-1 flex-col gap-4">
        {error && <p className="text-sm text-payable">{error}</p>}
        <WeekStrip days={weekDays} selected={selectedDay} onSelect={setSelectedDay} />
        <div className="flex flex-col gap-2">
          {selectedOccurrences.length === 0 && <p className="text-text-muted">Không có khoản nào ngày này.</p>}
          {selectedOccurrences.map(({ debt, occurrence, paid }) => (
            <div key={debt.id + occurrence.period} className="flex items-center justify-between rounded-xl bg-surface p-3">
              <div>
                <p className="text-text">{debt.name}</p>
                <p className="text-sm text-text-muted">{formatMoney(occurrence.amount)}đ</p>
              </div>
              <div className="flex gap-2">
                {debt.account_number && (
                  <button onClick={() => navigator.clipboard.writeText(debt.account_number!)} className="rounded-lg bg-border px-2 py-1 text-xs text-text">
                    Copy STK
                  </button>
                )}
                {!paid && (
                  <button onClick={() => handleMarkPaid(debt.id, occurrence.period)} className="rounded-lg bg-receivable px-2 py-1 text-xs text-bg">
                    Đã đóng
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <CalendarMonth debts={debts} payments={payments} onMarkPaid={handleMarkPaid} />
      </div>
      <div className="lg:sticky lg:top-4 lg:h-fit lg:w-80">
        <SummaryCards summary={summary} />
      </div>
    </div>
  )
}
