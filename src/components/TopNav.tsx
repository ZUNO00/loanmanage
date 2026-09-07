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
