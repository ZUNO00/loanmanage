# Appointment Notes + Reminder Sound + iOS Hint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone appointment-note feature (title + one-time
datetime, no money) that shows on the same calendar/home views as debts,
gets a single push reminder 1 hour before, harden the voice-dictation date
parser, add a foreground "ding" sound when a push arrives while a tab is
open, and add an iOS "Add to Home Screen" hint banner.

**Architecture:** New `notes` table (own RLS, independent of `debts`),
`src/lib/notes.ts` CRUD mirroring `src/lib/debts.ts`'s pattern, a `NoteForm`/
`NoteList`/`/notes` page mirroring the existing debt-management pages,
and calendar/home components extended to render notes as extra colored
items alongside debt occurrences. The existing `send-reminders` Edge
Function gains a second scan (notes) reusing its existing push-delivery
code. The service worker relays a `postMessage` to any open tab on every
push so the tab can play a Web Audio "ding" — no new dependency.

**Tech Stack:** Same as the existing app — Next.js 16 Client Components,
`@supabase/supabase-js`, Supabase Edge Function (Deno) + `pg_cron`, Web
Speech API, Web Audio API (new, browser-native, no dependency).

## Global Constraints

- Notes are one-time only (no repeat) — a single absolute `timestamptz`,
  no day-of-month/timezone-offset math like debts need.
- Reminder: exactly once, at `note_at - 1 hour`; `reminded_at` gates
  re-sending (spec §5).
- Notes never carry money — no amount field anywhere.
- Note color in the UI is a new distinct blue (`--color-note`), separate
  from payable (red/orange), receivable (green), and neutral/paid (border
  gray).
- Web Push cannot play a custom sound while the browser/tab is closed —
  the foreground "ding" only fires when a tab is open (spec §6, already
  agreed with the human partner as a platform limitation).
- All existing debt features/tests/RLS policies are unaffected — this is
  purely additive.

---

### Task 1: Database schema for notes

**Files:**
- Create: `supabase/migrations/0004_notes.sql`

- [ ] Step 1: Write the migration

Create `supabase/migrations/0004_notes.sql`:

```sql
create table notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  note_at timestamptz not null,
  reminded_at timestamptz,
  created_at timestamptz not null default now()
);

alter table notes enable row level security;
create policy "notes_select_own" on notes for select using (user_id = auth.uid());
create policy "notes_insert_own" on notes for insert with check (user_id = auth.uid());
create policy "notes_update_own" on notes for update using (user_id = auth.uid());
create policy "notes_delete_own" on notes for delete using (user_id = auth.uid());
```

- [ ] Step 2: Push the migration

Run:
```bash
export SUPABASE_ACCESS_TOKEN="<SUPABASE_ACCESS_TOKEN>"
supabase db push
```
(Get the token from the human partner if it's not already in your shell —
it's the same Supabase project this app already uses, ref
`wzfpknrgmjfzlqvhvzue`.)
Expected: reports migration `0004_notes.sql` applied, no errors.

- [ ] Step 3: Verify

Run:
```bash
export SUPABASE_ACCESS_TOKEN="<SUPABASE_ACCESS_TOKEN>"
supabase db query "select table_name from information_schema.tables where table_name='notes'" --linked
```
Expected: one row, `notes`.

- [ ] Step 4: Commit

```bash
git add supabase/migrations/0004_notes.sql
git commit -m "feat: add notes table with RLS for appointment reminders"
```

---

### Task 2: Notes types + data layer

**Files:**
- Modify: `src/lib/types.ts`
- Create: `src/lib/notes.ts`

**Interfaces:**
- Produces: `Note { id, user_id, title, note_at: string, reminded_at:
  string | null, created_at: string }` (types.ts); `listNotes(supabase):
  Promise<Note[]>`, `upsertNote(supabase, note: Partial<Note> & {
  user_id: string }): Promise<Note>`, `deleteNote(supabase, id: string):
  Promise<void>` (notes.ts).

- [ ] Step 1: Add the `Note` type

In `src/lib/types.ts`, add at the end of the file:

```ts
export interface Note {
  id: string
  user_id: string
  title: string
  note_at: string // ISO timestamptz
  reminded_at: string | null
  created_at: string
}
```

- [ ] Step 2: Create `src/lib/notes.ts`

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Note } from './types'

export async function listNotes(supabase: SupabaseClient): Promise<Note[]> {
  const { data, error } = await supabase.from('notes').select('*').order('note_at', { ascending: true })
  if (error) throw error
  return data as Note[]
}

export async function upsertNote(supabase: SupabaseClient, note: Partial<Note> & { user_id: string }): Promise<Note> {
  const { data, error } = await supabase.from('notes').upsert(note).select().single()
  if (error) throw error
  return data as Note
}

