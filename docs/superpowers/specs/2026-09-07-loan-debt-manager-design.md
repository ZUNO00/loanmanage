# Thiết kế: Web quản lý ghi nợ vay/thẻ tín dụng

Ngày: 2026-09-07

## 1. Mục tiêu

Web app cho nhiều người dùng (mỗi người dữ liệu riêng tư) quản lý:
- Khoản vay ngân hàng / thẻ tín dụng lặp lại hàng tháng.
- Khoản cho người khác vay / mượn người khác có lãi suất.

Mở app lên là thấy ngay hôm nay/tuần này cần trả hay sắp thu khoản gì, copy được
số tài khoản cần thanh toán, có push notification nhắc trước khi tới hạn (kể cả
khi đã đóng trình duyệt), và có dashboard tổng kết tình hình nợ/cho vay.

Không làm: chia sẻ dữ liệu giữa nhiều user (mỗi user riêng biệt), khoản vay ngân
hàng/thẻ tín dụng có kỳ hạn cố định/trả góp N kỳ (loại này lặp vô thời hạn tới khi
user tự tắt — khác với khoản cho vay/mượn người khác ở mục 7, loại đó có thể có
kỳ hạn cụ thể).

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
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id),
  type               text not null check (type in ('credit_card','loan','lend_out','borrow_in')),
  name               text not null,
  amount             numeric,           -- gõ tay, chỉ dùng khi type in ('credit_card','loan')
  due_day            int check (due_day between 1 and 31),  -- bắt buộc khi repayment_mode='recurring'
  due_time           time,              -- bắt buộc khi type='loan', hoặc repayment_mode='recurring' của lend_out/borrow_in
  account_number     text,
  bank_name          text,
  account_holder     text,
  -- Riêng cho type='lend_out'/'borrow_in':
  counterparty_name  text,              -- tên người vay/cho mượn
  principal_amount   numeric,           -- gốc
  interest_rate_pct  numeric,           -- % lãi/tháng, lãi đơn
  repayment_mode     text check (repayment_mode in ('recurring','one_time')),
  start_date         date,              -- ngày cho vay/mượn, dùng tính lãi one_time
  due_date           date,              -- chỉ khi repayment_mode='one_time': ngày đáo hạn cố định
  is_active          boolean default true,
  created_at         timestamptz default now()
)

