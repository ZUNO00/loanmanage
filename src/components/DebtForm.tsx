'use client'

import { useState } from 'react'
import type { Debt, DebtType, RepaymentMode } from '@/lib/types'
import { formatMoneyInput, parseMoneyDigits } from '@/lib/money'
import { parseDictation } from '@/lib/dictation'

const BANK_OPTIONS: { value: DebtType; label: string }[] = [
  { value: 'credit_card', label: 'Thẻ tín dụng' },
  { value: 'loan', label: 'Khoản vay' },
]
const PEER_OPTIONS: { value: DebtType; label: string }[] = [
  { value: 'lend_out', label: 'Cho vay' },
  { value: 'borrow_in', label: 'Đi mượn' },
]

interface Props {
  category: 'bank' | 'peer'
  initial: Partial<Debt> | null
  onSubmit: (values: Partial<Debt>) => Promise<void>
  onCancel: () => void
}

export function DebtForm({ category, initial, onSubmit, onCancel }: Props) {
  const options = category === 'bank' ? BANK_OPTIONS : PEER_OPTIONS
  const [type, setType] = useState<DebtType>(initial?.type ?? options[0].value)
  const [name, setName] = useState(initial?.name ?? '')
  const [amountText, setAmountText] = useState(initial?.amount != null ? formatMoneyInput(String(initial.amount)) : '')
  const [dueDay, setDueDay] = useState(initial?.due_day ? String(initial.due_day) : '')
  const [dueTime, setDueTime] = useState(initial?.due_time?.slice(0, 5) ?? '')
  const [accountNumber, setAccountNumber] = useState(initial?.account_number ?? '')
  const [bankName, setBankName] = useState(initial?.bank_name ?? '')
  const [accountHolder, setAccountHolder] = useState(initial?.account_holder ?? '')
  const [counterpartyName, setCounterpartyName] = useState(initial?.counterparty_name ?? '')
  const [principalText, setPrincipalText] = useState(initial?.principal_amount != null ? formatMoneyInput(String(initial.principal_amount)) : '')
  const [ratePct, setRatePct] = useState(initial?.interest_rate_pct != null ? String(initial.interest_rate_pct) : '')
  const [repaymentMode, setRepaymentMode] = useState<RepaymentMode>(initial?.repayment_mode ?? 'recurring')
  const [startDate, setStartDate] = useState(initial?.start_date ?? '')
  const [dueDate, setDueDate] = useState(initial?.due_date ?? '')
  const [transcript, setTranscript] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function applyDictation(text: string) {
    setTranscript(text)
    const parsed = parseDictation(text)
    if (parsed.type && options.some((o) => o.value === parsed.type)) setType(parsed.type)
    if (parsed.amount) {
      const formatted = formatMoneyInput(String(parsed.amount))
      if (category === 'peer') setPrincipalText(formatted)
      else setAmountText(formatted)
    }
    if (parsed.date && category === 'peer') setDueDate(parsed.date)
    if (parsed.time) setDueTime(parsed.time)
    if (parsed.bankName) setBankName(parsed.bankName)
    if (parsed.accountNumber) setAccountNumber(parsed.accountNumber)
  }

  function startDictation() {
    // Web Speech API types aren't in TS's lib.dom.d.ts — declare the minimal
    // shape we use instead of relying on an ambient global that isn't there.
    type MinimalRecognition = {
      lang: string
      start: () => void
      onresult: ((event: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null
    }
    const Ctor = (window as unknown as { webkitSpeechRecognition?: new () => MinimalRecognition }).webkitSpeechRecognition
    if (!Ctor) return
    const recognition = new Ctor()
    recognition.lang = 'vi-VN'
    recognition.onresult = (event) => applyDictation(event.results[0][0].transcript)
    recognition.start()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const isPeer = category === 'peer'
      await onSubmit({
        id: initial?.id,
        type,
        name,
        amount: isPeer ? null : parseMoneyDigits(amountText),
        due_day: repaymentMode === 'recurring' || !isPeer ? Number(dueDay) || null : null,
        due_time: type === 'loan' || (isPeer && repaymentMode === 'recurring') ? (dueTime ? `${dueTime}:00` : null) : null,
        account_number: accountNumber || null,
        bank_name: bankName || null,
        account_holder: accountHolder || null,
        counterparty_name: isPeer ? counterpartyName : null,
        principal_amount: isPeer ? parseMoneyDigits(principalText) : null,
        interest_rate_pct: isPeer ? (ratePct === '' ? null : Number(ratePct)) : null,
        repayment_mode: isPeer ? repaymentMode : null,
        start_date: isPeer && repaymentMode === 'one_time' ? startDate || null : null,
        due_date: isPeer && repaymentMode === 'one_time' ? dueDate || null : null,
        is_active: initial?.is_active ?? true,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Có lỗi xảy ra, thử lại.')
    } finally {
      setSubmitting(false)
    }
  }

  const showMic = typeof window !== 'undefined' && 'webkitSpeechRecognition' in window

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
      {showMic && (
        <button type="button" onClick={startDictation} className="self-start rounded-full bg-bg px-3 py-1.5 text-sm text-text">
          🎤 Đọc điền nhanh
        </button>
      )}
      {transcript && <p className="text-xs text-text-muted">Đã nghe: &quot;{transcript}&quot;</p>}

      <select className="rounded-lg bg-bg px-3 py-2 text-text" value={type} onChange={(e) => setType(e.target.value as DebtType)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <input className="rounded-lg bg-bg px-3 py-2 text-text" placeholder="Tên khoản" value={name} onChange={(e) => setName(e.target.value)} required />

      {category === 'peer' && (
        <input className="rounded-lg bg-bg px-3 py-2 text-text" placeholder="Tên người vay/cho mượn" value={counterpartyName} onChange={(e) => setCounterpartyName(e.target.value)} required />
      )}

      {category === 'bank' ? (
        <input className="rounded-lg bg-bg px-3 py-2 text-text" placeholder="Số tiền" inputMode="numeric" value={amountText} onChange={(e) => setAmountText(formatMoneyInput(e.target.value))} required />
      ) : (
        <>
          <input className="rounded-lg bg-bg px-3 py-2 text-text" placeholder="Gốc" inputMode="numeric" value={principalText} onChange={(e) => setPrincipalText(formatMoneyInput(e.target.value))} required />
          <input className="rounded-lg bg-bg px-3 py-2 text-text" placeholder="Lãi suất %/tháng" inputMode="decimal" value={ratePct} onChange={(e) => setRatePct(e.target.value)} required />
          <select className="rounded-lg bg-bg px-3 py-2 text-text" value={repaymentMode} onChange={(e) => setRepaymentMode(e.target.value as RepaymentMode)}>
            <option value="recurring">Lặp hàng tháng</option>
            <option value="one_time">Trả 1 lần</option>
          </select>
        </>
      )}

      {(category === 'bank' || repaymentMode === 'recurring') && (
        <div className="flex gap-2">
          <input className="w-1/2 rounded-lg bg-bg px-3 py-2 text-text" type="number" min={1} max={31} placeholder="Ngày đến hạn (1-31)" value={dueDay} onChange={(e) => setDueDay(e.target.value)} required />
          {(type === 'loan' || category === 'peer') && (
            <input className="w-1/2 rounded-lg bg-bg px-3 py-2 text-text" type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} required={type === 'loan'} />
          )}
        </div>
      )}

      {category === 'peer' && repaymentMode === 'one_time' && (
        <div className="flex gap-2">
          <input className="w-1/2 rounded-lg bg-bg px-3 py-2 text-text" type="date" placeholder="Ngày cho vay/mượn" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          <input className="w-1/2 rounded-lg bg-bg px-3 py-2 text-text" type="date" placeholder="Ngày đáo hạn" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
        </div>
      )}

      <input className="rounded-lg bg-bg px-3 py-2 text-text" placeholder="Ngân hàng" value={bankName} onChange={(e) => setBankName(e.target.value)} />
      <input className="rounded-lg bg-bg px-3 py-2 text-text" placeholder="Số tài khoản" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
      <input className="rounded-lg bg-bg px-3 py-2 text-text" placeholder="Chủ tài khoản" value={accountHolder} onChange={(e) => setAccountHolder(e.target.value)} />

      {error && <p className="text-sm text-payable">{error}</p>}
      <div className="flex gap-2">
        <button disabled={submitting} className="flex-1 rounded-xl bg-gradient-to-r from-urgent-from to-urgent-to py-2 font-semibold text-white disabled:opacity-50" type="submit">
          Lưu
        </button>
        <button type="button" onClick={onCancel} className="flex-1 rounded-xl bg-bg py-2 text-text-muted">
          Hủy
        </button>
      </div>
    </form>
  )
}
