import { useMemo, useState } from 'react'
import { ArrowRightLeft, Loader2, Plus, Trash2 } from 'lucide-react'
import { useData } from './data/DataContext'
import { useToast } from './ui/Toast'
import { Modal } from './ui/Modal'
import { ComponentPicker, Field, QtyStepper, SelectWithCreate } from './ui/common'
import { friendlyError } from './lib/api'
import { fmtNum } from './lib/format'
import { moveStock, setHome } from './lib/moves'
import './moves.css'

let seq = 0
const newLine = (componentId = null, fromLocationId = null, qty = '') => ({ id: ++seq, componentId, fromLocationId, qty })

/** Ngăn nhiều hàng nhất của linh kiện (trừ ngăn đích) */
function bestFrom(stockByComponent, componentId, dest) {
  const have = (stockByComponent.get(componentId) ?? []).filter((s) => s.location_id !== dest)
  return [...have].sort((a, b) => b.quantity - a.quantity)[0] ?? null
}

/**
 * Hộp thoại chuyển vị trí.
 * lines: [{ componentId, fromLocationId?, qty? }]  (trống = tự chọn ngăn nhiều hàng nhất, chuyển hết)
 * toLocationId: ngăn đích chọn sẵn (vd mở từ trang Vị trí "Chuyển hàng vào đây")
 */
