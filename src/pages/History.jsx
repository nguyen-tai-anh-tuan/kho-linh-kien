import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowDownToLine, ArrowUpFromLine, ChevronLeft, ChevronRight, Download, Loader2, SlidersHorizontal } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useData } from '../data/DataContext'
import { useTx } from '../TxContext'
import { useShell } from '../ShellContext'
import { useToast } from '../ui/Toast'
import { ComponentPicker, EmptyState, Skeleton } from '../ui/common'
import { fetchAll, friendlyError } from '../lib/api'
import { downloadCSV } from '../lib/csv'
import { buildTree, subtreeIds } from '../lib/tree'
import { fmtDateTime, fmtNum } from '../lib/format'

const PAGE_SIZE = 50

const TYPES = {
  in: { label: 'Nhập', Icon: ArrowDownToLine },
  out: { label: 'Xuất', Icon: ArrowUpFromLine },
  adjust: { label: 'Điều chỉnh', Icon: SlidersHorizontal },
}

/** 'YYYY-MM-DD' (giờ máy người dùng) -> mốc thời gian ISO, lệch thêm số ngày nếu cần */
function dayStart(isoDate, addDays = 0) {
  const d = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  d.setDate(d.getDate() + addDays)
  return d.toISOString()
}

function applyFilters(query, f) {
  let q = query
  if (f.type) q = q.eq('type', f.type)
  if (f.comp) q = q.eq('component_id', f.comp)
  if (f.proj) q = q.eq('project_id', f.proj)
  if (f.locIds) q = q.in('location_id', f.locIds)
  const from = f.from && dayStart(f.from)
  const to = f.to && dayStart(f.to, 1)
  if (from) q = q.gte('created_at', from)
  if (to) q = q.lt('created_at', to)
  return q.order('created_at', { ascending: false }).order('id', { ascending: false })
}

