import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowUpFromLine, CheckCircle2, ChevronLeft, ChevronRight, CircuitBoard, Download, Eye, RotateCcw, Loader2, Pencil, Plus, Save, Trash2 } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useData } from '../data/DataContext'
import { useUndoTx } from '../TxContext'
import { useShell } from '../ShellContext'
import { useToast } from '../ui/Toast'
import { Modal } from '../ui/Modal'
import { ConfirmDialog } from '../ui/dialogs'
import { ComponentPicker, EmptyState, Field, QtyStepper, RowThumb, Skeleton } from '../ui/common'
import { friendlyError, isMissingSchema, mustChange } from '../lib/api'
import { fetchBomLines, returnToStock } from '../lib/bom'
import { downloadXlsx } from '../lib/xlsx'
import { fmtNum, normalize } from '../lib/format'
import { removeProjectFiles } from '../lib/images'
import { ProjectGallery, useProjectImages } from './ProjectImages'
import { STAGES, StageBar, StageTag, hasStage } from './ProjectStage'

// Địa chỉ web Electronics Lab (nơi tạo dự án). Chưa đặt thì giữ nguyên cách tạo dự án cũ.
const LAB_URL = import.meta.env.VITE_LAB_URL
const BOM_PAGE = 10 // số dòng BOM trên một trang

/** Dự án hẹn giờ đăng ở Electronics Lab (ngày đăng ở tương lai) thì trang công khai chưa có */
const notYetPublished = (project) => Boolean(project.published_at) && Date.parse(project.published_at) > Date.now()

/**
 * Ghép từng dòng BOM với tồn kho.
 * total = cần cho số bộ muốn lắp, issued = đã xuất kho, need = còn phải xuất, short = kho còn thiếu.
 */
function analyse(lines, builds, componentsById) {
  return lines
    .map((line) => {
      const comp = componentsById.get(line.component_id)
      const have = comp?.total_quantity ?? 0
      // Ô số lượng có thể đang bỏ trống trong lúc người dùng gõ
      const per = Number(line.quantity) >= 1 ? Number(line.quantity) : 0
      const total = per * builds
      const issued = Number(line.issued) || 0
      const need = Math.max(0, total - issued)
      return { line, comp, per, have, total, issued, need, short: Math.max(0, need - have) }
    })
    .filter((r) => r.comp)
    .sort((a, b) => a.comp.part_number.localeCompare(b.comp.part_number, 'vi', { numeric: true }))
}

