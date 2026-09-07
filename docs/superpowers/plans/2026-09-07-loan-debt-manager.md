# Web quản lý ghi nợ vay/thẻ tín dụng — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Next.js + Supabase web app described in
`docs/superpowers/specs/2026-09-07-loan-debt-manager-design.md`: multi-user debt
tracker (bank loans/credit cards + peer lending/borrowing) with a calendar,
home dashboard, voice-dictation form filling, and push-notification reminders.

**Architecture:** Next.js 16 App Router, every page a Client Component calling
Supabase directly from the browser (no API routes, no Server Actions — RLS is
the only access control). A shared `src/lib/schedule.ts` computes due
dates/amounts for both recurring and one-time debts and is the single source
of truth for the calendar, dashboard, and (duplicated, different runtime) the
reminder Edge Function. Push reminders run via a Supabase Edge Function on a
`pg_cron` 15-minute schedule, independent of whether the browser is open.

**Tech Stack:** Next.js 16.3.4, React 19, TypeScript, Tailwind CSS v4,
`@supabase/supabase-js` v2, Vitest (unit tests), Web Push (VAPID) +
`npm:web-push` inside a Deno Edge Function, Web Speech API (browser-native,
no dependency).

## Global Constraints

- No API routes / Server Actions for CRUD — everything is a Client Component
  calling `@supabase/supabase-js` directly; RLS enforces `user_id = auth.uid()`
  on every table (spec §3).
- Auth uses `login_id` (e.g. `hoavnh_00`) mapped to a synthetic email
  `<login_id>@loanmanage.local` — never show this fake email in the UI (spec §4).
- All money display goes through `Intl.NumberFormat('vi-VN')` — dot thousand
  separators everywhere (spec §11).
- Recurring debts (`credit_card`, `loan`, and `lend_out`/`borrow_in` with
  `repayment_mode='recurring'`) never terminate on their own — only `one_time`
  peer loans have a fixed end (spec §1, §7).
- Reminder thresholds: `credit_card` = due − 2 days; everything else (`loan`,
  `lend_out`, `borrow_in`) = due − 24 hours (spec §6).
- Dark Slate palette only (no light mode): background `#0b1220`, surface
  `#141c2e`, border `#22304a`, text `#e2e8f0`, urgent gradient
  `#f43f5e → #fb923c`, receivable accent `#86efac` (spec §9).

---

## Already done (setup performed directly, not via subagent)

These required interactive login/external-service access I already had in
this session, so they're done rather than written as engineer-executable
steps:

- Next.js 16.3.4 scaffolded (`create-next-app`, App Router/TS/Tailwind v4/
  src-dir), committed as `0560e5e`.
- Supabase CLI installed, logged in, project linked to `wzfpknrgmjfzlqvhvzue`
  (`supabase link`). `supabase/config.toml` committed; `supabase/.temp/` is
  gitignored by Supabase's own `supabase/.gitignore`.
- Supabase Auth config: `mailer_autoconfirm` set to `true` via the Management
  API — required because signups use a fake `@loanmanage.local` email that
  can never receive a real confirmation link.
- VAPID key pair generated (`npx web-push generate-vapid-keys`). Public key
  is in `.env.local` as `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. Private key + subject
  already pushed as Supabase Edge Function secrets: `VAPID_PRIVATE_KEY`,
  `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` (`supabase secrets set`).
- `.env.local` created (gitignored) with `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
- `SUPABASE_ACCESS_TOKEN` env var needed for any `supabase` CLI command in
  this repo (db push, functions deploy, secrets) — export it in the shell
  before running CLI commands in later tasks:
  `export SUPABASE_ACCESS_TOKEN="<SUPABASE_ACCESS_TOKEN>"`

---

### Task 1: Project scaffold (done)

**Files:** `package.json`, `next.config.ts`, `tsconfig.json`, `src/app/*`,
`supabase/config.toml`, `.gitignore`

- [x] Step 1: Scaffold Next.js app, restore `.superpowers/` and `supabase/`
  dirs the scaffolder flagged as conflicts, re-add `.superpowers/` to
  `.gitignore`, commit (`0560e5e`).
- [x] Step 2: `supabase init`, `supabase link --project-ref
  wzfpknrgmjfzlqvhvzue`.

---

### Task 2: Dependencies, Supabase client, Vitest setup

**Files:**
- Modify: `package.json`
- Create: `src/lib/supabase/client.ts`
- Create: `vitest.config.ts`

**Interfaces:**
- Produces: `getSupabaseClient(): SupabaseClient` — every later task that
  talks to Supabase imports this.

- [ ] Step 1: Install runtime and dev dependencies

Run: `npm install @supabase/supabase-js`
Run: `npm install -D vitest`

- [ ] Step 2: Add the Supabase browser client helper

Create `src/lib/supabase/client.ts`:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | undefined

function resolveAuthStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined
  const remember = window.localStorage.getItem('loanmanage:remember') !== 'false'
  return remember ? window.localStorage : window.sessionStorage
}

export function getSupabaseClient(): SupabaseClient {
  if (cached) return cached
  cached = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: {
        storage: resolveAuthStorage(),
        persistSession: true,
        autoRefreshToken: true,
      },
    },
  )
  return cached
}

/** Call before signUp/signIn so the session lands in the right storage. */
export function setRememberMe(remember: boolean) {
  window.localStorage.setItem('loanmanage:remember', remember ? 'true' : 'false')
  cached = undefined // force re-creation with the new storage on next getSupabaseClient()
}
```

- [ ] Step 3: Add Vitest config

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
```

Add to `package.json` `"scripts"`: `"test": "vitest run"`.

- [ ] Step 4: Verify

Run: `npm run test`
Expected: `No test files found` (no test files yet) — exits without error,
proves Vitest + config load correctly.

- [ ] Step 5: Commit

```bash
git add package.json package-lock.json src/lib/supabase/client.ts vitest.config.ts
git commit -m "feat: add Supabase client helper and Vitest setup"
```

---

### Task 3: Database schema + RLS

**Files:**
- Create: `supabase/migrations/0001_init.sql`

- [ ] Step 1: Write the migration

Create `supabase/migrations/0001_init.sql`:

```sql
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  login_id text not null unique,
  display_name text not null,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
create policy "profiles_select_own" on profiles for select using (id = auth.uid());
create policy "profiles_insert_own" on profiles for insert with check (id = auth.uid());
create policy "profiles_update_own" on profiles for update using (id = auth.uid());

create table debts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('credit_card','loan','lend_out','borrow_in')),
  name text not null,
  amount numeric,
  due_day int check (due_day between 1 and 31),
  due_time time,
  account_number text,
  bank_name text,
  account_holder text,
  counterparty_name text,
  principal_amount numeric,
  interest_rate_pct numeric,
  repayment_mode text check (repayment_mode in ('recurring','one_time')),
  start_date date,
  due_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table debts enable row level security;
create policy "debts_select_own" on debts for select using (user_id = auth.uid());
create policy "debts_insert_own" on debts for insert with check (user_id = auth.uid());
create policy "debts_update_own" on debts for update using (user_id = auth.uid());
create policy "debts_delete_own" on debts for delete using (user_id = auth.uid());

create table debt_payments (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null references debts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  period text not null,
  paid_at timestamptz not null default now(),
  unique (debt_id, period)
);

alter table debt_payments enable row level security;
create policy "debt_payments_select_own" on debt_payments for select using (user_id = auth.uid());
create policy "debt_payments_insert_own" on debt_payments for insert with check (user_id = auth.uid());
create policy "debt_payments_delete_own" on debt_payments for delete using (user_id = auth.uid());

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;
create policy "push_subscriptions_select_own" on push_subscriptions for select using (user_id = auth.uid());
create policy "push_subscriptions_insert_own" on push_subscriptions for insert with check (user_id = auth.uid());
create policy "push_subscriptions_delete_own" on push_subscriptions for delete using (user_id = auth.uid());
```

- [ ] Step 2: Push the migration to the linked Supabase project

Run:
```bash
export SUPABASE_ACCESS_TOKEN="<SUPABASE_ACCESS_TOKEN>"
supabase db push
```
Expected: reports migration `0001_init.sql` applied, no errors.

- [ ] Step 3: Verify tables exist

Run:
```bash
export SUPABASE_ACCESS_TOKEN="<SUPABASE_ACCESS_TOKEN>"
supabase db query "select table_name from information_schema.tables where table_schema='public' order by 1" --linked
```
Expected: lists `debt_payments`, `debts`, `profiles`, `push_subscriptions`.

- [ ] Step 4: Commit

```bash
git add supabase/migrations/0001_init.sql
git commit -m "feat: add debts/payments/profiles/push_subscriptions schema with RLS"
```

---

### Task 4: Shared types + money formatting

**Files:**
- Create: `src/lib/types.ts`
- Create: `src/lib/money.ts`
- Test: `src/lib/money.test.ts`

**Interfaces:**
- Produces: `DebtType`, `RepaymentMode`, `Debt`, `DebtPayment` (types.ts);
  `formatMoney(value: number): string`, `parseMoneyDigits(input: string):
  number`, `formatMoneyInput(input: string): string` (money.ts).

- [ ] Step 1: Write `src/lib/types.ts`

```ts
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
```

- [ ] Step 1: Write the failing test for money formatting