export async function deleteNote(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('notes').delete().eq('id', id)
  if (error) throw error
}
```

- [ ] Step 3: Verify

Run: `npm run build`
Expected: compiles clean (no consumers yet, so no type errors expected).

- [ ] Step 4: Commit

```bash
git add src/lib/types.ts src/lib/notes.ts
git commit -m "feat: add Note type and notes data layer"
```

---

### Task 3: Harden the dictation date parser

**Files:**
- Modify: `src/lib/dictation.ts`
- Modify: `src/lib/dictation.test.ts`

**Interfaces:**
- No signature change — `parseDictation(text: string): ParsedDictation`
  keeps producing the same `date?: string` ('YYYY-MM-DD') shape, just
  recognizes more input formats. Later tasks (NoteForm) rely on this exact
  return shape.

- [ ] Step 1: Write the failing tests

Add these test cases to `src/lib/dictation.test.ts`, inside the existing
`describe('parseDictation', ...)` block (after the last existing `it`):

```ts
  it('resolves a day/month with no year to this year, or next year if already past', () => {
    // These two assertions are relative to "now" — the test fixes both
    // sides of the comparison using the same Date.now(), so it holds on
    // any run date.
    const future = new Date()
    future.setDate(future.getDate() + 30)
    const futureStr = `${String(future.getDate()).padStart(2, '0')}/${String(future.getMonth() + 1).padStart(2, '0')}`
    const result = parseDictation(`hẹn ngày ${futureStr}`)
    expect(result.date).toBe(
      `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`,
    )
  })

  it('parses verbose "ngày D tháng M năm Y" and "ngày D tháng M" (no year)', () => {
    expect(parseDictation('họp ngày 20 tháng 9 năm 2027').date).toBe('2027-09-20')
    const now = new Date()
    const verbose = parseDictation('họp ngày 20 tháng 9')
    const expectedYear = new Date(now.getFullYear(), 8, 20) < new Date(now.getFullYear(), now.getMonth(), now.getDate())
      ? now.getFullYear() + 1
      : now.getFullYear()
    expect(verbose.date).toBe(`${expectedYear}-09-20`)
  })

  it('resolves "hôm nay" and "ngày mai" to concrete dates', () => {
    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    expect(parseDictation('hẹn hôm nay lúc 3h').date).toBe(todayStr)

    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
    expect(parseDictation('nhắc tôi ngày mai nhé').date).toBe(tomorrowStr)
  })
```

- [ ] Step 2: Run to verify it fails

Run: `npm run test -- dictation.test.ts`
Expected: FAIL — the 3 new tests fail (short no-year dates, verbose
"tháng", "hôm nay"/"ngày mai" aren't recognized by the current parser).

- [ ] Step 3: Implement the hardened date parsing

In `src/lib/dictation.ts`, replace the existing date-parsing block:

```ts
  const dateMatch = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  if (dateMatch) {
    const [, d, m, y] = dateMatch
    result.date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
```

with:

```ts
  const fullDateMatch = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  const verboseDateMatch = lower.match(/ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})(?:\s+năm\s+(\d{4}))?/)
  const shortDateMatch = text.match(/(\d{1,2})[/-](\d{1,2})(?!\d)/)

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
```

Add this helper function above `parseDictation` (after the `ParsedDictation`
interface):

```ts
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
```

- [ ] Step 4: Run to verify it passes

Run: `npm run test -- dictation.test.ts`
Expected: PASS (9 tests — 6 original + 3 new).

- [ ] Step 5: Commit

```bash
git add src/lib/dictation.ts src/lib/dictation.test.ts
git commit -m "feat: recognize no-year, verbose, and relative dates in dictation parser"
```

---

### Task 4: Dark Slate theme token for notes

**Files:**
- Modify: `src/app/globals.css`

- [ ] Step 1: Add the note color token

In `src/app/globals.css`, inside the existing `@theme inline { ... }`
block, add one line after `--color-payable: #fca5a5;`:

```css
  --color-note: #60a5fa;
```

- [ ] Step 2: Verify

Run: `npm run build`
Expected: compiles clean (no consumers yet).

- [ ] Step 3: Commit

```bash
git add src/app/globals.css
git commit -m "feat: add note color token to Dark Slate theme"
```

---

### Task 5: NoteForm component

**Files:**
- Create: `src/components/NoteForm.tsx`

**Interfaces:**
- Consumes: `Note` from `@/lib/types`; `parseDictation` from
  `@/lib/dictation`.
- Produces: `<NoteForm initial={Note|null} onSubmit={(values:
  Partial<Note>) => Promise<void>} onCancel={() => void} />` — used by
  Task 6's `NoteList`.