debt_payments (
  id         uuid primary key default gen_random_uuid(),
  debt_id    uuid not null references debts(id) on delete cascade,
  user_id    uuid not null references auth.users(id),
  period     text not null,   -- 'YYYY-MM' khi recurring; khi one_time dùng chính due_date (vd '2026-11-20')
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

**Tính "ngày/số tiền đến hạn của kỳ hiện tại"** — 1 hàm dùng chung cho lịch hiển
thị, dashboard và Edge Function nhắc lịch:
- `credit_card` / `loan` / (`lend_out`,`borrow_in` có `repayment_mode='recurring'`):
  từ `due_day` (+ `due_time` nếu có) suy ra ngày đến hạn của tháng hiện tại; nếu
  ngày đó đã qua trong tháng này thì dùng tháng sau. `due_day` lớn hơn số ngày
  trong tháng (vd 31 vào tháng 2) thì dùng ngày cuối tháng. Số tiền: `credit_card`/
  `loan` lấy thẳng `amount`; `lend_out`/`borrow_in` tính `principal_amount ×
  interest_rate_pct / 100` (chỉ tiền lãi, gốc tất toán riêng lúc đóng hẳn khoản).
- (`lend_out`,`borrow_in` có `repayment_mode='one_time'`): ngày đến hạn = đúng
  `due_date`, chỉ xuất hiện 1 lần duy nhất (không lặp qua tháng khác). Số tiền =
  `principal_amount + principal_amount × interest_rate_pct/100 × số_tháng`, với
  số_tháng = làm tròn lên số tháng chênh lệch giữa `start_date` và `due_date`.

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

- Lịch tháng (nút prev/next), gồm cả 4 loại debt. Mỗi ngày có khoản nào tới hạn
  (theo công thức mục 3) thì hiện badge tên + số tiền (định dạng có dấu chấm, mục
  11), màu khác nhau cho "phải trả" (credit_card/loan/borrow_in) và "phải thu"
  (lend_out).
- Click ngày → popup danh sách khoản tới hạn ngày đó: tên, số tiền, số tài khoản
  đối phương nếu có (nút **Copy** dùng `navigator.clipboard.writeText`), nút **Đã
  đóng kỳ này** (insert `debt_payments` với `period` tương ứng — xem mục 3).
- Trang "Quản lý khoản vay": CRUD `debts`, form hiện/ẩn field theo `type` đã chọn
  (vd chỉ `lend_out`/`borrow_in` mới có `counterparty_name`, lãi suất, chọn
  `repayment_mode`), có nút mic đọc điền nhanh (mục 10).

## 6. Push notification (nhắc kể cả khi tắt trình duyệt)

- `public/sw.js`: service worker, nghe event `push` → `showNotification`; click
  vào notification → mở/focus app.
- Lúc user bật quyền thông báo: `pushManager.subscribe({applicationServerKey:
  VAPID_PUBLIC})` → lưu subscription vào `push_subscriptions`.
- VAPID key cặp sinh 1 lần (CLI `web-push generate-vapid-keys`), public key để
  trong `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, private key lưu Supabase Edge Function
  secret.
- `pg_cron` gọi Edge Function `send-reminders` mỗi 15 phút. Function: với mỗi
  debt `is_active`, tính ngày/giờ + số tiền đến hạn kỳ hiện tại (mục 3), kiểm tra
  đã có `debt_payments` cho kỳ đó chưa — nếu chưa và đã qua ngưỡng bắt đầu nhắc
  thì gửi push cho mọi subscription của `user_id` đó (dùng lib `web-push`).
- **Ngưỡng bắt đầu nhắc** (đã thống nhất gộp giản lược, áp dụng chung cho cả
  `lend_out`/`borrow_in` vì nhắc liên tục mỗi 15 phút xuyên suốt tới lúc đóng nên
  không cần nhiều mốc riêng lẻ):
  - `credit_card`: từ (ngày đến hạn lúc 00:00 − 2 ngày).
  - `loan`, và `lend_out`/`borrow_in` (cả `recurring` lẫn `one_time`): từ (ngày
    giờ đến hạn − 24 tiếng).
  - Vượt ngưỡng thì mỗi lần cron chạy (~15 phút/lần) gửi 1 lần push, tới khi user
    bấm "Đã đóng kỳ này" thì kỳ đó có `debt_payments`, lần cron sau tự loại trừ,
    không cần cờ tắt nhắc riêng.
  - `loan` bắt buộc có `due_time`; `credit_card` không cần; `lend_out`/`borrow_in`
    cần `due_time` khi `repayment_mode='recurring'` (còn `one_time` dùng thẳng
    `due_date`, giờ mặc định 00:00 nếu không nhập).

## 7. Cho người khác vay / mượn người khác

- Thêm khoản: chọn loại `lend_out` (cho vay) hoặc `borrow_in` (đi mượn), tên
  người đối diện, gốc, % lãi/tháng, chọn kiểu trả:
  - **Lặp hàng tháng** (`recurring`): nhập `due_day`+`due_time` như khoản vay
    thường, mỗi tháng tính lãi = gốc × %, gốc coi như tất toán riêng khi user tự
    tắt (`is_active=false`) hoặc sửa `principal_amount` nếu trả bớt gốc.
  - **Trả 1 lần** (`one_time`): nhập `start_date` + `due_date`, tới hạn tính 1
    lần gốc + lãi dồn theo số tháng (mục 3), đóng xong thì hết, không tái diễn.
- Các khoản này dùng chung cơ chế lịch + push notification ở mục 5, 6.

## 8. Dashboard tổng kết

Trang chủ, phần đầu (xem mục 9 về bố cục/giao diện):
- Tổng phải trả tháng này (credit_card + loan + borrow_in đến hạn tháng hiện tại).
- Tổng phải thu tháng này (lend_out đến hạn tháng hiện tại).
- Chênh lệch net (thu − trả).
- Tổng lãi dự kiến/tháng: thu được từ `lend_out` active, phải trả từ `borrow_in`
  active (cộng dồn theo `principal_amount × interest_rate_pct/100` của các khoản
  `recurring` đang active; khoản `one_time` cộng vào tháng có `due_date` rơi vào).
- Danh sách khoản quá hạn chưa đóng (due đã qua mà chưa có `debt_payments`) — nổi
  bật riêng, đỏ.
- Danh sách toàn bộ đang cho vay (ai nợ mình, gốc còn lại) / đang mượn (mình nợ
  ai, gốc còn lại).

## 9. Giao diện & responsive

**Trang chủ (ưu tiên số 1: đập vào mắt hôm nay/tuần này cần trả gì):**
- Dải 7 ô ngày trong tuần hiện tại, mỗi ô có chấm/nền màu nếu ngày đó có khoản
  tới hạn (đỏ/cam cho ngày gấp, ngày thường màu trung tính). Bấm vào 1 ngày lọc
  danh sách bên dưới theo đúng ngày đó.
- Ngay dưới dải tuần: danh sách dạng hàng "Hôm nay/Ngày mai/Thứ X — tên khoản —
  số tiền", mỗi hàng có nút Copy số tài khoản + nút Đã đóng kỳ này.
- Dưới cùng (hoặc cột phụ ở desktop): dashboard tổng kết (mục 8) và lịch tháng
  đầy đủ.

**Responsive:**
- Mobile: xếp dọc 1 cột — dải tuần → danh sách việc cần làm → tổng kết → lịch
  tháng thu gọn.
- Desktop: top nav ngang (Trang chủ · Lịch · Khoản vay · Cho vay/mượn) + nội
  dung chia 2 cột — cột trái rộng gộp dải tuần/danh sách/lịch tháng xếp dọc, cột
  phải hẹp là khối dashboard tổng kết dính theo khi cuộn (`position: sticky`).

**Phong cách hình ảnh — "Dark Slate":**
- Nền tối xanh than gần đen (`#0b1220` nền chính, `#141c2e` khối card), chữ sáng
  (`#e2e8f0`).
- Điểm nhấn cho khoản gấp/hôm nay: gradient đỏ–cam (`#f43f5e` → `#fb923c`); cho
  "phải thu" (lend_out): xanh lá nhạt (`#86efac`); cho khoản bình thường khác:
  nền card trung tính không gradient.
- Bo góc lớn (10–18px), khoảng đệm rộng rãi, không viền cứng — tránh nhìn giống
  UI ngân hàng xanh-trắng đại trà.
- Font hệ thống (system-ui/sans-serif), không cần font ngoài.

## 10. Đọc 1 lèo điền form bằng mic

- 1 nút mic trên form thêm/sửa khoản vay. Dùng Web Speech API (`lang='vi-VN'`)
  lấy transcript, hiện lại nguyên văn để user kiểm tra, đồng thời chạy parser
  tách vào các ô (ô nào không nhận ra để trống, user gõ tay bổ sung):
  - Loại: có "thẻ tín dụng" → `credit_card`; có "cho vay" → `lend_out`; có
    "mượn" → `borrow_in`; có "vay"/"nợ" (không rõ hướng) → `loan`.
  - Số tiền: regex số + đơn vị (`k`/`nghìn`/`ngàn` ×1.000, `tr`/`triệu`/`củ`
    ×1.000.000).
  - Ngày: `dd/mm/yyyy` hoặc "ngày X tháng Y".
  - Giờ: "4h chiều" → 16:00, "sáng"/"chiều"/"tối" cộng offset giờ tương ứng.
  - Ngân hàng: từ theo sau "ngân hàng".
  - Số tài khoản: chữ số theo sau "số tài khoản"/"stk".
- Mic chỉ hỗ trợ điền nhanh, không bắt buộc — ô vẫn gõ tay bình thường được.

## 11. Định dạng tiền

Mọi nơi hiển thị số tiền dùng `Intl.NumberFormat('vi-VN').format(...)` (dấu chấm
ngăn nghìn, vd `14.000.000`). Ô nhập tay số tiền tự chèn dấu chấm khi gõ (strip
non-digit, format lại), lưu xuống DB dạng số thuần (`numeric`).

## 12. Error handling

- Đăng ký/đăng nhập sai → hiện thông báo lỗi rõ ràng (sai `login_id`/password),
  không lộ email giả.
- Mic không được trình duyệt hỗ trợ (`webkitSpeechRecognition` undefined) → ẩn
  nút mic, không lỗi vỡ trang.
- Quyền Notification bị từ chối → app vẫn dùng được, chỉ không có push (không
  chặn thao tác khác).
- Edge Function lỗi gửi push cho 1 subscription (vd endpoint hết hạn) → xóa
  subscription đó khỏi bảng, không chặn gửi cho các subscription khác.

## 13. Kiểm thử

- Hàm tính "ngày/số tiền đến hạn kỳ hiện tại" (mục 3): unit test — ngày thường,
  ngày đã qua trong tháng (nhảy sang tháng sau), `due_day=31` rơi vào tháng 2/4,
  tính lãi `recurring` (gốc×%), tính gốc+lãi dồn tháng cho `one_time`.
- Hàm parser giọng nói (mục 10): test với câu mẫu "ngân hàng BIDV số tài khoản
  ... Nợ 4tr ngày 20/11/2026 lúc 4h chiều phải trả" → đúng từng field.
- Hàm định dạng tiền + parser ngược (input tiền → số thuần).
- Logic ngưỡng nhắc lịch (mục 6): test tính `should_notify` cho vài mốc thời gian
  giả lập quanh ngưỡng (trước/sau ngưỡng, đã đóng/chưa đóng), cho cả 4 loại debt.