export default function ProjectsPage() {
  const { projects, componentsById, loading, refreshing, error, reload, version } = useData()
  const { canEdit } = useShell()
  const [params, setParams] = useSearchParams()
  const [bom, setBom] = useState(null) // null: đang tải, { error, missing }: lỗi, mảng: các dòng BOM
  const [tracked, setTracked] = useState(false) // database có ghi nhớ số đã xuất của từng dòng BOM hay chưa
  const [attempt, setAttempt] = useState(0)
  const [dialog, setDialog] = useState(null) // { kind: 'form' | 'delete', project }
  const images = useProjectImages(version)
  const [stageFilter, setStageFilter] = useState('') // '' = mọi tiến độ

  useEffect(() => {
    let off = false
    fetchBomLines()
      .then((res) => {
        if (off) return
        setTracked(res.tracked)
        setBom(res.rows)
      })
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

  // Danh sách bên trái sau khi lọc theo tiến độ (dự án đang mở vẫn hiện ở khung phải)
  const listed = stageFilter === '' ? projects : projects.filter((p) => p.stage === Number(stageFilter))

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
        {canEdit && (
          <div className="kk-quick">
            {LAB_URL ? (
              <a className="kk-btn kk-btn-primary" href={`${LAB_URL}/quan-tri?moi=1`} target="_blank" rel="noopener noreferrer">
                <Plus size={18} />
                Tạo dự án ở Electronics Lab ↗
              </a>
            ) : (
              <button type="button" className="kk-btn kk-btn-primary" onClick={() => setDialog({ kind: 'form', project: null })}>
                <Plus size={18} />
                Thêm dự án
              </button>
            )}
          </div>
        )}
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
            text={
              canEdit
                ? 'Tạo dự án, liệt kê linh kiện cần cho một bộ sản phẩm, rồi xuất kho cả danh sách chỉ bằng một lần bấm.'
                : 'Khi có người tạo dự án và BOM, bạn sẽ thấy ở đây.'
            }
          >
            {canEdit &&
              (LAB_URL ? (
                <a className="kk-btn kk-btn-primary" href={`${LAB_URL}/quan-tri?moi=1`} target="_blank" rel="noopener noreferrer">
                  <Plus size={18} />
                  Tạo dự án ở Electronics Lab ↗
                </a>
              ) : (
                <button type="button" className="kk-btn kk-btn-primary" onClick={() => setDialog({ kind: 'form', project: null })}>
                  <Plus size={18} />
                  Thêm dự án
                </button>
              ))}
          </EmptyState>
        </div>
      ) : (
        <div className="kk-split">
          <nav className="kk-card kk-tree-card" aria-label="Danh sách dự án">
            {projects.some(hasStage) && (
              <div className="kk-stage-filter">
                <label htmlFor="prj-stage" className="kk-sr">
                  Lọc theo tiến độ
                </label>
                <select id="prj-stage" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
                  <option value="">Mọi tiến độ ({fmtNum(projects.length)})</option>
                  {STAGES.map((name, i) => (
                    <option key={name} value={i}>
                      {name} ({fmtNum(projects.filter((p) => p.stage === i).length)})
                    </option>
                  ))}
                </select>
              </div>
            )}
            {listed.length === 0 && <p className="kk-muted-text kk-stage-empty">Không có dự án nào ở bước này.</p>}
            <ul className="kk-pick-list">
              {listed.map((p) => {
                const own = linesByProject.get(p.id) ?? []
                const short = analyse(own, 1, componentsById).filter((r) => r.short > 0).length
                const on = selected?.id === p.id
                const cover = images.rows.find((r) => r.project_id === p.id && r.slot === 0)
                const coverUrl = cover ? images.urls.get(cover.thumb_path) : null
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      className={`kk-pick kk-pick-media ${on ? 'is-on' : ''}`}
                      aria-current={on ? 'true' : undefined}
                      onClick={() => select(p.id)}
                    >
                      {coverUrl ? (
                        <img className="kk-pick-thumb" src={coverUrl} alt="" loading="lazy" />
                      ) : (
                        <span className="kk-pick-thumb kk-pick-thumb-none" aria-hidden="true">
                          <CircuitBoard size={18} />
                        </span>
                      )}
                      <span className="kk-pick-text">
                        <strong>
                          {p.code && <span className="kk-prj">{p.code}</span>}
                          {p.name}
                        </strong>
                        <StageTag project={p} />
                        <small className={short > 0 ? 'kk-warn-text' : ''}>
                          {own.length === 0
                            ? 'Chưa có BOM'
                            : short > 0
                              ? `${fmtNum(own.length)} món, thiếu ${fmtNum(short)}`
                              : `${fmtNum(own.length)} món, đủ hàng`}
                        </small>
                      </span>
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
              images={images}
              tracked={tracked}
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
        <DeleteProject
          project={dialog.project}
          lines={linesByProject.get(dialog.project.id) ?? []}
          tracked={tracked}
          afterDelete={() => select(null)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Chi tiết một dự án: bảng BOM, tình trạng đủ/thiếu, xuất kho         */
/* ------------------------------------------------------------------ */
function ProjectDetail({ project, lines, images, tracked, setBom, refetchBom, onEdit, onDelete }) {
  const { componentsById, stockByComponent, locations, locationsById, reload } = useData()
  const { openComponent, canEdit, isAdmin } = useShell()
  const toast = useToast()
  const undo = useUndoTx()
  const [builds, setBuilds] = useState(1)
  const [addId, setAddId] = useState(null)
  const [addQty, setAddQty] = useState(1)
  const [addError, setAddError] = useState('')
  const [adding, setAdding] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [page, setPage] = useState(0)
  const timers = useRef(new Map())

  const n = Number(builds) >= 1 ? Number(builds) : 1
  const rows = useMemo(() => analyse(lines, n, componentsById), [lines, n, componentsById])
  const missing = rows.filter((r) => r.short > 0)
  const counted = rows.filter((r) => r.per > 0)
  // Tổng số bộ lắp được, tính cả phần linh kiện đã xuất kho cho dự án
  const maxBuilds = counted.length ? Math.min(...counted.map((r) => Math.floor((r.have + r.issued) / r.per))) : 0
  const pending = counted.filter((r) => r.need > 0) // các dòng còn phải xuất
  const issuedAny = rows.some((r) => r.issued > 0)
  const allIssued = issuedAny && pending.length === 0

  // Bảng BOM chia trang; các phép tính đủ/thiếu ở trên vẫn tính trên toàn bộ BOM
  const pageCount = Math.max(1, Math.ceil(rows.length / BOM_PAGE))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = rows.slice(safePage * BOM_PAGE, (safePage + 1) * BOM_PAGE)

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
      .select('*')
      .single()
    setAdding(false)
    if (error) return setAddError(friendlyError(error))
    setBom((list) => (Array.isArray(list) ? [...list, { ...data, issued: data.issued ?? 0 }] : list))
    // Nhảy tới trang chứa dòng vừa thêm (bảng xếp theo mã linh kiện)
    const part = componentsById.get(addId)?.part_number ?? ''
    const before = rows.filter((r) => r.comp.part_number.localeCompare(part, 'vi', { numeric: true }) < 0).length
    setPage(Math.floor(before / BOM_PAGE))
    setAddId(null)
    setAddQty(1)
  }

  /**
   * Trả linh kiện đã xuất cho dự án về kho (về đúng các vị trí đã lấy ra), rồi báo kèm nút Hoàn tác.
   * restore() được gọi khi người dùng hoàn tác, để đưa dòng BOM về như trước.
   */
  async function giveBack(comp, quantity, reason, restore) {
    const fallback = stockByComponent.get(comp.id)?.[0]?.location_id ?? locations[0]?.id
    let done = null
    try {
      done = await returnToStock({
        projectId: project.id,
        componentId: comp.id,
        quantity,
        note: `Trả lại kho: ${reason}${project.code ? ` (${project.code})` : ''}`,
        fallbackLocationId: fallback,
      })
    } catch (e) {
      toast.push({
        tone: 'error',
        duration: 12000,
        message: `Chưa trả được ${fmtNum(quantity)} × ${comp.part_number} về kho. ${friendlyError(e)} Bạn hãy nhập kho lại số này bằng tay.`,
      })
      return false
    }
    if (!done) {
      toast.push({
        tone: 'error',
        duration: 12000,
        message: `Kho chưa có vị trí nào để trả ${fmtNum(quantity)} × ${comp.part_number} về. Bạn hãy nhập kho lại số này bằng tay.`,
      })
      return false
    }
    await reload()
    const where = [...new Set(done.map((t) => locationsById.get(t.location_id)?.path).filter(Boolean))].join(', ')
    toast.push({
      duration: 10000,
      message: `Đã trả ${fmtNum(quantity)} × ${comp.part_number} về kho${where ? ` (${where})` : ''}.`,
      action: {
        label: 'Hoàn tác',
        onClick: async () => {
          if (!(await undo(done))) return
          await restore()
          refetchBom()
        },
      },
    })
    return true
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
          return refetchBom()
        }
        // Giảm số lượng xuống dưới mức đã xuất: phần xuất dư được trả về kho
        const issued = Number(line.issued) || 0
        const keep = Number(qty) * n
        const comp = componentsById.get(line.component_id)
        if (!tracked || !comp || issued <= keep) return
        const { error } = await supabase.from('project_bom').update({ issued: keep }).eq('id', line.id)
        if (error) return toast.push({ tone: 'error', message: friendlyError(error), duration: 9000 })
        setBom((list) => (Array.isArray(list) ? list.map((l) => (l.id === line.id ? { ...l, issued: keep } : l)) : list))
        await giveBack(comp, issued - keep, 'giảm số lượng trong BOM', async () => {
          await supabase.from('project_bom').update({ issued }).eq('id', line.id)
        })
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

    const putBack = async () => {
      const { error } = await supabase.from('project_bom').insert({
        project_id: project.id,
        component_id: row.line.component_id,
        quantity: row.line.quantity,
        ...(tracked ? { issued: row.line.issued ?? 0 } : {}),
      })
      if (error) toast.push({ tone: 'error', message: `Không đưa lại được vào BOM. ${friendlyError(error)}`, duration: 9000 })
    }

    // Linh kiện đã xuất kho cho dự án mà nay bỏ khỏi BOM: trả số đã xuất về kho
    if (tracked && row.issued > 0) {
      const ok = await giveBack(row.comp, row.issued, 'bỏ khỏi BOM', putBack)
      if (ok) return
    }
    toast.push({
      message: `Đã bỏ ${row.comp.part_number} khỏi BOM.`,
      action: {
        label: 'Hoàn tác',
        onClick: async () => {
          await putBack()
          refetchBom()
        },
      },
    })
  }

  function downloadMissing() {
    const slug = normalize(project.name).replace(/[^a-z0-9]+/g, '-')
    downloadXlsx({
      filename: `thieu-${slug}.xlsx`,
      title: `Linh kiện còn thiếu: ${project.code ? `${project.code} · ` : ''}${project.name}`,
      subtitle: 'Số "Cần" là số còn phải xuất, đã trừ phần xuất rồi',
      sheet: 'Còn thiếu',
      rows: missing,
      columns: [
        { header: 'Mã linh kiện', value: (r) => r.comp.part_number, width: 26, wrap: true },
        { header: 'Tên', value: (r) => r.comp.name, width: 34, wrap: true },
        { header: 'Cần', value: (r) => r.need, type: 'int', width: 10 },
        { header: 'Tồn kho', value: (r) => r.have, type: 'int', width: 10 },
        { header: 'Thiếu', value: (r) => r.short, type: 'int', tone: () => 'danger', width: 10, total: true },
      ],
    }).catch((e) => toast.push({ tone: 'error', message: `Chưa xuất được file Excel. ${friendlyError(e)}`, duration: 9000 }))
  }

  return (
    <section className="kk-card kk-table-card kk-card-open" aria-label={`Dự án ${project.name}`}>
      <div className="kk-pane-head">
        <div className="kk-pane-titles">
          <h2>
            {project.code && <span className="kk-prj">{project.code}</span>}
            {project.name}
          </h2>
          {project.description && <p className="kk-card-sub">{project.description}</p>}
        </div>
        <div className="kk-pane-actions">
          <Link className="kk-btn kk-btn-outline kk-btn-sm" to={`/projects/${project.id}`} title="Xem toàn bộ linh kiện, tiến độ xuất kho và lịch sử của dự án">
            <Eye size={16} />
            Xem chi tiết
          </Link>
          {LAB_URL && (
            <a
              className="kk-btn kk-btn-outline kk-btn-sm"
              href={`${LAB_URL}/quan-tri/du-an/${project.id}?tab=y-tuong`}
              target="_blank"
              rel="noopener noreferrer"
              title="Ghi chú ý tưởng, việc cần chuẩn bị, sơ đồ tạm của dự án ở Electronics Lab"
            >
              Ý tưởng ↗
            </a>
          )}
          {LAB_URL && project.is_public && project.slug && !notYetPublished(project) && (
            <a className="kk-btn kk-btn-outline kk-btn-sm" href={`${LAB_URL}/du-an/${project.slug}`} target="_blank" rel="noopener noreferrer">
              Xem trang công khai ↗
            </a>
          )}
        {canEdit && (
          <>
            <button type="button" className="kk-icon-btn kk-icon-btn-boxed kk-c-edit" aria-label="Sửa dự án" title="Sửa dự án" onClick={onEdit}>
              <Pencil size={16} />
            </button>
            {isAdmin && (
              <button type="button" className="kk-icon-btn kk-icon-btn-boxed kk-c-del" aria-label="Xóa dự án" title="Xóa dự án" onClick={onDelete}>
                <Trash2 size={16} />
              </button>
            )}
          </>
        )}
        </div>
      </div>

      <StageBar project={project} editable={canEdit} />

      <ProjectGallery
        project={project}
        images={images.rows.filter((r) => r.project_id === project.id)}
        urls={images.urls}
        missing={images.missing}
        onChanged={images.refresh}
      />

      {rows.length > 0 && (
        <div className="kk-pane-bar kk-bom-bar">
          <div className="kk-bom-builds">
            <label htmlFor="bom-builds">Số bộ muốn lắp</label>
            <QtyStepper id="bom-builds" value={builds} min={1} label="Số bộ muốn lắp" onChange={setBuilds} />
          </div>
          <p className={`kk-banner ${missing.length > 0 ? 'kk-banner-warn' : 'kk-banner-ok'}`} role="status">
            {missing.length > 0 ? <AlertTriangle size={18} aria-hidden="true" /> : <CheckCircle2 size={18} aria-hidden="true" />}
            <span>
              {allIssued
                ? `Đã xuất đủ linh kiện cho ${fmtNum(n)} bộ.`
                : missing.length > 0
                  ? `Thiếu ${fmtNum(missing.length)} món để lắp ${fmtNum(n)} bộ.`
                  : issuedAny
                    ? `Kho đủ để xuất nốt ${fmtNum(pending.length)} món còn lại cho ${fmtNum(n)} bộ.`
                    : `Đủ linh kiện để lắp ${fmtNum(n)} bộ.`}{' '}
              {maxBuilds > 0
                ? `${issuedAny ? 'Tính cả phần đã xuất, đủ' : 'Kho hiện đủ'} cho tối đa ${fmtNum(maxBuilds)} bộ.`
                : 'Kho hiện chưa đủ cho bộ nào.'}
            </span>
          </p>
          <div className="kk-pane-actions">
            {missing.length > 0 && (
              <button type="button" className="kk-btn kk-btn-outline kk-btn-sm" onClick={downloadMissing}>
                <Download size={16} />
                Tải danh sách thiếu (Excel)
              </button>
            )}
            {canEdit && (
              <>
                {tracked && issuedAny && (
                  <button
                    type="button"
                    className="kk-btn kk-btn-outline kk-btn-sm"
                    title="Đưa cột Đã xuất của dự án về 0 để lắp một đợt mới"
                    onClick={() => setResetting(true)}
                  >
                    <RotateCcw size={16} />
                    Bắt đầu đợt mới
                  </button>
                )}
                <button
                  type="button"
                  className="kk-btn kk-btn-primary kk-btn-sm kk-c-out"
                  disabled={pending.length === 0}
                  title={allIssued ? 'Mọi linh kiện đã được xuất đủ. Tăng số bộ, thêm linh kiện, hoặc bắt đầu đợt mới.' : undefined}
                  onClick={() => setExporting(true)}
                >
                  <ArrowUpFromLine size={16} />
                  {allIssued ? 'Đã xuất đủ' : issuedAny ? `Xuất ${fmtNum(pending.length)} món còn lại` : 'Xuất kho theo BOM'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="BOM còn trống"
          text={canEdit ? 'Thêm các linh kiện cần cho một bộ sản phẩm của dự án này ở ngay bên dưới.' : 'Dự án này chưa có linh kiện nào trong BOM.'}
        />
      ) : (
        <div className="kk-table-scroll">
          <table className="kk-table kk-table-plain kk-table-static">
            <thead>
              <tr>
                <th>Linh kiện</th>
                <th>Mỗi bộ cần</th>
                <th className="is-num">Tổng cần</th>
                {tracked && <th className="is-num">Đã xuất</th>}
                <th className="is-num">Tồn kho</th>
                <th>Tình trạng</th>
                {canEdit && (
                  <th className="kk-col-act">
                    <span className="kk-sr">Thao tác</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.line.id}>
                  <td data-label="Linh kiện" className="kk-cell-main">
                    <div className="kk-cell-media">
                      <RowThumb url={r.comp.image_url} />
                      <div className="kk-cell-body">
                        <button type="button" className="kk-row-link" onClick={() => openComponent(r.comp.id)}>
                          {r.comp.part_number}
                        </button>
                        <span className="kk-cell-name">{r.comp.name}</span>
                      </div>
                    </div>
                  </td>
                  <td data-label="Mỗi bộ cần">
                    {canEdit ? (
                      <div className="kk-cell-stepper">
                        <QtyStepper
                          value={r.line.quantity}
                          min={1}
                          invalid={!(Number(r.line.quantity) >= 1)}
                          label={`Số lượng ${r.comp.part_number} cho mỗi bộ`}
                          onChange={(v) => changeQty(r.line, v)}
                        />
                      </div>
                    ) : (
                      <span className="kk-strong-num">{fmtNum(r.per)}</span>
                    )}
                  </td>
                  <td data-label="Tổng cần" className="is-num kk-strong-num">
                    {fmtNum(r.total)}
                  </td>
                  {tracked && (
                    <td data-label="Đã xuất" className="is-num" title={r.need > 0 ? `Còn phải xuất ${fmtNum(r.need)}` : 'Đã xuất đủ'}>
                      {fmtNum(r.issued)} / {fmtNum(r.total)}
                    </td>
                  )}
                  <td data-label="Tồn kho" className="is-num">
                    {fmtNum(r.have)}
                  </td>
                  <td data-label="Tình trạng">
                    {r.per > 0 && r.need === 0 ? (
                      <span className="kk-status kk-status-ok">
                        <CheckCircle2 size={14} aria-hidden="true" />
                        Đã xuất đủ
                      </span>
                    ) : r.short > 0 ? (
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
                  {canEdit && (
                    <td className="kk-col-act">
                      <button
                        type="button"
                        className="kk-icon-btn kk-c-del"
                        aria-label={`Bỏ ${r.comp.part_number} khỏi BOM`}
                        title={tracked && r.issued > 0 ? `Bỏ khỏi BOM và trả ${fmtNum(r.issued)} cái đã xuất về kho` : 'Bỏ khỏi BOM'}
                        onClick={() => removeLine(r)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > BOM_PAGE && (
        <div className="kk-pager">
          <span>
            Hiển thị {fmtNum(safePage * BOM_PAGE + 1)} đến {fmtNum(safePage * BOM_PAGE + pageRows.length)} trong {fmtNum(rows.length)} linh kiện
          </span>
          <div>
            <button
              type="button"
              className="kk-icon-btn kk-icon-btn-boxed"
              aria-label="Trang trước"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
            >
              <ChevronLeft size={18} />
            </button>
            <span className="kk-pager-num">
              {safePage + 1} / {pageCount}
            </span>
            <button
              type="button"
              className="kk-icon-btn kk-icon-btn-boxed"
              aria-label="Trang sau"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      )}

      {canEdit && (
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
      )}

      {exporting && (
        <BomExportModal
          project={project}
          rows={pending}
          skipped={counted.length - pending.length}
          builds={n}
          tracked={tracked}
          onIssued={refetchBom}
          onClose={() => setExporting(false)}
        />
      )}
      {resetting && (
        <ConfirmDialog
          title="Bắt đầu đợt lắp mới?"
          text="Cột Đã xuất của mọi linh kiện trong dự án này sẽ về 0, nên lần xuất kho kế tiếp sẽ xuất lại toàn bộ BOM. Tồn kho và lịch sử không bị thay đổi."
          confirmLabel="Bắt đầu đợt mới"
          Icon={RotateCcw}
          onConfirm={async () => {
            mustChange(await supabase.from('project_bom').update({ issued: 0 }).eq('project_id', project.id).gt('issued', 0).select('id'))
            setBuilds(1)
            refetchBom()
            toast.push({ message: `Đã bắt đầu đợt mới cho ${project.name}.` })
          }}
          onClose={() => setResetting(false)}
        />
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Xuất kho theo BOM: xem trước sẽ lấy hàng ở đâu, món nào thiếu       */
/* ------------------------------------------------------------------ */
function BomExportModal({ project, rows, skipped, builds, tracked, onIssued, onClose }) {
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
    // Ghi nhớ số đã xuất của từng dòng, để lần sau không xuất lại
    const setIssued = (value) =>
      Promise.all(ready.map((p) => supabase.from('project_bom').update({ issued: value(p) }).eq('id', p.line.id).select('id')))
    let noted = true
    if (tracked) noted = (await setIssued((p) => p.issued + p.need)).every((r) => !r.error && r.data?.length > 0)
    await reload()
    onIssued()
    toast.push({
      tone: noted ? undefined : 'error',
      duration: noted ? undefined : 10000,
      message: !noted
        ? `Đã xuất kho ${fmtNum(ready.length)} món cho ${project.name}, nhưng chưa ghi được cột Đã xuất. Hãy kiểm tra lại trước khi xuất lần nữa.`
        : missing.length > 0
          ? `Đã xuất ${fmtNum(ready.length)} món cho ${project.name}, còn ${fmtNum(missing.length)} món thiếu chưa xuất.`
          : `Đã xuất kho ${fmtNum(ready.length)} món cho ${project.name}.`,
      action: {
        label: 'Hoàn tác',
        onClick: async () => {
          if (!(await undo(data))) return
          if (tracked) await setIssued((p) => p.issued)
          onIssued()
        },
      },
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
          <button type="button" className="kk-btn kk-btn-primary kk-c-out" onClick={submit} disabled={busy || ready.length === 0}>
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

      {skipped > 0 && (
        <p className="kk-muted-text kk-bom-skipped">
          {fmtNum(skipped)} linh kiện đã xuất đủ ở các lần trước nên không nằm trong lần xuất này.
        </p>
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
      subtitle={initial ? undefined : 'Sau khi tạo, bạn thêm ảnh và linh kiện vào BOM ngay trong trang dự án.'}
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

/**
 * Xóa dự án = dự án đã hủy, không thực hiện nữa. Linh kiện đã xuất kho cho dự án được trả về kho
 * trước khi xóa. Người dùng phải tick xác nhận thì mới bấm xóa được.
 */
function DeleteProject({ project, lines, tracked, afterDelete, onClose }) {
  const { componentsById, stockByComponent, locations, reload } = useData()
  const toast = useToast()
  const [sure, setSure] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Các dòng BOM đã xuất kho, cần trả về
  const issued = tracked
    ? lines
        .map((l) => ({ line: l, comp: componentsById.get(l.component_id), qty: Number(l.issued) || 0 }))
        .filter((x) => x.comp && x.qty > 0)
    : []
  const totalQty = issued.reduce((sum, x) => sum + x.qty, 0)
  const label = project.code ? `${project.code} ${project.name}` : project.name

  async function run() {
    if (busy || !sure) return
    setBusy(true)
    setError('')
    try {
      for (const x of issued) {
        const done = await returnToStock({
          projectId: project.id,
          componentId: x.comp.id,
          quantity: x.qty,
          note: `Trả lại kho: hủy dự án ${label}`.slice(0, 200),
          fallbackLocationId: stockByComponent.get(x.comp.id)?.[0]?.location_id ?? locations[0]?.id,
        })
        if (!done) throw new Error(`Kho chưa có vị trí nào để trả ${x.comp.part_number} về. Hãy tạo một vị trí rồi thử lại.`)
        // Ghi nhận ngay là đã trả, để nếu bước sau lỗi rồi bấm lại thì không trả hai lần
        await supabase.from('project_bom').update({ issued: 0 }).eq('id', x.line.id)
      }
      // Dọn file ảnh trước, vì xóa dự án xong thì không còn biết ảnh nào của nó
      await removeProjectFiles(project.id)
      mustChange(await supabase.from('projects').delete().eq('id', project.id).select('id'))
      afterDelete()
      await reload()
      toast.push({
        duration: 9000,
        message:
          issued.length > 0
            ? `Đã xóa dự án ${project.name} và trả ${fmtNum(totalQty)} linh kiện (${fmtNum(issued.length)} mã) về kho.`
            : `Đã xóa dự án ${project.name}.`,
      })
      onClose()
    } catch (e) {
      // Có thể đã trả được một phần: tải lại để tồn kho và cột Đã xuất hiện đúng
      await reload()
      setError(e instanceof Error && !e.code ? e.message.replace('NO_ROWS_CHANGED', friendlyError(e)) : friendlyError(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Xóa dự án ${project.name}?`}
      subtitle={project.code || undefined}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="kk-btn kk-btn-ghost" data-autofocus onClick={onClose} disabled={busy}>
            Giữ lại
          </button>
          <button type="button" className="kk-btn kk-btn-danger" onClick={run} disabled={busy || !sure}>
            {busy ? <Loader2 size={18} className="kk-spin" /> : <Trash2 size={18} />}
            {busy ? 'Đang xóa…' : issued.length > 0 ? 'Trả hàng về kho và xóa dự án' : 'Xóa dự án'}
          </button>
        </>
      }
    >
      <p className="kk-confirm-text">
        Xóa dự án nghĩa là dự án này đã hủy và không thực hiện nữa. Danh sách BOM và các ảnh của dự án bị xóa theo. Việc này không
        hoàn tác được.
      </p>

      {issued.length > 0 ? (
        <>
          <h3 className="kk-sub">
            Sẽ trả về kho {fmtNum(totalQty)} linh kiện ({fmtNum(issued.length)} mã)
          </h3>
          <table className="kk-mini-table">
            <thead>
              <tr>
                <th>Linh kiện đã xuất cho dự án</th>
                <th className="is-num">Trả về kho</th>
              </tr>
            </thead>
            <tbody>
              {issued.map((x) => (
                <tr key={x.line.id}>
                  <td>
                    <strong>{x.comp.part_number}</strong>
                  </td>
                  <td className="is-num">{fmtNum(x.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="kk-muted-text kk-bom-skipped">
            Hàng được nhập lại vào đúng các vị trí đã lấy ra và được ghi trong Lịch sử. Nếu linh kiện đã hàn lên mạch và không thu
            lại được, hãy bấm "Bắt đầu đợt mới" trong dự án trước khi xóa để không trả về kho.
          </p>
        </>
      ) : (
        <p className="kk-muted-text kk-bom-skipped">
          {lines.length > 0
            ? 'Dự án này chưa xuất kho linh kiện nào theo BOM, nên tồn kho không thay đổi.'
            : 'Dự án này chưa có BOM, nên tồn kho không thay đổi.'}
        </p>
      )}

      <label className="kk-check-confirm">
        <input type="checkbox" checked={sure} disabled={busy} onChange={(e) => setSure(e.target.checked)} />
        <span>
          Tôi xác nhận dự án <strong>{label}</strong> đã hủy và không thực hiện nữa.
        </span>
      </label>

      {error && (
        <p className="kk-form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}
