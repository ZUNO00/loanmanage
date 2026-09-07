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
