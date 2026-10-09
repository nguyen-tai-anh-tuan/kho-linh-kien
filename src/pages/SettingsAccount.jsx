import { useState } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useShell } from '../ShellContext'
import { useToast } from '../ui/Toast'
import { NewPasswordFields, PasswordInput } from '../ui/password'
import { passwordProblems, translateAuthError } from '../lib/auth'

/** Mục "Tài khoản" của trang Cài đặt: đổi mật khẩu khi đang đăng nhập */
export default function SettingsAccount() {
  const { email } = useShell()
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [signOutOthers, setSignOutOthers] = useState(true)
  const [submitted, setSubmitted] = useState(false)
  const [currentError, setCurrentError] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [round, setRound] = useState(0) // đổi key để các ô trở về trạng thái ban đầu sau khi lưu

  async function submit(ev) {
    ev.preventDefault()
    if (saving) return
    setSubmitted(true)
    setFormError('')
    setCurrentError(current ? '' : 'Hãy nhập mật khẩu hiện tại.')
    const problems = passwordProblems(password, confirm)
    if (!current || problems.password || problems.confirm) return
    if (password === current) return setFormError('Mật khẩu mới phải khác mật khẩu đang dùng.')

    setSaving(true)
    // Đăng nhập lại bằng mật khẩu hiện tại để chắc người đang ngồi trước máy đúng là chủ tài khoản
    const check = await supabase.auth.signInWithPassword({ email, password: current })
    if (check.error) {
      setSaving(false)
      const wrong = check.error.message.toLowerCase().includes('invalid login credentials')
      if (wrong) return setCurrentError('Mật khẩu hiện tại chưa đúng.')
      return setFormError(translateAuthError(check.error))
    }

    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setSaving(false)
      return setFormError(translateAuthError(error))
    }

    let othersFailed = false
    if (signOutOthers) {
      const res = await supabase.auth.signOut({ scope: 'others' })
      othersFailed = Boolean(res.error)
    }

    setSaving(false)
    setCurrent('')
    setPassword('')
    setConfirm('')
    setSubmitted(false)
    setRound((n) => n + 1)
    toast.push(
      othersFailed
        ? {
            tone: 'error',
            message: 'Đã đổi mật khẩu, nhưng chưa đăng xuất được các thiết bị khác. Bạn thử lại sau nhé.',
            duration: 9000,
          }
        : { message: signOutOthers ? 'Đã đổi mật khẩu và đăng xuất khỏi các thiết bị khác.' : 'Đã đổi mật khẩu.' },
    )
  }

  return (
    <section className="kk-card" id="account" aria-labelledby="set-account">
      <div className="kk-card-head">
        <div>
          <h2 id="set-account">Tài khoản</h2>
          <p className="kk-card-sub">Đang đăng nhập bằng {email}</p>
        </div>
      </div>

      <h3 className="kk-sub kk-sub-first">Đổi mật khẩu</h3>
      <form className="kk-account-form" onSubmit={submit} noValidate>
        <PasswordInput
          key={`current-${round}`}
          id="acc-current"
          label="Mật khẩu hiện tại"
          value={current}
          onChange={(v) => {
            setCurrent(v)
            setCurrentError('')
          }}
          autoComplete="current-password"
          show={showCurrent}
          onToggleShow={() => setShowCurrent((s) => !s)}
          error={currentError}
        />
        <NewPasswordFields
          key={`new-${round}`}
          idPrefix="acc"
          password={password}
          confirm={confirm}
          onPassword={setPassword}
          onConfirm={setConfirm}
          submitted={submitted}
        />

        <label className="kk-switch">
          <input type="checkbox" checked={signOutOthers} onChange={(e) => setSignOutOthers(e.target.checked)} />
          <span className="kk-switch-track" aria-hidden="true" />
          Đăng xuất khỏi các thiết bị khác
        </label>

        {formError && (
          <p className="kk-form-error" role="alert">
            {formError}
          </p>
        )}

        <div>
          <button type="submit" className="kk-btn kk-btn-primary" disabled={saving}>
            {saving ? <Loader2 size={18} className="kk-spin" /> : <KeyRound size={18} />}
            {saving ? 'Đang đổi…' : 'Đổi mật khẩu'}
          </button>
        </div>
      </form>
    </section>
  )
}