- [ ] Step 1: Implement `src/components/NoteForm.tsx`

```tsx
'use client'

import { useState } from 'react'
import type { Note } from '@/lib/types'
import { parseDictation } from '@/lib/dictation'

interface Props {
  initial: Partial<Note> | null
  onSubmit: (values: Partial<Note>) => Promise<void>
  onCancel: () => void
}

function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function NoteForm({ initial, onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [noteAtLocal, setNoteAtLocal] = useState(toDatetimeLocal(initial?.note_at))
  const [transcript, setTranscript] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function applyDictation(text: string) {
    setTranscript(text)
    const parsed = parseDictation(text)
    if (parsed.date || parsed.time) {
      const [datePart, timePart] = noteAtLocal.split('T')
      const newDate = parsed.date ?? datePart ?? ''
      const newTime = parsed.time ?? timePart ?? '00:00'
      if (newDate) setNoteAtLocal(`${newDate}T${newTime}`)
    }
    if (!title && text.trim()) setTitle(text.trim())
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
      await onSubmit({
        id: initial?.id,
        title,
        note_at: noteAtLocal ? new Date(noteAtLocal).toISOString() : undefined,
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

      <input className="rounded-lg bg-bg px-3 py-2 text-text" placeholder="Tiêu đề" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <input className="rounded-lg bg-bg px-3 py-2 text-text" type="datetime-local" value={noteAtLocal} onChange={(e) => setNoteAtLocal(e.target.value)} required />

      {error && <p className="text-sm text-payable">{error}</p>}
      <div className="flex gap-2">
        <button disabled={submitting} className="flex-1 rounded-xl bg-note py-2 font-semibold text-white disabled:opacity-50" type="submit">
          Lưu
        </button>
        <button type="button" onClick={onCancel} className="flex-1 rounded-xl bg-bg py-2 text-text-muted">
          Hủy
        </button>
      </div>
    </form>
  )
}
```

- [ ] Step 2: Verify

Run: `npm run build`
Expected: compiles clean.

- [ ] Step 3: Commit

```bash
git add src/components/NoteForm.tsx
git commit -m "feat: add NoteForm with datetime-local input and mic dictation"
```

---

### Task 6: NoteList + /notes page + nav link

**Files:**
- Create: `src/components/NoteList.tsx`
- Create: `src/app/(protected)/notes/page.tsx`
- Modify: `src/components/TopNav.tsx`

**Interfaces:**
- Consumes: `listNotes`, `upsertNote`, `deleteNote` from `@/lib/notes`;
  `NoteForm` from Task 5; `useAuth` from `@/components/AuthProvider`.

- [ ] Step 1: Implement `src/components/NoteList.tsx`

```tsx
'use client'

import { useEffect, useState } from 'react'
import type { Note } from '@/lib/types'
import { deleteNote, listNotes, upsertNote } from '@/lib/notes'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/AuthProvider'
import { NoteForm } from '@/components/NoteForm'

function formatNoteAt(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function NoteList() {
  const { session } = useAuth()
  const [notes, setNotes] = useState<Note[]>([])
  const [editing, setEditing] = useState<Note | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const supabase = getSupabaseClient()

  async function refresh() {
    try {
      setNotes(await listNotes(supabase))
    } catch {
      setError('Không tải được danh sách, thử tải lại trang.')
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount, no data-fetching library in this stack
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(values: Partial<Note>) {
    // No try/catch here: a rejection must propagate to NoteForm's own
    // catch, which is what's actually on screen while editing (this
    // component early-returns to <NoteForm> below).
    await upsertNote(supabase, { ...values, user_id: session!.user.id })
    setEditing(null)
    await refresh()
  }

  async function handleDelete(id: string) {
    try {
      await deleteNote(supabase, id)
      await refresh()
    } catch {
      setError('Không xóa được, thử lại.')
    }
  }

  if (editing) {
    return <NoteForm initial={editing === 'new' ? null : editing} onSubmit={handleSubmit} onCancel={() => setEditing(null)} />
  }

  return (
    <div className="flex flex-1 flex-col gap-3">
      {error && <p className="text-sm text-payable">{error}</p>}
      <button onClick={() => setEditing('new')} className="self-start rounded-xl bg-note px-4 py-2 font-semibold text-white">
        + Thêm ghi chú
      </button>
      {notes.map((note) => (
        <div key={note.id} className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-text">{note.title}</p>
              <p className="text-sm text-text-muted">{formatNoteAt(note.note_at)}</p>
            </div>
            <div className="flex gap-2 text-sm">
              <button onClick={() => setEditing(note)} className="text-text-muted hover:text-text">Sửa</button>
              <button onClick={() => handleDelete(note.id)} className="text-payable">Xóa</button>
            </div>
          </div>
        </div>
      ))}
      {notes.length === 0 && <p className="text-text-muted">Chưa có ghi chú nào.</p>}
    </div>
  )
}
```

