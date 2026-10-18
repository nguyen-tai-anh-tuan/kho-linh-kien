import { useState } from 'react'
import { Check, Loader2, Pencil, X } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useData } from '../data/DataContext'
import { useShell } from '../ShellContext'
import { useToast } from './Toast'
import { friendlyError, mustChange } from '../lib/api'
import { parseNumber } from '../lib/csv'
import { fmtPrice } from '../lib/format'
import { fmtUnitPrice, packNote, packOf, packPrice } from '../lib/price'

/**
 * Ô đơn giá bấm vào là sửa ngay tại chỗ (Enter lưu, Esc hủy, để trống là xóa giá).
 * option = { label, defaultChecked }: thêm một ô tick, giá trị của nó truyền vào onSave(price, checked).
 * align = 'end' trong cột số của bảng, 'start' trong khung chi tiết.
 * pack = { unit, qty }: món tính giá theo hộp / bộ. value và onSave vẫn là giá MỘT CÁI,
 * còn ô hiện và ô nhập là giá một hộp (tự nhân / chia qty).
 */
export function InlinePrice({ value, canEdit, label, onSave, option, note, align = 'end', pack }) {
  const [edit, setEdit] = useState(null) // { value, checked, saving, error }
  const shown = packPrice(value, pack)
  const packTitle = pack ? packNote(value, pack) : ''

  if (!canEdit) {
    return (
      <span className="kk-price-static" title={packTitle || undefined}>
        {fmtUnitPrice(value, pack)}
      </span>
    )
  }

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
      await onSave(price === null || !pack ? price : price / pack.qty, edit.checked)
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
            aria-label={`Đơn giá ${label}${pack ? ` một ${pack.unit}` : ''} (đ)`}
            placeholder="Vd: 3500"
            value={edit.value}
            disabled={edit.saving}
            aria-invalid={edit.error ? true : undefined}
            onChange={(e) => setEdit((s) => ({ ...s, value: e.target.value, error: '' }))}
            onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setEdit(null))}
          />
          <button type="submit" className="kk-icon-btn kk-icon-btn-ok" aria-label="Lưu đơn giá" title="Lưu (Enter)" disabled={edit.saving}>
            {edit.saving ? <Loader2 size={16} className="kk-spin" /> : <Check size={16} />}
          </button>
          <button type="button" className="kk-icon-btn kk-icon-btn-cancel" aria-label="Hủy" title="Hủy (Esc)" disabled={edit.saving} onClick={() => setEdit(null)}>
            <X size={16} />
          </button>
        </span>
        {pack && <span className="kk-price-unit-hint">đ / {pack.unit} {pack.qty > 1 ? `(${pack.qty} cái)` : ''}</span>}
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

  const empty = shown === null
  return (
    <>
      <button
        type="button"
        className={`kk-price ${empty ? 'is-empty' : ''}`}
        title={empty ? 'Thêm đơn giá' : `Bấm để sửa đơn giá${packTitle ? `
${packTitle}` : ''}`}
        onClick={(e) => {
          stop(e)
          setEdit({ value: empty ? '' : String(shown), checked: option?.defaultChecked ?? false, saving: false, error: '' })
        }}
      >
        {empty ? '+ Thêm giá' : fmtPrice(shown)}
        {pack && !empty && <small className="kk-price-per">/{pack.unit}</small>}
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
  const pack = packOf(comp)

  async function save(next) {
    mustChange(await supabase.from('components').update({ unit_price: next }).eq('id', comp.id).select('id'))
    await reload()
    toast.push({
      message: next === null ? `Đã xóa đơn giá của ${comp.part_number}.` : `Đã lưu đơn giá ${fmtUnitPrice(next, pack)} cho ${comp.part_number}.`,
    })
  }

  return (
    <InlinePrice
      value={price}
      canEdit={canEdit}
      label={comp.part_number}
      onSave={save}
      align={align}
      pack={pack}
      // Khung chi tiết đủ chỗ thì ghi rõ một hộp bao nhiêu cái
      note={align === 'start' && pack ? <small className="kk-price-note">{packNote(price, pack)}</small> : null}
    />
  )
}
