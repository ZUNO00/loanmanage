# Thiết kế: Note lịch hẹn + chuông thông báo + hỗ trợ iOS

Ngày: 2026-09-08

## 1. Mục tiêu

Thêm tính năng ghi chú lịch hẹn (không liên quan tiền) hiện chung trên lịch/trang
chủ với khoản vay, có push nhắc trước 1 tiếng (1 lần duy nhất). Đồng thời:
nâng cấp mic đọc điền ngày/giờ cho chuẩn hơn (áp dụng chung cho note lẫn form
khoản vay), thêm tiếng chuông khi có thông báo lúc app đang mở, và thêm hướng
dẫn cho user iOS (Safari/mọi trình duyệt trên iOS đều dùng chung engine
WebKit nên cùng bị giới hạn) vì mic và push không hoạt động nếu không cài
web này vào Màn hình chính.

## 2. Data model

```sql
notes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  title        text not null,
  note_at      timestamptz not null,  -- 1 mốc giờ tuyệt đối, không lặp lại
  reminded_at  timestamptz,           -- null tới khi đã gửi nhắc — chặn gửi lại
  created_at   timestamptz not null default now()
)
```
RLS: chỉ `user_id = auth.uid()` (select/insert/update/delete) — giống mọi
bảng khác.

Khác với `debts`: note chỉ có 1 mốc thời gian tuyệt đối (không lặp hàng
tháng) nên không cần tách ngày/giờ hay tính múi giờ VN như khoản vay — chỉ
việc lưu đúng thời điểm người dùng chọn trên trình duyệt của họ.

## 3. Giao diện

- Trang mới `/notes` ("Ghi chú" trong menu), CRUD giống trang Khoản vay:
  form thêm/sửa có ô tiêu đề + 1 ô `datetime-local` (native picker ngày+giờ
  chung) + nút mic, danh sách hiện các note sắp tới, nút xóa.
- Lịch tháng (`CalendarMonth`) và trang chủ (dải tuần + list) hiện note
  cùng chỗ với khoản vay trong cùng ngày, nhưng thẻ màu xanh dương riêng để
  phân biệt: đỏ-cam = phải trả, xanh lá = phải thu, xanh dương = note/nhắc
  việc. Click vào note trong popup chỉ hiện tiêu đề + giờ, không có nút
  "Đã đóng"/Copy STK (không áp dụng cho note).

## 4. Mic + parser ngày/giờ chuẩn hơn

Mở rộng `parseDictation` (dùng chung cho note lẫn form khoản vay):
- Ngày không có năm (`20/9`) → lấy năm hiện tại; nếu ngày đó đã qua trong
  năm nay → lấy năm sau.
- Dạng nói `"ngày 20 tháng 9"` / `"ngày 20 tháng 9 năm 2026"` (không cần
  gõ dấu `/`).
- `"hôm nay"` → ngày hiện tại; `"ngày mai"` → ngày hiện tại + 1.

Note's mic ghép ngày+giờ nghe được thành 1 giá trị `datetime-local` duy
nhất (`YYYY-MM-DDTHH:mm`).

## 5. Push nhắc cho note

Dùng chung Edge Function `send-reminders` (đã deploy) + cron 15 phút đã có
— thêm 1 vòng quét bảng `notes`:
- Điều kiện gửi: `reminded_at is null` và `now >= note_at - 1 tiếng`.
- Gửi xong thì `update notes set reminded_at = now()` — đảm bảo chỉ gửi
  đúng 1 lần (không nag lặp lại như khoản vay, vì note không có khái niệm
  "đã đóng/chưa đóng" — đã thống nhất ở bước brainstorm).
- Payload push: `title: "Nhắc: {note.title}"`, không có số tiền.

## 6. Chuông khi app đang mở (bổ sung cho cả note lẫn khoản vay)

Web Push chuẩn không chèn được file âm thanh riêng (giới hạn nền tảng, đã
nói ở bước brainstorm) — khi tab đang mở thì phát thêm 1 tiếng "ding" thật
bằng Web Audio API (tự tạo sóng âm bằng code, không cần file mp3):

- `public/sw.js`'s `push` handler: sau khi `showNotification`, gọi
  `self.clients.matchAll(...)` rồi `client.postMessage({ type:
  'PLAY_REMINDER_SOUND' })` cho mọi tab đang mở.
- Component mới `NotificationSoundListener` (mount trong root layout):
  lắng nghe `navigator.serviceWorker.addEventListener('message', ...)`,
  khi nhận `PLAY_REMINDER_SOUND` thì phát 1 chuỗi 2 tiếng bíp ngắn qua
  `AudioContext` + `OscillatorNode`.
- Áp dụng chung: cơ chế push của khoản vay/thẻ tín dụng (đã có) và note
  (mục 5) đều đi qua cùng service worker nên tự động có chuông, không cần
  sửa gì thêm ở Edge Function.

## 7. Hỗ trợ iOS (mic/push không chạy nếu chưa cài vào Màn hình chính)

Mọi trình duyệt trên iOS (Safari, Chrome iOS, ...) đều dùng chung engine
WebKit của Apple nên cùng bị giới hạn: mic đọc (`webkitSpeechRecognition`)
không tồn tại, và Web Push chỉ hoạt động sau khi "Thêm vào Màn hình chính"
(cài như PWA) — mở bằng tab trình duyệt thường thì không có push.

Thêm component `IosInstallHint`: banner nhỏ, dismiss được (nhớ qua
`localStorage`), hiện khi phát hiện đang chạy trên iOS (`/iPad|iPhone|iPod/`
trong `navigator.userAgent`) và CHƯA chạy ở chế độ standalone (chưa cài
— check `navigator.standalone` hoặc
`matchMedia('(display-mode: standalone)')`). Nội dung: hướng dẫn bấm nút
Chia sẻ → "Thêm vào Màn hình chính" để dùng được mic và nhận thông báo.
Đặt trong `(protected)/layout.tsx`, hiện trên mọi trang sau khi đăng nhập.

## 8. Testing

- `dictation.test.ts`: thêm case cho ngày không năm (roll sang năm sau nếu
  đã qua), "ngày D tháng M", "hôm nay", "ngày mai".
- Không có test tự động cho phần âm thanh/iOS-detection (phụ thuộc
  API trình duyệt thật, browser-only) — kiểm tra tay ở bước cuối, giống
  các phần UI/push khác của app.