Create `src/lib/money.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatMoney, parseMoneyDigits, formatMoneyInput } from './money'

describe('formatMoney', () => {
  it('formats with Vietnamese thousand separators', () => {
    expect(formatMoney(14000000)).toBe('14.000.000')
    expect(formatMoney(0)).toBe('0')
  })
})

describe('parseMoneyDigits', () => {
  it('strips separators back to a plain number', () => {
    expect(parseMoneyDigits('14.000.000')).toBe(14000000)
    expect(parseMoneyDigits('')).toBe(0)
  })
})

describe('formatMoneyInput', () => {
  it('reformats a raw typed value live', () => {
    expect(formatMoneyInput('14000000')).toBe('14.000.000')
  })
})
```

- [ ] Step 2: Run to verify it fails

Run: `npm run test -- money.test.ts`
Expected: FAIL — `Cannot find module './money'`

- [ ] Step 3: Implement `src/lib/money.ts`

```ts
const formatter = new Intl.NumberFormat('vi-VN')

export function formatMoney(value: number): string {
  return formatter.format(Math.round(value))
}

/** Strips everything but digits, so a formatted input like "14.000.000"
 * round-trips back to the plain number 14000000. */
export function parseMoneyDigits(input: string): number {
  const digits = input.replace(/\D/g, '')
  return digits ? Number(digits) : 0
}

/** Re-formats a raw input value as the user types. */
export function formatMoneyInput(input: string): string {
  return formatMoney(parseMoneyDigits(input))
}
```

- [ ] Step 4: Run to verify it passes

Run: `npm run test -- money.test.ts`
Expected: PASS (3 tests)

- [ ] Step 5: Commit

```bash
git add src/lib/types.ts src/lib/money.ts src/lib/money.test.ts
git commit -m "feat: add shared Debt types and Vietnamese money formatting"
```

---

### Task 5: Due-date/amount scheduling logic

**Files:**
- Create: `src/lib/schedule.ts`
- Test: `src/lib/schedule.test.ts`

**Interfaces:**
- Consumes: `Debt` from `./types`.
- Produces: `Occurrence { dueAt: Date; period: string; amount: number;
  isReceivable: boolean }`, `getOccurrenceForPeriod(debt, year, monthIndex0):
  Occurrence | null`, `getOccurrencesInRange(debts, paidKeys: Set<string>,
  rangeStart: Date, rangeEnd: Date): Array<{ debt: Debt; occurrence:
  Occurrence; paid: boolean }>`, `getRelevantOccurrence(debt, paidKeys:
  Set<string>, now?: Date): Occurrence | null`,
  `getReminderThresholdMs(debt, occurrence): number`,
  `paymentKey(debtId: string, period: string): string`.
  `paidKeys` everywhere is a `Set<string>` of `paymentKey(debt_id, period)` —
  **not** bare periods, because two different debts can share the same
  period string (e.g. two debts both due `'2026-09'`).

- [ ] Step 1: Write the failing tests

Create `src/lib/schedule.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  getOccurrenceForPeriod,
  getOccurrencesInRange,
  getRelevantOccurrence,
  getReminderThresholdMs,
  paymentKey,
} from './schedule'
import type { Debt } from './types'

function baseDebt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: 'd1',
    user_id: 'u1',
    type: 'credit_card',
    name: 'Thẻ VIB',
    amount: 3500000,
    due_day: 9,
    due_time: null,
    account_number: '0123456789',
    bank_name: 'VIB',
    account_holder: 'Nguyen Van A',
    counterparty_name: null,
    principal_amount: null,
    interest_rate_pct: null,
    repayment_mode: null,
    start_date: null,
    due_date: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('getOccurrenceForPeriod', () => {
  it('computes the due date for a normal day-of-month', () => {
    const occ = getOccurrenceForPeriod(baseDebt(), 2026, 8) // September (0-indexed)
    expect(occ?.dueAt.getFullYear()).toBe(2026)
    expect(occ?.dueAt.getMonth()).toBe(8)
    expect(occ?.dueAt.getDate()).toBe(9)
    expect(occ?.period).toBe('2026-09')
    expect(occ?.amount).toBe(3500000)
  })

  it('clamps due_day=31 to the last day of February', () => {
    const occ = getOccurrenceForPeriod(baseDebt({ due_day: 31 }), 2026, 1) // February
    expect(occ?.dueAt.getDate()).toBe(28)
  })

  it('computes recurring interest for lend_out (principal x rate)', () => {
    const debt = baseDebt({
      type: 'lend_out',
      repayment_mode: 'recurring',
      amount: null,
      principal_amount: 5000000,
      interest_rate_pct: 2,
      due_day: 15,
    })
    const occ = getOccurrenceForPeriod(debt, 2026, 8)
    expect(occ?.amount).toBe(100000) // 5,000,000 * 2%
    expect(occ?.isReceivable).toBe(true)
  })

  it('computes one_time principal+interest over elapsed months', () => {
    const debt = baseDebt({
      type: 'borrow_in',
      repayment_mode: 'one_time',
      amount: null,
      principal_amount: 5000000,
      interest_rate_pct: 2,
      start_date: '2026-09-01',
      due_date: '2026-11-20',
    })
    const occ = getOccurrenceForPeriod(debt, 2026, 10) // November
    // 2026-09-01 -> 2026-11-20 spans 3 calendar months (Sep, Oct, Nov partial rounds up)
    expect(occ?.amount).toBe(5300000) // 5,000,000 + 5,000,000*2%*3
    expect(occ?.period).toBe('2026-11-20')
  })

  it('returns null for one_time debts outside the given month', () => {
    const debt = baseDebt({
      type: 'lend_out',
      repayment_mode: 'one_time',
      due_date: '2026-11-20',
    })
    expect(getOccurrenceForPeriod(debt, 2026, 8)).toBeNull()
  })
})

describe('getRelevantOccurrence', () => {
  it('returns the current month when unpaid', () => {
    const now = new Date(2026, 8, 5) // Sep 5, before due day 9
    // created_at is this same month: there's no earlier period that could
    // ever have been overdue, so the 1-month lookback must not invent one.
    const debt = baseDebt({ created_at: '2026-09-01T00:00:00Z' })
    const occ = getRelevantOccurrence(debt, new Set(), now)
    expect(occ?.period).toBe('2026-09')
  })

  it('falls back to last month when it is overdue and unpaid', () => {
    const now = new Date(2026, 9, 3) // Oct 3 — September's due day 9 has passed unpaid
    const occ = getRelevantOccurrence(baseDebt(), new Set(), now)
    expect(occ?.period).toBe('2026-09')
  })

  it('advances to the current month once the previous one is paid', () => {
    const now = new Date(2026, 9, 3) // Oct 3
    const paid = new Set([paymentKey('d1', '2026-09')])
    const occ = getRelevantOccurrence(baseDebt(), paid, now)
    expect(occ?.period).toBe('2026-10')
  })

  it('returns null once a one_time debt is paid', () => {
    const debt = baseDebt({ type: 'lend_out', repayment_mode: 'one_time', due_date: '2026-09-09' })
    const paid = new Set([paymentKey('d1', '2026-09-09')])
    expect(getRelevantOccurrence(debt, paid, new Date(2026, 8, 5))).toBeNull()
  })

  it('returns null for inactive debts', () => {
    expect(getRelevantOccurrence(baseDebt({ is_active: false }), new Set(), new Date(2026, 8, 5))).toBeNull()
  })

  it('surfaces the current month even if its due day predates created_at', () => {
    // Added Sep 15, after this cycle's Sep 9 due day already passed — the
    // bill is still real and unpaid, so it must surface. Only the PREVIOUS
    // month's lookback is gated by created_at, never the current month's.
    const now = new Date(2026, 8, 20) // Sep 20
    const debt = baseDebt({ due_day: 9, created_at: '2026-09-15T00:00:00Z' })
    const occ = getRelevantOccurrence(debt, new Set(), now)
    expect(occ?.period).toBe('2026-09')
  })
})

describe('getOccurrencesInRange', () => {
  it('finds occurrences across a range spanning two months', () => {
    // due_day=2: September's occurrence (Sep 2) falls before the range and
    // is excluded; only October's (Oct 2) lands inside [Sep 28, Oct 4].
    // This proves the range collector actually checks both months, not
    // just the range's start month.
    const debt = baseDebt({ due_day: 2 })
    const rangeStart = new Date(2026, 8, 28)
    const rangeEnd = new Date(2026, 9, 4)
    const results = getOccurrencesInRange([debt], new Set(), rangeStart, rangeEnd)
    expect(results).toHaveLength(1)
    expect(results[0].occurrence.period).toBe('2026-10')
  })
})

describe('getReminderThresholdMs', () => {
  it('is 2 days before due for credit_card', () => {
    const debt = baseDebt()
    const occ = getOccurrenceForPeriod(debt, 2026, 8)!
    const threshold = getReminderThresholdMs(debt, occ)
    expect(occ.dueAt.getTime() - threshold).toBe(2 * 24 * 60 * 60 * 1000)
  })

  it('is 24 hours before due for loan/lend_out/borrow_in', () => {
    const debt = baseDebt({ type: 'loan', due_time: '16:00' })
    const occ = getOccurrenceForPeriod(debt, 2026, 8)!
    const threshold = getReminderThresholdMs(debt, occ)
    expect(occ.dueAt.getTime() - threshold).toBe(24 * 60 * 60 * 1000)
  })
})
```

