import { useState } from 'react'
import { AlertTriangle, Check, Circle, Eye, EyeOff } from 'lucide-react'
import { checkPassword, passwordProblems } from '../lib/auth'
import './password.css'

/** Một ô mật khẩu có nút hiện/ẩn, cảnh báo Caps Lock và chỗ báo lỗi ngay dưới ô */
export function PasswordInput({
  id,
  label,
  value,
  onChange,
  autoComplete,
  show,
  onToggleShow,
  error,
  Icon,
  autoFocus,
  onBlur,
  children,
}) {
  const [caps, setCaps] = useState(false)
  const readCaps = (e) => setCaps(Boolean(e.getModifierState?.('CapsLock')))

  return (
    <div className="pw-field">
      <label htmlFor={id}>{label}</label>
      <div className={`pw-wrap ${Icon ? 'has-ico' : ''}`}>
        {Icon && <Icon className="pw-ico" size={18} aria-hidden="true" />}
        <input
          id={id}
          className="pw-input"
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={readCaps}
          onKeyUp={readCaps}
          onBlur={(e) => {
            setCaps(false)
            onBlur?.(e)
          }}
        />
        {onToggleShow && (
          <button type="button" className="pw-eye" onClick={onToggleShow} aria-label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>
            {show ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
      </div>
      {caps && (
        <p className="pw-note pw-caps" role="status">
          <AlertTriangle size={14} aria-hidden="true" />
          Caps Lock đang bật
        </p>
      )}
      {error && (
        <p className="pw-note pw-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
      {children}
    </div>
  )
}

/**
 * Cặp ô "mật khẩu mới" + "nhập lại" kèm thanh độ mạnh, dùng cho cả trang đặt lại mật khẩu lẫn trang Cài đặt.
 * Lỗi của từng ô hiện ngay khi rời ô; submitted = true thì hiện hết (người dùng vừa bấm Lưu).
 */
export function NewPasswordFields({ idPrefix, password, confirm, onPassword, onConfirm, submitted, Icon, autoFocus }) {
  const [show, setShow] = useState(false)
  const [touched, setTouched] = useState({ password: false, confirm: false })
  const strength = checkPassword(password)
  const problems = passwordProblems(password, confirm)
  const touch = (key) => () => setTouched((t) => ({ ...t, [key]: true }))

  return (
    <>
      <PasswordInput
        id={`${idPrefix}-new`}
        label="Mật khẩu mới"
        value={password}
        onChange={onPassword}
        autoComplete="new-password"
        show={show}
        onToggleShow={() => setShow((s) => !s)}
        error={(submitted || (touched.password && password !== '')) && problems.password}
        Icon={Icon}
        autoFocus={autoFocus}
        onBlur={touch('password')}
      >
        <div className="pw-meter" data-score={strength.score}>
          <span className="pw-bars" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="pw-meter-label" aria-live="polite">
            {strength.label}
          </span>
        </div>
        <ul className="pw-rules" aria-label="Điều kiện của mật khẩu">
          {strength.rules.map((r) => (
            <li key={r.key} className={r.met ? 'is-met' : ''}>
              {r.met ? <Check size={14} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />}
              {r.text}
              <span className="pw-sr">{r.met ? ' (đã đạt)' : ' (chưa đạt)'}</span>
            </li>
          ))}
        </ul>
      </PasswordInput>

      <PasswordInput
        id={`${idPrefix}-confirm`}
        label="Nhập lại mật khẩu mới"
        value={confirm}
        onChange={onConfirm}
        autoComplete="new-password"
        show={show}
        error={(submitted || (touched.confirm && confirm !== '')) && problems.confirm}
        Icon={Icon}
        onBlur={touch('confirm')}
      />
    </>
  )
}
