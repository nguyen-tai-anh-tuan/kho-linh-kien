import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, AlertCircle, X } from 'lucide-react'

const ToastContext = createContext(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast phải dùng bên trong ToastProvider')
  return ctx
}

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const idRef = useRef(0)

  const dismiss = useCallback((id) => setItems((list) => list.filter((t) => t.id !== id)), [])

  const push = useCallback(
    ({ tone = 'ok', message, action, duration = 6500 }) => {
      const id = ++idRef.current
      setItems((list) => [...list.slice(-2), { id, tone, message, action }])
      if (duration) setTimeout(() => dismiss(id), duration)
      return id
    },
    [dismiss],
  )

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="kk-portal kk-toasts" role="status" aria-live="polite">
          {items.map((t) => (
            <div key={t.id} className={`kk-toast kk-toast-${t.tone}`}>
              {t.tone === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
              <span className="kk-toast-msg">{t.message}</span>
              {t.action && (
                <button
                  type="button"
                  className="kk-toast-action"
                  onClick={() => {
                    dismiss(t.id)
                    t.action.onClick()
                  }}
                >
                  {t.action.label}
                </button>
              )}
              <button type="button" className="kk-toast-x" aria-label="Đóng thông báo" onClick={() => dismiss(t.id)}>
                <X size={16} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}