- [ ] Step 2: Implement `src/app/(protected)/notes/page.tsx`

```tsx
'use client'

import { NoteList } from '@/components/NoteList'

export default function NotesPage() {
  return <NoteList />
}
```

- [ ] Step 3: Add the nav link

In `src/components/TopNav.tsx`, change the `LINKS` array from:

```tsx
const LINKS = [
  { href: '/', label: 'Trang chủ' },
  { href: '/calendar', label: 'Lịch' },
  { href: '/debts', label: 'Khoản vay' },
  { href: '/lending', label: 'Cho vay/mượn' },
]
```

to:

```tsx
const LINKS = [
  { href: '/', label: 'Trang chủ' },
  { href: '/calendar', label: 'Lịch' },
  { href: '/debts', label: 'Khoản vay' },
  { href: '/lending', label: 'Cho vay/mượn' },
  { href: '/notes', label: 'Ghi chú' },
]
```

- [ ] Step 4: Verify

Run: `npm run build`
Expected: compiles clean, route table includes `/notes`.

- [ ] Step 5: Commit

```bash
git add src/components/NoteList.tsx "src/app/(protected)/notes/page.tsx" src/components/TopNav.tsx
git commit -m "feat: add notes management page and nav link"
```

---

### Task 7: Show notes on the calendar

**Files:**
- Modify: `src/components/CalendarMonth.tsx`

**Interfaces:**
- Consumes: `Note` from `@/lib/types`.
- Produces: `CalendarMonth` now takes an additional required `notes:
  Note[]` prop — Task 8 updates both callers (`calendar/page.tsx`,
  `page.tsx`) to pass it.

- [ ] Step 1: Replace `src/components/CalendarMonth.tsx` in full

