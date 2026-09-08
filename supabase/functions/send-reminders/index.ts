// ponytail: the occurrence/threshold math below is duplicated from
// src/lib/schedule.ts. This runs on Deno (Supabase Edge Functions), a
// separate runtime from the Next.js app, and it's ~40 lines — not worth a
// shared package for that. Keep both in sync if the rules change.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')!
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')!
const vapidSubject = Deno.env.get('VAPID_SUBJECT')!
const cronSecret = Deno.env.get('CRON_SECRET')!

webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
const supabase = createClient(supabaseUrl, serviceRoleKey)

interface Debt {
  id: string
  user_id: string
  type: string
  name: string
  amount: number | null
  due_day: number | null
  due_time: string | null
  principal_amount: number | null
  interest_rate_pct: number | null
  repayment_mode: string | null
  start_date: string | null
  due_date: string | null
  is_active: boolean
  created_at: string
}

interface NoteRow {
  id: string
  user_id: string
  title: string
  note_at: string
  reminded_at: string | null
}

function daysInMonth(year: number, monthIndex0: number) {
  return new Date(year, monthIndex0 + 1, 0).getDate()
}

function isRecurring(debt: Debt) {
  return debt.type === 'credit_card' || debt.type === 'loan' || debt.repayment_mode === 'recurring'
}

function monthsBetween(startDate: string | null, dueDate: string) {
  if (!startDate) return 1
  const [sy, sm, sd] = startDate.split('-').map(Number)
  const [ey, em, ed] = dueDate.split('-').map(Number)
  let months = (ey - sy) * 12 + (em - sm)
  if (ed > sd) months += 1
  return Math.max(1, months)
}

function computeAmount(debt: Debt, months = 1) {
  if (debt.type === 'lend_out' || debt.type === 'borrow_in') {
    const interest = ((debt.principal_amount ?? 0) * (debt.interest_rate_pct ?? 0)) / 100 * months
    return debt.repayment_mode === 'one_time'
      ? Math.round((debt.principal_amount ?? 0) + interest)
      : Math.round(interest)
  }
  return debt.amount ?? 0
}

// This app is Vietnamese-only (UI, users, use case) — reminders are
// computed in Vietnam's wall-clock time (UTC+7, no DST), not whatever
// timezone the Edge Function's runtime defaults to (Deno defaults to
// UTC), so "today" and due datetimes here match what the browser
// (already on the user's local VN clock) shows.
// ponytail: hardcoded offset rather than a per-user timezone column —
// every user of this app is assumed to be in Vietnam. Add a timezone
// column + per-user conversion if that assumption ever breaks.
const VN_OFFSET_MS = 7 * 60 * 60 * 1000

function nowInVn(): Date {
  return new Date(Date.now() + VN_OFFSET_MS)
}

function vnDateTime(year: number, monthIndex0: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, monthIndex0, day, hour, minute) - VN_OFFSET_MS)
}

function occurrenceForPeriod(debt: Debt, year: number, monthIndex0: number) {
  if (isRecurring(debt)) {
    if (!debt.due_day) return null
    const day = Math.min(debt.due_day, daysInMonth(year, monthIndex0))
    const [h, m] = (debt.due_time ?? '00:00').split(':').map(Number)
    const dueAt = vnDateTime(year, monthIndex0, day, h || 0, m || 0)
    const period = `${year}-${String(monthIndex0 + 1).padStart(2, '0')}`
    return { dueAt, period, amount: computeAmount(debt) }
  }
  if (!debt.due_date) return null
  const [dy, dm, dd] = debt.due_date.split('-').map(Number)
  if (dy !== year || dm - 1 !== monthIndex0) return null
  const [h, m] = (debt.due_time ?? '00:00').split(':').map(Number)
  const dueAt = vnDateTime(dy, dm - 1, dd, h || 0, m || 0)
  return { dueAt, period: debt.due_date, amount: computeAmount(debt, monthsBetween(debt.start_date, debt.due_date)) }
}

