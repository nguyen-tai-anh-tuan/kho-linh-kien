import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useToast } from '../ui/Toast'
import { Field, Skeleton } from '../ui/common'
import { ConfirmDialog } from '../ui/dialogs'
import { friendlyError, isMissingSchema, mustChange } from '../lib/api'
import { parseNumber } from '../lib/csv'
import { fmtMoneyFull, fmtNum } from '../lib/format'

const MAX_AMOUNT = 99999999999999 // numeric(14, 0) trong sql/16_project_costs.sql

async function readCosts(projectId) {
  const { data, error } = await supabase
    .from('project_costs')
    .select('id,name,amount')
    .eq('project_id', projectId)
    .order('created_at')
    .order('id')
  if (error) return isMissingSchema(error) ? { projectId, rows: [], missing: true } : { projectId, rows: [], error: friendlyError(error) }
  return { projectId, rows: data }
}

/** Các khoản tiền công của một dự án. enabled = false (không phải admin) thì không tải gì. */
export function useProjectCosts(projectId, enabled) {
  const [state, setState] = useState(null)

  useEffect(() => {
    if (!enabled) return
    let off = false
    readCosts(projectId).then((next) => !off && setState(next))
    return () => {
      off = true
    }
  }, [projectId, enabled])

  const refresh = useCallback(async () => setState(await readCosts(projectId)), [projectId])
  // Vừa chuyển dự án thì chưa dùng số của dự án trước
  const current = state?.projectId === projectId ? state : null
  return { loading: enabled && !current, rows: current?.rows ?? [], missing: Boolean(current?.missing), error: current?.error ?? '', refresh }
}

/**
 * Khung chi phí dự án (chỉ admin): tiền linh kiện web tự tính từ BOM cộng các khoản tiền công admin tự nhập.
 * Tiền công là số cố định cho cả dự án, không nhân theo số bộ.
 */
