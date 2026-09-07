'use client'

import { useEffect, useState } from 'react'
import type { Debt } from '@/lib/types'
import { deleteDebt, listDebts, upsertDebt } from '@/lib/debts'
import { formatMoney } from '@/lib/money'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/AuthProvider'
import { DebtForm } from '@/components/DebtForm'

export function DebtList({ category }: { category: 'bank' | 'peer' }) {
  const { session } = useAuth()
  const [debts, setDebts] = useState<Debt[]>([])
  const [editing, setEditing] = useState<Debt | 'new' | null>(null)
  const supabase = getSupabaseClient()

  async function refresh() {
    setDebts(await listDebts(supabase, category))
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category])

  async function handleSubmit(values: Partial<Debt>) {
    await upsertDebt(supabase, { ...values, user_id: session!.user.id })
    setEditing(null)
    await refresh()
  }

  async function handleToggleActive(debt: Debt) {
    await upsertDebt(supabase, { id: debt.id, user_id: debt.user_id, is_active: !debt.is_active })
    await refresh()
  }

  async function handleDelete(id: string) {
    await deleteDebt(supabase, id)
    await refresh()
  }

  if (editing) {
    return (
      <DebtForm
        category={category}
        initial={editing === 'new' ? null : editing}
        onSubmit={handleSubmit}
        onCancel={() => setEditing(null)}
      />
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-3">
      <button onClick={() => setEditing('new')} className="self-start rounded-xl bg-gradient-to-r from-urgent-from to-urgent-to px-4 py-2 font-semibold text-white">
        + Thêm khoản
      </button>
      {debts.map((debt) => (
        <div key={debt.id} className={`rounded-xl border border-border bg-surface p-4 ${debt.is_active ? '' : 'opacity-50'}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-text">{debt.name}</p>
              <p className="text-sm text-text-muted">
                {debt.type === 'lend_out' || debt.type === 'borrow_in'
                  ? `${debt.counterparty_name} · gốc ${formatMoney(debt.principal_amount ?? 0)} · ${debt.interest_rate_pct}%/tháng`
                  : formatMoney(debt.amount ?? 0)}
              </p>
            </div>
            <div className="flex gap-2 text-sm">
              <button onClick={() => setEditing(debt)} className="text-text-muted hover:text-text">Sửa</button>
              <button onClick={() => handleToggleActive(debt)} className="text-text-muted hover:text-text">
                {debt.is_active ? 'Tạm ngưng' : 'Bật lại'}
              </button>
              <button onClick={() => handleDelete(debt.id)} className="text-payable">Xóa</button>
            </div>
          </div>
        </div>
      ))}
      {debts.length === 0 && <p className="text-text-muted">Chưa có khoản nào.</p>}
    </div>
  )
}
