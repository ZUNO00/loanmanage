# Thiết kế: Web quản lý ghi nợ vay/thẻ tín dụng

Ngày: 2026-09-07

## 1. Mục tiêu

Web app cho nhiều người dùng (mỗi người dữ liệu riêng tư) quản lý các khoản vay/thẻ
tín dụng lặp lại hàng tháng, xem lịch tới hạn, copy số tài khoản cần trả, và được
đẩy thông báo nhắc trước khi tới hạn — kể cả khi đã đóng trình duyệt.

Không làm: chia sẻ dữ liệu giữa nhiều user (mỗi user riêng biệt), khoản vay có kỳ
hạn cố định/trả góp N kỳ (mọi khoản đều lặp vô thời hạn tới khi user tự tắt).

## 2. Stack

- Next.js (App Router), React client component gọi thẳng Supabase JS (không có
  API route riêng — RLS lo bảo mật).
- Tailwind CSS.
- Supabase: Auth, Postgres (RLS), Edge Function (Deno) + `pg_cron` cho nhắc lịch,
  Storage không cần.
- Web Push chuẩn trình duyệt (VAPID) + `web-push` npm lib phía Edge Function.
- Web Speech API (`webkitSpeechRecognition`, `vi-VN`) cho đọc điền form — có sẵn
  trình duyệt, không thêm dependency.

## 3. Data model

```sql
profiles (
  id            uuid primary key references auth.users(id),
  login_id      text unique not null,   -- vd 'hoavnh_00', dùng làm email giả <login_id>@loanmanage.local
  display_name  text not null,          -- tên user nhập lúc đăng ký, vd 'hoavnh'
  created_at    timestamptz default now()
)

debts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id),
  type            text not null check (type in ('credit_card','loan')),
  name            text not null,
  amount          numeric not null,
  due_day         int not null check (due_day between 1 and 31),
  due_time        time,              -- bắt buộc khi type='loan', null khi 'credit_card'
  account_number  text,
  bank_name       text,
  account_holder  text,
  is_active       boolean default true,
  created_at      timestamptz default now()
)

debt_payments (
  id         uuid primary key default gen_random_uuid(),
  debt_id    uuid not null references debts(id) on delete cascade,
  user_id    uuid not null references auth.users(id),
  period     text not null,   -- 'YYYY-MM', kỳ đã đóng
  paid_at    timestamptz default now(),
  unique (debt_id, period)
)

push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id),
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz default now()
)
```

RLS: tất cả 4 bảng chỉ cho phép `user_id = auth.uid()` (select/insert/update/delete).
`profiles` không cần select public — việc kiểm tra `login_id` trùng dựa vào lỗi
"user already registered" khi `signUp` (xem mục 4), không query trực tiếp bảng.

**Tính "ngày đến hạn của kỳ hiện tại"**: từ `due_day` (+ `due_time` nếu có) suy ra
ngày đến hạn của tháng hiện tại; nếu ngày đó đã qua trong tháng này thì dùng tháng
sau. Nếu `due_day` lớn hơn số ngày trong tháng (vd 31 vào tháng 2), dùng ngày cuối
tháng. Hàm này dùng chung cho cả lịch hiển thị lẫn Edge Function tính nhắc lịch.

## 4. Auth (username tự sinh key, không cần email)

- Đăng ký: nhập `display_name` (vd `hoavnh`) + password + xác nhận password.
  Client thử `login_id = display_name_00`; gọi `supabase.auth.signUp({ email:
  '<login_id>@loanmanage.local', password })`. Nếu lỗi "user already registered",
  tăng số (`_01`, `_02`...) thử lại, tối đa 20 lần. Thành công thì insert vào
  `profiles` và hiện rõ `login_id` cho user biết (vd **hoavnh_00**) để lần sau
  đăng nhập.
- Đăng nhập: nhập đúng `login_id` + password → build lại email giả, gọi
  `signInWithPassword`.
- Checkbox "Ghi nhớ đăng nhập": bật → Supabase session lưu ở `localStorage` (mặc
  định); tắt → lưu ở `sessionStorage` (mất khi đóng tab). Không lưu password thô ở
  client, chỉ session token chuẩn.

## 5. Lịch trả nợ + copy số tài khoản

- Trang chính: lịch tháng (nút prev/next). Mỗi ngày có khoản nào tới hạn (theo
  công thức mục 3) thì hiện badge tên + số tiền (định dạng có dấu chấm, mục 8).
- Click ngày → popup danh sách khoản tới hạn ngày đó: tên, số tiền, số tài khoản
  (nút **Copy** dùng `navigator.clipboard.writeText`), nút **Đã đóng kỳ này**
  (insert `debt_payments` với `period` = tháng đang xem của khoản đó).
- Trang "Quản lý khoản vay": CRUD `debts` (thêm/sửa/xóa/tạm ngưng `is_active`),
  có nút mic đọc điền nhanh (mục 9).

