import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ArrowDownToLine,
  ArrowDownUp,
  ArrowUp,
  ArrowDown,
  ArrowUpFromLine,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  PackagePlus,
  Search,
  SlidersHorizontal,
  Upload,
  X,
} from 'lucide-react'
import { useData } from '../data/DataContext'
import { lastEvent, sumEvents, useActivity } from '../data/useActivity'
import { useTx } from '../TxContext'
import { useShell } from '../ShellContext'
import { CategoryChip, EmptyState, RowThumb, Skeleton, StatusChip, StockBar } from '../ui/common'
import { datedName, stockText, stockTone } from '../lib/xlsx'
import { useXlsxExport } from '../ui/useXlsxExport'
import { fmtDate, fmtDateTime, fmtMoneyFull, fmtNum, normalize, timeAgo } from '../lib/format'
import { matches, parseQuery, quantitiesIn } from '../lib/smartSearch'
import { StockStatCards, stockStats } from '../ui/stats'
import { ComponentPrice } from '../ui/PriceEdit'
import { packOf, packPrice } from '../lib/price'
import { CategoryFilter } from '../ui/CategoryMenu'
import { subtreeIds } from '../lib/tree'
import '../components-page.css'

const PAGE_SIZES = [10, 25, 50, 100]
const SIZE_KEY = 'kk-components-page-size'
const PANEL_KEY = 'kk-components-advanced'
const STATUS_ORDER = { out: 0, low: 1, ok: 2 }
const DAY = 24 * 60 * 60 * 1000
const NEW_DAYS = 7 // linh kiện thêm trong 7 ngày gần đây có nhãn "Mới"

const COLUMNS = [
  { key: 'part_number', title: 'Linh kiện', sortable: true },
  { key: 'package', title: 'Package', sortable: true, cls: 'kk-col-pkg' },
  { key: 'locations', title: 'Vị trí', cls: 'kk-col-loc' },
  // Cột gộp (cho bảng gọn, không phải kéo ngang): mỗi cột có thêm một nút xếp phụ (extra)
  { key: 'total_quantity', title: 'Tồn kho', sortable: true, extra: { key: 'status', title: 'Trạng thái' } },
  { key: 'activity', title: 'Hoạt động gần nhất', sortable: true, cls: 'kk-col-activity', firstDir: 'desc' },
  { key: 'stock_value', title: 'Giá trị', sortable: true, cls: 'kk-col-money', num: true, extra: { key: 'unit_price', title: 'Đơn giá' } },
]

/** Lọc theo hoạt động. types: loại giao dịch trong lịch sử nhập / xuất */
const ACTS = {
  new: { label: 'Mới thêm vào kho', chip: 'Mới thêm' },
  in: { label: 'Mới nhập kho', chip: 'Mới nhập', types: ['in'] },
  out: { label: 'Mới xuất kho', chip: 'Mới xuất', types: ['out'] },
  adjust: { label: 'Mới kiểm kê', chip: 'Mới kiểm kê', types: ['adjust'] },
  idle: { label: 'Lâu không nhập / xuất', chip: 'Không nhập / xuất' },
}
const RECENT_PERIODS = [
  { v: '1', label: 'Hôm nay' },
  { v: '7', label: '7 ngày' },
  { v: '30', label: '30 ngày' },
  { v: '90', label: '90 ngày' },
  { v: 'custom', label: 'Tự chọn ngày' },
]
const IDLE_PERIODS = [
  { v: '30', label: 'Hơn 30 ngày' },
  { v: '60', label: 'Hơn 60 ngày' },
  { v: '90', label: 'Hơn 90 ngày' },
  { v: '180', label: 'Hơn 6 tháng' },
  { v: '365', label: 'Hơn 1 năm' },
]
const STATUS_TABS = [
  { v: '', label: 'Tất cả' },
  { v: 'ok', label: 'Còn hàng' },
  { v: 'low', label: 'Sắp hết' },
  { v: 'out', label: 'Hết hàng' },
]
const STATUS_CHIP = { ok: 'Còn hàng', low: 'Sắp hết', out: 'Hết hàng', warn: 'Sắp hết và hết hàng' }
const QTY_PRESETS = [
  { label: 'Bằng 0', min: '0', max: '0' },
  { label: '1 đến 10', min: '1', max: '10' },
  { label: '11 đến 100', min: '11', max: '100' },
  { label: 'Trên 100', min: '101', max: '' },
]
/** Bộ lọc nhanh: bấm một lần là đặt sẵn nhiều điều kiện */
const PRESETS = [
  { label: 'Mới về tuần này', params: { act: 'in', d: '7' } },
  { label: 'Mới xuất tuần này', params: { act: 'out', d: '7' } },
  { label: 'Mới thêm 30 ngày', params: { act: 'new', d: '30' } },
  { label: 'Hàng tồn đọng', params: { act: 'idle', d: '90', qmin: '1' }, title: 'Còn hàng nhưng hơn 90 ngày không nhập / xuất' },
  { label: 'Cần nhập thêm', params: { stt: 'warn' }, title: 'Sắp hết và hết hàng' },
]
// Các khóa thuộc phần lọc nâng cao / lọc nhanh (bộ lọc nhanh thay toàn bộ nhóm này)
const ADV_KEYS = ['act', 'd', 'from', 'to', 'stt', 'low', 'qmin', 'qmax', 'price']

