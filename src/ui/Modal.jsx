import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

// Ngăn xếp các cửa sổ đang mở: chỉ cửa sổ trên cùng nhận phím Esc / Tab
const stack = []

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * variant="modal": cửa sổ nổi ở giữa.  variant="drawer": ngăn kéo trượt từ bên phải.
 * Phần tử có thuộc tính data-autofocus sẽ nhận focus đầu tiên.
 */
export function Modal({ title, subtitle, onClose, children, footer, size = 'md', variant = 'modal', headerExtra }) {
  const ref = useRef(null)
  const titleId = useId()
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    const id = Symbol('modal')
    stack.push(id)
    const previouslyFocused = document.activeElement
    const node = ref.current
    document.body.style.overflow = 'hidden'

    const visibleFocusables = () =>
      [...node.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement)

    if (!node.contains(document.activeElement)) {
      const target = node.querySelector('[data-autofocus]') || visibleFocusables()[0] || node
      target.focus()
    }

    function onKey(e) {
      if (stack[stack.length - 1] !== id) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
      } else if (e.key === 'Tab') {
        const items = visibleFocusables()
        if (items.length === 0) {
          e.preventDefault()
          return
        }
        const first = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
      stack.splice(stack.indexOf(id), 1)
      if (stack.length === 0) document.body.style.overflow = ''
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus()
    }
  }, [])

  return createPortal(
    <div
      className={`kk-portal kk-backdrop kk-backdrop-${variant}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeRef.current()
      }}
    >
      <div
        ref={ref}
        className={`kk-dialog kk-dialog-${variant} kk-size-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="kk-dialog-head">
          <div className="kk-dialog-titles">
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {headerExtra}
          <button type="button" className="kk-icon-btn" aria-label="Đóng" onClick={() => closeRef.current()}>
            <X size={20} />
          </button>
        </header>
        <div className="kk-dialog-body">{children}</div>
        {footer && <footer className="kk-dialog-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}