```tsx
'use client'

import { useMemo, useState } from 'react'
import type { Debt, DebtPayment, Note } from '@/lib/types'
import { getOccurrencesInRange, paymentKey } from '@/lib/schedule'
import { formatMoney } from '@/lib/money'

interface Props {
  debts: Debt[]
  payments: DebtPayment[]
  notes: Note[]
  onMarkPaid: (debtId: string, period: string) => Promise<void>
}

const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

export function CalendarMonth({ debts, payments, notes, onMarkPaid }: Props) {
  const [cursor, setCursor] = useState(() => new Date())
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)

  const paidKeys = useMemo(() => new Set(payments.map((p) => paymentKey(p.debt_id, p.period))), [payments])

  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59)
  const monthStartMs = monthStart.getTime()
  const monthEndMs = monthEnd.getTime()
  const occurrences = useMemo(
    () => getOccurrencesInRange(debts, paidKeys, monthStart, monthEnd),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- monthStart/monthEnd are new Date objects every render; monthStartMs/monthEndMs is their real value for memoization
    [debts, paidKeys, monthStartMs, monthEndMs],
  )

  const leadingBlanks = (monthStart.getDay() + 6) % 7 // Monday-first
  const daysInMonth = monthEnd.getDate()
  const cells: (Date | null)[] = [
    ...Array(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(cursor.getFullYear(), cursor.getMonth(), i + 1)),
  ]

  function occurrencesOn(day: Date) {
    return occurrences.filter((o) => o.occurrence.dueAt.toDateString() === day.toDateString())
  }

  function notesOn(day: Date) {
    return notes.filter((n) => new Date(n.note_at).toDateString() === day.toDateString())
  }

  const selectedOccurrences = selectedDay ? occurrencesOn(selectedDay) : []
  const selectedNotes = selectedDay ? notesOn(selectedDay) : []
  const today = new Date()

  return (
    <div className="flex-1">
      <div className="mb-3 flex items-center justify-between">
        <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="rounded-lg bg-surface px-3 py-1 text-text">‹</button>
        <p className="font-semibold text-text">Tháng {cursor.getMonth() + 1}/{cursor.getFullYear()}</p>
        <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="rounded-lg bg-surface px-3 py-1 text-text">›</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-text-muted">
        {WEEKDAY_LABELS.map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />
          const dayOccurrences = occurrencesOn(day)
          const dayNotes = notesOn(day)
          const isToday = day.toDateString() === today.toDateString()
          const isSelected = selectedDay?.toDateString() === day.toDateString()
          type Item = { key: string; label: string; colorClass: string }
          const debtItems: Item[] = dayOccurrences.map((o) => ({
            key: o.debt.id + o.occurrence.period,
            label: o.debt.name,
            colorClass: o.paid
              ? 'bg-border text-text-muted line-through'
              : o.occurrence.isReceivable
                ? 'bg-receivable text-bg'
                : 'bg-gradient-to-r from-urgent-from to-urgent-to text-white',
          }))
          const noteItems: Item[] = dayNotes.map((n) => ({
            key: n.id,
            label: n.title,
            colorClass: 'bg-note text-white',
          }))
          const items = [...debtItems, ...noteItems]
          const visible = items.slice(0, 3)
          const hiddenCount = items.length - visible.length
          return (
            <button
              key={i}
              onClick={() => setSelectedDay(day)}
              className={`aspect-square overflow-hidden rounded-lg bg-surface p-1 text-left text-[10px] ring-2 ${isSelected ? 'ring-text' : isToday ? 'ring-text-muted' : 'ring-transparent'}`}
            >
              <div className="mb-0.5 text-xs font-semibold text-text">{day.getDate()}</div>
              <div className="flex flex-col gap-0.5">
                {visible.map((item) => (
                  <div key={item.key} className={`truncate rounded px-1 leading-tight ${item.colorClass}`}>
                    {item.label}
                  </div>
                ))}
                {hiddenCount > 0 && <div className="px-1 leading-tight text-text-muted">+{hiddenCount} khác</div>}
              </div>
            </button>
          )
        })}
      </div>

      {selectedDay && (
        <div className="mt-4 rounded-xl bg-surface p-4">
          <p className="mb-2 font-semibold text-text">Ngày {selectedDay.getDate()}/{selectedDay.getMonth() + 1}</p>
          {selectedOccurrences.length === 0 && selectedNotes.length === 0 && <p className="text-text-muted">Không có khoản nào.</p>}
          {selectedOccurrences.map(({ debt, occurrence, paid }) => (
            <div key={debt.id + occurrence.period} className="mb-2 flex items-center justify-between rounded-lg bg-bg p-3">
              <div>
                <p className="text-text">{debt.name}</p>
                <p className="text-sm text-text-muted">{formatMoney(occurrence.amount)}đ</p>
              </div>
              <div className="flex gap-2">
                {debt.account_number && (
                  <button
                    onClick={() => navigator.clipboard.writeText(debt.account_number!)}
                    className="rounded-lg bg-border px-2 py-1 text-xs text-text"
                  >
                    Copy STK
                  </button>
                )}
                {!paid && (
                  <button
                    onClick={() => onMarkPaid(debt.id, occurrence.period)}
                    className="rounded-lg bg-receivable px-2 py-1 text-xs text-bg"
                  >
                    Đã đóng
                  </button>
                )}
              </div>
            </div>
          ))}
          {selectedNotes.map((note) => (
            <div key={note.id} className="mb-2 rounded-lg bg-bg p-3">
              <p className="text-text">{note.title}</p>
              <p className="text-sm text-text-muted">
                {new Date(note.note_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] Step 2: Verify

Run: `npm run build`
Expected: FAILS at this point — `calendar/page.tsx` and `page.tsx` (Task 8)
don't pass the new required `notes` prop yet. That's expected; Task 8
fixes both callers. Confirm the error is specifically about the missing
`notes` prop on `<CalendarMonth>` (not something else), then proceed —
don't commit yet.

---

### Task 8: Fetch notes on calendar/home pages, show in day lists and week strip

**Files:**
- Modify: `src/components/WeekStrip.tsx`
- Modify: `src/app/(protected)/page.tsx`
- Modify: `src/app/(protected)/calendar/page.tsx`

**Interfaces:**
- Consumes: `listNotes` from `@/lib/notes`; `Note` from `@/lib/types`;
  `CalendarMonth` from Task 7 (now requires `notes` prop).
- Produces: `WeekStrip`'s `days` prop now requires `hasNote: boolean` per
  entry (this task's own `page.tsx` change supplies it — no other
  consumer of `WeekStrip` exists).

- [ ] Step 1: Replace `src/components/WeekStrip.tsx` in full

```tsx
'use client'

const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

interface Props {
  days: Array<{ date: Date; hasUnpaid: boolean; hasNote: boolean }>
  selected: Date
  onSelect: (date: Date) => void
}