- [ ] Step 2: Run to verify it fails

Run: `npm run test -- schedule.test.ts`
Expected: FAIL — `Cannot find module './schedule'`

- [ ] Step 3: Implement `src/lib/schedule.ts`

```ts
import type { Debt } from './types'

export interface Occurrence {
  dueAt: Date
  period: string
  amount: number
  isReceivable: boolean
}

export function paymentKey(debtId: string, period: string): string {
  return `${debtId}:${period}`
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(year, monthIndex0 + 1, 0).getDate()
}

function isRecurring(debt: Debt): boolean {
  return debt.type === 'credit_card' || debt.type === 'loan' || debt.repayment_mode === 'recurring'
}

function monthsBetween(startDate: string | null, dueDate: string): number {
  if (!startDate) return 1
  const [sy, sm, sd] = startDate.split('-').map(Number)
  const [ey, em, ed] = dueDate.split('-').map(Number)
  let months = (ey - sy) * 12 + (em - sm)
  if (ed > sd) months += 1
  return Math.max(1, months)
}

function computeAmount(debt: Debt, months = 1): number {
  if (debt.type === 'lend_out' || debt.type === 'borrow_in') {
    const interest = ((debt.principal_amount ?? 0) * (debt.interest_rate_pct ?? 0)) / 100 * months
    return debt.repayment_mode === 'one_time'
      ? Math.round((debt.principal_amount ?? 0) + interest)
      : Math.round(interest)
  }
  return debt.amount ?? 0
}

function combine(year: number, monthIndex0: number, day: number, time: string | null): Date {
  const [h, m] = (time ?? '00:00').split(':').map(Number)
  return new Date(year, monthIndex0, day, h || 0, m || 0)
}

/** Occurrence of a debt within one specific calendar month — pure, no
 * dependency on "now" or payment status. Used to render any month browsed
 * on the calendar, and as the building block for the functions below. */
export function getOccurrenceForPeriod(debt: Debt, year: number, monthIndex0: number): Occurrence | null {
  if (isRecurring(debt)) {
    if (!debt.due_day) return null
    const day = Math.min(debt.due_day, daysInMonth(year, monthIndex0))
    const period = `${year}-${String(monthIndex0 + 1).padStart(2, '0')}`
    return { dueAt: combine(year, monthIndex0, day, debt.due_time), period, amount: computeAmount(debt), isReceivable: debt.type === 'lend_out' }
  }
  if (!debt.due_date) return null
  const [dy, dm, dd] = debt.due_date.split('-').map(Number)
  if (dy !== year || dm - 1 !== monthIndex0) return null
  const months = monthsBetween(debt.start_date, debt.due_date)
  return { dueAt: combine(dy, dm - 1, dd, debt.due_time), period: debt.due_date, amount: computeAmount(debt, months), isReceivable: debt.type === 'lend_out' }
}

/** The occurrence that should currently be surfaced on the dashboard/for
 * reminders: for recurring debts, the earliest of {previous month, current
 * month} that isn't yet paid; for one_time debts, the single due date if
 * unpaid. The current month's occurrence is ALWAYS a candidate regardless
 * of `created_at` — it's the live cycle, whether the user added tracking
 * for it on the 1st or the 28th. `created_at` only gates the PREVIOUS
 * month's lookback, so a debt added mid-September doesn't get told August
 * was also overdue — August was never a cycle this record could have
 * tracked, but September's due date, even if already past, is real and
 * relevant the moment the debt exists.
 * ponytail: only looks back 1 month, not an unbounded scan — reminders nag
 * every 15min so nothing can silently go unpaid for a long stretch without
 * the user noticing; extend the lookback if that assumption ever breaks. */
export function getRelevantOccurrence(debt: Debt, paidKeys: Set<string>, now: Date = new Date()): Occurrence | null {
  if (!debt.is_active) return null
  const createdAt = new Date(debt.created_at)
  if (!isRecurring(debt)) {
    if (!debt.due_date) return null
    const [y, m] = debt.due_date.split('-').map(Number)
    const occ = getOccurrenceForPeriod(debt, y, m - 1)
    return occ && !paidKeys.has(paymentKey(debt.id, occ.period)) ? occ : null
  }
  // Check the previous month FIRST and independently of whether the
  // current month is paid — otherwise a debt paid promptly this month
  // while last month's occurrence was somehow missed would report nothing
  // due at all, hiding a genuinely unpaid period.
  const prevRef = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const prevMonth = getOccurrenceForPeriod(debt, prevRef.getFullYear(), prevRef.getMonth())
  if (prevMonth && prevMonth.dueAt >= createdAt && !paidKeys.has(paymentKey(debt.id, prevMonth.period))) {
    return prevMonth
  }
  const thisMonth = getOccurrenceForPeriod(debt, now.getFullYear(), now.getMonth())
  if (thisMonth && !paidKeys.has(paymentKey(debt.id, thisMonth.period))) {
    return thisMonth
  }
  return null
}

/** All occurrences of the given debts whose due datetime falls within
 * [rangeStart, rangeEnd] — used for the calendar month grid, the home
 * page's 7-day strip, and "overdue" scans. */
export function getOccurrencesInRange(
  debts: Debt[],
  paidKeys: Set<string>,
  rangeStart: Date,
  rangeEnd: Date,
): Array<{ debt: Debt; occurrence: Occurrence; paid: boolean }> {
  const months = new Set<string>()
  const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1)
  while (cursor <= rangeEnd) {
    months.add(`${cursor.getFullYear()}-${cursor.getMonth()}`)
    cursor.setMonth(cursor.getMonth() + 1)
  }
  const results: Array<{ debt: Debt; occurrence: Occurrence; paid: boolean }> = []
  for (const debt of debts) {
    if (!debt.is_active) continue
    for (const key of months) {
      const [y, m] = key.split('-').map(Number)
      const occ = getOccurrenceForPeriod(debt, y, m)
      if (occ && occ.dueAt >= rangeStart && occ.dueAt <= rangeEnd) {
        results.push({ debt, occurrence: occ, paid: paidKeys.has(paymentKey(debt.id, occ.period)) })
      }
    }
  }
  return results
}

export function getReminderThresholdMs(debt: Debt, occurrence: Occurrence): number {
  const oneDay = 24 * 60 * 60 * 1000
  return occurrence.dueAt.getTime() - (debt.type === 'credit_card' ? 2 * oneDay : oneDay)
}
```

- [ ] Step 4: Run to verify it passes

Run: `npm run test -- schedule.test.ts`
Expected: PASS (all tests)

- [ ] Step 5: Commit

```bash
git add src/lib/schedule.ts src/lib/schedule.test.ts
git commit -m "feat: add due-date and amount scheduling logic for all debt types"
```

---

### Task 6: Voice dictation parser

**Files:**
- Create: `src/lib/dictation.ts`
- Test: `src/lib/dictation.test.ts`

**Interfaces:**
- Consumes: `DebtType` from `./types`.
- Produces: `ParsedDictation { type?: DebtType; amount?: number; date?:
  string; time?: string; bankName?: string; accountNumber?: string }`,
  `parseDictation(text: string): ParsedDictation`.

- [ ] Step 1: Write the failing test

Create `src/lib/dictation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseDictation } from './dictation'

describe('parseDictation', () => {
  it('parses a full free-form sentence', () => {
    const result = parseDictation(
      'ngân hàng BIDV số tài khoản 19029384756 nợ 4 triệu ngày 20/11/2026 lúc 4h chiều phải trả',
    )
    expect(result.bankName).toBe('BIDV')
    expect(result.accountNumber).toBe('19029384756')
    expect(result.amount).toBe(4000000)
    expect(result.date).toBe('2026-11-20')
    expect(result.time).toBe('16:00')
    expect(result.type).toBe('loan')
  })

  it('recognizes credit card and k-unit amounts', () => {
    const result = parseDictation('thẻ tín dụng nợ 14k')
    expect(result.type).toBe('credit_card')
    expect(result.amount).toBe(14000)
  })

  it('recognizes lend_out vs borrow_in', () => {
    expect(parseDictation('cho Minh vay 2 triệu').type).toBe('lend_out')
    expect(parseDictation('mượn Lan 500k').type).toBe('borrow_in')
  })

  it('leaves fields undefined when not recognized', () => {
    const result = parseDictation('không rõ thông tin gì cả')
    expect(result.amount).toBeUndefined()
    expect(result.date).toBeUndefined()
  })

  it('parses the "củ" amount unit (worth 1,000,000)', () => {
    expect(parseDictation('nợ 5 củ').amount).toBe(5000000)
  })

  it('does not misclassify an ordinary loan sentence that merely contains "cho" elsewhere', () => {
    const result = parseDictation(
      'vay ngân hàng Vietcombank 20 triệu, nhớ đừng quên trả cho đúng hẹn',
    )
    expect(result.type).toBe('loan')
  })
})
```

- [ ] Step 2: Run to verify it fails

Run: `npm run test -- dictation.test.ts`
Expected: FAIL — `Cannot find module './dictation'`

- [ ] Step 3: Implement `src/lib/dictation.ts`