## 6. Push notification (nhắc kể cả khi tắt trình duyệt)

- `public/sw.js`: service worker, nghe event `push` → `showNotification`; click
  vào notification → mở/focus app.
- Lúc user bật quyền thông báo: `pushManager.subscribe({applicationServerKey:
  VAPID_PUBLIC})` → lưu subscription vào `push_subscriptions`.
- VAPID key cặp sinh 1 lần (CLI `web-push generate-vapid-keys`), public key để
  trong `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, private key lưu Supabase Edge Function
  secret.
- `pg_cron` gọi Edge Function `send-reminders` mỗi 15 phút. Function: với mỗi
  debt `is_active`, tính ngày/giờ đến hạn kỳ hiện tại (mục 3), kiểm tra đã có
  `debt_payments` cho kỳ đó chưa — nếu chưa và đã qua ngưỡng bắt đầu nhắc thì gửi
  push cho mọi subscription của `user_id` đó (dùng lib `web-push`).
- **Ngưỡng bắt đầu nhắc** (đã thống nhất gộp giản lược):
  - `credit_card`: từ (ngày đến hạn lúc 00:00 − 2 ngày).
  - `loan`: từ (ngày giờ đến hạn − 24 tiếng). Gộp chung mốc "1 ngày trước" và "2
    tiếng trước" thành một mốc 24h vì cron nhắc liên tục mỗi 15 phút xuyên suốt
    tới lúc đóng, nên mốc 2 tiếng trước tự động nằm trong khoảng đã nhắc.
  - Vượt ngưỡng thì mỗi lần cron chạy (~15 phút/lần) gửi 1 lần push, tới khi user
    bấm "Đã đóng kỳ này" thì kỳ đó có `debt_payments`, lần cron sau tự loại trừ,
    không cần cờ tắt nhắc riêng.
  - `loan` bắt buộc có `due_time`; `credit_card` không cần.

## 7. Đọc 1 lèo điền form bằng mic

- 1 nút mic trên form thêm/sửa khoản vay. Dùng Web Speech API (`lang='vi-VN'`)
  lấy transcript, hiện lại nguyên văn để user kiểm tra, đồng thời chạy parser
  tách vào các ô (ô nào không nhận ra để trống, user gõ tay bổ sung):
  - Loại: có "thẻ tín dụng" → `credit_card`; có "vay"/"nợ" → `loan`.
  - Số tiền: regex số + đơn vị (`k`/`nghìn`/`ngàn` ×1.000, `tr`/`triệu`/`củ`
    ×1.000.000).
  - Ngày: `dd/mm/yyyy` hoặc "ngày X tháng Y".
  - Giờ: "4h chiều" → 16:00, "sáng"/"chiều"/"tối" cộng offset giờ tương ứng.
  - Ngân hàng: từ theo sau "ngân hàng".
  - Số tài khoản: chữ số theo sau "số tài khoản"/"stk".
- Mic chỉ hỗ trợ điền nhanh, không bắt buộc — ô vẫn gõ tay bình thường được.

## 8. Định dạng tiền

Mọi nơi hiển thị số tiền dùng `Intl.NumberFormat('vi-VN').format(...)` (dấu chấm
ngăn nghìn, vd `14.000.000`). Ô nhập tay số tiền tự chèn dấu chấm khi gõ (strip
non-digit, format lại), lưu xuống DB dạng số thuần (`numeric`).

## 9. Error handling

- Đăng ký/đăng nhập sai → hiện thông báo lỗi rõ ràng (sai `login_id`/password),
  không lộ email giả.
- Mic không được trình duyệt hỗ trợ (`webkitSpeechRecognition` undefined) → ẩn
  nút mic, không lỗi vỡ trang.
- Quyền Notification bị từ chối → app vẫn dùng được, chỉ không có push (không
  chặn thao tác khác).
- Edge Function lỗi gửi push cho 1 subscription (vd endpoint hết hạn) → xóa
  subscription đó khỏi bảng, không chặn gửi cho các subscription khác.

## 10. Kiểm thử

- Hàm tính "ngày đến hạn kỳ hiện tại" (mục 3): unit test các case — ngày thường,
  ngày đã qua trong tháng (nhảy sang tháng sau), `due_day=31` rơi vào tháng 2/4.
- Hàm parser giọng nói (mục 9): test với câu mẫu "ngân hàng BIDV số tài khoản
  ... Nợ 4tr ngày 20/11/2026 lúc 4h chiều phải trả" → đúng từng field.
- Hàm định dạng tiền + parser ngược (input tiền → số thuần).
- Logic ngưỡng nhắc lịch (mục 6): test tính `should_notify` cho vài mốc thời gian
  giả lập quanh ngưỡng (trước/sau ngưỡng, đã đóng/chưa đóng).
