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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only feature detection (UA, standalone mode, localStorage), must run after mount
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
