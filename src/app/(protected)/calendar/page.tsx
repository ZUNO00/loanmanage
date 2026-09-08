'use client'

import { useEffect, useState } from 'react'
import type { Debt, DebtPayment, Note } from '@/lib/types'
import { listAllActiveDebts, listPayments, markPaid } from '@/lib/debts'
import { listNotes } from '@/lib/notes'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/AuthProvider'
import { CalendarMonth } from '@/components/CalendarMonth'

export default function CalendarPage() {
  const { session } = useAuth()
  const [debts, setDebts] = useState<Debt[]>([])
  const [payments, setPayments] = useState<DebtPayment[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [error, setError] = useState<string | null>(null)
  const supabase = getSupabaseClient()

  async function refresh() {
    try {
      const [d, p, n] = await Promise.all([listAllActiveDebts(supabase), listPayments(supabase), listNotes(supabase)])
      setDebts(d)
      setPayments(p)
      setNotes(n)
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
      <CalendarMonth debts={debts} payments={payments} notes={notes} onMarkPaid={handleMarkPaid} />
    </>
  )
}
