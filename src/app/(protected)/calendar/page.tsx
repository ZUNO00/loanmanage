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
  const supabase = getSupabaseClient()

  async function refresh() {
    const [d, p] = await Promise.all([listAllActiveDebts(supabase), listPayments(supabase)])
    setDebts(d)
    setPayments(p)
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleMarkPaid(debtId: string, period: string) {
    await markPaid(supabase, debtId, session!.user.id, period)
    await refresh()
  }

  return <CalendarMonth debts={debts} payments={payments} onMarkPaid={handleMarkPaid} />
}