export default function MoveDialog({ lines: initialLines = [], toLocationId = null, onClose }) {
  const { componentsById, locations, locationsById, stockMap, stockByComponent, createLocation, reload, homeOf, moves } = useData()
  const toast = useToast()
  const [dest, setDest] = useState(toLocationId)
  const [lines, setLines] = useState(() => {
    const out = initialLines.map((l) => {
      const from = l.fromLocationId ?? bestFrom(stockByComponent, l.componentId, toLocationId)?.location_id ?? null
      const have = from ? (stockMap.get(`${l.componentId}|${from}`) ?? 0) : 0
      return newLine(l.componentId, from, l.qty ?? (have > 0 ? have : ''))
    })
    return out.length ? out : [newLine()]
  })
  const [note, setNote] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  /* ---- kiểm tra từng dòng, tính trước số lượng sau khi chuyển ---- */
  const sim = useMemo(() => {
    const used = new Map() // (linh kiện|ngăn cũ) -> đã lấy ở các dòng trước
    const added = new Map() // linh kiện -> đã thêm vào ngăn đích ở các dòng trước
    return lines.map((l) => {
      if (!l.componentId) return { state: 'empty' }
      const comp = componentsById.get(l.componentId)
      if (!comp) return { state: 'empty' }
      const errors = []
      const options = stockByComponent.get(l.componentId) ?? []
      if (options.length === 0) errors.push('Món này chưa có hàng ở vị trí nào nên không có gì để chuyển.')
      else if (!l.fromLocationId) errors.push('Chọn ngăn đang chứa hàng.')
      if (dest && l.fromLocationId === dest) errors.push('Ngăn đang chứa trùng với ngăn chuyển đến.')
      const q = l.qty === '' ? NaN : Number(l.qty)
      if (!(q >= 1)) errors.push('Nhập số lượng lớn hơn 0.')
      if (errors.length) return { state: 'incomplete', errors }

      const key = `${l.componentId}|${l.fromLocationId}`
      const have = (stockMap.get(key) ?? 0) - (used.get(key) ?? 0)
      if (q > have) return { state: 'invalid', errors: [`Ngăn này chỉ còn ${fmtNum(have)}, không chuyển được ${fmtNum(q)}.`] }
      used.set(key, (used.get(key) ?? 0) + q)
      const destBefore = dest ? (stockMap.get(`${l.componentId}|${dest}`) ?? 0) + (added.get(l.componentId) ?? 0) : 0
      added.set(l.componentId, (added.get(l.componentId) ?? 0) + q)
      return { state: 'ok', q, fromBefore: have, fromAfter: have - q, destBefore, destAfter: destBefore + q }
    })
  }, [lines, dest, componentsById, stockByComponent, stockMap])

  const okLines = sim.filter((s) => s.state === 'ok')
  const totalQty = okLines.reduce((n, s) => n + s.q, 0)

  const patchLine = (id, patch) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)))

  function changeComponent(line, id) {
    const from = id ? bestFrom(stockByComponent, id, dest) : null
    patchLine(line.id, { componentId: id, fromLocationId: from?.location_id ?? null, qty: from ? from.quantity : '' })
  }

  function changeFrom(line, from) {
    const have = from ? (stockMap.get(`${line.componentId}|${from}`) ?? 0) : 0
    // Đổi ngăn thì mặc định chuyển hết số đang có ở ngăn đó
    patchLine(line.id, { fromLocationId: from, qty: have > 0 ? have : '' })
  }

  async function submit() {
    if (busy) return
    setAttempted(true)
    setError('')
    if (!dest) return setError('Hãy chọn ngăn chuyển đến.')
    const bad = sim.filter((s) => s.state === 'incomplete' || s.state === 'invalid').length
    if (bad > 0) return setError(`Còn ${bad} dòng cần sửa trước khi chuyển.`)
    const pairs = lines.map((l, i) => ({ l, s: sim[i] })).filter(({ s }) => s.state === 'ok')
    if (pairs.length === 0) return setError('Hãy chọn ít nhất một linh kiện.')

    const payload = pairs.map(({ l }) => ({
      component_id: l.componentId,
      from_location_id: l.fromLocationId,
      to_location_id: dest,
      quantity: Number(l.qty),
    }))
    setBusy(true)
    try {
      await moveStock(payload, note)
      // Chỗ cất mặc định "đi theo" hàng: món đang cất ở ngăn cũ và đã chuyển hết khỏi đó thì đổi sang ngăn mới
      if (moves.homesReady) {
        const follow = pairs
          .filter(({ l, s }) => homeOf.get(l.componentId) === l.fromLocationId && s.fromAfter === 0)
          .map(({ l }) => l.componentId)
        if (follow.length) await setHome([...new Set(follow)], dest).catch(() => {})
      }
      await reload()
      const destPath = locationsById.get(dest)?.path ?? 'ngăn mới'
      toast.push({
        message: `Đã chuyển ${fmtNum(payload.length)} dòng, ${fmtNum(totalQty)} cái đến ${destPath}.`,
        action: {
          label: 'Hoàn tác',
          onClick: async () => {
            try {
              await moveStock(
                payload.map((m) => ({ ...m, from_location_id: m.to_location_id, to_location_id: m.from_location_id })),
                'Hoàn tác lần chuyển trước',
              )
              await reload()
              toast.push({ message: 'Đã hoàn tác lần chuyển vị trí.' })
            } catch (e) {
              toast.push({ tone: 'error', message: `Không hoàn tác được. ${friendlyError(e)}`, duration: 9000 })
            }
          },
        },
      })
      onClose()
    } catch (e) {
      setError(friendlyError(e))
      setBusy(false)
    }
  }

  const destOptions = locations.map((l) => ({ value: l.id, label: l.path }))

  return (
    <Modal
      title="Chuyển vị trí"
      subtitle="Đưa hàng từ ngăn này sang ngăn khác. Tổng tồn kho giữ nguyên, không tính là nhập hay xuất."
      size="lg"
      onClose={onClose}
      footer={
        <>
          <span className="kk-foot-note" aria-live="polite">
            {okLines.length > 0 ? `${fmtNum(okLines.length)} dòng, ${fmtNum(totalQty)} cái sẵn sàng` : 'Chưa có dòng nào hợp lệ'}
          </span>
          <button type="button" className="kk-btn kk-btn-ghost" onClick={onClose}>
            Hủy
          </button>
          <button type="button" className="kk-btn kk-btn-primary" onClick={submit} disabled={busy}>
            {busy ? <Loader2 size={18} className="kk-spin" /> : <ArrowRightLeft size={18} />}
            {busy ? 'Đang chuyển…' : 'Chuyển'}
          </button>
        </>
      }
    >
      <div
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault()
            submit()
          }
        }}
      >
        <div className="kk-mv-dest">
          <Field label="Chuyển đến ngăn" htmlFor="mv-dest" error={attempted && !dest ? 'Hãy chọn ngăn chuyển đến.' : ''}>
            <SelectWithCreate
              id="mv-dest"
              value={dest}
              invalid={attempted && !dest}
              placeholder="Chọn ngăn chuyển đến"
              options={destOptions}
              onChange={setDest}
              onCreate={createLocation}
              createLabel="Thêm vị trí mới (vd: Tủ B, ngăn 2)"
            />
          </Field>
        </div>

        <div className="kk-txlines">
          {lines.map((l, i) => {
            const s = sim[i]
            const fromOptions = (stockByComponent.get(l.componentId) ?? []).map((w) => ({
              value: w.location_id,
              label: `${w.path} (có ${fmtNum(w.quantity)})`,
            }))
            const showErr = s.state === 'invalid' || (attempted && s.state === 'incomplete')
            return (
              <div key={l.id} className={`kk-txline ${showErr ? 'has-error' : ''}`}>
                <div className="kk-txline-grid">
                  <Field label="Linh kiện" htmlFor={`mv-c-${l.id}`}>
                    <ComponentPicker
                      id={`mv-c-${l.id}`}
                      value={l.componentId}
                      autoFocus={i === 0 && !l.componentId && Boolean(dest)}
                      invalid={showErr && !l.componentId}
                      onChange={(id) => changeComponent(l, id)}
                    />
                  </Field>
                  <Field label="Lấy từ ngăn" htmlFor={`mv-f-${l.id}`}>
                    <select
                      id={`mv-f-${l.id}`}
                      value={l.fromLocationId ?? ''}
                      disabled={!l.componentId || fromOptions.length === 0}
                      aria-invalid={(showErr && !l.fromLocationId) || undefined}
                      onChange={(e) => changeFrom(l, e.target.value || null)}
                    >
                      <option value="">{l.componentId && fromOptions.length === 0 ? 'Chưa có hàng ở đâu' : 'Chọn ngăn'}</option>
                      {fromOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Số lượng" htmlFor={`mv-q-${l.id}`}>
                    <QtyStepper
                      id={`mv-q-${l.id}`}
                      value={l.qty}
                      min={1}
                      invalid={showErr && !(Number(l.qty) >= 1)}
                      onChange={(v) => patchLine(l.id, { qty: v })}
                    />
                  </Field>
                  <button
                    type="button"
                    className="kk-icon-btn kk-txline-remove kk-c-del"
                    aria-label="Xóa dòng này"
                    disabled={lines.length === 1}
                    onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
                {s.state === 'ok' && (
                  <p className="kk-preview">
                    <span>
                      Ngăn cũ: <b>{fmtNum(s.fromBefore)}</b> → <b className="kk-down">{fmtNum(s.fromAfter)}</b>
                      {s.fromAfter === 0 && ' (chuyển hết)'}
                    </span>
                    {dest && (
                      <span>
                        Ngăn mới: <b>{fmtNum(s.destBefore)}</b> → <b className="kk-up">{fmtNum(s.destAfter)}</b>
                      </span>
                    )}
                  </p>
                )}
                {showErr && s.errors && (
                  <p className="kk-line-error" role="alert">
                    {s.errors.join(' ')}
                  </p>
                )}
              </div>
            )
          })}
        </div>

        <button type="button" className="kk-btn kk-btn-soft kk-add-line" onClick={() => setLines((ls) => [...ls, newLine()])}>
          <Plus size={18} />
          Thêm linh kiện
        </button>

        <div className="kk-form-grid kk-tx-extra">
          <Field label="Ghi chú (không bắt buộc)" htmlFor="mv-note" className="kk-span-2">
            <input
              id="mv-note"
              value={note}
              maxLength={200}
              placeholder="Vd: sắp xếp lại tủ 2"
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </div>
        {moves.homesReady && (
          <p className="kk-hint kk-mv-hint">
            Món nào đang có chỗ cất mặc định ở ngăn cũ và được chuyển hết đi thì chỗ cất mặc định cũng đổi sang ngăn mới.
          </p>
        )}

        {error && (
          <p className="kk-form-error" role="alert">
            {error}
          </p>
        )}
        <p className="kk-kbd-hint">Nhấn Ctrl + Enter để chuyển nhanh.</p>
      </div>
    </Modal>
  )
}