```ts
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

  // "cho <tên> vay/mượn" within a few words — not a bare .includes('cho'),
  // since "cho" is an extremely common function word (e.g. "trả cho đúng
  // hẹn") that would otherwise misclassify ordinary loan sentences that
  // merely contain it somewhere unrelated.
  const lendOutMatch = /\bcho\s+(?:\S+\s+){0,3}(?:vay|mượn)\b/.test(lower)
  if (lower.includes('thẻ tín dụng')) result.type = 'credit_card'
  else if (lendOutMatch) result.type = 'lend_out'
  else if (lower.includes('mượn')) result.type = 'borrow_in'
  else if (lower.includes('vay') || lower.includes('nợ')) result.type = 'loan'

  // Trailing boundary uses a lookahead instead of `\b` — `\b` only anchors
  // at a transition to/from a `\w` character, and Vietnamese diacritics
  // (the "ủ" in "củ", "riệu" in "triệu") aren't `\w`, so `\b` silently
  // fails to match right after them. The lookahead just checks "not
  // immediately followed by another letter/digit", which works regardless
  // of what precedes it.
  const amountMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*(k|nghìn|ngàn|tr|triệu|củ)(?![a-zA-ZÀ-ỹ0-9])/)
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
```

- [ ] Step 4: Run to verify it passes

Run: `npm run test -- dictation.test.ts`
Expected: PASS (4 tests)

- [ ] Step 5: Commit

```bash
git add src/lib/dictation.ts src/lib/dictation.test.ts
git commit -m "feat: add free-form Vietnamese voice dictation parser"
```

---

### Task 7: Auth (signup/login with generated login_id)

**Files:**
- Create: `src/lib/auth.ts`
- Create: `src/components/AuthProvider.tsx`
- Create: `src/app/login/page.tsx`

**Interfaces:**
- Consumes: `getSupabaseClient`, `setRememberMe` from
  `@/lib/supabase/client`.
- Produces: `signUpWithDisplayName(supabase, displayName: string, password:
  string): Promise<{ loginId: string }>`, `signInWithLoginId(supabase,
  loginId: string, password: string): Promise<void>` (auth.ts);
  `<AuthProvider>` context exposing `useAuth(): { session: Session | null;
  loading: boolean }` — every protected page/layout in later tasks consumes
  `useAuth()`.

- [ ] Step 1: Implement `src/lib/auth.ts`

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

const EMAIL_DOMAIN = 'loanmanage.local'