export function WeekStrip({ days, selected, onSelect }: Props) {
  return (
    <div className="flex gap-2">
      {days.map(({ date, hasUnpaid, hasNote }) => {
        const isSelected = date.toDateString() === selected.toDateString()
        return (
          <button
            key={date.toISOString()}
            onClick={() => onSelect(date)}
            className={`flex-1 rounded-xl p-2 text-center ring-2 ${isSelected ? 'ring-text' : 'ring-transparent'} ${
              hasUnpaid ? 'bg-gradient-to-br from-urgent-from to-urgent-to text-white' : hasNote ? 'bg-note text-white' : 'bg-surface text-text-muted'
            }`}
          >
            <div className="text-[10px]">{WEEKDAY_LABELS[(date.getDay() + 6) % 7]}</div>
            <div className="text-sm font-semibold">{date.getDate()}</div>
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] Step 2: Replace `src/app/(protected)/page.tsx` in full

```tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Debt, DebtPayment, Note } from '@/lib/types'
import { listAllActiveDebts, listPayments, markPaid } from '@/lib/debts'
import { listNotes } from '@/lib/notes'
import { getOccurrencesInRange, paymentKey } from '@/lib/schedule'
import { computeDashboardSummary } from '@/lib/dashboard'
import { formatMoney } from '@/lib/money'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/AuthProvider'
import { WeekStrip } from '@/components/WeekStrip'
import { SummaryCards } from '@/components/SummaryCards'
import { CalendarMonth } from '@/components/CalendarMonth'

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export default function HomePage() {
  const { session } = useAuth()
  const [debts, setDebts] = useState<Debt[]>([])
  const [payments, setPayments] = useState<DebtPayment[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()))
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

  const paidKeys = useMemo(() => new Set(payments.map((p) => paymentKey(p.debt_id, p.period))), [payments])

  const weekDays = useMemo(() => {
    const today = startOfDay(new Date())
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i)
      const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59)
      const hasUnpaid = getOccurrencesInRange(debts, paidKeys, date, dayEnd).some((o) => !o.paid)
      const hasNote = notes.some((n) => new Date(n.note_at).toDateString() === date.toDateString())
      return { date, hasUnpaid, hasNote }
    })
  }, [debts, paidKeys, notes])

  const selectedOccurrences = useMemo(() => {
    const dayEnd = new Date(selectedDay.getFullYear(), selectedDay.getMonth(), selectedDay.getDate(), 23, 59, 59)
    return getOccurrencesInRange(debts, paidKeys, selectedDay, dayEnd)
  }, [debts, paidKeys, selectedDay])

  const selectedNotes = useMemo(
    () => notes.filter((n) => new Date(n.note_at).toDateString() === selectedDay.toDateString()),
    [notes, selectedDay],
  )

  const summary = useMemo(() => computeDashboardSummary(debts, paidKeys), [debts, paidKeys])

  async function handleMarkPaid(debtId: string, period: string) {
    try {
      setError(null)
      await markPaid(supabase, debtId, session!.user.id, period)
      await refresh()
    } catch {
      setError('Không đánh dấu đã đóng được, thử lại.')
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4 lg:flex-row">
      <div className="flex flex-1 flex-col gap-4">
        {error && <p className="text-sm text-payable">{error}</p>}
        <WeekStrip days={weekDays} selected={selectedDay} onSelect={setSelectedDay} />
        <div className="flex flex-col gap-2">
          {selectedOccurrences.length === 0 && selectedNotes.length === 0 && <p className="text-text-muted">Không có khoản nào ngày này.</p>}
          {selectedOccurrences.map(({ debt, occurrence, paid }) => (
            <div key={debt.id + occurrence.period} className="flex items-center justify-between rounded-xl bg-surface p-3">
              <div>
                <p className="text-text">{debt.name}</p>
                <p className="text-sm text-text-muted">{formatMoney(occurrence.amount)}đ</p>
              </div>
              <div className="flex gap-2">
                {debt.account_number && (
                  <button onClick={() => navigator.clipboard.writeText(debt.account_number!)} className="rounded-lg bg-border px-2 py-1 text-xs text-text">
                    Copy STK
                  </button>
                )}
                {!paid && (
                  <button onClick={() => handleMarkPaid(debt.id, occurrence.period)} className="rounded-lg bg-receivable px-2 py-1 text-xs text-bg">
                    Đã đóng
                  </button>
                )}
              </div>
            </div>
          ))}
          {selectedNotes.map((note) => (
            <div key={note.id} className="flex items-center justify-between rounded-xl bg-surface p-3">
              <div>
                <p className="text-text">{note.title}</p>
                <p className="text-sm text-text-muted">
                  {new Date(note.note_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))}
        </div>
        <CalendarMonth debts={debts} payments={payments} notes={notes} onMarkPaid={handleMarkPaid} />
      </div>
      <div className="lg:sticky lg:top-4 lg:h-fit lg:w-80">
        <SummaryCards summary={summary} />
      </div>
    </div>
  )
}
```

- [ ] Step 3: Replace `src/app/(protected)/calendar/page.tsx` in full

```tsx
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
```

- [ ] Step 4: Verify

Run: `npm run build`
Expected: compiles clean now (Task 7's failure is resolved).

Run: `npm run lint`
Expected: 0 errors, 0 warnings.

- [ ] Step 5: Commit

```bash
git add src/components/CalendarMonth.tsx src/components/WeekStrip.tsx "src/app/(protected)/page.tsx" "src/app/(protected)/calendar/page.tsx"
git commit -m "feat: show notes on calendar, home week strip, and day-detail lists"
```

---

### Task 9: Edge Function scans notes for the 1-hour reminder

**Files:**
- Modify: `supabase/functions/send-reminders/index.ts`

- [ ] Step 1: Add the notes scan

In `supabase/functions/send-reminders/index.ts`, add this interface near
the existing `Debt` interface:

```ts
interface NoteRow {
  id: string
  user_id: string
  title: string
  note_at: string
  reminded_at: string | null
}
```

Then, inside the `Deno.serve(async (req) => { ... })` handler, right
before the final `return new Response(...)` statement, add:

```ts
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
```

Then change the final return statement from:

```ts
  return new Response(JSON.stringify({ checked: debts?.length ?? 0, sent }), { headers: { 'Content-Type': 'application/json' } })
```

to:

```ts
  return new Response(
    JSON.stringify({ checked: debts?.length ?? 0, sent, notesChecked: notes?.length ?? 0, notesSent }),
    { headers: { 'Content-Type': 'application/json' } },
  )
```

- [ ] Step 2: Redeploy

Run:
```bash
export SUPABASE_ACCESS_TOKEN="<SUPABASE_ACCESS_TOKEN>"
supabase functions deploy send-reminders --no-verify-jwt --use-api --project-ref wzfpknrgmjfzlqvhvzue
```
Expected: reports the function redeployed.

- [ ] Step 3: Smoke-test (needs the cron shared secret — same one already
  configured for the existing debt reminders)

Run (verified working exactly as written — the CLI's `--output json` wraps
rows in `{ rows: [...] }`, and stderr must be silenced or it pollutes the
piped JSON):
```bash
export SUPABASE_ACCESS_TOKEN="<SUPABASE_ACCESS_TOKEN>"
CRON_SECRET=$(supabase db query "select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'" --linked --output json 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).rows[0].decrypted_secret))")
curl -s -X POST "https://wzfpknrgmjfzlqvhvzue.supabase.co/functions/v1/send-reminders" -H "x-cron-secret: $CRON_SECRET"
```
Expected: `{"checked":N,"sent":N,"notesChecked":N,"notesSent":N}` — HTTP 200,
no error. `notesChecked`/`notesSent` can legitimately be 0 if there are no
notes with `reminded_at is null` yet — that's fine, it just proves the new
field appears and the function didn't crash.

- [ ] Step 4: Commit

```bash
git add supabase/functions/send-reminders/index.ts
git commit -m "feat: send a one-time 1-hour-before push reminder for notes"
```

---

### Task 10: Foreground "ding" sound on push

**Files:**
- Modify: `public/sw.js`
- Create: `src/components/NotificationSoundListener.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Produces: `<NotificationSoundListener />` — a side-effect-only component
  (renders nothing) mounted once in the root layout.

- [ ] Step 1: Replace `public/sw.js` in full

```js
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {}
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || 'Nhắc thanh toán', {
        body: data.body || '',
        icon: '/favicon.ico',
        tag: data.tag || 'loanmanage-reminder',
      }),
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) client.postMessage({ type: 'PLAY_REMINDER_SOUND' })
      }),
    ]),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) return client.focus()
      }
      return self.clients.openWindow('/')
    }),
  )
})
```

- [ ] Step 2: Implement `src/components/NotificationSoundListener.tsx`

```tsx
'use client'

