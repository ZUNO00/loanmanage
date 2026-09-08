import type { DebtType } from './types'

export interface ParsedDictation {
  type?: DebtType
  amount?: number
  date?: string // 'YYYY-MM-DD'
  time?: string // 'HH:MM'
  bankName?: string
  accountNumber?: string
}

/** A day/month with no year means "the next occurrence of that date" —
 * this year if it hasn't happened yet, next year if it has. */
function resolveYear(day: number, month: number, explicitYear?: number): number {
  const now = new Date()
  if (explicitYear != null) return explicitYear
  const candidate = new Date(now.getFullYear(), month - 1, day)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (candidate.getTime() < todayStart.getTime()) return now.getFullYear() + 1
  return now.getFullYear()
}

export function parseDictation(text: string): ParsedDictation {
  const result: ParsedDictation = {}
  const lower = text.toLowerCase()

  const lendOutMatch = /\bcho\s+(?:\S+\s+){0,3}(?:vay|mượn)\b/.test(lower)
  if (lower.includes('thẻ tín dụng')) result.type = 'credit_card'
  else if (lendOutMatch) result.type = 'lend_out'
  else if (lower.includes('mượn')) result.type = 'borrow_in'
  else if (lower.includes('vay') || lower.includes('nợ')) result.type = 'loan'

  const amountMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*(k|nghìn|ngàn|tr|triệu|củ)(?![a-zA-ZÀ-ỹ0-9])/)
  if (amountMatch) {
    const num = Number(amountMatch[1].replace(',', '.'))
    const isThousand = amountMatch[2] === 'k' || amountMatch[2] === 'nghìn' || amountMatch[2] === 'ngàn'
    result.amount = Math.round(num * (isThousand ? 1_000 : 1_000_000))
  }

  const fullDateMatch = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  const verboseDateMatch = lower.match(/ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})(?:\s+năm\s+(\d{4}))?/)
  // Requires a preceding "ngày" — a bare D[/-]M pattern anywhere in the
  // sentence would collide with an amount range like "5-6 triệu" and
  // silently produce a fabricated date instead of falling through to the
  // (correct) "ngày mai"/"hôm nay" checks below.
  const shortDateMatch = lower.match(/ngày\s+(\d{1,2})[/-](\d{1,2})(?!\d)/)

  if (fullDateMatch) {
    const [, d, m, y] = fullDateMatch
    result.date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  } else if (verboseDateMatch) {
    const [, d, m, y] = verboseDateMatch
    const year = resolveYear(Number(d), Number(m), y ? Number(y) : undefined)
    result.date = `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  } else if (shortDateMatch) {
    const [, d, m] = shortDateMatch
    const year = resolveYear(Number(d), Number(m))
    result.date = `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  } else if (lower.includes('ngày mai')) {
    const t = new Date()
    t.setDate(t.getDate() + 1)
    result.date = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
  } else if (lower.includes('hôm nay')) {
    const t = new Date()
    result.date = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
  }

  const timeMatch = lower.match(/(\d{1,2})\s*(?:h|giờ)\s*(\d{2})?\s*(sáng|chiều|tối)?/)
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