function readStore(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}
function writeStore(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // trình duyệt chặn lưu trữ: bỏ qua, chỉ là tiện ích nhớ lựa chọn
  }
}

/** 'YYYY-MM-DD' -> mốc đầu ngày (giờ máy) */
function dayStart(s) {
  const [y, m, d] = String(s).split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d).getTime()
}

const numParam = (s) => (s === '' || s === null || !Number.isFinite(Number(s)) ? null : Number(s))

export default function ComponentsPage() {
  const {
    components: active,
    archivedComponents,
    categoriesById,
    categoryChildren,
    locations,
    locationsById,
    packages,
    stockMap,
    stockByComponent,
    toneByCategory,
    loading,
    refreshing,
    error,
    reload,
    version,
  } = useData()
  const { openTx } = useTx()
  const { openComponent, openForm, openImport, canEdit } = useShell()
  const activity = useActivity(version)
  const [params, setParams] = useSearchParams()
  const [sort, setSort] = useState({ key: 'part_number', dir: 'asc' })
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(() => {
    const n = Number(readStore(SIZE_KEY, 10))
    return PAGE_SIZES.includes(n) ? n : 10
  })
  const [panelOpen, setPanelOpen] = useState(() => readStore(PANEL_KEY, '0') === '1')
  const [selected, setSelected] = useState(() => new Set())
  const xlsx = useXlsxExport()

  const q = params.get('q') ?? ''
  const cat = params.get('cat') ?? ''
  const pkg = params.get('pkg') ?? ''
  const loc = params.get('loc') ?? ''
  // Link cũ "?low=1" (từ trang Tổng quan) = sắp hết và hết hàng
  const stt = params.get('stt') ?? (params.get('low') === '1' ? 'warn' : '')
  const noPrice = params.get('price') === 'none' // chỉ hiện mã chưa có đơn giá
  const arc = params.get('arc') === '1' // đang xem các linh kiện ngừng dùng
  const act = ACTS[params.get('act')] ? params.get('act') : ''
  const d = params.get('d') ?? ''
  const dFrom = params.get('from') ?? ''
  const dTo = params.get('to') ?? ''
  const qminRaw = params.get('qmin') ?? ''
  const qmaxRaw = params.get('qmax') ?? ''
  const qmin = numParam(qminRaw)
  const qmax = numParam(qmaxRaw)

  const period = act === 'idle' ? d || '90' : act ? d || '7' : ''
  const needsTx = act === 'in' || act === 'out' || act === 'adjust' || act === 'idle'
  const waitingTx = needsTx && activity.status === 'loading'
  const advCount = (act ? 1 : 0) + (qmin !== null || qmax !== null ? 1 : 0) + (noPrice ? 1 : 0)
  const hasFilter = Boolean(q || cat || pkg || loc || stt || noPrice || act || qmin !== null || qmax !== null)
  const components = arc ? archivedComponents : active

  function update(patch, { keepOthers = true } = {}) {
    // Dùng dạng hàm để luôn lấy bộ lọc mới nhất, kể cả khi gõ phím rất nhanh
    setParams(
      (prev) => {
        const next = new URLSearchParams(keepOthers ? prev : undefined)
        for (const [key, value] of Object.entries(patch)) {
          if (value) next.set(key, value)
          else next.delete(key)
        }
        return next
      },
      { replace: true },
    )
    setPage(0)
  }
  const setParam = (key, value) => update({ [key]: value })

  function clearFilters() {
    setParams(new URLSearchParams(arc ? { arc: '1' } : {}), { replace: true })
    setPage(0)
  }

  function setStatus(v) {
    update({ stt: v, low: '' })
  }

  function setAct(v) {
    update({ act: v, d: '', from: '', to: '' })
    // Lọc theo hoạt động thì xếp theo thời gian luôn: mới nhất trước, riêng "lâu không dùng" thì lâu nhất trước
    if (v) setSort({ key: 'activity', dir: v === 'idle' ? 'asc' : 'desc' })
  }

  function presetOn(p) {
    return ADV_KEYS.every((k) => (p.params[k] ?? '') === (params.get(k) ?? ''))
  }

  function applyPreset(p) {
    const patch = Object.fromEntries(ADV_KEYS.map((k) => [k, '']))
    if (!presetOn(p)) Object.assign(patch, p.params)
    update(patch)
    const a = patch.act
    if (a) setSort({ key: 'activity', dir: a === 'idle' ? 'asc' : 'desc' })
  }

  function togglePanel() {
    setPanelOpen((o) => {
      writeStore(PANEL_KEY, o ? '0' : '1')
      return !o
    })
  }

  function changePageSize(n) {
    setPageSize(n)
    writeStore(SIZE_KEY, String(n))
    setPage(0)
  }

  // Khoảng thời gian [from, to] (ms) của bộ lọc hoạt động
  const range = useMemo(() => {
    if (!act) return null
    const now = activity.at
    if (act === 'idle') return { cutoff: now - Number(period) * DAY }
    if (period === 'custom') {
      const f = dFrom ? dayStart(dFrom) : null
      const t = dTo ? dayStart(dTo) : null
      return { from: f ?? -Infinity, to: t !== null ? t + DAY - 1 : Infinity }
    }
    if (period === '1') {
      const s = new Date(now)
      s.setHours(0, 0, 0, 0)
      return { from: s.getTime(), to: Infinity }
    }
    return { from: now - Number(period) * DAY, to: Infinity }
    // activity.at: mốc "bây giờ" được cập nhật mỗi khi lịch sử được tải lại
  }, [act, period, dFrom, dTo, activity.at])

  /** Sự kiện hiện ở cột "Hoạt động gần nhất" (theo đúng bộ lọc đang chọn) */
  const activityOf = useCallback((c) => {
    const created = c.created_at ? new Date(c.created_at).getTime() : null
    if (act === 'new') return created !== null ? { type: 'new', t: created } : null
    if (activity.status === 'loading') return null // chưa có lịch sử: hiện "…" thay vì đoán
    const list = activity.byComponent.get(c.id)
    if (act && ACTS[act].types) return lastEvent(list, ACTS[act].types, range.from, range.to)
    return lastEvent(list) ?? (created !== null ? { type: 'new', t: created } : null)
  }, [act, range, activity])

  // Chuỗi tìm kiếm (bỏ dấu) + các giá trị số của từng linh kiện, để gõ "10k" ra cả "10kΩ" lẫn "10000"
  const searchIndex = useMemo(
    () =>
      new Map(
        components.map((c) => [
          c.id,
          {
            text: normalize(
              [
                c.part_number,
                c.name,
                c.value,
                c.package,
                c.manufacturer,
                categoriesById.get(c.category_id)?.path ?? c.category_name,
                (stockByComponent.get(c.id) ?? []).map((s) => s.path).join(' '),
                c.notes,
              ]
                .filter(Boolean)
                .join(' '),
            ),
            qtys: quantitiesIn(c.value, c.name),
          },
        ]),
      ),
    [components, categoriesById, stockByComponent],
  )

  // Lọc mọi thứ trừ trạng thái tồn: để đếm số mã trên các nút Tất cả / Còn hàng / Sắp hết / Hết hàng
  const base = useMemo(() => {
    const terms = parseQuery(q)
    // Lọc theo một danh mục thì tính luôn mọi danh mục nằm bên trong nó
    const catIds = cat && cat !== 'none' ? new Set(subtreeIds(categoryChildren, cat)) : null
    return components.filter((c) => {
      if (terms.length && !matches(searchIndex.get(c.id) ?? { text: '', qtys: [] }, terms)) return false
      if (cat === 'none' && c.category_id) return false
      if (catIds && !catIds.has(c.category_id)) return false
      if (pkg && c.package !== pkg) return false
      if (loc && !(stockByComponent.get(c.id) ?? []).some((s) => s.location_id === loc)) return false
      if (noPrice && Number(c.unit_price) > 0) return false
      if (qmin !== null || qmax !== null) {
        // Đã chọn vị trí thì so số lượng tại đúng vị trí đó, chưa chọn thì so tổng tồn
        const n = loc ? (stockMap.get(`${c.id}|${loc}`) ?? 0) : Number(c.total_quantity) || 0
        if (qmin !== null && n < qmin) return false
        if (qmax !== null && n > qmax) return false
      }
      if (act) {
        const created = c.created_at ? new Date(c.created_at).getTime() : null
        if (act === 'new') {
          if (created === null || created < range.from || created > range.to) return false
        } else if (act === 'idle') {
          const move = lastEvent(activity.byComponent.get(c.id), ['in', 'out'])
          const ref = move?.t ?? created
          if (ref === null || ref >= range.cutoff) return false
        } else if (!lastEvent(activity.byComponent.get(c.id), ACTS[act].types, range.from, range.to)) {
          return false
        }
      }
      return true
    })
  }, [
    components,
    searchIndex,
    stockByComponent,
    stockMap,
    categoryChildren,
    q,
    cat,
    pkg,
    loc,
    noPrice,
    qmin,
    qmax,
    act,
    range,
    activity,
  ])

  const statusCounts = useMemo(() => {
    const n = { '': base.length, ok: 0, low: 0, out: 0 }
    for (const c of base) n[c.status] = (n[c.status] ?? 0) + 1
    return n
  }, [base])

  const filtered = useMemo(() => {
    if (!stt) return base
    if (stt === 'warn') return base.filter((c) => c.status !== 'ok')
    return base.filter((c) => c.status === stt)
  }, [base, stt])

  // Số liệu tính theo đúng danh sách đang lọc
  const stats = useMemo(() => stockStats(filtered), [filtered])

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1
    const get = (c) =>
      sort.key === 'status'
        ? STATUS_ORDER[c.status]
        : sort.key === 'activity'
          ? (activityOf(c)?.t ?? null)
          : sort.key === 'stock_value'
            ? Number(c.unit_price) > 0
              ? Number(c.stock_value) || 0
              : null
            : c[sort.key]
    return [...filtered].sort((a, b) => {
      const x = get(a)
      const y = get(b)
      const xe = x === null || x === undefined || x === ''
      const ye = y === null || y === undefined || y === ''
      if (xe && ye) return 0
      if (xe) return 1 // ô trống luôn nằm cuối
      if (ye) return -1
      if (typeof x === 'number' || sort.key === 'unit_price' || sort.key === 'stock_value') return (Number(x) - Number(y)) * dir
      return String(x).localeCompare(String(y), 'vi', { numeric: true }) * dir
    })
  }, [filtered, sort, activityOf])

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const rows = sorted.slice(safePage * pageSize, (safePage + 1) * pageSize)
  const from = sorted.length === 0 ? 0 : safePage * pageSize + 1
  const to = Math.min(sorted.length, (safePage + 1) * pageSize)

  const allOnPage = rows.length > 0 && rows.every((c) => selected.has(c.id))
  const someOnPage = rows.some((c) => selected.has(c.id))

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allOnPage) rows.forEach((c) => next.delete(c.id))
      else rows.forEach((c) => next.add(c.id))
      return next
    })
  }

  function toggleOne(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSort(col) {
    setSort((s) =>
      s.key === col.key ? { key: col.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: col.key, dir: col.firstDir ?? 'asc' },
    )
  }

  // Nhãn các bộ lọc đang bật, mỗi nhãn có nút bỏ riêng
  const chips = []
  if (q) chips.push({ key: 'q', label: `Tìm: “${q}”`, clear: { q: '' } })
  if (cat) chips.push({ key: 'cat', label: `Loại: ${cat === 'none' ? 'Chưa phân loại' : (categoriesById.get(cat)?.path ?? '…')}`, clear: { cat: '' } })
  if (pkg) chips.push({ key: 'pkg', label: `Package: ${pkg}`, clear: { pkg: '' } })
  if (loc) chips.push({ key: 'loc', label: `Vị trí: ${locationsById.get(loc)?.path ?? '…'}`, clear: { loc: '' } })
  if (stt) chips.push({ key: 'stt', label: STATUS_CHIP[stt] ?? stt, clear: { stt: '', low: '' } })
  if (act) {
    let when
    if (act === 'idle') when = (IDLE_PERIODS.find((p) => p.v === period)?.label ?? `Hơn ${period} ngày`).toLowerCase()
    else if (period === 'custom')
      when = dFrom && dTo ? `${fmtDate(dFrom)} – ${fmtDate(dTo)}` : dFrom ? `từ ${fmtDate(dFrom)}` : dTo ? `đến ${fmtDate(dTo)}` : 'mọi lúc'
    else if (period === '1') when = 'hôm nay'
    else when = `${period} ngày qua`
    chips.push({ key: 'act', label: `${ACTS[act].chip}: ${when}`, clear: { act: '', d: '', from: '', to: '' } })
  }
  if (qmin !== null || qmax !== null) {
    const what = loc ? 'Tồn tại vị trí' : 'Tồn kho'
    const val =
      qmin !== null && qmax !== null
        ? qmin === qmax
          ? `bằng ${fmtNum(qmin)}`
          : `${fmtNum(qmin)} đến ${fmtNum(qmax)}`
        : qmin !== null
          ? `từ ${fmtNum(qmin)}`
          : `đến ${fmtNum(qmax)}`
    chips.push({ key: 'qty', label: `${what}: ${val}`, clear: { qmin: '', qmax: '' } })
  }
  if (noPrice) chips.push({ key: 'price', label: 'Chưa có đơn giá', clear: { price: '' } })

  function exportXlsx() {
    const list = selected.size > 0 ? sorted.filter((c) => selected.has(c.id)) : sorted
    xlsx.run({
      filename: datedName('kho-linh-kien'),
      title: arc ? 'Linh kiện ngừng dùng' : 'Danh sách linh kiện',
      subtitle: selected.size > 0 ? `${fmtNum(list.length)} mục đã chọn` : hasFilter ? 'Theo bộ lọc đang chọn' : 'Toàn bộ kho',
      sheet: 'Linh kiện',
      rows: list,
      columns: [
        { header: 'Mã linh kiện', value: (c) => c.part_number, width: 26, wrap: true },
        { header: 'Tên', value: (c) => c.name, width: 34, wrap: true },
        { header: 'Danh mục', value: (c) => categoriesById.get(c.category_id)?.path ?? c.category_name, width: 30, wrap: true },
        { header: 'Giá trị', value: (c) => c.value, width: 12 },
        { header: 'Package', value: (c) => c.package, width: 13 },
        { header: 'Hãng', value: (c) => c.manufacturer, width: 14 },
        { header: 'Tồn kho', value: (c) => c.total_quantity, type: 'int', width: 11, total: true },
        { header: 'Tối thiểu', value: (c) => c.min_stock, type: 'int', width: 11 },
        { header: 'Trạng thái', value: (c) => stockText(c.status), tone: (c) => stockTone(c.status), width: 12 },
        { header: 'Đơn giá', value: (c) => (Number(c.unit_price) > 0 ? packPrice(c.unit_price, packOf(c)) : null), type: 'money', width: 14 },
        { header: 'Tính theo', value: (c) => (packOf(c) ? `${packOf(c).unit} (${fmtNum(packOf(c).qty)} cái)` : 'cái'), width: 15 },
        { header: 'Giá trị tồn', value: (c) => (Number(c.unit_price) > 0 ? Number(c.stock_value) : null), type: 'money', width: 16, total: true },
        { header: 'Vị trí', value: (c) => (stockByComponent.get(c.id) ?? []).map((x) => `${x.path}: ${x.quantity}`).join('\n'), width: 30, wrap: true },
        { header: 'Datasheet', value: (c) => c.datasheet_url, type: 'link', linkText: 'Mở datasheet', width: 15 },
        { header: 'Ghi chú', value: (c) => c.notes, width: 30, wrap: true },
      ],
    })
  }

  if (error) {
    return (
      <EmptyState title="Chưa tải được danh sách linh kiện" text={error}>
        <button type="button" className="kk-btn kk-btn-primary" onClick={reload}>
          Thử lại
        </button>
      </EmptyState>
    )
  }

  const nowMs = activity.at
  const showRowActs = canEdit && !arc

  return (
    <div className={`kk-page ${refreshing ? 'is-refreshing' : ''}`}>
      <div className="kk-page-head">
        <div>
          <h1>Linh kiện</h1>
          <p>
            {loading ? 'Đang tải…' : `${fmtNum(components.length)} mã${arc ? ' ngừng dùng' : ''}`}
            {!loading && hasFilter ? `, đang hiện ${fmtNum(filtered.length)}` : ''}
          </p>
        </div>
        <div className="kk-quick">
          {canEdit && (
            <>
              <button type="button" className="kk-btn kk-btn-primary" onClick={() => openForm(null)}>
                <PackagePlus size={18} />
                Thêm linh kiện
              </button>
              <button type="button" className="kk-btn kk-btn-outline kk-c-in" onClick={() => openTx({ type: 'in' })}>
                <ArrowDownToLine size={18} />
                Nhập / xuất kho
              </button>
              <button type="button" className="kk-btn kk-btn-outline" onClick={openImport}>
                <Upload size={18} />
                Nhập CSV
              </button>
            </>
          )}
          <button type="button" className="kk-btn kk-btn-outline" onClick={exportXlsx} disabled={components.length === 0 || xlsx.busy}>
            <Download size={18} />
            {xlsx.busy ? 'Đang xuất…' : 'Xuất Excel'}
          </button>
        </div>
      </div>

      {!loading && components.length > 0 && (
        <section className="kk-stats kk-stats-3" aria-label="Số liệu linh kiện">
          <StockStatCards
            stats={stats}
            scope={arc ? 'ngừng dùng' : hasFilter ? 'theo bộ lọc' : undefined}
            onMissing={noPrice ? undefined : () => setParam('price', 'none')}
          />
        </section>
      )}

      <div className="kk-card kk-toolbar kk-cp-toolbar">
        <div className="kk-cp-row">
          <div className="kk-search kk-search-page">
            <Search size={18} aria-hidden="true" />
            <input
              data-global-search
              type="search"
              value={q}
              placeholder="Tìm mã, tên, giá trị (10k, 4k7, 100nF), package, vị trí…"
              aria-label="Tìm linh kiện"
              onChange={(e) => setParam('q', e.target.value)}
            />
          </div>
          <CategoryFilter value={cat} onChange={(id) => setParam('cat', id)} />
          <select aria-label="Lọc theo package" value={pkg} onChange={(e) => setParam('pkg', e.target.value)}>
            <option value="">Mọi package</option>
            {packages.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select aria-label="Lọc theo vị trí" value={loc} onChange={(e) => setParam('loc', e.target.value)}>
            <option value="">Mọi vị trí</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.path}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`kk-btn kk-btn-outline kk-cp-advbtn ${advCount ? 'is-set' : ''}`}
            aria-expanded={panelOpen}
            aria-controls="kk-cp-adv"
            onClick={togglePanel}
          >
            <SlidersHorizontal size={17} aria-hidden="true" />
            Lọc nâng cao
            {advCount > 0 && <span className="kk-cp-count">{advCount}</span>}
            <ChevronDown size={16} aria-hidden="true" className={panelOpen ? 'kk-cp-flip' : ''} />
          </button>
        </div>

        <div className="kk-cp-row kk-cp-row2">
          <div className="kk-cp-seg" role="group" aria-label="Lọc theo trạng thái tồn kho">
            {STATUS_TABS.map((t) => (
              <button
                key={t.v || 'all'}
                type="button"
                className={`kk-cp-seg-btn ${t.v ? `kk-cp-seg-${t.v}` : ''} ${stt === t.v ? 'is-on' : ''}`}
                aria-pressed={stt === t.v}
                onClick={() => setStatus(t.v)}
              >
                {t.label}
                <span className="kk-cp-seg-n">{loading || waitingTx ? '…' : fmtNum(statusCounts[t.v] ?? 0)}</span>
              </button>
            ))}
          </div>
          <div className="kk-cp-presets" role="group" aria-label="Bộ lọc nhanh">
            <span className="kk-cp-presets-label">Lọc nhanh</span>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className={`kk-pill kk-cp-pill ${presetOn(p) ? 'is-on' : ''}`}
                aria-pressed={presetOn(p)}
                title={p.title}
                onClick={() => applyPreset(p)}
              >
                {p.label}
              </button>
            ))}
          </div>
          {(arc || archivedComponents.length > 0) && (
            <label className="kk-switch kk-cp-arc">
              <input type="checkbox" checked={arc} onChange={(e) => setParam('arc', e.target.checked ? '1' : '')} />
              <span className="kk-switch-track" aria-hidden="true" />
              Xem linh kiện ngừng dùng ({fmtNum(archivedComponents.length)})
            </label>
          )}
        </div>

        {panelOpen && (
          <div className="kk-cp-adv" id="kk-cp-adv">
            <fieldset className="kk-cp-group">
              <legend>Hoạt động</legend>
              <select aria-label="Lọc theo hoạt động" value={act} onChange={(e) => setAct(e.target.value)}>
                <option value="">Mọi linh kiện</option>
                {Object.entries(ACTS).map(([k, a]) => (
                  <option key={k} value={k}>
                    {a.label}
                  </option>
                ))}
              </select>
              {act && (
                <div className="kk-cp-pills" role="group" aria-label="Khoảng thời gian">
                  {(act === 'idle' ? IDLE_PERIODS : RECENT_PERIODS).map((p) => (
                    <button
                      key={p.v}
                      type="button"
                      className={`kk-pill kk-cp-pill ${period === p.v ? 'is-on' : ''}`}
                      aria-pressed={period === p.v}
                      onClick={() => update({ d: p.v, ...(p.v === 'custom' ? {} : { from: '', to: '' }) })}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
              {act && act !== 'idle' && period === 'custom' && (
                <div className="kk-cp-pair">
                  <label>
                    <span>Từ ngày</span>
                    <input type="date" value={dFrom} max={dTo || undefined} onChange={(e) => setParam('from', e.target.value)} />
                  </label>
                  <label>
                    <span>Đến ngày</span>
                    <input type="date" value={dTo} min={dFrom || undefined} onChange={(e) => setParam('to', e.target.value)} />
                  </label>
                </div>
              )}
              <p className="kk-cp-hint">
                {act === 'idle'
                  ? 'Món không có lần nhập hay xuất nào trong khoảng này (kiểm kê không tính).'
                  : act === 'new'
                    ? 'Món được tạo mới trong kho trong khoảng này.'
                    : act
                      ? 'Món có ít nhất một lần như vậy trong khoảng này.'
                      : 'Tìm món mới về, mới xuất, mới kiểm kê hoặc hàng lâu không dùng tới.'}
                {needsTx && activity.status === 'error' ? ` Chưa tải được lịch sử: ${activity.error}` : ''}
              </p>
            </fieldset>

            <fieldset className="kk-cp-group">
              <legend>{loc ? 'Số lượng tại vị trí đã chọn' : 'Số lượng tồn kho'}</legend>
              <div className="kk-cp-pair">
                <label>
                  <span>Từ</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    placeholder="0"
                    value={qminRaw}
                    onChange={(e) => setParam('qmin', e.target.value)}
                  />
                </label>
                <label>
                  <span>Đến</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    placeholder="Không giới hạn"
                    value={qmaxRaw}
                    onChange={(e) => setParam('qmax', e.target.value)}
                  />
                </label>
              </div>
              <div className="kk-cp-pills" role="group" aria-label="Khoảng số lượng hay dùng">
                {QTY_PRESETS.map((p) => {
                  const on = qminRaw === p.min && qmaxRaw === p.max
                  return (
                    <button
                      key={p.label}
                      type="button"
                      className={`kk-pill kk-cp-pill ${on ? 'is-on' : ''}`}
                      aria-pressed={on}
                      onClick={() => update(on ? { qmin: '', qmax: '' } : { qmin: p.min, qmax: p.max })}
                    >
                      {p.label}
                    </button>
                  )
                })}
              </div>
              <p className="kk-cp-hint">
                {loc ? 'Đang so số lượng nằm ở đúng vị trí đã chọn, không phải tổng tồn.' : 'Chọn một vị trí ở trên để lọc theo số lượng tại riêng chỗ đó.'}
              </p>
            </fieldset>

            <fieldset className="kk-cp-group">
              <legend>Khác</legend>
              <label className="kk-switch">
                <input type="checkbox" checked={noPrice} onChange={(e) => setParam('price', e.target.checked ? 'none' : '')} />
                <span className="kk-switch-track" aria-hidden="true" />
                Chưa có đơn giá
              </label>
            </fieldset>
          </div>
        )}
      </div>

      {chips.length > 0 && (
        <div className="kk-cp-chips" aria-label="Bộ lọc đang bật">
          {chips.map((c) => (
            <span key={c.key} className="kk-cp-chip">
              {c.label}
              <button type="button" aria-label={`Bỏ lọc ${c.label}`} onClick={() => update(c.clear)}>
                <X size={14} aria-hidden="true" />
              </button>
            </span>
          ))}
          <button type="button" className="kk-link" onClick={clearFilters}>
            Xóa tất cả
          </button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="kk-bulk" role="region" aria-label="Thao tác với mục đã chọn">
          <strong>Đã chọn {fmtNum(selected.size)}</strong>
          {canEdit && (
            <button type="button" className="kk-btn kk-btn-soft kk-btn-sm" onClick={() => openTx({ type: 'in', componentIds: [...selected] })}>
              Nhập / xuất các mục này
            </button>
          )}
          <button type="button" className="kk-btn kk-btn-soft kk-btn-sm" onClick={exportXlsx} disabled={xlsx.busy}>
            <Download size={16} />
            Xuất Excel
          </button>
          <button type="button" className="kk-btn kk-btn-ghost kk-btn-sm" onClick={() => setSelected(new Set())}>
            <X size={16} />
            Bỏ chọn
          </button>
        </div>
      )}

      <div className="kk-card kk-table-card">
        {loading || waitingTx ? (
          <div className="kk-skel-list">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} h={52} r={10} />
            ))}
          </div>
        ) : arc && components.length === 0 ? (
          <EmptyState title="Không có linh kiện nào đang ngừng dùng" text="Tắt công tắc để quay lại danh sách linh kiện đang dùng.">
            <button type="button" className="kk-btn kk-btn-outline" onClick={() => setParam('arc', '')}>
              Về danh sách đang dùng
            </button>
          </EmptyState>
        ) : components.length === 0 ? (
          <EmptyState
            title="Chưa có linh kiện nào"
            text={canEdit ? 'Thêm món đầu tiên của bạn nhé, hoặc nhập cả danh sách từ file CSV.' : 'Kho đang trống. Khi có người thêm linh kiện, bạn sẽ thấy ở đây.'}
          >
            {canEdit && (
              <>
                <button type="button" className="kk-btn kk-btn-primary" onClick={() => openForm(null)}>
                  <PackagePlus size={18} />
                  Thêm linh kiện
                </button>
                <button type="button" className="kk-btn kk-btn-outline" onClick={openImport}>
                  <Upload size={18} />
                  Nhập từ CSV
                </button>
              </>
            )}
          </EmptyState>
        ) : sorted.length === 0 ? (
          <EmptyState title="Không tìm thấy linh kiện nào" text="Thử đổi từ khóa hoặc bỏ bớt bộ lọc.">
            <button type="button" className="kk-btn kk-btn-outline" onClick={clearFilters}>
              Xóa bộ lọc
            </button>
          </EmptyState>
        ) : (
          <>
            <div className="kk-table-scroll">
              <table className="kk-table kk-cp-table">
                <thead>
                  <tr>
                    <th className="kk-col-check">
                      <input
                        type="checkbox"
                        aria-label="Chọn tất cả trên trang này"
                        checked={allOnPage}
                        ref={(el) => {
                          if (el) el.indeterminate = !allOnPage && someOnPage
                        }}
                        onChange={toggleAll}
                      />
                    </th>
                    {COLUMNS.map((col) => {
                      const keys = [col.key, col.extra?.key].filter(Boolean)
                      const sortBtn = (c, small) => (
                        <button type="button" className={`kk-sort ${small ? 'kk-cp-sort-sub' : ''}`} onClick={() => toggleSort(c)}>
                          {c.title}
                          {sort.key === c.key ? (
                            sort.dir === 'asc' ? (
                              <ArrowUp size={small ? 12 : 14} />
                            ) : (
                              <ArrowDown size={small ? 12 : 14} />
                            )
                          ) : (
                            <ArrowDownUp size={small ? 12 : 14} className="kk-sort-idle" />
                          )}
                        </button>
                      )
                      return (
                        <th
                          key={col.key}
                          className={`${col.cls ?? ''} ${col.num ? 'is-num' : ''}`}
                          aria-sort={
                            keys.includes(sort.key) ? (sort.dir === 'asc' ? 'ascending' : 'descending') : col.sortable ? 'none' : undefined
                          }
                        >
                          {!col.sortable ? (
                            col.title
                          ) : col.extra ? (
                            <span className="kk-cp-th2">
                              {sortBtn(col)}
                              {sortBtn(col.extra, true)}
                            </span>
                          ) : (
                            sortBtn(col)
                          )}
                        </th>
                      )
                    })}
                    {showRowActs && (
                      <th className="kk-col-rowact">
                        <span className="kk-cp-sr">Nhập / xuất nhanh</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    // Vị trí đang lọc đứng đầu, rồi tới các chỗ khác
                    const all = stockByComponent.get(c.id) ?? []
                    const where = loc ? [...all.filter((w) => w.location_id === loc), ...all.filter((w) => w.location_id !== loc)] : all
                    const isNew = c.created_at && nowMs - new Date(c.created_at).getTime() < NEW_DAYS * DAY
                    const ev = activityOf(c)
                    const periodSum =
                      act && ACTS[act].types && act !== 'adjust'
                        ? sumEvents(activity.byComponent.get(c.id), act, range.from, range.to)
                        : 0
                    return (
                      <tr key={c.id} className={selected.has(c.id) ? 'is-selected' : ''} onClick={() => openComponent(c.id)}>
                        <td className="kk-col-check" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Chọn ${c.part_number}`}
                            checked={selected.has(c.id)}
                            onChange={() => toggleOne(c.id)}
                          />
                        </td>
                        <td data-label="Linh kiện" className="kk-cell-main">
                          <div className="kk-cell-media">
                            <RowThumb url={c.image_url} />
                            <div className="kk-cell-body">
                              <span className="kk-cp-title">
                                <button
                                  type="button"
                                  className="kk-row-link"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    openComponent(c.id)
                                  }}
                                >
                                  {c.part_number}
                                </button>
                                {isNew && (
                                  <span className="kk-cp-new" title={`Thêm vào kho ${fmtDateTime(c.created_at)}`}>
                                    Mới
                                  </span>
                                )}
                              </span>
                              {c.archived_at && <span className="kk-chip kk-chip-none kk-chip-archived">Ngừng dùng</span>}
                              <span className="kk-cell-sub">
                                <span className="kk-cell-name">
                                  {c.value && !normalize(c.name).includes(normalize(c.value))
                                    ? `${c.name}, ${c.value}`
                                    : c.name}
                                </span>
                                <CategoryChip
                                  name={c.category_name}
                                  tone={toneByCategory.get(c.category_id)}
                                  title={categoriesById.get(c.category_id)?.path}
                                />
                              </span>
                            </div>
                          </div>
                        </td>
                        <td data-label="Package" className="kk-col-pkg">
                          {c.package || '—'}
                        </td>
                        <td data-label="Vị trí" className="kk-col-loc">
                          {where.length === 0 ? (
                            '—'
                          ) : (
                            <div className="kk-cp-locs" title={where.map((w) => `${w.path}: ${fmtNum(w.quantity)}`).join('\n')}>
                              {where.slice(0, 2).map((w) => (
                                <span key={w.location_id} className={`kk-cp-loc ${w.location_id === loc ? 'is-hit' : ''}`}>
                                  <span className="kk-cp-loc-path">{w.path}</span>
                                  <b className="kk-cp-loc-qty">{fmtNum(w.quantity)}</b>
                                </span>
                              ))}
                              {where.length > 2 && <em className="kk-more">+{where.length - 2} chỗ khác</em>}
                            </div>
                          )}
                        </td>
                        <td data-label="Tồn kho">
                          <div className="kk-cp-stockcell">
                            <StockBar qty={c.total_quantity} min={c.min_stock} status={c.status} />
                            <StatusChip status={c.status} />
                          </div>
                        </td>
                        <td data-label="Hoạt động" className="kk-col-activity">
                          <ActivityCell ev={ev} loading={activity.status === 'loading'} periodSum={periodSum} act={act} now={nowMs} />
                        </td>
                        <td data-label="Giá trị" className="kk-col-money is-num">
                          <div className="kk-cp-money">
                            <strong>{Number(c.unit_price) > 0 ? fmtMoneyFull(c.stock_value) : '—'}</strong>
                            <span className="kk-cp-unit">
                              <span className="kk-cp-unit-label">Đơn giá</span>
                              <ComponentPrice comp={c} />
                            </span>
                          </div>
                        </td>
                        {showRowActs && (
                          <td className="kk-col-rowact" onClick={(e) => e.stopPropagation()}>
                            <div className="kk-cp-rowact">
                              <button
                                type="button"
                                className="kk-icon-btn kk-cp-act-in"
                                title="Nhập kho"
                                aria-label={`Nhập kho ${c.part_number}`}
                                onClick={() => openTx({ type: 'in', componentId: c.id, locationId: loc || undefined })}
                              >
                                <ArrowDownToLine size={17} />
                              </button>
                              <button
                                type="button"
                                className="kk-icon-btn kk-cp-act-out"
                                title={c.total_quantity > 0 ? 'Xuất kho' : 'Hết hàng, không xuất được'}
                                aria-label={`Xuất kho ${c.part_number}`}
                                disabled={!(c.total_quantity > 0)}
                                onClick={() => openTx({ type: 'out', componentId: c.id })}
                              >
                                <ArrowUpFromLine size={17} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="kk-pager">
              <span>
                Hiển thị {fmtNum(from)} đến {fmtNum(to)} trong {fmtNum(sorted.length)} linh kiện
              </span>
              <div className="kk-cp-pager">
                <label className="kk-cp-size">
                  <span>Mỗi trang</span>
                  <select aria-label="Số dòng mỗi trang" value={pageSize} onChange={(e) => changePageSize(Number(e.target.value))}>
                    {PAGE_SIZES.map((n) => (
                      <option key={n} value={n}>
                        {n} dòng
                      </option>
                    ))}
                  </select>
                </label>
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
          </>
        )}
      </div>
    </div>
  )
}

const EV = {
  in: { Icon: ArrowDownToLine, label: 'Nhập', cls: 'in' },
  out: { Icon: ArrowUpFromLine, label: 'Xuất', cls: 'out' },
  adjust: { Icon: SlidersHorizontal, label: 'Kiểm kê', cls: 'adjust' },
  new: { Icon: PackagePlus, label: 'Thêm vào kho', cls: 'new' },
}

/** Cột "Hoạt động gần nhất": loại giao dịch, số lượng và bao lâu trước */
function ActivityCell({ ev, loading, periodSum, act, now }) {
  if (!ev) return loading ? <span className="kk-cp-muted">…</span> : <span className="kk-cp-muted">Chưa có</span>
  const e = EV[ev.type] ?? EV.adjust
  let amount = ''
  if (ev.type === 'in') amount = ` +${fmtNum(ev.quantity)}`
  else if (ev.type === 'out') amount = ` −${fmtNum(ev.quantity)}`
  else if (ev.type === 'adjust') {
    const dlt = Number(ev.delta)
    amount = !Number.isFinite(dlt) || ev.delta === null ? ` còn ${fmtNum(ev.quantity)}` : dlt === 0 ? ' (khớp)' : ` ${dlt > 0 ? '+' : '−'}${fmtNum(Math.abs(dlt))}`
  }
  const iso = new Date(ev.t).toISOString()
  return (
    <span className="kk-cp-ev" title={fmtDateTime(iso)}>
      <span className={`kk-cp-ev-what kk-cp-ev-${e.cls}`}>
        <e.Icon size={14} aria-hidden="true" />
        {e.label}
        {amount}
      </span>
      <small>
        {timeAgo(iso, now)}
        {periodSum > 0 && periodSum !== Number(ev.quantity) && (
          <>
            {' · '}cả kỳ {act === 'out' ? '−' : '+'}
            {fmtNum(periodSum)}
          </>
        )}
      </small>
    </span>
  )
}
