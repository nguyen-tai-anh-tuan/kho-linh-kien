import { useState } from 'react'
import { Lock, Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react'
import { supabase } from './supabaseClient'
import AuthLayout from './AuthLayout'

export default function ResetPassword({ onDone }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (loading) return
    if (password.length < 6) return setError('Mật khẩu cần có ít nhất 6 ký tự.')
    if (password !== confirm) return setError('Hai mật khẩu chưa khớp nhau.')
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) return setError(`Có lỗi xảy ra: ${error.message}`)
    onDone()
  }

  return (
    <AuthLayout>
      <h2 className="auth-title">Đặt mật khẩu mới</h2>
      <p className="auth-sub">Chọn một mật khẩu mà bạn dễ nhớ nhưng khó đoán nhé.</p>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="np">Mật khẩu mới</label>
          <div className="input-wrap">
            <Lock className="ico" size={18} />
            <input
              id="np"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
            />
            <button
              type="button"
              className="eye-btn"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
            >
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        <div className="field">
          <label htmlFor="cp">Nhập lại mật khẩu</label>
          <div className="input-wrap">
            <Lock className="ico" size={18} />
            <input
              id="cp"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>
        </div>

        {error && (
          <div className="msg error" role="alert">
            <AlertCircle size={18} /> <span>{error}</span>
          </div>
        )}

        <button className="btn-primary" disabled={loading}>
          {loading ? <><Loader2 size={18} className="spin" /> Đang lưu...</> : 'Lưu mật khẩu'}
        </button>
      </form>
    </AuthLayout>
  )
}