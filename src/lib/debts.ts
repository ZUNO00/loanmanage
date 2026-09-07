import type { SupabaseClient } from '@supabase/supabase-js'
import type { Debt, DebtPayment } from './types'

const BANK_TYPES = ['credit_card', 'loan']
const PEER_TYPES = ['lend_out', 'borrow_in']

export async function listDebts(supabase: SupabaseClient, category: 'bank' | 'peer'): Promise<Debt[]> {
  const { data, error } = await supabase
    .from('debts')
    .select('*')
    .in('type', category === 'bank' ? BANK_TYPES : PEER_TYPES)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as Debt[]
}

export async function listAllActiveDebts(supabase: SupabaseClient): Promise<Debt[]> {
  const { data, error } = await supabase.from('debts').select('*').eq('is_active', true)
  if (error) throw error
  return data as Debt[]
}

export async function upsertDebt(supabase: SupabaseClient, debt: Partial<Debt> & { user_id: string }): Promise<Debt> {
  const { data, error } = await supabase.from('debts').upsert(debt).select().single()
  if (error) throw error
  return data as Debt
}

export async function deleteDebt(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('debts').delete().eq('id', id)
  if (error) throw error
}

export async function listPayments(supabase: SupabaseClient): Promise<DebtPayment[]> {
  const { data, error } = await supabase.from('debt_payments').select('*')
  if (error) throw error
  return data as DebtPayment[]
}

export async function markPaid(supabase: SupabaseClient, debtId: string, userId: string, period: string): Promise<void> {
  const { error } = await supabase.from('debt_payments').insert({ debt_id: debtId, user_id: userId, period })
  if (error) throw error
}