import { useEffect } from 'react'

function playBell() {
  const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextCtor) return
  const ctx = new AudioContextCtor()
  const startTime = ctx.currentTime
  ;[880, 1320].forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = freq
    osc.connect(gain)
    gain.connect(ctx.destination)
    const start = startTime + i * 0.18
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16)
    osc.start(start)
    osc.stop(start + 0.18)
  })
}

export function NotificationSoundListener() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === 'PLAY_REMINDER_SOUND') playBell()
    }
    navigator.serviceWorker.addEventListener('message', handleMessage)
    return () => navigator.serviceWorker.removeEventListener('message', handleMessage)
  }, [])

  return null
}
```

- [ ] Step 3: Mount it in the root layout

In `src/app/layout.tsx`, add the import:

```tsx
import { NotificationSoundListener } from "@/components/NotificationSoundListener";
```

and render it inside `<AuthProvider>`, as a sibling before `{children}`:

```tsx
        <AuthProvider>
          <NotificationSoundListener />
          {children}
        </AuthProvider>
```

- [ ] Step 4: Verify

Run: `npm run build`
Expected: compiles clean.

Run: `npm run lint`
Expected: 0 errors, 0 warnings.

- [ ] Step 5: Commit

```bash
git add public/sw.js src/components/NotificationSoundListener.tsx src/app/layout.tsx
git commit -m "feat: play a Web Audio ding in any open tab when a push notification arrives"
```

---

### Task 11: iOS "Add to Home Screen" hint

**Files:**
- Create: `src/components/IosInstallHint.tsx`
- Modify: `src/app/(protected)/layout.tsx`

**Interfaces:**
- Produces: `<IosInstallHint />` — self-contained, no props.

- [ ] Step 1: Implement `src/components/IosInstallHint.tsx`

```tsx
'use client'