function slugify(displayName: string): string {
  return displayName
    .trim()
    .toLowerCase()
    .replace(/đ/g, 'd') // NFD below doesn't decompose Đ/đ — it needs an explicit swap
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

export async function signUpWithDisplayName(
  supabase: SupabaseClient,
  displayName: string,
  password: string,
): Promise<{ loginId: string }> {
  const base = slugify(displayName)
  if (!base) throw new Error('Tên không hợp lệ')

  for (let i = 0; i < 20; i++) {
    const loginId = `${base}_${String(i).padStart(2, '0')}`
    const email = `${loginId}@${EMAIL_DOMAIN}`
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (!error) {
      const userId = data.user!.id
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({ id: userId, login_id: loginId, display_name: displayName })
      if (profileError) throw new Error('Không lưu được thông tin tài khoản, vui lòng thử lại.')
      return { loginId }
    }
    if (!/already registered|already exists/i.test(error.message)) {
      throw new Error('Không tạo được tài khoản, vui lòng thử lại.')
    }
  }
  throw new Error('Không tạo được tài khoản, thử lại sau.')
}

export async function signInWithLoginId(supabase: SupabaseClient, loginId: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({
    email: `${loginId}@${EMAIL_DOMAIN}`,
    password,
  })
  if (error) throw new Error('Sai tên đăng nhập hoặc mật khẩu')
}
```

- [ ] Step 2: Implement `src/components/AuthProvider.tsx`

```tsx
'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabaseClient } from '@/lib/supabase/client'

interface AuthState {
  session: Session | null
  loading: boolean
}

const AuthContext = createContext<AuthState>({ session: null, loading: true })

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = getSupabaseClient()
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  return <AuthContext.Provider value={{ session, loading }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  return useContext(AuthContext)
}
```

- [ ] Step 3: Implement `src/app/login/page.tsx`

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseClient, setRememberMe } from '@/lib/supabase/client'
import { signInWithLoginId, signUpWithDisplayName } from '@/lib/auth'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [displayName, setDisplayName] = useState('')
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createdLoginId, setCreatedLoginId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      setRememberMe(remember)
      const supabase = getSupabaseClient()
      if (mode === 'signup') {
        if (password !== confirmPassword) throw new Error('Mật khẩu xác nhận không khớp')
        const { loginId: created } = await signUpWithDisplayName(supabase, displayName, password)
        setCreatedLoginId(created)
        return
      }
      await signInWithLoginId(supabase, loginId, password)
      router.push('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Có lỗi xảy ra')
    } finally {
      setSubmitting(false)
    }
  }

  if (createdLoginId) {
    return (
      <div className="mx-auto mt-24 max-w-sm rounded-2xl bg-surface p-6 text-center">
        <p className="text-text-muted">Tạo tài khoản thành công! Tên đăng nhập của bạn là</p>
        <p className="mt-2 text-2xl font-bold text-text">{createdLoginId}</p>
        <p className="mt-2 text-sm text-text-muted">Ghi nhớ tên này để đăng nhập lần sau.</p>
        <button
          className="mt-4 w-full rounded-xl bg-gradient-to-r from-urgent-from to-urgent-to py-2 font-semibold text-white"
          onClick={() => {
            setMode('login')
            setLoginId(createdLoginId)
            setCreatedLoginId(null)
          }}
        >
          Đăng nhập ngay
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto mt-24 max-w-sm rounded-2xl bg-surface p-6">
      <div className="mb-4 flex gap-2">
        <button
          className={`flex-1 rounded-lg py-2 ${mode === 'login' ? 'bg-bg text-text' : 'text-text-muted'}`}
          onClick={() => setMode('login')}
          type="button"
        >
          Đăng nhập
        </button>
        <button
          className={`flex-1 rounded-lg py-2 ${mode === 'signup' ? 'bg-bg text-text' : 'text-text-muted'}`}
          onClick={() => setMode('signup')}
          type="button"
        >
          Đăng ký
        </button>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {mode === 'signup' ? (
          <input
            className="rounded-lg bg-bg px-3 py-2 text-text"
            placeholder="Tên của bạn (vd hoavnh)"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
        ) : (
          <input
            className="rounded-lg bg-bg px-3 py-2 text-text"
            placeholder="Tên đăng nhập (vd hoavnh_00)"
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
            required
          />
        )}
        <input
          className="rounded-lg bg-bg px-3 py-2 text-text"
          type="password"
          placeholder="Mật khẩu"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {mode === 'signup' && (
          <input
            className="rounded-lg bg-bg px-3 py-2 text-text"
            type="password"
            placeholder="Xác nhận mật khẩu"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        )}
        <label className="flex items-center gap-2 text-sm text-text-muted">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Ghi nhớ đăng nhập
        </label>
        {error && <p className="text-sm text-payable">{error}</p>}
        <button
          disabled={submitting}
          className="mt-2 rounded-xl bg-gradient-to-r from-urgent-from to-urgent-to py-2 font-semibold text-white disabled:opacity-50"
          type="submit"
        >
          {mode === 'signup' ? 'Tạo tài khoản' : 'Đăng nhập'}
        </button>
      </form>
    </div>
  )
}
```

- [ ] Step 4: Verify (manual, no automated test — this is thin glue over
  Supabase Auth, already covered by the `signUpWithDisplayName` retry logic
  which the schedule/money/dictation tasks established the testing pattern
  for; UI is verified end-to-end in Task 17)

Run: `npm run build`
Expected: builds without type errors (catches typos/missing imports now,
full behavior verified once the dev server runs in Task 17).

- [ ] Step 5: Commit

```bash
git add src/lib/auth.ts src/components/AuthProvider.tsx src/app/login/page.tsx
git commit -m "feat: add username-style signup/login with generated login_id"
```

---

### Task 8: Root layout, Dark Slate theme, protected shell + top nav

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`
- Create: `src/app/(protected)/layout.tsx`
- Create: `src/components/TopNav.tsx`

**Interfaces:**
- Consumes: `AuthProvider`, `useAuth` from Task 7.
- Produces: every page in Tasks 9-14 lives under `src/app/(protected)/` and
  is wrapped by this layout (auth guard + nav already applied — pages don't
  redo it).

- [ ] Step 1: Replace `src/app/globals.css` with the Dark Slate theme

```css
@import "tailwindcss";

@theme inline {
  --color-bg: #0b1220;
  --color-surface: #141c2e;
  --color-border: #22304a;
  --color-text: #e2e8f0;
  --color-text-muted: #94a3b8;
  --color-urgent-from: #f43f5e;
  --color-urgent-to: #fb923c;
  --color-receivable: #86efac;
  --color-payable: #fca5a5;
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

body {
  background: var(--color-bg);
  color: var(--color-text);
}
```

- [ ] Step 2: Update `src/app/layout.tsx` to wrap children in `AuthProvider`
  (keep the existing Geist font setup the scaffold generated, just change
  the body wrapper)

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/components/AuthProvider";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Quản lý ghi nợ",
  description: "Theo dõi khoản vay, thẻ tín dụng, và cho vay/mượn người khác",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
```

- [ ] Step 3: Create `src/components/TopNav.tsx`

```tsx
'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { getSupabaseClient } from '@/lib/supabase/client'

const LINKS = [
  { href: '/', label: 'Trang chủ' },
  { href: '/calendar', label: 'Lịch' },
  { href: '/debts', label: 'Khoản vay' },
  { href: '/lending', label: 'Cho vay/mượn' },
]

export function TopNav() {
  const pathname = usePathname()
  const router = useRouter()

  async function handleLogout() {
    await getSupabaseClient().auth.signOut()
    router.push('/login')
  }

  return (
    <nav className="flex flex-wrap items-center gap-1 border-b border-border bg-surface px-4 py-3">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`rounded-lg px-3 py-1.5 text-sm ${pathname === link.href ? 'bg-bg text-text' : 'text-text-muted hover:text-text'}`}
        >
          {link.label}
        </Link>
      ))}
      <button onClick={handleLogout} className="ml-auto rounded-lg px-3 py-1.5 text-sm text-text-muted hover:text-text">
        Đăng xuất
      </button>
    </nav>
  )
}
```

- [ ] Step 4: Create `src/app/(protected)/layout.tsx`

```tsx
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { TopNav } from '@/components/TopNav'

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !session) router.replace('/login')
  }, [loading, session, router])

  if (loading || !session) return null

  return (
    <div className="min-h-screen">
      <TopNav />
      <main className="mx-auto max-w-6xl p-4 lg:flex lg:gap-6">{children}</main>
    </div>
  )
}
```

- [ ] Step 5: Delete the scaffolded placeholder page so the route group
  takes over `/` in the next task

Run: `rm src/app/page.tsx`

(Task 14 creates `src/app/(protected)/page.tsx` as the real home page — until
then, `npm run build` will report no page for `/`, which is expected and
fixed by Task 14, not this task.)

- [ ] Step 6: Verify

Run: `npm run build`
Expected: compiles (a missing `/` page is only a warning at this stage
since route groups resolve at build differently — if the build hard-fails
on a missing root page, create a 1-line placeholder
`src/app/(protected)/page.tsx` with `export default function Page() {
return <div /> }` now and let Task 14 replace it).

- [ ] Step 7: Commit

```bash
git add src/app/layout.tsx src/app/globals.css src/components/TopNav.tsx "src/app/(protected)/layout.tsx"
git rm src/app/page.tsx
git commit -m "feat: add Dark Slate theme, top nav, and protected route shell"
```

---

### Task 9: Debts data layer + DebtForm

**Files:**
- Create: `src/lib/debts.ts`
- Create: `src/components/DebtForm.tsx`

**Interfaces:**
- Consumes: `Debt`, `DebtType` from `@/lib/types`; `getSupabaseClient`;
  `formatMoneyInput`, `parseMoneyDigits` from `@/lib/money`.
- Produces: `listDebts(supabase, category: 'bank' | 'peer'): Promise<Debt[]>`,
  `upsertDebt(supabase, debt): Promise<Debt>`, `deleteDebt(supabase, id:
  string): Promise<void>`, `listPayments(supabase): Promise<DebtPayment[]>`,
  `markPaid(supabase, debtId: string, userId: string, period: string):
  Promise<void>` (debts.ts); `<DebtForm category="bank"|"peer"
  initial={Debt|null} onSaved={() => void} onCancel={() => void} />`
  (used by Task 10).

- [ ] Step 1: Implement `src/lib/debts.ts`

```ts
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
```

- [ ] Step 2: Implement `src/components/DebtForm.tsx`

```tsx
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

  function applyDictation(text: string) {
    setTranscript(text)
    const parsed = parseDictation(text)
    if (parsed.type && options.some((o) => o.value === parsed.type)) setType(parsed.type)
    if (parsed.amount) {
      const formatted = formatMoneyInput(String(parsed.amount))
      category === 'peer' ? setPrincipalText(formatted) : setAmountText(formatted)
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
        is_active: true,
      })
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
      {transcript && <p className="text-xs text-text-muted">Đã nghe: "{transcript}"</p>}

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
```

- [ ] Step 3: Verify

Run: `npm run build`
Expected: compiles without type errors.

- [ ] Step 4: Commit

```bash
git add src/lib/debts.ts src/components/DebtForm.tsx
git commit -m "feat: add debts data layer and type-conditional DebtForm with mic dictation"
```

---

### Task 10: Debt management pages (/debts, /lending)

**Files:**
- Create: `src/components/DebtList.tsx`
- Create: `src/app/(protected)/debts/page.tsx`
- Create: `src/app/(protected)/lending/page.tsx`

**Interfaces:**
- Consumes: `listDebts`, `upsertDebt`, `deleteDebt` from `@/lib/debts`;
  `DebtForm` from Task 9; `useAuth` from Task 7; `formatMoney` from
  `@/lib/money`.
- Produces: `<DebtList category="bank"|"peer" />` (self-contained page body,
  used by both routes below with a different `category`).

- [ ] Step 1: Implement `src/components/DebtList.tsx`

```tsx
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
    // Must send the full row, not just {id, user_id, is_active}: Postgres
    // builds the candidate INSERT tuple for ON CONFLICT DO UPDATE and
    // checks NOT NULL constraints (type, name) on it before the conflict
    // path even kicks in, so a partial upsert missing those columns fails
    // with a not-null violation even though the row already exists.
    await upsertDebt(supabase, { ...debt, is_active: !debt.is_active })
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
```

- [ ] Step 2: Create the two thin route pages

`src/app/(protected)/debts/page.tsx`:
```tsx
'use client'

import { DebtList } from '@/components/DebtList'

export default function DebtsPage() {
  return <DebtList category="bank" />
}
```

`src/app/(protected)/lending/page.tsx`:
```tsx
'use client'

import { DebtList } from '@/components/DebtList'

export default function LendingPage() {
  return <DebtList category="peer" />
}
```

- [ ] Step 3: Verify

Run: `npm run build`
Expected: compiles without type errors.

- [ ] Step 4: Commit

```bash
git add src/components/DebtList.tsx "src/app/(protected)/debts/page.tsx" "src/app/(protected)/lending/page.tsx"
git commit -m "feat: add debt management pages for bank debts and peer lending"
```

---

### Task 11: Dashboard aggregation

**Files:**
- Create: `src/lib/dashboard.ts`
- Test: `src/lib/dashboard.test.ts`

**Interfaces:**
- Consumes: `Debt`, `getOccurrencesInRange`, `getRelevantOccurrence`,
  `paymentKey` from `@/lib/schedule`.
- Produces: `DashboardSummary { totalPayableThisMonth: number;
  totalReceivableThisMonth: number; net: number; monthlyInterestReceivable:
  number; monthlyInterestPayable: number; overdue: Array<{ debt: Debt;
  occurrence: Occurrence }> }`, `computeDashboardSummary(debts: Debt[],
  paidKeys: Set<string>, now?: Date): DashboardSummary`.

- [ ] Step 1: Write the failing test

Create `src/lib/dashboard.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { computeDashboardSummary } from './dashboard'
import { paymentKey } from './schedule'
import type { Debt } from './types'

function debt(overrides: Partial<Debt>): Debt {
  return {
    id: overrides.id ?? 'd',
    user_id: 'u1',
    type: 'credit_card',
    name: 'x',
    amount: null,
    due_day: null,
    due_time: null,
    account_number: null,
    bank_name: null,
    account_holder: null,
    counterparty_name: null,
    principal_amount: null,
    interest_rate_pct: null,
    repayment_mode: null,
    start_date: null,
    due_date: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('computeDashboardSummary', () => {
  const now = new Date(2026, 8, 5) // Sep 5, 2026

  it('sums payable vs receivable for the current month', () => {
    const debts = [
      debt({ id: 'card', type: 'credit_card', amount: 3500000, due_day: 20 }),
      debt({ id: 'lend', type: 'lend_out', repayment_mode: 'recurring', principal_amount: 5000000, interest_rate_pct: 2, due_day: 15 }),
    ]
    const summary = computeDashboardSummary(debts, new Set(), now)
    expect(summary.totalPayableThisMonth).toBe(3500000)
    expect(summary.totalReceivableThisMonth).toBe(100000)
    expect(summary.net).toBe(100000 - 3500000)
  })

  it('lists overdue unpaid occurrences', () => {
    const debts = [debt({ id: 'overdue', type: 'loan', amount: 1000000, due_day: 1, due_time: '08:00' })]
    const summary = computeDashboardSummary(debts, new Set(), now)
    expect(summary.overdue).toHaveLength(1)
    expect(summary.overdue[0].debt.id).toBe('overdue')
  })

  it('excludes paid occurrences from overdue', () => {
    // created_at this same month: no earlier period could legitimately be
    // overdue, so paying the current period must clear the debt entirely.
    const debts = [debt({ id: 'paid', type: 'loan', amount: 1000000, due_day: 1, due_time: '08:00', created_at: '2026-09-01T00:00:00Z' })]
    const summary = computeDashboardSummary(debts, new Set(['paid:2026-09']), now)
    expect(summary.overdue).toHaveLength(0)
  })

  it('counts a one_time debt\'s interest in the month its due_date falls in', () => {
    const debts = [
      debt({
        id: 'onetime', type: 'borrow_in', repayment_mode: 'one_time',
        principal_amount: 5000000, interest_rate_pct: 2,
        start_date: '2026-08-01', due_date: '2026-09-20',
      }),
    ]
    const summary = computeDashboardSummary(debts, new Set(), now)
    // 2026-08-01 -> 2026-09-20 spans 2 months (Sep 20 > Aug 1 rounds up)
    expect(summary.monthlyInterestPayable).toBe(5000000 * 0.02 * 2)
  })

  it('matches schedule.ts\'s rounded amount for a non-integer interest product', () => {
    const debts = [
      debt({ id: 'frac', type: 'lend_out', repayment_mode: 'recurring', principal_amount: 333333, interest_rate_pct: 3, due_day: 15 }),
    ]
    const summary = computeDashboardSummary(debts, new Set(), now)
    expect(summary.monthlyInterestReceivable).toBe(10000) // Math.round(333333 * 3 / 100) = Math.round(9999.99)
  })

  it('excludes an already-paid occurrence from this month\'s totals', () => {
    const debts = [debt({ id: 'paidcard', type: 'credit_card', amount: 3500000, due_day: 20, created_at: '2026-09-01T00:00:00Z' })]
    const summary = computeDashboardSummary(debts, new Set([paymentKey('paidcard', '2026-09')]), now)
    expect(summary.totalPayableThisMonth).toBe(0)
  })
})
```

- [ ] Step 2: Run to verify it fails

Run: `npm run test -- dashboard.test.ts`
Expected: FAIL — `Cannot find module './dashboard'`

- [ ] Step 3: Implement `src/lib/dashboard.ts`

```ts
import type { Debt } from './types'
import { getOccurrenceForPeriod, getOccurrencesInRange, getRelevantOccurrence, paymentKey, type Occurrence } from './schedule'

export interface DashboardSummary {
  totalPayableThisMonth: number
  totalReceivableThisMonth: number
  net: number
  monthlyInterestReceivable: number
  monthlyInterestPayable: number
  overdue: Array<{ debt: Debt; occurrence: Occurrence }>
}

export function computeDashboardSummary(debts: Debt[], paidKeys: Set<string>, now: Date = new Date()): DashboardSummary {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
  const thisMonth = getOccurrencesInRange(debts, paidKeys, monthStart, monthEnd)

  // Only unpaid occurrences count toward "still owed this month" — a bill
  // paid on the 2nd shouldn't keep inflating what's left to pay/collect
  // for the rest of the month.
  let totalPayableThisMonth = 0
  let totalReceivableThisMonth = 0
  for (const { occurrence, paid } of thisMonth) {
    if (paid) continue
    if (occurrence.isReceivable) totalReceivableThisMonth += occurrence.amount
    else totalPayableThisMonth += occurrence.amount
  }

  // Reuse getOccurrenceForPeriod (the same canonical, rounded calculation
  // the calendar/overdue list use) instead of re-deriving the interest
  // formula here — that would silently drift from schedule.ts's rounding
  // for non-integer products, and would miss one_time debts entirely
  // (their whole accrued interest counts in the month their due_date
  // falls in, per spec, not just recurring debts).
  let monthlyInterestReceivable = 0
  let monthlyInterestPayable = 0
  for (const debt of debts) {
    if (!debt.is_active || (debt.type !== 'lend_out' && debt.type !== 'borrow_in')) continue
    const occ = getOccurrenceForPeriod(debt, now.getFullYear(), now.getMonth())
    if (!occ) continue
    const interest = debt.repayment_mode === 'one_time' ? occ.amount - (debt.principal_amount ?? 0) : occ.amount
    if (debt.type === 'lend_out') monthlyInterestReceivable += interest
    else monthlyInterestPayable += interest
  }

  // Reuse getRelevantOccurrence (not a raw range scan) so each debt
  // contributes at most one overdue row — the same "current unpaid period"
  // the reminder Edge Function nags about, not every stale month at once.
  const overdue: Array<{ debt: Debt; occurrence: Occurrence }> = []
  for (const debt of debts) {
    const occurrence = getRelevantOccurrence(debt, paidKeys, now)
    if (occurrence && occurrence.dueAt < now) overdue.push({ debt, occurrence })
  }

  return {
    totalPayableThisMonth,
    totalReceivableThisMonth,
    net: totalReceivableThisMonth - totalPayableThisMonth,
    monthlyInterestReceivable,
    monthlyInterestPayable,
    overdue,
  }
}

export { paymentKey }
```

- [ ] Step 4: Run to verify it passes

Run: `npm run test -- dashboard.test.ts`
Expected: PASS (3 tests)

- [ ] Step 5: Commit

```bash
git add src/lib/dashboard.ts src/lib/dashboard.test.ts
git commit -m "feat: add dashboard summary aggregation (payable/receivable/interest/overdue)"
```

---

### Task 12: Calendar page

**Files:**
- Create: `src/components/CalendarMonth.tsx`
- Create: `src/app/(protected)/calendar/page.tsx`

**Interfaces:**
- Consumes: `listAllActiveDebts` from `@/lib/debts`; `listPayments`,
  `markPaid` from `@/lib/debts`; `getOccurrencesInRange`, `paymentKey` from
  `@/lib/schedule`; `formatMoney` from `@/lib/money`; `useAuth`.

- [ ] Step 1: Implement `src/components/CalendarMonth.tsx`

```tsx
'use client'

import { useMemo, useState } from 'react'
import type { Debt, DebtPayment } from '@/lib/types'
import { getOccurrencesInRange, paymentKey } from '@/lib/schedule'
import { formatMoney } from '@/lib/money'

interface Props {
  debts: Debt[]
  payments: DebtPayment[]
  onMarkPaid: (debtId: string, period: string) => Promise<void>
}

const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

export function CalendarMonth({ debts, payments, onMarkPaid }: Props) {
  const [cursor, setCursor] = useState(() => new Date())
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)

  const paidKeys = useMemo(() => new Set(payments.map((p) => paymentKey(p.debt_id, p.period))), [payments])

  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59)
  const occurrences = useMemo(
    () => getOccurrencesInRange(debts, paidKeys, monthStart, monthEnd),
    [debts, paidKeys, monthStart.getTime(), monthEnd.getTime()],
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

  const selectedOccurrences = selectedDay ? occurrencesOn(selectedDay) : []

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
          const hasUnpaid = dayOccurrences.some((o) => !o.paid)
          return (
            <button
              key={i}
              onClick={() => setSelectedDay(day)}
              className={`aspect-square rounded-lg p-1 text-left text-xs ${hasUnpaid ? 'bg-gradient-to-br from-urgent-from to-urgent-to text-white' : dayOccurrences.length ? 'bg-border text-text' : 'bg-surface text-text-muted'}`}
            >
              {day.getDate()}
            </button>
          )
        })}
      </div>

      {selectedDay && (
        <div className="mt-4 rounded-xl bg-surface p-4">
          <p className="mb-2 font-semibold text-text">Ngày {selectedDay.getDate()}/{selectedDay.getMonth() + 1}</p>
          {selectedOccurrences.length === 0 && <p className="text-text-muted">Không có khoản nào.</p>}
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
        </div>
      )}
    </div>
  )
}
```

- [ ] Step 2: Implement `src/app/(protected)/calendar/page.tsx`

```tsx
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
```

- [ ] Step 3: Verify

Run: `npm run build`
Expected: compiles without type errors.

- [ ] Step 4: Commit

```bash
git add src/components/CalendarMonth.tsx "src/app/(protected)/calendar/page.tsx"
git commit -m "feat: add calendar month view with day popup, copy, and mark-paid"
```

---

### Task 13: Home dashboard page (week strip + due list + summary)

**Files:**
- Create: `src/components/WeekStrip.tsx`
- Create: `src/components/SummaryCards.tsx`
- Create: `src/app/(protected)/page.tsx`

**Interfaces:**
- Consumes: `listAllActiveDebts`, `listPayments`, `markPaid` from
  `@/lib/debts`; `getOccurrencesInRange`, `paymentKey` from `@/lib/schedule`;
  `computeDashboardSummary` from `@/lib/dashboard`; `formatMoney`.

- [ ] Step 1: Implement `src/components/WeekStrip.tsx`

```tsx
'use client'

const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

interface Props {
  days: Array<{ date: Date; hasUnpaid: boolean }>
  selected: Date
  onSelect: (date: Date) => void
}

export function WeekStrip({ days, selected, onSelect }: Props) {
  return (
    <div className="flex gap-2">
      {days.map(({ date, hasUnpaid }) => {
        const isSelected = date.toDateString() === selected.toDateString()
        return (
          <button
            key={date.toISOString()}
            onClick={() => onSelect(date)}
            className={`flex-1 rounded-xl p-2 text-center ${
              hasUnpaid ? 'bg-gradient-to-br from-urgent-from to-urgent-to text-white' : isSelected ? 'bg-border text-text' : 'bg-surface text-text-muted'
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

- [ ] Step 2: Implement `src/components/SummaryCards.tsx`

```tsx
'use client'

import type { DashboardSummary } from '@/lib/dashboard'
import { formatMoney } from '@/lib/money'

export function SummaryCards({ summary }: { summary: DashboardSummary }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-xl bg-surface p-3">
        <p className="text-xs text-text-muted">Phải trả tháng này</p>
        <p className="text-lg font-bold text-payable">{formatMoney(summary.totalPayableThisMonth)}đ</p>
      </div>
      <div className="rounded-xl bg-surface p-3">
        <p className="text-xs text-text-muted">Phải thu tháng này</p>
        <p className="text-lg font-bold text-receivable">{formatMoney(summary.totalReceivableThisMonth)}đ</p>
      </div>
      <div className="rounded-xl bg-surface p-3">
        <p className="text-xs text-text-muted">Lãi dự kiến thu/tháng</p>
        <p className="text-lg font-bold text-receivable">{formatMoney(summary.monthlyInterestReceivable)}đ</p>
      </div>
      <div className="rounded-xl bg-surface p-3">
        <p className="text-xs text-text-muted">Lãi phải trả/tháng</p>
        <p className="text-lg font-bold text-payable">{formatMoney(summary.monthlyInterestPayable)}đ</p>
      </div>
      {summary.overdue.length > 0 && (
        <div className="col-span-2 rounded-xl border border-payable bg-surface p-3">
          <p className="text-xs text-payable">⚠ {summary.overdue.length} khoản quá hạn</p>
          {summary.overdue.map(({ debt }) => (
            <p key={debt.id} className="text-sm text-text">{debt.name}</p>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] Step 3: Implement `src/app/(protected)/page.tsx`

```tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Debt, DebtPayment } from '@/lib/types'
import { listAllActiveDebts, listPayments, markPaid } from '@/lib/debts'
import { getOccurrencesInRange, paymentKey } from '@/lib/schedule'
import { computeDashboardSummary } from '@/lib/dashboard'
import { formatMoney } from '@/lib/money'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/AuthProvider'
import { WeekStrip } from '@/components/WeekStrip'
import { SummaryCards } from '@/components/SummaryCards'

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export default function HomePage() {
  const { session } = useAuth()
  const [debts, setDebts] = useState<Debt[]>([])
  const [payments, setPayments] = useState<DebtPayment[]>([])
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()))
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

  const paidKeys = useMemo(() => new Set(payments.map((p) => paymentKey(p.debt_id, p.period))), [payments])

  const weekDays = useMemo(() => {
    const today = startOfDay(new Date())
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i)
      const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59)
      const hasUnpaid = getOccurrencesInRange(debts, paidKeys, date, dayEnd).some((o) => !o.paid)
      return { date, hasUnpaid }
    })
  }, [debts, paidKeys])

  const selectedOccurrences = useMemo(() => {
    const dayEnd = new Date(selectedDay.getFullYear(), selectedDay.getMonth(), selectedDay.getDate(), 23, 59, 59)
    return getOccurrencesInRange(debts, paidKeys, selectedDay, dayEnd)
  }, [debts, paidKeys, selectedDay])

  const summary = useMemo(() => computeDashboardSummary(debts, paidKeys), [debts, paidKeys])

  async function handleMarkPaid(debtId: string, period: string) {
    await markPaid(supabase, debtId, session!.user.id, period)
    await refresh()
  }

  return (
    <div className="flex flex-1 flex-col gap-4 lg:flex-row">
      <div className="flex flex-1 flex-col gap-4">
        <WeekStrip days={weekDays} selected={selectedDay} onSelect={setSelectedDay} />
        <div className="flex flex-col gap-2">
          {selectedOccurrences.length === 0 && <p className="text-text-muted">Không có khoản nào ngày này.</p>}
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
        </div>
      </div>
      <div className="lg:sticky lg:top-4 lg:h-fit lg:w-80">
        <SummaryCards summary={summary} />
      </div>
    </div>
  )
}
```

- [ ] Step 4: Verify

Run: `npm run build`
Expected: compiles without type errors.

- [ ] Step 5: Commit

```bash
git add src/components/WeekStrip.tsx src/components/SummaryCards.tsx "src/app/(protected)/page.tsx"
git commit -m "feat: add home dashboard with week strip, due list, and summary cards"
```

---

### Task 14: Push notification subscribe flow (client + service worker)

**Files:**
- Create: `public/sw.js`
- Create: `src/lib/push.ts`
- Modify: `src/components/TopNav.tsx`

**Interfaces:**
- Consumes: `getSupabaseClient`; `session.user.id`.
- Produces: `subscribeToPush(supabase, userId: string): Promise<'subscribed'
  | 'unsupported' | 'denied'>` — called from a button in TopNav.

- [ ] Step 1: Create `public/sw.js`

```js
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {}
  event.waitUntil(
    self.registration.showNotification(data.title || 'Nhắc thanh toán', {
      body: data.body || '',
      icon: '/favicon.ico',
      tag: 'loanmanage-reminder',
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(self.clients.openWindow('/'))
})
```

- [ ] Step 2: Implement `src/lib/push.ts`

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

// Return type is Uint8Array<ArrayBuffer>, not bare Uint8Array — the DOM
// lib's BufferSource (which applicationServerKey needs) is invariant on
// ArrayBuffer, and the wider default generic doesn't satisfy it under
// this TypeScript version.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
}

export async function subscribeToPush(
  supabase: SupabaseClient,
  userId: string,
): Promise<'subscribed' | 'unsupported' | 'denied'> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported'

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'

  const registration = await navigator.serviceWorker.register('/sw.js')
  const existing = await registration.pushManager.getSubscription()
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
    }))

  const json = subscription.toJSON()
  const { data: already } = await supabase
    .from('push_subscriptions')
    .select('id')
    .eq('endpoint', json.endpoint!)
    .maybeSingle()

  if (!already) {
    await supabase.from('push_subscriptions').insert({
      user_id: userId,
      endpoint: json.endpoint!,
      p256dh: json.keys!.p256dh,
      auth: json.keys!.auth,
    })
  }
  return 'subscribed'
}
```

- [ ] Step 3: Add a "Bật thông báo" button to `src/components/TopNav.tsx` —
  modify the existing component from Task 8, adding this import and button:

```tsx
import { subscribeToPush } from '@/lib/push'
import { useAuth } from '@/components/AuthProvider'
```

Inside `TopNav()`, before the `handleLogout` function:

```tsx
const { session } = useAuth()

async function handleEnableNotifications() {
  if (!session) return
  const result = await subscribeToPush(getSupabaseClient(), session.user.id)
  if (result === 'denied') alert('Bạn đã từ chối quyền thông báo — bật lại trong cài đặt trình duyệt nếu muốn nhận nhắc.')
  if (result === 'unsupported') alert('Trình duyệt này không hỗ trợ thông báo đẩy.')
}
```

And add this button next to the logout button (before it, inside the `nav`):

```tsx
<button onClick={handleEnableNotifications} className="ml-auto rounded-lg px-3 py-1.5 text-sm text-text-muted hover:text-text">
  🔔 Bật thông báo
</button>
```

(remove `ml-auto` from the existing logout button since the notifications
button now takes that position).

- [ ] Step 4: Verify

Run: `npm run build`
Expected: compiles without type errors.

- [ ] Step 5: Commit

```bash
git add public/sw.js src/lib/push.ts src/components/TopNav.tsx
git commit -m "feat: add push notification subscribe flow and service worker"
```

---

### Task 15: Reminder Edge Function

**Files:**
- Create: `supabase/functions/send-reminders/index.ts`

- [ ] Step 1: Write the Edge Function

Create `supabase/functions/send-reminders/index.ts`:

```ts
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

function occurrenceForPeriod(debt: Debt, year: number, monthIndex0: number) {
  if (isRecurring(debt)) {
    if (!debt.due_day) return null
    const day = Math.min(debt.due_day, daysInMonth(year, monthIndex0))
    const [h, m] = (debt.due_time ?? '00:00').split(':').map(Number)
    const dueAt = new Date(year, monthIndex0, day, h || 0, m || 0)
    const period = `${year}-${String(monthIndex0 + 1).padStart(2, '0')}`
    return { dueAt, period, amount: computeAmount(debt) }
  }
  if (!debt.due_date) return null
  const [dy, dm, dd] = debt.due_date.split('-').map(Number)
  if (dy !== year || dm - 1 !== monthIndex0) return null
  const [h, m] = (debt.due_time ?? '00:00').split(':').map(Number)
  const dueAt = new Date(dy, dm - 1, dd, h || 0, m || 0)
  return { dueAt, period: debt.due_date, amount: computeAmount(debt, monthsBetween(debt.start_date, debt.due_date)) }
}

function relevantOccurrence(debt: Debt, paidPeriods: Set<string>, now: Date) {
  if (!debt.is_active) return null
  const createdAt = new Date(debt.created_at)
  if (!isRecurring(debt)) {
    if (!debt.due_date) return null
    const [y, m] = debt.due_date.split('-').map(Number)
    const occ = occurrenceForPeriod(debt, y, m - 1)
    return occ && !paidPeriods.has(occ.period) ? occ : null
  }
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const prevMonth = occurrenceForPeriod(debt, prev.getFullYear(), prev.getMonth())
  if (prevMonth && prevMonth.dueAt >= createdAt && !paidPeriods.has(prevMonth.period)) return prevMonth
  const thisMonth = occurrenceForPeriod(debt, now.getFullYear(), now.getMonth())
  if (thisMonth && !paidPeriods.has(thisMonth.period)) return thisMonth
  return null
}

function reminderThresholdMs(debt: Debt, dueAt: Date) {
  const oneDay = 24 * 60 * 60 * 1000
  return dueAt.getTime() - (debt.type === 'credit_card' ? 2 * oneDay : oneDay)
}

Deno.serve(async () => {
  const now = new Date()
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
    const occ = relevantOccurrence(debt, paid, now)
    if (!occ || now.getTime() < reminderThresholdMs(debt, occ.dueAt)) continue

    const { data: subs } = await supabase.from('push_subscriptions').select('*').eq('user_id', debt.user_id)
    const isOverdue = occ.dueAt.getTime() < now.getTime()
    const payload = JSON.stringify({
      title: `${isOverdue ? 'Quá hạn' : 'Sắp tới hạn'}: ${debt.name}`,
      body: `${new Intl.NumberFormat('vi-VN').format(occ.amount)}đ`,
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

  return new Response(JSON.stringify({ checked: debts?.length ?? 0, sent }), { headers: { 'Content-Type': 'application/json' } })
})
```

- [ ] Step 2: Deploy the function (no JWT verification — it's cron-only,
  authenticates internally with the service role key)

Run:
```bash
export SUPABASE_ACCESS_TOKEN="<SUPABASE_ACCESS_TOKEN>"
supabase functions deploy send-reminders --no-verify-jwt --use-api --project-ref wzfpknrgmjfzlqvhvzue
```
(`--use-api` bundles server-side instead of via Docker — this machine has no
Docker installed.)
Expected: reports the function deployed, prints its URL
(`https://wzfpknrgmjfzlqvhvzue.supabase.co/functions/v1/send-reminders`).

- [ ] Step 3: Smoke-test it manually

Run:
```bash
curl -s -X POST "https://wzfpknrgmjfzlqvhvzue.supabase.co/functions/v1/send-reminders"
```
Expected: JSON like `{"checked":0,"sent":0}` (0 until Task 17's manual test
creates a debt) — a 500 or connection error means something's wrong with the
function itself; check `supabase functions logs send-reminders`.

- [ ] Step 4: Commit

```bash
git add supabase/functions/send-reminders/index.ts
git commit -m "feat: add send-reminders Edge Function (Web Push via VAPID)"
```

---

### Task 16: pg_cron schedule

**Files:**
- Create: `supabase/migrations/0002_cron.sql`

- [ ] Step 1: Write the migration

Create `supabase/migrations/0002_cron.sql`:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'send-reminders-every-15-min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://wzfpknrgmjfzlqvhvzue.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
  $$
);
```

- [ ] Step 2: Push it

Run:
```bash
export SUPABASE_ACCESS_TOKEN="<SUPABASE_ACCESS_TOKEN>"
supabase db push
```
Expected: applies `0002_cron.sql` without error.

- [ ] Step 3: Verify the job was scheduled

Run:
```bash
export SUPABASE_ACCESS_TOKEN="<SUPABASE_ACCESS_TOKEN>"
supabase db query "select jobname, schedule, active from cron.job" --linked
```
Expected: one row, `send-reminders-every-15-min`, `*/15 * * * *`, `active=true`.

- [ ] Step 4: Commit

```bash
git add supabase/migrations/0002_cron.sql
git commit -m "feat: schedule send-reminders Edge Function every 15 minutes via pg_cron"
```

---

### Task 17: End-to-end manual verification

No new files — this task runs the app and walks the golden path in a real
browser, per this project's rule that UI work must be checked in a browser
before being called done.

- [ ] Step 1: Start the dev server

Run: `npm run dev -- --port 3000` (background)
Expected: "Ready" log, no compile errors.

- [ ] Step 2: Manual checklist (open `http://localhost:3000`)

