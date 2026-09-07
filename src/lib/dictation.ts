import type { DebtType } from './types'

export interface ParsedDictation {
  type?: DebtType
  amount?: number
  date?: string // 'YYYY-MM-DD'
  time?: string // 'HH:MM'
  bankName?: string
  accountNumber?: string
}

export function parseDictation(text: string): ParsedDictation {
  const result: ParsedDictation = {}
  const lower = text.toLowerCase()

  if (lower.includes('thẻ tín dụng')) result.type = 'credit_card'
  else if (lower.includes('cho') && (lower.includes('vay') || lower.includes('mượn'))) result.type = 'lend_out'
  else if (lower.includes('mượn')) result.type = 'borrow_in'
  else if (lower.includes('vay') || lower.includes('nợ')) result.type = 'loan'

  const amountMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*(k|nghìn|ngàn|tr|triệu|củ)\b/)
  if (amountMatch) {
    const num = Number(amountMatch[1].replace(',', '.'))
    const isThousand = amountMatch[2] === 'k' || amountMatch[2] === 'nghìn' || amountMatch[2] === 'ngàn'
    result.amount = Math.round(num * (isThousand ? 1_000 : 1_000_000))
  }

  const dateMatch = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  if (dateMatch) {
    const [, d, m, y] = dateMatch
    result.date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  const timeMatch = lower.match(/(\d{1,2})\s*h\s*(\d{2})?\s*(sáng|chiều|tối)?/)
  if (timeMatch) {
    let hour = Number(timeMatch[1])
    const minute = timeMatch[2] ? Number(timeMatch[2]) : 0
    if ((timeMatch[3] === 'chiều' || timeMatch[3] === 'tối') && hour < 12) hour += 12
    result.time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }

  const bankMatch = text.match(/ngân hàng\s+([a-zA-ZÀ-ỹ0-9]+)/i)
  if (bankMatch) result.bankName = bankMatch[1].toUpperCase()

  const accountMatch = lower.match(/(?:số tài khoản|stk)\D*(\d{6,})/)
  if (accountMatch) result.accountNumber = accountMatch[1]

  return result
}
