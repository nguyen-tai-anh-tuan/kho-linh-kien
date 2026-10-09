import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Modal } from './Modal'
import { Field } from './common'
import { friendlyError } from '../lib/api'

/** Hỏi lại trước khi làm việc không hoàn tác được. onConfirm có thể là hàm async, lỗi sẽ hiện ngay trong hộp. */
export function ConfirmDialog({ title, text, confirmLabel, Icon, danger = true, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await onConfirm()
      onClose()
    } catch (e) {
      setError(friendlyError(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="kk-btn kk-btn-ghost" data-autofocus onClick={onClose} disabled={busy}>
            Giữ lại
          </button>
          <button type="button" className={`kk-btn ${danger ? 'kk-btn-danger' : 'kk-btn-primary'}`} onClick={run} disabled={busy}>
            {busy ? <Loader2 size={18} className="kk-spin" /> : Icon ? <Icon size={18} /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="kk-confirm-text">{text}</p>
      {error && (
        <p className="kk-form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}

/** Hộp nhập một cái tên (thêm mới hoặc đổi tên). validate trả về câu báo lỗi hoặc chuỗi rỗng. */
export function NameDialog({ title, subtitle, label, initial = '', placeholder, submitLabel, validate, onSubmit, onClose }) {
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(ev) {
    ev.preventDefault()
    if (busy) return
    const clean = name.trim()
    const problem = !clean ? 'Hãy nhập tên.' : (validate?.(clean) ?? '')
    if (problem) return setError(problem)
    setBusy(true)
    setError('')
    try {
      await onSubmit(clean)
      onClose()
    } catch (e) {
      setError(friendlyError(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="kk-btn kk-btn-ghost" onClick={onClose} disabled={busy}>
            Hủy
          </button>
          <button type="submit" form="name-dialog" className="kk-btn kk-btn-primary" disabled={busy}>
            {busy && <Loader2 size={18} className="kk-spin" />}
            {submitLabel}
          </button>
        </>
      }
    >
      <form id="name-dialog" onSubmit={submit} noValidate>
        <Field label={label} htmlFor="name-dialog-input" error={error}>
          <input
            id="name-dialog-input"
            data-autofocus
            value={name}
            maxLength={80}
            placeholder={placeholder}
            aria-invalid={error ? true : undefined}
            onChange={(e) => {
              setName(e.target.value)
              setError('')
            }}
          />
        </Field>
      </form>
    </Modal>
  )
}