export default function HistoryPage() {
  const { locations, projects, version } = useData()
  const { openTx } = useTx()
  const { openComponent } = useShell()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [state, setState] = useState({ status: 'loading', rows: [], count: 0, error: '' })
  const [exporting, setExporting] = useState(false)
  const [attempt, setAttempt] = useState(0)

  const type = params.get('type') ?? ''
  const comp = params.get('comp') ?? ''
  const proj = params.get('proj') ?? ''
  const loc = params.get('loc') ?? ''
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const page = Math.max(0, (Number(params.get('page')) || 1) - 1)
  const hasFilter = Boolean(type || comp || proj || loc || from || to)

  // Lọc theo một tủ thì tính luôn mọi ngăn bên trong
  const locIds = useMemo(() => (loc ? subtreeIds(buildTree(locations), loc) : null), [loc, locations])
  const filters = useMemo(() => ({ type, comp, proj, locIds, from, to }), [type, comp, proj, locIds, from, to])

  useEffect(() => {
    let off = false
    setState((s) => ({ ...s, status: 'loading' }))
    applyFilters(supabase.from('transactions_feed').select('*', { count: 'exact' }), filters)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
      .then(({ data, count, error }) => {
        if (off) return
        // Trang đang xem không còn tồn tại (vd: vừa đổi bộ lọc ở tab khác): quay về trang đầu
        if (error?.code === 'PGRST103' && page > 0) return setParam('page', '')
        if (error) return setState({ status: 'error', rows: [], count: 0, error: friendlyError(error) })
        setState({ status: 'ready', rows: data, count: count ?? data.length, error: '' })
      })
    return () => {
      off = true
    }
  }, [filters, page, version, attempt])

  function setParam(key, value) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        if (key !== 'page') next.delete('page')
        return next
      },
      { replace: true },
    )
  }

  function clearFilters() {
    // Giữ lại ?c= để ngăn kéo chi tiết linh kiện (nếu đang mở) không bị đóng
    setParams(
      (prev) => {
        const next = new URLSearchParams()
        if (prev.get('c')) next.set('c', prev.get('c'))
        return next
      },
      { replace: true },
    )
  }

  async function exportCsv() {
    if (exporting) return
    setExporting(true)
    try {
      const all = await fetchAll(() => applyFilters(supabase.from('transactions_feed').select('*'), filters))
      const header = ['thoi_gian', 'loai', 'part_number', 'ten', 'so_luong', 'thay_doi', 'vi_tri', 'du_an', 'ghi_chu']
      const body = all.map((t) => [
        fmtDateTime(t.created_at),
        TYPES[t.type]?.label ?? t.type,
        t.part_number,
        t.component_name,
        t.quantity,
        t.delta,
        t.location_path,
        t.project_name,
        t.note,
      ])
      downloadCSV(`lich-su-kho-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...body])
    } catch (e) {
      toast.push({ tone: 'error', message: `Chưa xuất được file. ${friendlyError(e)}`, duration: 9000 })
    } finally {
      setExporting(false)
    }
  }

  const { status, rows, count } = state
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE))
  const first = count === 0 ? 0 : page * PAGE_SIZE + 1
  const last = Math.min(count, page * PAGE_SIZE + rows.length)

  return (
    <div className="kk-page">
      <div className="kk-page-head">
        <div>
          <h1>Lịch sử</h1>
          <p>
            {status === 'ready'
              ? `${fmtNum(count)} giao dịch${hasFilter ? ' khớp bộ lọc' : ''}`
              : 'Mọi lần nhập, xuất và điều chỉnh kho'}
          </p>
        </div>
        <div className="kk-quick">
          <button type="button" className="kk-btn kk-btn-outline" onClick={exportCsv} disabled={exporting || count === 0}>
            {exporting ? <Loader2 size={18} className="kk-spin" /> : <Download size={18} />}
            Xuất CSV
          </button>
        </div>
      </div>

      <div className="kk-card kk-toolbar kk-filters">
        <div className="kk-filter">
          <label htmlFor="hf-type">Loại</label>
          <select id="hf-type" value={type} onChange={(e) => setParam('type', e.target.value)}>
            <option value="">Mọi loại</option>
            {Object.entries(TYPES).map(([key, t]) => (
              <option key={key} value={key}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="kk-filter kk-filter-wide">
          <label htmlFor="hf-comp">Linh kiện</label>
          <ComponentPicker id="hf-comp" value={comp || null} onChange={(id) => setParam('comp', id ?? '')} />
        </div>
        <div className="kk-filter">
          <label htmlFor="hf-proj">Dự án</label>
          <select id="hf-proj" value={proj} onChange={(e) => setParam('proj', e.target.value)}>
            <option value="">Mọi dự án</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="kk-filter">
          <label htmlFor="hf-loc">Vị trí</label>
          <select id="hf-loc" value={loc} onChange={(e) => setParam('loc', e.target.value)}>
            <option value="">Mọi vị trí</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.path}
              </option>
            ))}
          </select>
        </div>
        <div className="kk-filter">
          <label htmlFor="hf-from">Từ ngày</label>
          <input id="hf-from" type="date" value={from} max={to || undefined} onChange={(e) => setParam('from', e.target.value)} />
        </div>
        <div className="kk-filter">
          <label htmlFor="hf-to">Đến ngày</label>
          <input id="hf-to" type="date" value={to} min={from || undefined} onChange={(e) => setParam('to', e.target.value)} />
        </div>
        {hasFilter && (
          <button type="button" className="kk-link kk-filter-clear" onClick={clearFilters}>
            Xóa bộ lọc
          </button>
        )}
      </div>

      <div className={`kk-card kk-table-card ${status === 'loading' && rows.length > 0 ? 'is-stale' : ''}`}>
        {status === 'error' ? (
          <EmptyState title="Chưa tải được lịch sử" text={state.error}>
            <button type="button" className="kk-btn kk-btn-primary" onClick={() => setAttempt((n) => n + 1)}>
              Thử lại
            </button>
          </EmptyState>
        ) : status === 'loading' && rows.length === 0 ? (
          <div className="kk-skel-list">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} h={48} r={10} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          hasFilter ? (
            <EmptyState title="Không có giao dịch nào khớp bộ lọc" text="Thử nới khoảng ngày hoặc bỏ bớt bộ lọc.">
              <button type="button" className="kk-btn kk-btn-outline" onClick={clearFilters}>
                Xóa bộ lọc
              </button>
            </EmptyState>
          ) : (
            <EmptyState title="Chưa có giao dịch nào" text="Mỗi lần nhập, xuất hay kiểm kê sẽ được ghi lại ở đây.">
              <button type="button" className="kk-btn kk-btn-primary" onClick={() => openTx({ type: 'in' })}>
                <ArrowDownToLine size={18} />
                Nhập kho
              </button>
            </EmptyState>
          )
        ) : (
          <>
            <div className="kk-table-scroll">
              <table className="kk-table kk-table-plain">
                <thead>
                  <tr>
                    <th>Thời gian</th>
                    <th>Loại</th>
                    <th>Linh kiện</th>
                    <th className="is-num">Số lượng</th>
                    <th>Vị trí</th>
                    <th>Dự án</th>
                    <th>Ghi chú</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => {
                    const T = TYPES[t.type] ?? TYPES.adjust
                    return (
                      <tr key={t.id} onClick={() => openComponent(t.component_id)}>
                        <td data-label="Thời gian" className="kk-nowrap">
                          {fmtDateTime(t.created_at)}
                        </td>
                        <td data-label="Loại">
                          <span className={`kk-status kk-type-${t.type}`}>
                            <T.Icon size={14} aria-hidden="true" />
                            {T.label}
                          </span>
                        </td>
                        <td data-label="Linh kiện" className="kk-cell-main">
                          <button
                            type="button"
                            className="kk-row-link"
                            onClick={(e) => {
                              e.stopPropagation()
                              openComponent(t.component_id)
                            }}
                          >
                            {t.part_number}
                          </button>
                          <span className="kk-cell-name">{t.component_name}</span>
                        </td>
                        <td data-label="Số lượng" className="is-num kk-strong-num">
                          <Quantity t={t} />
                        </td>
                        <td data-label="Vị trí">{t.location_path || '—'}</td>
                        <td data-label="Dự án">{t.project_name || '—'}</td>
                        <td data-label="Ghi chú" className="kk-cell-note">
                          {t.note || '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="kk-pager">
              <span>
                Hiển thị {fmtNum(first)} đến {fmtNum(last)} trong {fmtNum(count)} giao dịch
              </span>
              <div>
                <button
                  type="button"
                  className="kk-icon-btn kk-icon-btn-boxed"
                  aria-label="Trang trước"
                  disabled={page === 0}
                  onClick={() => setParam('page', page <= 1 ? '' : String(page))}
                >
                  <ChevronLeft size={18} />
                </button>
                <span className="kk-pager-num">
                  {page + 1} / {pageCount}
                </span>
                <button
                  type="button"
                  className="kk-icon-btn kk-icon-btn-boxed"
                  aria-label="Trang sau"
                  disabled={page >= pageCount - 1}
                  onClick={() => setParam('page', String(page + 2))}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Quantity({ t }) {
  if (t.type === 'in') return <span className="kk-num-up">+{fmtNum(t.quantity)}</span>
  if (t.type === 'out') return <span className="kk-num-down">−{fmtNum(t.quantity)}</span>
  const d = t.delta
  return (
    <span>
      còn {fmtNum(t.quantity)}
      {d !== null && d !== undefined && d !== 0 && (
        <small className="kk-num-note">
          {' '}
          ({d > 0 ? '+' : '−'}
          {fmtNum(Math.abs(d))})
        </small>
      )}
    </span>
  )
}
