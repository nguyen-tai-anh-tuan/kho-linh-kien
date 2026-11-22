import { useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useData } from '../data/DataContext'
import { useShell } from '../ShellContext'
import { useUndoTx } from '../TxContext'
import { useToast } from './Toast'
import { friendlyError } from '../lib/api'
import { fmtNum } from '../lib/format'
import { StockBar } from './common'

/**
 * Tồn kho trong bảng Linh kiện, bấm ✏️ để kiểm kê nhanh tại chỗ (Enter lưu, Esc hủy).
 * Ghi thành MỘT giao dịch "Điều chỉnh" (giống ô Nhập/xuất → Điều chỉnh): tồn tại vị trí đó
 * được đặt đúng bằng số đếm được. Số trùng với tồn hiện tại vẫn được ghi ("Kiểm kê (khớp)")
 * để biết món đó vừa được kiểm kê.
 *
 * Tồn tính theo từng vị trí: món ở 1 chỗ thì sửa luôn chỗ đó; ở nhiều chỗ thì chọn vị trí;
 * chưa ở đâu thì lấy chỗ cất mặc định, chưa có nữa thì chọn trong mọi vị trí.
 */
export function StockEdit({ comp, preferLocation }) {
  const { stockByComponent, stockMap, homeOf, locations, locationsById, reload } = useData()
  const { canEdit } = useShell()
  const toast = useToast()
  const undo = useUndoTx()
  const [edit, setEdit] = useState(null) // { locationId, value, saving, error }

  const bar = <StockBar qty={comp.total_quantity} min={comp.min_stock} status={comp.status} />
  if (!canEdit || comp.archived_at) return bar

  const where = stockByComponent.get(comp.id) ?? []
  // Các vị trí được chọn: chỗ đang có hàng; chưa có ở đâu thì mọi vị trí
  const options = where.length > 0 ? where.map((w) => ({ id: w.location_id, path: w.path })) : locations.map((l) => ({ id: l.id, path: l.path }))
  const qtyAt = (locId) => (locId ? (stockMap.get(`${comp.id}|${locId}`) ?? 0) : 0)

  // Bảng có hàng bấm để mở chi tiết: thao tác trong ô này không được mở theo
  const stop = (e) => e.stopPropagation()

  function open(e) {
    stop(e)
    const first =
      (preferLocation && where.some((w) => w.location_id === preferLocation) && preferLocation) ||
      where[0]?.location_id ||
      homeOf.get(comp.id) ||
      ''
    setEdit({ locationId: first, value: first ? String(qtyAt(first)) : '', saving: false, error: '' })
  }

  async function submit(e) {
    e.preventDefault()
    if (edit.saving) return
    if (!edit.locationId) return setEdit((s) => ({ ...s, error: 'Chọn vị trí đã đếm.' }))
    const n = Number(edit.value)
    if (edit.value.trim() === '' || !Number.isInteger(n) || n < 0) {
      return setEdit((s) => ({ ...s, error: 'Nhập số đếm được (0 trở lên).' }))
    }
    setEdit((s) => ({ ...s, saving: true, error: '' }))
    const { data, error } = await supabase
      .from('transactions')
      .insert({ component_id: comp.id, location_id: edit.locationId, type: 'adjust', quantity: n, note: 'Kiểm kê nhanh' })
      .select('id,component_id,location_id,type,quantity,delta')
    if (error) return setEdit((s) => (s ? { ...s, saving: false, error: friendlyError(error) } : s))

    await reload()
    setEdit(null)
    const d = Number(data?.[0]?.delta ?? n - qtyAt(edit.locationId))
    const place = locationsById.get(edit.locationId)?.name ?? ''
    toast.push(
      d === 0
        ? { message: `${comp.part_number}: đã kiểm kê ${place}, khớp ${fmtNum(n)} cái.` }
        : {
            message: `${comp.part_number}: kiểm kê ${place} còn ${fmtNum(n)} cái (${d > 0 ? '+' : '−'}${fmtNum(Math.abs(d))}).`,
            action: { label: 'Hoàn tác', onClick: () => undo(data) },
          },
    )
  }

  if (edit) {
    const cur = qtyAt(edit.locationId)
    const n = Number(edit.value)
    const valid = edit.locationId && edit.value.trim() !== '' && Number.isInteger(n) && n >= 0
    const d = valid ? n - cur : null
    const needPick = options.length > 1 || !edit.locationId
    return (
      <form className="kk-price-form is-start kk-stock-form" onSubmit={submit} onClick={stop}>
        {needPick && (
          <select
            aria-label={`Vị trí kiểm kê ${comp.part_number}`}
            value={edit.locationId}
            disabled={edit.saving}
            onChange={(e) => setEdit((s) => ({ ...s, locationId: e.target.value, value: String(qtyAt(e.target.value)), error: '' }))}
            onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setEdit(null))}
          >
            {!edit.locationId && <option value="">Chọn vị trí…</option>}
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.path} (tồn {fmtNum(qtyAt(o.id))})
              </option>
            ))}
          </select>
        )}
        <span className="kk-price-row">
          <input
            autoFocus
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            aria-label={`Số đếm được của ${comp.part_number}`}
            placeholder="Số đếm"
            value={edit.value}
            disabled={edit.saving}
            aria-invalid={edit.error ? true : undefined}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setEdit((s) => ({ ...s, value: e.target.value, error: '' }))}
            onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setEdit(null))}
          />
          <button type="submit" className="kk-icon-btn kk-icon-btn-ok" aria-label="Lưu kiểm kê" title="Lưu (Enter)" disabled={edit.saving}>
            {edit.saving ? <Loader2 size={16} className="kk-spin" /> : <Check size={16} />}
          </button>
          <button type="button" className="kk-icon-btn kk-icon-btn-cancel" aria-label="Hủy" title="Hủy (Esc)" disabled={edit.saving} onClick={() => setEdit(null)}>
            <X size={16} />
          </button>
        </span>
        {edit.error ? (
          <span className="kk-form-error" role="alert">
            {edit.error}
          </span>
        ) : (
          d !== null && (
            <span className={`kk-stock-delta ${d > 0 ? 'is-up' : d < 0 ? 'is-down' : ''}`}>
              {d === 0 ? `Khớp, đang có ${fmtNum(cur)}` : `${d > 0 ? '+' : '−'}${fmtNum(Math.abs(d))} so với ${fmtNum(cur)}`}
            </span>
          )
        )}
      </form>
    )
  }

  return <StockBar qty={comp.total_quantity} min={comp.min_stock} status={comp.status} onEdit={open} editLabel={comp.part_number} />
}
