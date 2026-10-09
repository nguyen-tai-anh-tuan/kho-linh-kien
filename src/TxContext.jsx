import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Loader2, Plus, SlidersHorizontal, Trash2 } from 'lucide-react'
import { supabase } from './supabaseClient'
import { useData } from './data/DataContext'
import { useToast } from './ui/Toast'
import { Modal } from './ui/Modal'
import { ComponentPicker, Field, QtyStepper, SelectWithCreate } from './ui/common'
import { friendlyError } from './lib/api'
import { fmtNum } from './lib/format'

const TxContext = createContext(null)

export function useTx() {
  const ctx = useContext(TxContext)
  if (!ctx) throw new Error('useTx phải dùng bên trong TxProvider')
  return ctx
}

/** Hoàn tác = ghi giao dịch ngược lại, lịch sử cũ vẫn được giữ nguyên */
export function useUndoTx() {
  const { reload } = useData()
  const toast = useToast()
  return useCallback(
    async (done) => {
      const inverse = [...done].reverse().map((r) => ({
        component_id: r.component_id,
        location_id: r.location_id,
        type: r.type === 'in' ? 'out' : r.type === 'out' ? 'in' : 'adjust',
        quantity: r.type === 'adjust' ? r.quantity - r.delta : r.quantity,
        note: 'Hoàn tác giao dịch trước',
      }))
      const { error: err } = await supabase.from('transactions').insert(inverse)
      if (err) return toast.push({ tone: 'error', message: `Không hoàn tác được. ${friendlyError(err)}`, duration: 9000 })
      await reload()
      toast.push({ message: 'Đã hoàn tác giao dịch.' })
    },
    [reload, toast],
  )
}

/** Mở cửa sổ nhập/xuất từ bất kỳ đâu: openTx({ type, componentId, componentIds, locationId }) */
export function TxProvider({ children }) {
  const [opts, setOpts] = useState(null)
  const openTx = useCallback((o = {}) => setOpts({ ...o, key: Date.now() }), [])
  const value = useMemo(() => ({ openTx }), [openTx])
  return (
    <TxContext.Provider value={value}>
      {children}
      {opts && <TxModal key={opts.key} {...opts} onClose={() => setOpts(null)} />}
    </TxContext.Provider>
  )
}

const TYPES = {
  in: { label: 'Nhập kho', Icon: ArrowDownToLine, submit: 'Nhập kho', done: 'Đã nhập kho' },
  out: { label: 'Xuất kho', Icon: ArrowUpFromLine, submit: 'Xuất kho', done: 'Đã xuất kho' },
  adjust: { label: 'Điều chỉnh', Icon: SlidersHorizontal, submit: 'Lưu điều chỉnh', done: 'Đã điều chỉnh tồn' },
}

let lineSeq = 0
const newLine = (componentId = null) => ({ id: ++lineSeq, componentId, locationId: null, qty: '' })

