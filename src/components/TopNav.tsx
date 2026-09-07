'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { getSupabaseClient } from '@/lib/supabase/client'
import { subscribeToPush } from '@/lib/push'
import { useAuth } from '@/components/AuthProvider'

const LINKS = [
  { href: '/', label: 'Trang chủ' },
  { href: '/calendar', label: 'Lịch' },
  { href: '/debts', label: 'Khoản vay' },
  { href: '/lending', label: 'Cho vay/mượn' },
]

export function TopNav() {
  const pathname = usePathname()
  const router = useRouter()
  const { session } = useAuth()

  async function handleEnableNotifications() {
    if (!session) return
    const result = await subscribeToPush(getSupabaseClient(), session.user.id)
    if (result === 'denied') alert('Bạn đã từ chối quyền thông báo — bật lại trong cài đặt trình duyệt nếu muốn nhận nhắc.')
    if (result === 'unsupported') alert('Trình duyệt này không hỗ trợ thông báo đẩy.')
    if (result === 'failed') alert('Không lưu được đăng ký thông báo, thử lại sau.')
  }

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
      <button onClick={handleEnableNotifications} className="ml-auto rounded-lg px-3 py-1.5 text-sm text-text-muted hover:text-text">
        🔔 Bật thông báo
      </button>
      <button onClick={handleLogout} className="rounded-lg px-3 py-1.5 text-sm text-text-muted hover:text-text">
        Đăng xuất
      </button>
    </nav>
  )
}