import { useEffect, useState } from 'react'

const DISMISS_KEY = 'loanmanage:ios-hint-dismissed'

export function IosInstallHint() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
    const nav = navigator as Navigator & { standalone?: boolean }
    const isStandalone = nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches
    const dismissed = localStorage.getItem(DISMISS_KEY) === 'true'
    setShow(isIos && !isStandalone && !dismissed)
  }, [])

  if (!show) return null

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, 'true')
    setShow(false)
  }

  return (
    <div className="flex items-center justify-between gap-2 bg-border px-4 py-2 text-xs text-text">
      <span>📲 Trên iPhone: bấm nút Chia sẻ rồi chọn &quot;Thêm vào Màn hình chính&quot; để dùng được mic đọc và nhận thông báo nhắc.</span>
      <button onClick={dismiss} className="shrink-0 text-text-muted">Đã hiểu</button>
    </div>
  )
}
```

- [ ] Step 2: Mount it in the protected layout

In `src/app/(protected)/layout.tsx`, add the import:

```tsx
import { IosInstallHint } from '@/components/IosInstallHint'
```

and render it right after `<TopNav />`:

```tsx
  return (
    <div className="min-h-screen">
      <TopNav />
      <IosInstallHint />
      <main className="mx-auto max-w-6xl p-4 lg:flex lg:gap-6">{children}</main>
    </div>
  )
```

- [ ] Step 3: Verify

Run: `npm run build`
Expected: compiles clean.

Run: `npm run lint`
Expected: 0 errors, 0 warnings.

- [ ] Step 4: Commit

```bash
git add src/components/IosInstallHint.tsx "src/app/(protected)/layout.tsx"
git commit -m "feat: add dismissible iOS Add-to-Home-Screen hint banner"
```

---

### Task 12: Final verification and redeploy

No new files — final check + ship.

- [ ] Step 1: Run the full automated suite

Run: `npm run test`
Expected: all tests pass (existing suite + Task 3's 3 new dictation tests).

- [ ] Step 2: Run build and lint one more time

Run: `npm run build`
Expected: clean, route table includes `/notes`.

Run: `npm run lint`
Expected: 0 errors, 0 warnings.

- [ ] Step 3: Redeploy to Netlify

Run:
```bash
export NETLIFY_AUTH_TOKEN="<NETLIFY_AUTH_TOKEN>"
netlify deploy --prod
```
(Get the token from the human partner if it's not already in your shell —
same site, `loanmanage-hoavnh`, already linked via `.netlify/state.json`
in this repo.)
Expected: "Deploy is live!", production URL
`https://loanmanage-hoavnh.netlify.app`.

- [ ] Step 4: Manual checklist (report which items you could not verify —
  this environment has no browser automation tool; the human partner runs
  this checklist themselves)

- [ ] Go to "Ghi chú", add a note with a title + datetime a few minutes in
  the future → appears in the list.
- [ ] Go to "Lịch", confirm the note's day shows a blue card with its
  title; click the day → popup shows the note's title + time, no
  copy/mark-paid buttons.
- [ ] Go to trang chủ, confirm a day with only a note (no debt due) shows
  the week-strip tile in blue, not the debt red/orange.
- [ ] On the note form, click the mic (Chrome desktop/Android only) and
  say a sentence like "họp lúc 3 giờ chiều ngày mai" → confirm the
  datetime field fills in correctly.
- [ ] Confirm push still works for both debts and notes (may need a note
  due within the next ~1h15m to see the reminder fire within a reasonable
  wait, since the cron only runs every 15 minutes and the threshold is
  exactly 1 hour before).
- [ ] With the app open in a foreground tab, confirm a "ding" sound plays
  when a push notification arrives (both for a note and for a debt).
- [ ] On an iPhone, open the site in Safari without installing it — confirm
  the "📲 Trên iPhone..." banner appears, and dismissing it hides it and it
  stays hidden on reload.

- [ ] Step 5: Report results

If every checklist item you could verify passes and the human partner
confirms the remaining manual/mobile items later, the feature is
complete.