- [ ] Signup: create a display name, password+confirm → see the generated
  `login_id` (e.g. `test_00`) shown back.
- [ ] Login with that `login_id` + password, "Ghi nhớ đăng nhập" checked →
  redirected to home (`/`).
- [ ] Home page shows the 7-day week strip (empty state is fine with no
  debts yet) and summary cards all at 0.
- [ ] Go to "Khoản vay" (`/debts`), add a `credit_card` with a `due_day` = a
  couple days from today, an account number → save → it appears in the
  list.
- [ ] Home page now shows that debt on the correct day in the week strip
  (badge colored if within the reminder window) and in the summary's
  "Phải trả tháng này".
- [ ] Go to "Lịch" (`/calendar`), confirm the same debt's day is highlighted;
  click the day → popup shows name/amount, "Copy STK" copies the account
  number (paste somewhere to confirm), "Đã đóng" marks it paid and the
  highlight disappears.
- [ ] Go to "Cho vay/mượn" (`/lending`), add a `lend_out` with
  `repayment_mode='one_time'`, a `start_date`/`due_date` a few weeks apart,
  principal + rate → confirm the computed amount shows correctly on the
  calendar/dashboard (principal + interest for the elapsed months).
- [ ] On the debt form, click "🎤 Đọc điền nhanh" (if the browser supports
  it — Chrome desktop does) and say a sentence like the dictation test's
  example → confirm fields populate.
