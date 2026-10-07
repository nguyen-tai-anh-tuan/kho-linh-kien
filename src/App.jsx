import { useEffect, useState } from 'react'
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

  if (!ready) return <p>Đang tải...</p>
  if (recovery && session) return <ResetPassword onDone={() => setRecovery(false)} />
  return session ? <Dashboard session={session} /> : <Login />
}