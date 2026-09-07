export type DebtType = 'credit_card' | 'loan' | 'lend_out' | 'borrow_in'
export type RepaymentMode = 'recurring' | 'one_time'

export interface Debt {
  id: string
  user_id: string
  type: DebtType
  name: string
  amount: number | null
  due_day: number | null
  due_time: string | null // 'HH:MM:SS' or null
  account_number: string | null
  bank_name: string | null
  account_holder: string | null
  counterparty_name: string | null
  principal_amount: number | null
  interest_rate_pct: number | null
  repayment_mode: RepaymentMode | null
  start_date: string | null // 'YYYY-MM-DD'
  due_date: string | null // 'YYYY-MM-DD'
  is_active: boolean
  created_at: string
}

export interface DebtPayment {
  id: string
  debt_id: string
  user_id: string
  period: string
  paid_at: string
}
