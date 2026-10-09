import { useState } from 'react'
import { Lock, Loader2, AlertCircle, CheckCircle2, LogOut } from 'lucide-react'
import { supabase } from './supabaseClient'
import AuthLayout from './AuthLayout'
import { NewPasswordFields } from './ui/password'
import { passwordProblems, setRecoveryPending, translateAuthError } from './lib/auth'

export default function ResetPassword({ onDone }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (loading) return
    setSubmitted(true)
    setError('')
    const problems = passwordProblems(password, confirm)
    if (problems.password || problems.confirm) return
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) return setError(translateAuthError(error))
    // Xong bước đặt lại: từ giờ tải lại trang sẽ vào thẳng Dashboard
    setRecoveryPending(false)
    setDone(true)
  }

  if (done) {
    return (
      <AuthLayout>
        <h2 className="auth-title">Đã đổi mật khẩu</h2>
        <p className="auth-sub">Từ lần sau, bạn đăng nhập bằng mật khẩu mới này nhé.</p>
        <div className="msg ok" role="status">
          <CheckCircle2 size={18} /> <span>Mật khẩu mới đã được lưu.</span>
        </div>
        <button type="button" className="btn-primary" autoFocus onClick={onDone}>
          Vào kho
        </button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <h2 className="auth-title">Đặt mật khẩu mới</h2>
      <p className="auth-sub">Chọn một mật khẩu mà bạn dễ nhớ nhưng khó đoán nhé.</p>
      <form onSubmit={handleSubmit} noValidate>
        <NewPasswordFields
          idPrefix="rp"
          password={password}
          confirm={confirm}
          onPassword={setPassword}
          onConfirm={setConfirm}
          submitted={submitted}
          Icon={Lock}
          autoFocus
        />

        {error && (
          <div className="msg error" role="alert">
            <AlertCircle size={18} /> <span>{error}</span>
          </div>
        )}

        <button className="btn-primary" disabled={loading}>
          {loading ? <><Loader2 size={18} className="spin" /> Đang lưu...</> : 'Lưu mật khẩu'}
        </button>
      </form>
      <div className="back-row">
        <button type="button" className="link-btn" onClick={() => supabase.auth.signOut()}>
          <LogOut size={16} /> Để sau và đăng xuất
        </button>
      </div>
    </AuthLayout>
  )
}
