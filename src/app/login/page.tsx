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
