import { useEffect, useState } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { authLanding, supabase } from './supabaseClient'
import { isRecoveryPending, setRecoveryPending } from './lib/auth'
import Login from './Login'
import ResetPassword from './ResetPassword'
import Dashboard from './Dashboard'
import './App.css'

export default function App() {
  const [session, setSession] = useState(null)
  const [ready, setReady] = useState(false)
  // Nhớ cả qua lần tải lại trang: chưa đặt xong mật khẩu mới thì chưa cho vào Dashboard
  const [recovery, setRecovery] = useState(() => authLanding.recovery || isRecoveryPending())

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) {
        // Phiên đã hết: lần đăng nhập bình thường sau đó không bị bắt đặt lại mật khẩu
        setRecoveryPending(false)
        setRecovery(false)
      }
      setReady(true)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryPending(true)
        setRecovery(true)
      } else if (event === 'SIGNED_OUT') {
        setRecoveryPending(false)
        setRecovery(false)
      }
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  if (!ready) return <div className="app-boot">Đang tải…</div>

  return (
    <BrowserRouter>
      {recovery && session ? (
        <ResetPassword onDone={() => setRecovery(false)} />
      ) : session ? (
        <Dashboard session={session} />
      ) : (
        <Login linkExpired={authLanding.linkError} />
      )}
    </BrowserRouter>
  )
}
