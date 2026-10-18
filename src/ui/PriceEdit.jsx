import { useState } from 'react'
import { Check, Loader2, Pencil, X } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useData } from '../data/DataContext'
import { useShell } from '../ShellContext'
import { useToast } from './Toast'
import { friendlyError, mustChange } from '../lib/api'
import { parseNumber } from '../lib/csv'
import { fmtPrice } from '../lib/format'

/**
 * Ô đơn giá bấm vào là sửa ngay tại chỗ (Enter lưu, Esc hủy, để trống là xóa giá).
 * option = { label, defaultChecked }: thêm một ô tick, giá trị của nó truyền vào onSave(price, checked).
 * align = 'end' trong cột số của bảng, 'start' trong khung chi tiết.
 */
export function InlinePrice({ value, canEdit, label, onSave, option, note, align = 'end' }) {
  const [edit, setEdit] = useState(null) // { value, checked, saving, error }

  if (!canEdit) return fmtPrice(value)

  async function submit(e) {
    e.preventDefault()
    if (edit.saving) return
    const price = edit.value.trim() === '' ? null : parseNumber(edit.value)
    if (price !== null && (Number.isNaN(price) || price < 0)) {
      setEdit((s) => ({ ...s, error: 'Nhập số tiền hợp lệ, vd 3500.' }))
      return
    }
    setEdit((s) => ({ ...s, saving: true, error: '' }))
    try {
      await onSave(price, edit.checked)
      setEdit(null)
    } catch (err) {
      setEdit((s) => (s ? { ...s, saving: false, error: friendlyError(err) } : s))
    }
  }

  // Bảng có hàng bấm để mở chi tiết: thao tác trong ô này không được mở theo
  const stop = (e) => e.stopPropagation()

  if (edit) {
    return (
      <form className={`kk-price-form is-${align}`} onSubmit={submit} onClick={stop}>
        <span className="kk-price-row">
          <input
            autoFocus
            inputMode="decimal"
            aria-label={`Đơn giá ${label} (đ)`}
            placeholder="Vd: 3500"
            value={edit.value}
            disabled={edit.saving}
            aria-invalid={edit.error ? true : undefined}
            onChange={(e) => setEdit((s) => ({ ...s, value: e.target.value, error: '' }))}
            onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setEdit(null))}
          />
          <button type="submit" className="kk-icon-btn" aria-label="Lưu đơn giá" title="Lưu (Enter)" disabled={edit.saving}>
            {edit.saving ? <Loader2 size={16} className="kk-spin" /> : <Check size={16} />}
          </button>
          <button type="button" className="kk-icon-btn" aria-label="Hủy" title="Hủy (Esc)" disabled={edit.saving} onClick={() => setEdit(null)}>
            <X size={16} />
          </button>
        </span>
        {option && (
          <label className="kk-price-sync">
            <input
              type="checkbox"
              checked={edit.checked}
              disabled={edit.saving}
              onChange={(e) => setEdit((s) => ({ ...s, checked: e.target.checked }))}
            />
            {option.label}
          </label>
        )}
        {edit.error && (
          <span className="kk-form-error" role="alert">
            {edit.error}
          </span>
        )}
      </form>
    )
  }

  const empty = value === null || value === undefined || value === ''
  return (
    <>
      <button
        type="button"
        className={`kk-price ${empty ? 'is-empty' : ''}`}
        title={empty ? 'Thêm đơn giá' : 'Bấm để sửa đơn giá'}
        onClick={(e) => {
          stop(e)
          setEdit({ value: empty ? '' : String(Number(value)), checked: option?.defaultChecked ?? false, saving: false, error: '' })
        }}
      >
        {empty ? '+ Thêm giá' : fmtPrice(value)}
        <Pencil size={12} aria-hidden="true" />
      </button>
      {note}
    </>
  )
}

/** Đơn giá của một linh kiện trong kho, sửa tại chỗ (dùng ở trang Linh kiện, Cần mua, khung chi tiết) */
export function ComponentPrice({ comp, align }) {
  const { reload } = useData()
  const { canEdit } = useShell()
  const toast = useToast()
  const price = Number(comp.unit_price) > 0 ? Number(comp.unit_price) : null

  async function save(next) {
    mustChange(await supabase.from('components').update({ unit_price: next }).eq('id', comp.id).select('id'))
    await reload()
    toast.push({ message: next === null ? `Đã xóa đơn giá của ${comp.part_number}.` : `Đã lưu đơn giá ${fmtPrice(next)} cho ${comp.part_number}.` })
  }

  return <InlinePrice value={price} canEdit={canEdit} label={comp.part_number} onSave={save} align={align} />
}
