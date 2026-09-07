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