function TxModal({ type: initialType = 'in', componentId, componentIds, locationId: presetLocationId, onClose }) {
  const { componentsById, locations, projects, stockMap, stockByComponent, createLocation, createProject, reload } =
    useData()
  const toast = useToast()
  const undo = useUndoTx()

  // Vị trí chọn sẵn (mở từ trang Vị trí) chỉ dùng cho nhập và điều chỉnh; xuất thì phải lấy từ nơi đang có hàng
  const presetFor = (t) => (t !== 'out' && presetLocationId ? presetLocationId : null)

  const [type, setType] = useState(initialType)
  const [lines, setLines] = useState(() => {
    const ids = componentIds?.length ? componentIds : componentId ? [componentId] : [null]
    return ids.map((id) => {
      const l = newLine(id)
      if (id) l.locationId = presetFor(initialType) ?? pickLocation(initialType, id, [], locations, stockByComponent)
      return l
    })
  })
  const [projectId, setProjectId] = useState(null)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [error, setError] = useState('')

  /* ---- tính trước kết quả của từng dòng ---- */
  const sim = useMemo(() => {
    const running = new Map()
    const totals = new Map()
    return lines.map((l) => {
      if (!l.componentId) return { state: 'empty' }
      const comp = componentsById.get(l.componentId)
      if (!comp) return { state: 'empty' }
      const errors = []
      if (!l.locationId) errors.push('Chọn vị trí.')
      const q = l.qty === '' ? NaN : Number(l.qty)
      const minQ = type === 'adjust' ? 0 : 1
      if (!(q >= minQ)) errors.push(type === 'adjust' ? 'Nhập số lượng đã đếm được.' : 'Nhập số lượng lớn hơn 0.')
      if (errors.length) return { state: 'incomplete', errors, comp }

      const key = `${l.componentId}|${l.locationId}`
      const before = running.has(key) ? running.get(key) : (stockMap.get(key) ?? 0)
      const totalBefore = totals.has(l.componentId) ? totals.get(l.componentId) : comp.total_quantity
      const delta = type === 'in' ? q : type === 'out' ? -q : q - before
      const after = before + delta
      if (after < 0) {
        return {
          state: 'invalid',
          errors: [`Vị trí này chỉ còn ${fmtNum(before)}, không thể xuất ${fmtNum(q)}.`],
          comp,
        }
      }
      running.set(key, after)
      totals.set(l.componentId, totalBefore + delta)
      return {
        state: 'ok',
        comp,
        before,
        after,
        delta,
        totalBefore,
        totalAfter: totalBefore + delta,
        noop: delta === 0,
      }
    })
  }, [lines, type, componentsById, stockMap])

  const okCount = sim.filter((s) => s.state === 'ok' && !s.noop).length

  /* ---- thao tác trên dòng ---- */
  const patchLine = (id, patch) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)))

  function changeComponent(line, id) {
    const others = lines.filter((l) => l.id !== line.id)
    patchLine(line.id, {
      componentId: id,
      locationId: id ? (presetFor(type) ?? pickLocation(type, id, others, locations, stockByComponent)) : null,
    })
  }

  function changeType(next) {
    if (next === type) return
    setType(next)
    setError('')
    setLines((ls) =>
      ls.map((l, i) => {
        if (!l.componentId) return l
        const valid = locationOptions(next, l.componentId, locations, stockMap, stockByComponent).some(
          (o) => o.value === l.locationId,
        )
        if (valid) return l
        const others = ls.filter((_, j) => j !== i)
        return { ...l, locationId: pickLocation(next, l.componentId, others, locations, stockByComponent) }
      }),
    )
  }

  /* ---- gửi lên Supabase ---- */
  async function submit() {
    if (submitting) return
    setAttempted(true)
    setError('')
    const bad = sim.filter((s) => s.state === 'incomplete' || s.state === 'invalid').length
    if (bad > 0) return setError(`Còn ${bad} dòng cần sửa trước khi lưu.`)
    const good = lines.map((l, i) => ({ l, s: sim[i] })).filter(({ s }) => s.state === 'ok' && !s.noop)
    if (good.length === 0) {
      return setError(
        sim.some((s) => s.state === 'ok')
          ? 'Số đếm trùng với tồn hiện tại nên chưa có gì thay đổi.'
          : 'Hãy chọn ít nhất một linh kiện.',
      )
    }

    const rows = good.map(({ l }) => ({
      component_id: l.componentId,
      location_id: l.locationId,
      type,
      quantity: Number(l.qty),
      project_id: type === 'out' ? projectId : null,
      note: note.trim() || null,
    }))

    setSubmitting(true)
    const { data, error: err } = await supabase
      .from('transactions')
      .insert(rows)
      .select('id,component_id,location_id,type,quantity,delta')
    if (err) {
      setSubmitting(false)
      return setError(friendlyError(err))
    }

    await reload()
    const totalQty = rows.reduce((sum, r) => sum + r.quantity, 0)
    const detail = type === 'adjust' ? `${rows.length} dòng` : `${rows.length} dòng, ${fmtNum(totalQty)} cái`
    toast.push({
      message: `${TYPES[type].done}: ${detail}.`,
      action: { label: 'Hoàn tác', onClick: () => undo(data) },
    })
    onClose()
  }

  const T = TYPES[type]
  return (
    <Modal
      title="Nhập / xuất kho"
      subtitle="Thêm một hoặc nhiều linh kiện rồi lưu một lần."
      size="lg"
      onClose={onClose}
      footer={
        <>
          <span className="kk-foot-note" aria-live="polite">
            {okCount > 0 ? `${okCount} dòng sẵn sàng` : 'Chưa có dòng nào hợp lệ'}
          </span>
          <button type="button" className="kk-btn kk-btn-ghost" onClick={onClose}>
            Hủy
          </button>
          <button type="button" className="kk-btn kk-btn-primary" onClick={submit} disabled={submitting}>
            {submitting ? <Loader2 size={18} className="kk-spin" /> : <T.Icon size={18} />}
            {submitting ? 'Đang lưu…' : T.submit}
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
        <div className="kk-seg" role="group" aria-label="Loại giao dịch">
          {Object.entries(TYPES).map(([key, t]) => (
            <button
              key={key}
              type="button"
              className={`kk-seg-btn kk-seg-${key} ${type === key ? 'is-on' : ''}`}
              aria-pressed={type === key}
              onClick={() => changeType(key)}
            >
              <t.Icon size={18} />
              {t.label}
            </button>
          ))}
        </div>
        {type === 'adjust' && (
          <p className="kk-explain">
            Dùng khi kiểm kê: nhập số lượng bạn đếm được thực tế tại vị trí đó, tồn kho sẽ được đặt đúng bằng số này.
          </p>
        )}

        <div className="kk-txlines">
          {lines.map((l, i) => {
            const s = sim[i]
            const options = l.componentId ? locationOptions(type, l.componentId, locations, stockMap, stockByComponent) : []
            const noStock = type === 'out' && l.componentId && options.length === 0
            const showErr = s.state === 'invalid' || (attempted && s.state === 'incomplete')
            return (
              <div key={l.id} className={`kk-txline ${showErr ? 'has-error' : ''}`}>
                <div className="kk-txline-grid">
                  <Field label="Linh kiện" htmlFor={`tx-c-${l.id}`}>
                    <ComponentPicker
                      id={`tx-c-${l.id}`}
                      value={l.componentId}
                      autoFocus={i === 0 && !l.componentId}
                      invalid={showErr && !l.componentId}
                      onChange={(id) => changeComponent(l, id)}
                    />
                  </Field>
                  <Field label="Vị trí" htmlFor={`tx-l-${l.id}`}>
                    <SelectWithCreate
                      id={`tx-l-${l.id}`}
                      value={l.locationId}
                      invalid={showErr && !l.locationId}
                      disabled={!l.componentId || noStock}
                      placeholder={noStock ? 'Chưa có tồn ở vị trí nào' : 'Chọn vị trí'}
                      options={options}
                      onChange={(id) => patchLine(l.id, { locationId: id })}
                      onCreate={type === 'out' ? undefined : createLocation}
                      createLabel="Thêm vị trí mới (vd: Tủ A, ngăn 1)"
                    />
                  </Field>
                  <Field label={type === 'adjust' ? 'Số đếm được' : 'Số lượng'} htmlFor={`tx-q-${l.id}`}>
                    <QtyStepper
                      id={`tx-q-${l.id}`}
                      value={l.qty}
                      min={type === 'adjust' ? 0 : 1}
                      invalid={showErr && s.state !== 'ok' && !(Number(l.qty) >= (type === 'adjust' ? 0 : 1))}
                      label={type === 'adjust' ? 'Số lượng đếm được' : 'Số lượng'}
                      onChange={(v) => patchLine(l.id, { qty: v })}
                    />
                  </Field>
                  <button
                    type="button"
                    className="kk-icon-btn kk-txline-remove"
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
                      Tại vị trí này: <b>{fmtNum(s.before)}</b> → <b className={deltaClass(s.delta)}>{fmtNum(s.after)}</b>
                      {type === 'adjust' && (s.noop ? ' (không đổi)' : ` (${s.delta > 0 ? '+' : '−'}${fmtNum(Math.abs(s.delta))})`)}
                    </span>
                    <span>
                      Tổng tồn: <b>{fmtNum(s.totalBefore)}</b> → <b className={deltaClass(s.delta)}>{fmtNum(s.totalAfter)}</b>
                    </span>
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
          Thêm dòng
        </button>

        <div className="kk-form-grid kk-tx-extra">
          {type === 'out' && (
            <Field label="Dùng cho dự án (không bắt buộc)" htmlFor="tx-project">
              <SelectWithCreate
                id="tx-project"
                value={projectId}
                onChange={setProjectId}
                placeholder="Không gắn dự án"
                options={projects.map((p) => ({ value: p.id, label: p.name }))}
                onCreate={createProject}
                createLabel="Thêm dự án mới"
              />
            </Field>
          )}
          <Field label="Ghi chú (không bắt buộc)" htmlFor="tx-note" className={type === 'out' ? '' : 'kk-span-2'}>
            <input
              id="tx-note"
              value={note}
              maxLength={200}
              placeholder={type === 'in' ? 'Vd: mua ở LCSC, đơn #1234' : type === 'out' ? 'Vd: lắp mạch thử' : 'Vd: kiểm kê cuối tháng'}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </div>

        {error && (
          <p className="kk-form-error" role="alert">
            {error}
          </p>
        )}
        <p className="kk-kbd-hint">Nhấn Ctrl + Enter để lưu nhanh.</p>
      </div>
    </Modal>
  )
}

function deltaClass(delta) {
  return delta > 0 ? 'kk-up' : delta < 0 ? 'kk-down' : ''
}

/** Các vị trí được phép chọn cho từng loại giao dịch */
function locationOptions(type, componentId, locations, stockMap, stockByComponent) {
  if (type === 'out') {
    return (stockByComponent.get(componentId) ?? []).map((s) => ({
      value: s.location_id,
      label: `${s.path} (tồn ${fmtNum(s.quantity)})`,
    }))
  }
  return locations.map((loc) => {
    const q = stockMap.get(`${componentId}|${loc.id}`) ?? 0
    return { value: loc.id, label: q > 0 ? `${loc.path} (tồn ${fmtNum(q)})` : loc.path }
  })
}

/** Gợi ý vị trí mặc định: nơi đang có nhiều hàng nhất, hoặc vị trí vừa dùng ở dòng trước */
function pickLocation(type, componentId, otherLines, locations, stockByComponent) {
  const have = [...(stockByComponent.get(componentId) ?? [])].sort((a, b) => b.quantity - a.quantity)
  if (have.length > 0) return have[0].location_id
  if (type === 'out') return null
  const prev = [...otherLines].reverse().find((l) => l.locationId)
  if (prev) return prev.locationId
  return locations.length === 1 ? locations[0].id : null
}
