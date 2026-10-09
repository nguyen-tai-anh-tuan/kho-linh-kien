import { useEffect, useState } from 'react'
import { AlertCircle, Clock, Loader2, LogOut, RefreshCw, ShieldOff } from 'lucide-react'
import { supabase } from './supabaseClient'
import AuthLayout from './AuthLayout'

const COPY = {
  pending: {
    title: 'Đang chờ admin duyệt',
    text: 'Tài khoản của bạn đã được tạo. Khi admin cấp quyền, bạn sẽ vào được kho. Trang này tự kiểm tra lại sau mỗi 20 giây.',
    Icon: Clock,
    tone: 'ok',
  },
  blocked: {
    title: 'Tài khoản đã bị khóa',
    text: 'Admin đã khóa tài khoản này nên bạn không vào được kho. Hãy liên hệ admin nếu bạn nghĩ đây là nhầm lẫn.',
    Icon: ShieldOff,
    tone: 'error',
  },
  error: {
    title: 'Chưa tải được tài khoản',
    text: '',
    Icon: AlertCircle,
    tone: 'error',
  },
}

/** Màn hình cho người đã đăng nhập nhưng chưa vào được kho: chờ duyệt, bị khóa, hoặc lỗi tải hồ sơ */
export default function WaitingRoom({ variant, name, email, error, onRefresh }) {
  const [checking, setChecking] = useState(false)
  const copy = COPY[variant] ?? COPY.pending

  // Chờ duyệt thì tự hỏi lại định kỳ, để vừa được duyệt là vào được ngay
  useEffect(() => {
    if (variant !== 'pending') return
    const timer = setInterval(onRefresh, 20000)
    return () => clearInterval(timer)
  }, [variant, onRefresh])

  function check() {
    setChecking(true)
    onRefresh()
    setTimeout(() => setChecking(false), 1200)
  }

  return (
    <AuthLayout>
      <h2 className="auth-title">{copy.title}</h2>
      <p className="auth-sub">{name ? `Chào ${name}. ` : ''}{copy.text || error}</p>
      <div className={`msg ${copy.tone}`} role="status">
        <copy.Icon size={18} /> <span>Đang đăng nhập bằng {email}</span>
      </div>
      {variant !== 'blocked' && (
        <button type="button" className="btn-primary" onClick={check} disabled={checking}>
          {checking ? <Loader2 size={18} className="spin" /> : <RefreshCw size={18} />}
          {variant === 'error' ? 'Thử lại' : 'Kiểm tra lại'}
        </button>
      )}
      <div className="back-row">
        <button type="button" className="link-btn" onClick={() => supabase.auth.signOut()}>
          <LogOut size={16} /> Đăng xuất
        </button>
      </div>
    </AuthLayout>
  )
}
