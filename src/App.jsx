import { useEffect, useState } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { supabase } from './supabaseClient'
import Login from './Login'
import ResetPassword from './ResetPassword'
import Dashboard from './Dashboard'
import './App.css'

export default function App() {
  const [session, setSession] = useState(null)
  const [ready, setReady] = useState(false)
  const [recovery, setRecovery] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
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
        <Login />
      )}
    </BrowserRouter>
  )
}
