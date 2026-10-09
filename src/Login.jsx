import { useEffect, useRef, useState } from 'react'
import { Mail, Lock, Eye, EyeOff, Loader2, AlertCircle, CheckCircle2, ArrowLeft, User } from 'lucide-react'
import { supabase } from './supabaseClient'
import AuthLayout from './AuthLayout'
import { NewPasswordFields } from './ui/password'
import { markResetSent, passwordProblems, resetCooldownLeft, translateAuthError } from './lib/auth'

const EMAIL_KEY = 'kho_last_email'

function getSavedEmail() {
  try { return localStorage.getItem(EMAIL_KEY) || '' } catch { return '' }
}
function saveEmail(value) {
  try {
    if (value) localStorage.setItem(EMAIL_KEY, value)
    else localStorage.removeItem(EMAIL_KEY)
  } catch { /* bỏ qua */ }
}

const LINK_EXPIRED = 'Link đặt lại mật khẩu đã hết hạn hoặc đã được dùng rồi. Nhập email để nhận link mới nhé.'

/** linkExpired: người dùng vừa bấm một link đặt lại mật khẩu không còn dùng được */
export default function Login({ linkExpired = false }) {
  const [mode, setMode] = useState(linkExpired ? 'forgot' : 'login') // 'login' | 'forgot' | 'signup'
  const [email, setEmail] = useState(getSavedEmail)
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [remember, setRemember] = useState(true)
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(linkExpired ? LINK_EXPIRED : '')
  const [info, setInfo] = useState('')
  const [wait, setWait] = useState(resetCooldownLeft) // số giây còn phải đợi trước khi gửi lại email
  const emailRef = useRef(null)
  const passRef = useRef(null)
  const nameRef = useRef(null)

  const waiting = wait > 0
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => setWait(resetCooldownLeft()), 500)
    return () => clearInterval(timer)
  }, [waiting])

  // Tự đặt con trỏ: nếu đã nhớ email thì nhảy thẳng vào ô mật khẩu
  useEffect(() => {
    if (mode === 'signup') nameRef.current?.focus()
    else if (mode === 'login' && email) passRef.current?.focus()
    else emailRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  function switchMode(next) {
    setMode(next)
    setError('')
    setInfo('')
    setPassword('')
    setConfirm('')
    setSubmitted(false)
  }

  async function handleSignup(e) {
    e.preventDefault()
    if (loading) return
    setSubmitted(true)
    setError('')
    const cleanName = name.trim()
    const cleanEmail = email.trim()
    const problems = passwordProblems(password, confirm)
    if (!cleanName) return setError('Hãy nhập tên hiển thị để mọi người biết bạn là ai.')
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) return setError('Email chưa đúng định dạng.')
    if (problems.password || problems.confirm) return

    setLoading(true)
    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: { data: { display_name: cleanName }, emailRedirectTo: window.location.origin },
    })
    if (error) {
      setLoading(false)
      return setError(translateAuthError(error))
    }
    // Có phiên ngay (Supabase không bắt xác nhận email): App tự chuyển sang màn chờ admin duyệt
    if (data.session) return
    setLoading(false)
    // Email đã có tài khoản: Supabase trả về người dùng "giả" không có danh tính nào
    if (data.user && data.user.identities?.length === 0) {
      return setError('Email này đã có tài khoản. Hãy đăng nhập, hoặc dùng "Quên mật khẩu?" nếu bạn không nhớ mật khẩu.')
    }
    switchMode('login')
    setInfo('Đã tạo tài khoản. Hãy bấm link xác nhận trong email (xem cả mục Spam), rồi quay lại đăng nhập.')
  }

  async function handleLogin(e) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (error) {
      setError(translateAuthError(error))
      setLoading(false)
      return
    }
    saveEmail(remember ? email.trim() : '')
    // Đăng nhập xong, App tự chuyển sang Dashboard
  }

  async function handleForgot(e) {
    e.preventDefault()
    if (loading || waiting) return
    setLoading(true)
    setError('')
    setInfo('')
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    })
    setLoading(false)
    if (error) return setError(translateAuthError(error))
    markResetSent()
    setWait(resetCooldownLeft())
    setInfo('Đã gửi! Hãy kiểm tra hộp thư (cả mục Spam) để lấy link đặt lại mật khẩu. Link chỉ dùng được một lần.')
  }

  const emailField = (
    <div className="field">
      <label htmlFor="email">Email</label>
      <div className="input-wrap">
        <Mail className="ico" size={18} />
        <input
          id="email"
          ref={emailRef}
          type="email"
          placeholder="ban@example.com"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
    </div>
  )

  const messages = (
    <>
      {error && (
        <div className="msg error" role="alert">
          <AlertCircle size={18} /> <span>{error}</span>
        </div>
      )}
      {info && (
        <div className="msg ok" role="status">
          <CheckCircle2 size={18} /> <span>{info}</span>
        </div>
      )}
    </>
  )

  if (mode === 'signup') {
    return (
      <AuthLayout>
        <h2 className="auth-title">Tạo tài khoản</h2>
        <p className="auth-sub">Sau khi tạo, admin sẽ duyệt và cấp quyền để bạn vào kho.</p>
        <form onSubmit={handleSignup} noValidate>
          <div className="field">
            <label htmlFor="display-name">Tên hiển thị</label>
            <div className="input-wrap">
              <User className="ico" size={18} />
              <input
                id="display-name"
                ref={nameRef}
                type="text"
                placeholder="Vd: Anh Tuấn"
                autoComplete="name"
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>
          {emailField}
          <NewPasswordFields
            idPrefix="su"
            password={password}
            confirm={confirm}
            onPassword={setPassword}
            onConfirm={setConfirm}
            submitted={submitted}
            Icon={Lock}
          />
          {messages}
          <button className="btn-primary" disabled={loading}>
            {loading ? <><Loader2 size={18} className="spin" /> Đang tạo...</> : 'Tạo tài khoản'}
          </button>
        </form>
        <div className="back-row">
          <button type="button" className="link-btn" onClick={() => switchMode('login')}>
            <ArrowLeft size={16} /> Đã có tài khoản? Đăng nhập
          </button>
        </div>
      </AuthLayout>
    )
  }

  if (mode === 'forgot') {
    return (
      <AuthLayout>
        <h2 className="auth-title">Quên mật khẩu?</h2>
        <p className="auth-sub">Nhập email của bạn, mình sẽ gửi link để đặt lại mật khẩu.</p>
        <form onSubmit={handleForgot}>
          {emailField}
          {messages}
          <button className="btn-primary" disabled={loading || waiting}>
            {loading ? (
              <><Loader2 size={18} className="spin" /> Đang gửi...</>
            ) : waiting ? (
              `Gửi lại sau ${wait} giây`
            ) : info ? (
              'Gửi lại link'
            ) : (
              'Gửi link đặt lại'
            )}
          </button>
        </form>
        <div className="back-row">
          <button type="button" className="link-btn" onClick={() => switchMode('login')}>
            <ArrowLeft size={16} /> Quay lại đăng nhập
          </button>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <h2 className="auth-title">Đăng nhập</h2>
      <p className="auth-sub">Rất vui được gặp lại bạn 👋</p>
      <form onSubmit={handleLogin}>
        {emailField}

        <div className="field">
          <label htmlFor="password">Mật khẩu</label>
          <div className="input-wrap">
            <Lock className="ico" size={18} />
            <input
              id="password"
              ref={passRef}
              type={showPass ? 'text' : 'password'}
              placeholder="••••••••"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="eye-btn"
              onClick={() => setShowPass((s) => !s)}
              aria-label={showPass ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
            >
              {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        <div className="row">
          <label className="check">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            Ghi nhớ email
          </label>
          <button type="button" className="link-btn" onClick={() => switchMode('forgot')}>
            Quên mật khẩu?
          </button>
        </div>

        {messages}

        <button className="btn-primary" disabled={loading}>
          {loading ? <><Loader2 size={18} className="spin" /> Đang đăng nhập...</> : 'Đăng nhập'}
        </button>
      </form>
      <div className="back-row">
        Chưa có tài khoản?{' '}
        <button type="button" className="link-btn" onClick={() => switchMode('signup')}>
          Tạo tài khoản
        </button>
      </div>
    </AuthLayout>
  )
}