function relevantOccurrence(debt: Debt, paidPeriods: Set<string>, nowVn: Date) {
  if (!debt.is_active) return null
  const createdAt = new Date(debt.created_at)
  if (!isRecurring(debt)) {
    if (!debt.due_date) return null
    const [y, m] = debt.due_date.split('-').map(Number)
    const occ = occurrenceForPeriod(debt, y, m - 1)
    return occ && !paidPeriods.has(occ.period) ? occ : null
  }
  const year = nowVn.getUTCFullYear()
  const month0 = nowVn.getUTCMonth()
  const prevRef = new Date(Date.UTC(year, month0 - 1, 1))
  const prevMonth = occurrenceForPeriod(debt, prevRef.getUTCFullYear(), prevRef.getUTCMonth())
  if (prevMonth && prevMonth.dueAt >= createdAt && !paidPeriods.has(prevMonth.period)) return prevMonth
  const thisMonth = occurrenceForPeriod(debt, year, month0)
  if (thisMonth && !paidPeriods.has(thisMonth.period)) return thisMonth
  return null
}

function reminderThresholdMs(debt: Debt, dueAt: Date) {
  const oneDay = 24 * 60 * 60 * 1000
  return dueAt.getTime() - (debt.type === 'credit_card' ? 2 * oneDay : oneDay)
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response('unauthorized', { status: 401 })
  }

  const now = new Date()
  const nowVn = nowInVn()
  const { data: debts, error: debtsError } = await supabase.from('debts').select('*').eq('is_active', true)
  if (debtsError) return new Response(debtsError.message, { status: 500 })

  const { data: payments } = await supabase.from('debt_payments').select('debt_id, period')
  const paidByDebt = new Map<string, Set<string>>()
  for (const p of payments ?? []) {
    if (!paidByDebt.has(p.debt_id)) paidByDebt.set(p.debt_id, new Set())
    paidByDebt.get(p.debt_id)!.add(p.period)
  }

  let sent = 0
  for (const debt of (debts ?? []) as Debt[]) {
    const paid = paidByDebt.get(debt.id) ?? new Set<string>()
    const occ = relevantOccurrence(debt, paid, nowVn)
    if (!occ || now.getTime() < reminderThresholdMs(debt, occ.dueAt)) continue

    const { data: subs } = await supabase.from('push_subscriptions').select('*').eq('user_id', debt.user_id)
    const isOverdue = occ.dueAt.getTime() < now.getTime()
    const payload = JSON.stringify({
      title: `${isOverdue ? 'Quá hạn' : 'Sắp tới hạn'}: ${debt.name}`,
      body: `${new Intl.NumberFormat('vi-VN').format(occ.amount)}đ`,
      tag: debt.id,
    })

    for (const sub of subs ?? []) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
        sent++
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 404 || statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('id', sub.id)
        }
      }
    }
  }

  const { data: notes } = await supabase.from('notes').select('*').is('reminded_at', null)
  let notesSent = 0
  for (const note of (notes ?? []) as NoteRow[]) {
    const noteAt = new Date(note.note_at)
    const threshold = noteAt.getTime() - 60 * 60 * 1000 // 1 tiếng trước
    if (now.getTime() < threshold) continue

    const { data: subs } = await supabase.from('push_subscriptions').select('*').eq('user_id', note.user_id)
    const payload = JSON.stringify({ title: `Nhắc: ${note.title}`, body: '', tag: `note-${note.id}` })

    for (const sub of subs ?? []) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
        notesSent++
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 404 || statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('id', sub.id)
        }
      }
    }

    await supabase.from('notes').update({ reminded_at: now.toISOString() }).eq('id', note.id)
  }

  return new Response(
    JSON.stringify({ checked: debts?.length ?? 0, sent, notesChecked: notes?.length ?? 0, notesSent }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
