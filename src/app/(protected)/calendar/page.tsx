'use client'

import { useEffect, useState } from 'react'
import type { Debt, DebtPayment } from '@/lib/types'
import { listAllActiveDebts, listPayments, markPaid } from '@/lib/debts'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/AuthProvider'
import { CalendarMonth } from '@/components/CalendarMonth'

export default function CalendarPage() {
  const { session } = useAuth()
  const [debts, setDebts] = useState<Debt[]>([])
  const [payments, setPayments] = useState<DebtPayment[]>([])
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

  async function handleMarkPaid(debtId: string, period: string) {
    try {
      await markPaid(supabase, debtId, session!.user.id, period)
      await refresh()
    } catch {
      setError('Không đánh dấu đã đóng được, thử lại.')
    }
  }

  return (
    <>
      {error && <p className="mb-2 text-sm text-payable">{error}</p>}
      <CalendarMonth debts={debts} payments={payments} onMarkPaid={handleMarkPaid} />
    </>
  )
}
