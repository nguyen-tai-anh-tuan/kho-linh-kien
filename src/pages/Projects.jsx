import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowUpFromLine, CheckCircle2, Download, Loader2, Pencil, Plus, Save, Trash2 } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useData } from '../data/DataContext'
import { useUndoTx } from '../TxContext'
import { useShell } from '../ShellContext'
import { useToast } from '../ui/Toast'
import { Modal } from '../ui/Modal'
import { ConfirmDialog } from '../ui/dialogs'
import { ComponentPicker, EmptyState, Field, QtyStepper, Skeleton } from '../ui/common'
import { fetchAll, friendlyError, isMissingSchema, mustChange } from '../lib/api'
import { downloadCSV } from '../lib/csv'
import { fmtNum, normalize } from '../lib/format'

const BOM_COLUMNS = 'id,project_id,component_id,quantity'

/** Ghép từng dòng BOM với tồn kho: cần bao nhiêu cho số bộ muốn lắp, đang thiếu bao nhiêu */
function analyse(lines, builds, componentsById) {
  return lines
    .map((line) => {
      const comp = componentsById.get(line.component_id)
      const have = comp?.total_quantity ?? 0
      // Ô số lượng có thể đang bỏ trống trong lúc người dùng gõ
      const per = Number(line.quantity) >= 1 ? Number(line.quantity) : 0
      const need = per * builds
      return { line, comp, per, have, need, short: Math.max(0, need - have) }
    })
    .filter((r) => r.comp)
    .sort((a, b) => a.comp.part_number.localeCompare(b.comp.part_number, 'vi', { numeric: true }))
}

