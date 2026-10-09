import { useCallback, useEffect, useState } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { authLanding, resetAfterSignOut, supabase } from './supabaseClient'
import { isRecoveryPending, setRecoveryPending } from './lib/auth'
import { friendlyError, isMissingSchema } from './lib/api'
import { canEnter } from './lib/roles'
import Login from './Login'
import ResetPassword from './ResetPassword'
import WaitingRoom from './WaitingRoom'
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
        if (resetAfterSignOut()) window.location.reload()
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
        <Account key={session.user.id} session={session} />
      ) : (
        <Login linkExpired={authLanding.linkError} />
      )}
    </BrowserRouter>
  )
}

/** Tải hồ sơ (tên + vai trò) của người đang đăng nhập rồi quyết định cho vào kho hay cho chờ */
function Account({ session }) {
  const userId = session.user.id
  const [state, setState] = useState({ status: 'loading', profile: null, error: '' })
  const [attempt, setAttempt] = useState(0)
  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  useEffect(() => {
    let off = false
    supabase
      .from('profiles')
      .select('id,email,display_name,role')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (off) return
        if (error && isMissingSchema(error)) {
          // Chưa chạy sql/04_roles.sql: database chưa phân quyền, app chạy như trước đây
          return setState({ status: 'ready', profile: { id: userId, display_name: '', role: 'admin', legacy: true }, error: '' })
        }
        if (error) return setState((s) => (s.profile ? s : { status: 'error', profile: null, error: friendlyError(error) }))
        setState({ status: 'ready', profile: data ?? { id: userId, display_name: '', role: 'pending' }, error: '' })
      })
    return () => {
      off = true
    }
  }, [userId, attempt])

  if (state.status === 'loading') return <div className="app-boot">Đang tải…</div>

  const email = session.user.email ?? ''
  if (state.status === 'error') {
    return <WaitingRoom variant="error" email={email} error={state.error} onRefresh={reload} />
  }
  const { profile } = state
  if (!canEnter(profile.role)) {
    return (
      <WaitingRoom
        variant={profile.role === 'blocked' ? 'blocked' : 'pending'}
        name={profile.display_name}
        email={email}
        onRefresh={reload}
      />
    )
  }
  return <Dashboard session={session} profile={profile} reloadProfile={reload} />
}