- [ ] Click "🔔 Bật thông báo" in the top nav → browser permission prompt →
  allow → no error.
- [ ] Log out, log back in with "Ghi nhớ đăng nhập" unchecked → confirm
  `sessionStorage` is used (DevTools → Application → Session Storage shows
  the Supabase session key; Local Storage does not).

- [ ] Step 3: Fix build/lint issues found during this task's automated
  verification pass

Two real issues surfaced only at this final stage (individual tasks only
ran `npm run build`/`npm run test`, never `npm run lint`, and no earlier
task's build happened to pick up the Deno file added in Task 15):

1. `npm run build` fails: `tsconfig.json`'s `include: ["**/*.ts", ...]` is
   a project-wide glob that also picks up
   `supabase/functions/send-reminders/index.ts` — a Deno file (`Deno.*`
   globals, `npm:` specifiers) that isn't part of the Next.js app and
   isn't meant to type-check under this tsconfig at all (Deno type-checks
   it separately, already proven working by its live deploy in Task 15).
   Fix: add it to `tsconfig.json`'s `exclude`:
   ```json
   "exclude": ["node_modules", "supabase/functions"]
   ```

2. `npm run lint` reports 7 errors, 4 warnings:
   - `src/app/(protected)/page.tsx:32`, `src/app/(protected)/calendar/page.tsx:23`,
     `src/components/DebtList.tsx:22` — `react-hooks/set-state-in-effect`
     flags the `useEffect(() => { refresh() }, [])` fetch-on-mount pattern
     (the same pattern already has an adjacent
     `// eslint-disable-next-line react-hooks/exhaustive-deps` for a
     different rule). This is the standard, correct way to fetch once on
     mount in a plain Client Component with no data-fetching library — add
     a disable comment for this rule too, right before the `refresh()`
     call in all three files:
     ```tsx
     useEffect(() => {
       // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount, no data-fetching library in this stack
       refresh()
       // eslint-disable-next-line react-hooks/exhaustive-deps
     }, [])
     ```
     (`DebtList.tsx`'s effect keeps its existing `}, [category])` dependency array — only add the new disable line above `refresh()`, don't touch the array.)
   - `src/components/CalendarMonth.tsx:26` — the `useMemo` dependency
     array calls `.getTime()` inline, which isn't a "simple expression"
     per this lint rule. Fix: extract to local variables above the
     `useMemo` call:
     ```tsx
     const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
     const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59)
     const monthStartMs = monthStart.getTime()
     const monthEndMs = monthEnd.getTime()
     // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed on the primitive ms values, not object identity (monthStart/monthEnd are new Date objects every render and would defeat memoization if listed directly)
     const occurrences = useMemo(
       () => getOccurrencesInRange(debts, paidKeys, monthStart, monthEnd),
       [debts, paidKeys, monthStartMs, monthEndMs],
     )
     ```
   - `src/components/DebtForm.tsx` — two separate real issues in
     `applyDictation`:
     - A bare ternary used as a statement (`no-unused-expressions`):
       ```tsx
       category === 'peer' ? setPrincipalText(formatted) : setAmountText(formatted)
       ```
       Fix: use an if/else statement instead:
       ```tsx
       if (category === 'peer') setPrincipalText(formatted)
       else setAmountText(formatted)
       ```
     - An unescaped `"` in JSX text (`react/no-unescaped-entities`):
       ```tsx
       {transcript && <p className="text-xs text-text-muted">Đã nghe: "{transcript}"</p>}
       ```
       Fix: escape both quote characters:
       ```tsx
       {transcript && <p className="text-xs text-text-muted">Đã nghe: &quot;{transcript}&quot;</p>}
       ```

Run: `npm run build` then `npm run lint`
Expected: both exit clean, zero errors/warnings.

- [ ] Step 4: Run the full automated test suite one more time

Run: `npm run test`
Expected: all tests across `money`, `schedule`, `dictation`, `dashboard`
pass.

- [ ] Step 5: Run the production build

Run: `npm run build`
Expected: builds cleanly with no type errors.

- [ ] Step 6: Report results

If every checklist item passes, the app is feature-complete per the spec.
If something fails, note exactly which step and what happened — do not mark
this task's checkboxes done until the real browser walkthrough passed.