export default function ProjectsPage() {
  const { projects, componentsById, loading, refreshing, error, reload, version } = useData()
  const [params, setParams] = useSearchParams()
  const [bom, setBom] = useState(null) // null: đang tải, { error, missing }: lỗi, mảng: các dòng BOM
  const [attempt, setAttempt] = useState(0)
  const [dialog, setDialog] = useState(null) // { kind: 'form' | 'delete', project }

  useEffect(() => {
    let off = false
    fetchAll(() => supabase.from('project_bom').select(BOM_COLUMNS).order('id'))
      .then((rows) => !off && setBom(rows))
      .catch((e) => !off && setBom({ error: friendlyError(e), missing: isMissingSchema(e) }))
    return () => {
      off = true
    }
  }, [version, attempt])

  const lines = Array.isArray(bom) ? bom : null
  const linesByProject = useMemo(() => {
    const map = new Map()
    for (const l of lines ?? []) {
      const list = map.get(l.project_id) ?? []
      list.push(l)
      map.set(l.project_id, list)
    }
    return map
  }, [lines])

  const selected = projects.find((p) => p.id === params.get('p')) ?? projects[0] ?? null

  function select(id) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (id) next.set('p', id)
        else next.delete('p')
        return next
      },
      { replace: true },
    )
  }

  if (error) {
    return (
      <EmptyState title="Chưa tải được danh sách dự án" text={error}>
        <button type="button" className="kk-btn kk-btn-primary" onClick={reload}>
          Thử lại
        </button>
      </EmptyState>
    )
  }

  return (
    <div className={`kk-page ${refreshing ? 'is-refreshing' : ''}`}>
      <div className="kk-page-head">
        <div>
          <h1>Dự án và BOM</h1>
          <p>{loading ? 'Đang tải…' : `${fmtNum(projects.length)} dự án`}</p>
        </div>
        <div className="kk-quick">
          <button type="button" className="kk-btn kk-btn-primary" onClick={() => setDialog({ kind: 'form', project: null })}>
            <Plus size={18} />
            Thêm dự án
          </button>
        </div>
      </div>

      {loading || bom === null ? (
        <div className="kk-split">
          <Skeleton h={280} r={20} />
          <Skeleton h={280} r={20} />
        </div>
      ) : bom.error ? (
        <div className="kk-card">
          <EmptyState
            title={bom.missing ? 'Cần nâng cấp database cho trang này' : 'Chưa tải được BOM'}
            text={
              bom.missing
                ? 'Mở Supabase, vào SQL Editor, dán toàn bộ nội dung file sql/03_pages.sql rồi bấm Run. Xong thì bấm Thử lại.'
                : bom.error
            }
          >
            <button type="button" className="kk-btn kk-btn-primary" onClick={() => setAttempt((n) => n + 1)}>
              Thử lại
            </button>
          </EmptyState>
        </div>
      ) : projects.length === 0 ? (
        <div className="kk-card">
          <EmptyState
            title="Chưa có dự án nào"
            text="Tạo dự án, liệt kê linh kiện cần cho một bộ sản phẩm, rồi xuất kho cả danh sách chỉ bằng một lần bấm."
          >
            <button type="button" className="kk-btn kk-btn-primary" onClick={() => setDialog({ kind: 'form', project: null })}>
              <Plus size={18} />
              Thêm dự án
            </button>
          </EmptyState>
        </div>
      ) : (
        <div className="kk-split">
          <nav className="kk-card kk-tree-card" aria-label="Danh sách dự án">
            <ul className="kk-pick-list">
              {projects.map((p) => {
                const own = linesByProject.get(p.id) ?? []
                const short = analyse(own, 1, componentsById).filter((r) => r.short > 0).length
                const on = selected?.id === p.id
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      className={`kk-pick ${on ? 'is-on' : ''}`}
                      aria-current={on ? 'true' : undefined}
                      onClick={() => select(p.id)}
                    >
                      <strong>{p.name}</strong>
                      <small className={short > 0 ? 'kk-warn-text' : ''}>
                        {own.length === 0
                          ? 'Chưa có BOM'
                          : short > 0
                            ? `${fmtNum(own.length)} món, thiếu ${fmtNum(short)}`
                            : `${fmtNum(own.length)} món, đủ hàng`}
                      </small>
                    </button>
                  </li>
                )
              })}
            </ul>
          </nav>

          {selected && (
            <ProjectDetail
              key={selected.id}
              project={selected}
              lines={linesByProject.get(selected.id) ?? []}
              setBom={setBom}
              refetchBom={() => setAttempt((n) => n + 1)}
              onEdit={() => setDialog({ kind: 'form', project: selected })}
              onDelete={() => setDialog({ kind: 'delete', project: selected })}
            />
          )}
        </div>
      )}

      {dialog?.kind === 'form' && (
        <ProjectForm initial={dialog.project} onSaved={select} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteProject project={dialog.project} afterDelete={() => select(null)} onClose={() => setDialog(null)} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Chi tiết một dự án: bảng BOM, tình trạng đủ/thiếu, xuất kho         */
/* ------------------------------------------------------------------ */
function ProjectDetail({ project, lines, setBom, refetchBom, onEdit, onDelete }) {
  const { componentsById } = useData()
  const { openComponent } = useShell()
  const toast = useToast()
  const [builds, setBuilds] = useState(1)
  const [addId, setAddId] = useState(null)
  const [addQty, setAddQty] = useState(1)
  const [addError, setAddError] = useState('')
  const [adding, setAdding] = useState(false)
  const [exporting, setExporting] = useState(false)
  const timers = useRef(new Map())

  const n = Number(builds) >= 1 ? Number(builds) : 1
  const rows = useMemo(() => analyse(lines, n, componentsById), [lines, n, componentsById])
  const missing = rows.filter((r) => r.short > 0)
  const counted = rows.filter((r) => r.per > 0)
  const maxBuilds = counted.length ? Math.min(...counted.map((r) => Math.floor(r.have / r.per))) : 0

  async function addLine() {
    if (adding) return
    if (!addId) return setAddError('Chọn một linh kiện.')
    if (!(Number(addQty) >= 1)) return setAddError('Nhập số lượng lớn hơn 0.')
    if (lines.some((l) => l.component_id === addId)) return setAddError('Linh kiện này đã có trong BOM, bạn sửa số lượng ở bảng bên trên nhé.')
    setAdding(true)
    setAddError('')
    const { data, error } = await supabase
      .from('project_bom')
      .insert({ project_id: project.id, component_id: addId, quantity: Number(addQty) })
      .select(BOM_COLUMNS)
      .single()
    setAdding(false)
    if (error) return setAddError(friendlyError(error))
    setBom((list) => (Array.isArray(list) ? [...list, data] : list))
    setAddId(null)
    setAddQty(1)
  }

  function changeQty(line, qty) {
    // Cập nhật ngay trên màn hình, đợi người dùng dừng bấm rồi mới lưu
    setBom((list) => (Array.isArray(list) ? list.map((l) => (l.id === line.id ? { ...l, quantity: qty } : l)) : list))
    clearTimeout(timers.current.get(line.id))
    if (!(Number(qty) >= 1)) return
    timers.current.set(
      line.id,
      setTimeout(async () => {
        try {
          mustChange(await supabase.from('project_bom').update({ quantity: Number(qty) }).eq('id', line.id).select('id'))
        } catch (e) {
          toast.push({ tone: 'error', message: `Chưa lưu được số lượng. ${friendlyError(e)}`, duration: 9000 })
          refetchBom()
        }
      }, 500),
    )
  }

  async function removeLine(row) {
    clearTimeout(timers.current.get(row.line.id))
    try {
      mustChange(await supabase.from('project_bom').delete().eq('id', row.line.id).select('id'))
    } catch (e) {
      return toast.push({ tone: 'error', message: friendlyError(e), duration: 9000 })
    }
    setBom((list) => (Array.isArray(list) ? list.filter((l) => l.id !== row.line.id) : list))
    toast.push({
      message: `Đã bỏ ${row.comp.part_number} khỏi BOM.`,
      action: {
        label: 'Hoàn tác',
        onClick: async () => {
          const { error } = await supabase
            .from('project_bom')
            .insert({ project_id: project.id, component_id: row.line.component_id, quantity: row.line.quantity })
          if (error) toast.push({ tone: 'error', message: `Không hoàn tác được. ${friendlyError(error)}`, duration: 9000 })
          refetchBom()
        },
      },
    })
  }

  function downloadMissing() {
    const header = ['part_number', 'ten', 'can', 'ton_kho', 'thieu']
    const body = missing.map((r) => [r.comp.part_number, r.comp.name, r.need, r.have, r.short])
    downloadCSV(`thieu-${normalize(project.name).replace(/[^a-z0-9]+/g, '-')}.csv`, [header, ...body])
  }

  return (
    <section className="kk-card kk-table-card kk-card-open" aria-label={`Dự án ${project.name}`}>
      <div className="kk-pane-head">
        <div className="kk-pane-titles">
          <h2>{project.name}</h2>
          {project.description && <p className="kk-card-sub">{project.description}</p>}
        </div>
        <div className="kk-pane-actions">
          <button type="button" className="kk-icon-btn kk-icon-btn-boxed" aria-label="Sửa dự án" title="Sửa dự án" onClick={onEdit}>
            <Pencil size={16} />
          </button>
          <button type="button" className="kk-icon-btn kk-icon-btn-boxed" aria-label="Xóa dự án" title="Xóa dự án" onClick={onDelete}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="kk-pane-bar kk-bom-bar">
          <div className="kk-bom-builds">
            <label htmlFor="bom-builds">Số bộ muốn lắp</label>
            <QtyStepper id="bom-builds" value={builds} min={1} label="Số bộ muốn lắp" onChange={setBuilds} />
          </div>
          <p className={`kk-banner ${missing.length > 0 ? 'kk-banner-warn' : 'kk-banner-ok'}`} role="status">
            {missing.length > 0 ? <AlertTriangle size={18} aria-hidden="true" /> : <CheckCircle2 size={18} aria-hidden="true" />}
            <span>
              {missing.length > 0
                ? `Thiếu ${fmtNum(missing.length)} món để lắp ${fmtNum(n)} bộ.`
                : `Đủ linh kiện để lắp ${fmtNum(n)} bộ.`}{' '}
              {maxBuilds > 0 ? `Kho hiện đủ cho tối đa ${fmtNum(maxBuilds)} bộ.` : 'Kho hiện chưa đủ cho bộ nào.'}
            </span>
          </p>
          <div className="kk-pane-actions">
            {missing.length > 0 && (
              <button type="button" className="kk-btn kk-btn-outline kk-btn-sm" onClick={downloadMissing}>
                <Download size={16} />
                Tải danh sách thiếu
              </button>
            )}
            <button type="button" className="kk-btn kk-btn-primary kk-btn-sm" onClick={() => setExporting(true)}>
              <ArrowUpFromLine size={16} />
              Xuất kho theo BOM
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState title="BOM còn trống" text="Thêm các linh kiện cần cho một bộ sản phẩm của dự án này ở ngay bên dưới." />
      ) : (
        <div className="kk-table-scroll">
          <table className="kk-table kk-table-plain kk-table-static">
            <thead>
              <tr>
                <th>Linh kiện</th>
                <th>Mỗi bộ cần</th>
                <th className="is-num">Tổng cần</th>
                <th className="is-num">Tồn kho</th>
                <th>Tình trạng</th>
                <th className="kk-col-act">
                  <span className="kk-sr">Thao tác</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.line.id}>
                  <td data-label="Linh kiện" className="kk-cell-main">
                    <button type="button" className="kk-row-link" onClick={() => openComponent(r.comp.id)}>
                      {r.comp.part_number}
                    </button>
                    <span className="kk-cell-name">{r.comp.name}</span>
                  </td>
                  <td data-label="Mỗi bộ cần">
                    <div className="kk-cell-stepper">
                      <QtyStepper
                        value={r.line.quantity}
                        min={1}
                        invalid={!(Number(r.line.quantity) >= 1)}
                        label={`Số lượng ${r.comp.part_number} cho mỗi bộ`}
                        onChange={(v) => changeQty(r.line, v)}
                      />
                    </div>
                  </td>
                  <td data-label="Tổng cần" className="is-num kk-strong-num">
                    {fmtNum(r.need)}
                  </td>
                  <td data-label="Tồn kho" className="is-num">
                    {fmtNum(r.have)}
                  </td>
                  <td data-label="Tình trạng">
                    {r.short > 0 ? (
                      <span className="kk-status kk-status-low">
                        <AlertTriangle size={14} aria-hidden="true" />
                        Thiếu {fmtNum(r.short)}
                      </span>
                    ) : (
                      <span className="kk-status kk-status-ok">
                        <CheckCircle2 size={14} aria-hidden="true" />
                        Đủ
                      </span>
                    )}
                  </td>
                  <td className="kk-col-act">
                    <button
                      type="button"
                      className="kk-icon-btn"
                      aria-label={`Bỏ ${r.comp.part_number} khỏi BOM`}
                      title="Bỏ khỏi BOM"
                      onClick={() => removeLine(r)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="kk-bom-add">
        <Field label="Thêm linh kiện vào BOM" htmlFor="bom-add-comp" className="kk-bom-add-comp">
          <ComponentPicker
            id="bom-add-comp"
            value={addId}
            onChange={(id) => {
              setAddId(id)
              setAddError('')
            }}
          />
        </Field>
        <Field label="Mỗi bộ cần" htmlFor="bom-add-qty">
          <QtyStepper id="bom-add-qty" value={addQty} min={1} label="Số lượng cho mỗi bộ" onChange={setAddQty} />
        </Field>
        <button type="button" className="kk-btn kk-btn-soft" onClick={addLine} disabled={adding}>
          {adding ? <Loader2 size={18} className="kk-spin" /> : <Plus size={18} />}
          Thêm vào BOM
        </button>
        {addError && (
          <p className="kk-line-error kk-bom-add-error" role="alert">
            {addError}
          </p>
        )}
      </div>

      {exporting && <BomExportModal project={project} rows={counted} builds={n} onClose={() => setExporting(false)} />}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Xuất kho theo BOM: xem trước sẽ lấy hàng ở đâu, món nào thiếu       */
/* ------------------------------------------------------------------ */
function BomExportModal({ project, rows, builds, onClose }) {
  const { stockByComponent, reload } = useData()
  const toast = useToast()
  const undo = useUndoTx()
  const [note, setNote] = useState(`Xuất theo BOM, ${builds} bộ`)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Lấy hàng ở vị trí đang có nhiều nhất trước, hết thì sang vị trí kế tiếp
  const plan = useMemo(
    () =>
      rows.map((r) => {
        const sources = [...(stockByComponent.get(r.comp.id) ?? [])].sort((a, b) => b.quantity - a.quantity)
        const takes = []
        let left = r.need
        for (const s of sources) {
          if (left <= 0) break
          const qty = Math.min(s.quantity, left)
          takes.push({ location_id: s.location_id, path: s.path, qty })
          left -= qty
        }
        return { ...r, takes, short: left }
      }),
    [rows, stockByComponent],
  )
  const ready = plan.filter((p) => p.short === 0)
  const missing = plan.filter((p) => p.short > 0)

  async function submit() {
    if (busy || ready.length === 0) return
    setBusy(true)
    setError('')
    const txRows = ready.flatMap((p) =>
      p.takes.map((t) => ({
        component_id: p.comp.id,
        location_id: t.location_id,
        type: 'out',
        quantity: t.qty,
        project_id: project.id,
        note: note.trim() || null,
      })),
    )
    const { data, error: err } = await supabase
      .from('transactions')
      .insert(txRows)
      .select('id,component_id,location_id,type,quantity,delta')
    if (err) {
      setBusy(false)
      return setError(friendlyError(err))
    }
    await reload()
    toast.push({
      message:
        missing.length > 0
          ? `Đã xuất ${fmtNum(ready.length)} món cho ${project.name}, còn ${fmtNum(missing.length)} món thiếu chưa xuất.`
          : `Đã xuất kho ${fmtNum(ready.length)} món cho ${project.name}.`,
      action: { label: 'Hoàn tác', onClick: () => undo(data) },
    })
    onClose()
  }

  return (
    <Modal
      title="Xuất kho theo BOM"
      subtitle={`${project.name}, ${fmtNum(builds)} bộ`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <span className="kk-foot-note" aria-live="polite">
            {missing.length > 0
              ? `${fmtNum(ready.length)} món đủ hàng, ${fmtNum(missing.length)} món thiếu`
              : `${fmtNum(ready.length)} món sẵn sàng`}
          </span>
          <button type="button" className="kk-btn kk-btn-ghost" onClick={onClose} disabled={busy}>
            Hủy
          </button>
          <button type="button" className="kk-btn kk-btn-primary" onClick={submit} disabled={busy || ready.length === 0}>
            {busy ? <Loader2 size={18} className="kk-spin" /> : <ArrowUpFromLine size={18} />}
            {busy ? 'Đang xuất…' : missing.length > 0 ? `Chỉ xuất ${fmtNum(ready.length)} món đủ hàng` : 'Xuất kho'}
          </button>
        </>
      }
    >
      {missing.length > 0 && (
        <div className="kk-banner kk-banner-warn kk-banner-block" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <strong>
              Chưa đủ hàng để lắp {fmtNum(builds)} bộ, thiếu {fmtNum(missing.length)} món:
            </strong>
            <ul>
              {missing.map((p) => (
                <li key={p.line.id}>
                  {p.comp.part_number}: cần {fmtNum(p.need)}, kho có {fmtNum(p.have)}, thiếu {fmtNum(p.short)}
                </li>
              ))}
            </ul>
            {ready.length > 0
              ? 'Bạn có thể xuất trước các món đủ hàng; món thiếu sẽ được giữ nguyên trong kho.'
              : 'Hãy nhập thêm hàng hoặc giảm số bộ muốn lắp.'}
          </div>
        </div>
      )}

      {ready.length > 0 && (
        <>
          <h3 className="kk-sub">Sẽ lấy ra khỏi kho</h3>
          <table className="kk-mini-table">
            <thead>
              <tr>
                <th>Linh kiện</th>
                <th>Lấy từ</th>
                <th className="is-num">Số lượng</th>
              </tr>
            </thead>
            <tbody>
              {ready.map((p) => (
                <tr key={p.line.id}>
                  <td>
                    <strong>{p.comp.part_number}</strong>
                  </td>
                  <td>{p.takes.map((t) => (p.takes.length > 1 ? `${t.path} (${fmtNum(t.qty)})` : t.path)).join(', ')}</td>
                  <td className="is-num">{fmtNum(p.need)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <Field label="Ghi chú (không bắt buộc)" htmlFor="bom-note" className="kk-tx-extra">
            <input id="bom-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </>
      )}

      {error && (
        <p className="kk-form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Thêm / sửa / xóa dự án                                              */
/* ------------------------------------------------------------------ */
function ProjectForm({ initial, onSaved, onClose }) {
  const { projects, reload } = useData()
  const toast = useToast()
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [nameError, setNameError] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(ev) {
    ev.preventDefault()
    if (saving) return
    const clean = name.trim()
    if (!clean) return setNameError('Nhập tên dự án.')
    if (projects.some((p) => p.id !== initial?.id && normalize(p.name) === normalize(clean))) {
      return setNameError('Đã có dự án trùng tên này.')
    }
    setSaving(true)
    setFormError('')
    const payload = { name: clean, description: description.trim() || null }
    try {
      const saved = initial
        ? mustChange(await supabase.from('projects').update(payload).eq('id', initial.id).select('id'))[0]
        : mustChange(await supabase.from('projects').insert(payload).select('id'))[0]
      await reload()
      onSaved(saved.id)
      toast.push({ message: initial ? `Đã lưu dự án ${clean}.` : `Đã thêm dự án ${clean}.` })
      onClose()
    } catch (e) {
      setFormError(friendlyError(e))
      setSaving(false)
    }
  }

  return (
    <Modal
      title={initial ? 'Sửa dự án' : 'Thêm dự án'}
      subtitle={initial ? undefined : 'Sau khi tạo, bạn thêm linh kiện vào BOM của dự án.'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="kk-btn kk-btn-ghost" onClick={onClose} disabled={saving}>
            Hủy
          </button>
          <button type="submit" form="project-form" className="kk-btn kk-btn-primary" disabled={saving}>
            {saving ? <Loader2 size={18} className="kk-spin" /> : <Save size={18} />}
            {initial ? 'Lưu thay đổi' : 'Thêm dự án'}
          </button>
        </>
      }
    >
      <form id="project-form" className="kk-form-grid" onSubmit={submit} noValidate>
        <Field label="Tên dự án *" htmlFor="pf-name" error={nameError} className="kk-span-2">
          <input
            id="pf-name"
            data-autofocus
            value={name}
            maxLength={80}
            placeholder="Vd: Mạch điều khiển quạt v2"
            aria-invalid={nameError ? true : undefined}
            onChange={(e) => {
              setName(e.target.value)
              setNameError('')
            }}
          />
        </Field>
        <Field label="Mô tả (không bắt buộc)" htmlFor="pf-desc" className="kk-span-2">
          <textarea id="pf-desc" rows={3} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {formError && (
          <p className="kk-form-error kk-span-2" role="alert">
            {formError}
          </p>
        )}
      </form>
    </Modal>
  )
}

function DeleteProject({ project, afterDelete, onClose }) {
  const { reload } = useData()
  const toast = useToast()
  return (
    <ConfirmDialog
      title={`Xóa dự án ${project.name}?`}
      text="Danh sách BOM của dự án cũng bị xóa theo. Việc này không hoàn tác được."
      confirmLabel="Xóa dự án"
      Icon={Trash2}
      onConfirm={async () => {
        mustChange(await supabase.from('projects').delete().eq('id', project.id).select('id'))
        afterDelete()
        await reload()
        toast.push({ message: `Đã xóa dự án ${project.name}.` })
      }}
      onClose={onClose}
    />
  )
}