export function ProjectCosts({ project, builds, partsCost, unpriced, bomCount, costs }) {
  const toast = useToast()
  const [editingId, setEditingId] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const labor = costs.rows.reduce((sum, c) => sum + (Number(c.amount) || 0), 0)
  const noPrices = bomCount > 0 && unpriced === bomCount

  async function add(values) {
    mustChange(await supabase.from('project_costs').insert({ project_id: project.id, ...values }).select('id'))
    await costs.refresh()
    toast.push({ message: `Đã thêm khoản ${values.name}.` })
  }

  async function save(id, values) {
    mustChange(await supabase.from('project_costs').update(values).eq('id', id).select('id'))
    await costs.refresh()
    setEditingId(null)
    toast.push({ message: `Đã lưu khoản ${values.name}.` })
  }

  async function remove(cost) {
    mustChange(await supabase.from('project_costs').delete().eq('id', cost.id).select('id'))
    await costs.refresh()
    toast.push({ message: `Đã xóa khoản ${cost.name}.` })
  }

  return (
    <section className="kk-card kk-cost" aria-labelledby="pv-costs">
      <div className="kk-card-head">
        <div>
          <h2 id="pv-costs">Chi phí dự án</h2>
          <p className="kk-card-sub">Chỉ admin thấy khung này. Tiền công là số cố định cho cả dự án, không nhân theo số bộ.</p>
        </div>
      </div>

      {costs.loading ? (
        <Skeleton h={120} r={12} />
      ) : costs.missing ? (
        <p className="kk-form-error" role="alert">
          Database chưa có bảng tiền công. Hãy chạy file sql/16_project_costs.sql trong Supabase (SQL Editor) rồi tải lại trang.
        </p>
      ) : costs.error ? (
        <p className="kk-form-error" role="alert">
          {costs.error}
        </p>
      ) : (
        <>
          <table className="kk-cost-table">
            <thead>
              <tr>
                <th scope="col">Khoản</th>
                <th scope="col" className="is-num">
                  Số tiền
                </th>
                <th scope="col" className="kk-cost-actions kk-no-print" aria-label="Thao tác" />
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  Tiền linh kiện cho {fmtNum(builds)} bộ
                  <small>
                    {bomCount === 0
                      ? 'BOM còn trống'
                      : noPrices
                        ? 'Nhập đơn giá cho linh kiện để web tự tính'
                        : unpriced > 0
                          ? `Tự tính từ BOM, chưa tính ${fmtNum(unpriced)} mã chưa có đơn giá`
                          : 'Tự tính từ BOM và đơn giá'}
                  </small>
                </td>
                <td className="is-num">{noPrices ? 'Chưa có giá' : fmtMoneyFull(partsCost)}</td>
                <td className="kk-cost-actions kk-no-print" />
              </tr>
              {costs.rows.map((c) =>
                editingId === c.id ? (
                  <tr key={c.id}>
                    <td colSpan={3}>
                      <CostForm initial={c} onSave={(values) => save(c.id, values)} onCancel={() => setEditingId(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td className="is-num">{fmtMoneyFull(c.amount)}</td>
                    <td className="kk-cost-actions kk-no-print">
                      <button type="button" className="kk-icon-btn kk-c-edit" aria-label={`Sửa khoản ${c.name}`} title="Sửa" onClick={() => setEditingId(c.id)}>
                        <Pencil size={16} />
                      </button>
                      <button type="button" className="kk-icon-btn kk-c-del" aria-label={`Xóa khoản ${c.name}`} title="Xóa" onClick={() => setDeleting(c)}>
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">
                  Tổng chi phí
                  {unpriced > 0 && <small>Chưa gồm {fmtNum(unpriced)} mã chưa có đơn giá</small>}
                </th>
                <td className="is-num">{fmtMoneyFull(partsCost + labor)}</td>
                <td className="kk-cost-actions kk-no-print" />
              </tr>
            </tfoot>
          </table>

          <div className="kk-no-print">
            <CostForm onSave={add} />
          </div>
        </>
      )}

      {deleting && (
        <ConfirmDialog
          title={`Xóa khoản ${deleting.name}?`}
          text={`Khoản ${fmtMoneyFull(deleting.amount)} sẽ bị xóa khỏi chi phí của dự án. Việc này không hoàn tác được.`}
          confirmLabel="Xóa khoản này"
          Icon={Trash2}
          onConfirm={() => remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </section>
  )
}

/** Form một khoản tiền công. Có initial là đang sửa dòng đó, không có là thêm dòng mới. */
function CostForm({ initial, onSave, onCancel }) {
  const uid = useId()
  const nameRef = useRef(null)
  const [name, setName] = useState(initial?.name ?? '')
  const [amount, setAmount] = useState(initial ? fmtNum(initial.amount) : '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(ev) {
    ev.preventDefault()
    if (saving) return
    const clean = name.trim()
    if (!clean) return setError('Nhập tên khoản tiền công.')
    const value = parseNumber(amount)
    if (!Number.isInteger(value) || value < 0 || value > MAX_AMOUNT) return setError('Nhập số tiền hợp lệ, vd 300000.')
    setSaving(true)
    setError('')
    try {
      await onSave({ name: clean, amount: value })
      if (!initial) {
        setName('')
        setAmount('')
        nameRef.current?.focus()
      }
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="kk-cost-form" onSubmit={submit} noValidate onKeyDown={(e) => e.key === 'Escape' && onCancel?.()}>
      <Field label="Tên khoản" htmlFor={`${uid}-name`}>
        <input
          id={`${uid}-name`}
          ref={nameRef}
          autoFocus={Boolean(initial)}
          value={name}
          maxLength={80}
          placeholder="Vd: Công hàn mạch"
          disabled={saving}
          onChange={(e) => {
            setName(e.target.value)
            setError('')
          }}
        />
      </Field>
      <Field label="Số tiền (đ)" htmlFor={`${uid}-amount`} className="kk-cost-amount">
        <input
          id={`${uid}-amount`}
          inputMode="numeric"
          value={amount}
          placeholder="Vd: 300000"
          disabled={saving}
          onChange={(e) => {
            setAmount(e.target.value)
            setError('')
          }}
        />
      </Field>
      {initial ? (
        <>
          <button type="submit" className="kk-btn kk-btn-primary" disabled={saving}>
            {saving ? <Loader2 size={18} className="kk-spin" /> : <Check size={18} />}
            Lưu
          </button>
          <button type="button" className="kk-btn kk-btn-ghost" disabled={saving} onClick={onCancel}>
            <X size={18} />
            Hủy
          </button>
        </>
      ) : (
        <button type="submit" className="kk-btn kk-btn-outline" disabled={saving}>
          {saving ? <Loader2 size={18} className="kk-spin" /> : <Plus size={18} />}
          Thêm khoản
        </button>
      )}
      {error && (
        <p className="kk-form-error kk-cost-error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
