import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ArrowDownToLine,
  ArrowDownUp,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  Download,
  PackagePlus,
  Search,
  Upload,
  X,
} from 'lucide-react'
import { useData } from '../data/DataContext'
import { useTx } from '../TxContext'
import { useShell } from '../ShellContext'
import { CategoryChip, EmptyState, Skeleton, StatusChip, StockBar } from '../ui/common'
import { downloadCSV } from '../lib/csv'
import { fmtNum, fmtPrice, normalize } from '../lib/format'
import { indentLabel, subtreeIds } from '../lib/tree'

const PAGE_SIZE = 25
const STATUS_ORDER = { out: 0, low: 1, ok: 2 }

const COLUMNS = [
  { key: 'part_number', title: 'Linh kiện', sortable: true },
  { key: 'package', title: 'Package', sortable: true, cls: 'kk-col-pkg' },
  { key: 'locations', title: 'Vị trí', cls: 'kk-col-loc' },
  { key: 'total_quantity', title: 'Tồn kho', sortable: true },
  { key: 'unit_price', title: 'Đơn giá', sortable: true, cls: 'kk-col-price', num: true },
  { key: 'status', title: 'Trạng thái', sortable: true },
]

export default function ComponentsPage() {
  const {
    components,
    categories,
    categoriesById,
    categoryChildren,
    locations,
    packages,
    stockByComponent,
    toneByCategory,
    searchText,
    loading,
    refreshing,
    error,
    reload,
  } = useData()
  const { openTx } = useTx()
  const { openComponent, openForm, openImport, canEdit } = useShell()
  const [params, setParams] = useSearchParams()
  const [sort, setSort] = useState({ key: 'part_number', dir: 'asc' })
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState(() => new Set())

  const q = params.get('q') ?? ''
  const cat = params.get('cat') ?? ''
  const pkg = params.get('pkg') ?? ''
  const loc = params.get('loc') ?? ''
  const low = params.get('low') === '1'
  const hasFilter = Boolean(q || cat || pkg || loc || low)

  function setParam(key, value) {
    // Dùng dạng hàm để luôn lấy bộ lọc mới nhất, kể cả khi gõ phím rất nhanh
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )
    setPage(0)
  }

  function clearFilters() {
    setParams(new URLSearchParams(), { replace: true })
    setPage(0)
  }

  const filtered = useMemo(() => {
    const terms = normalize(q).split(/\s+/).filter(Boolean)
    // Lọc theo một danh mục thì tính luôn mọi danh mục nằm bên trong nó
    const catIds = cat && cat !== 'none' ? new Set(subtreeIds(categoryChildren, cat)) : null
    return components.filter((c) => {
      if (terms.length) {
        const text = searchText.get(c.id) ?? ''
        if (!terms.every((t) => text.includes(t))) return false
      }
      if (cat === 'none' && c.category_id) return false
      if (catIds && !catIds.has(c.category_id)) return false
      if (pkg && c.package !== pkg) return false
      if (loc && !(stockByComponent.get(c.id) ?? []).some((s) => s.location_id === loc)) return false
      if (low && c.status === 'ok') return false
      return true
    })
  }, [components, searchText, stockByComponent, categoryChildren, q, cat, pkg, loc, low])

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1
    const get = (c) => (sort.key === 'status' ? STATUS_ORDER[c.status] : c[sort.key])
    return [...filtered].sort((a, b) => {
      const x = get(a)
      const y = get(b)
      const xe = x === null || x === undefined || x === ''
      const ye = y === null || y === undefined || y === ''
      if (xe && ye) return 0
      if (xe) return 1 // ô trống luôn nằm cuối
      if (ye) return -1
      if (typeof x === 'number' || sort.key === 'unit_price') return (Number(x) - Number(y)) * dir
      return String(x).localeCompare(String(y), 'vi', { numeric: true }) * dir
    })
  }, [filtered, sort])

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const rows = sorted.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)
  const from = sorted.length === 0 ? 0 : safePage * PAGE_SIZE + 1
  const to = Math.min(sorted.length, (safePage + 1) * PAGE_SIZE)

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

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }

  function exportCsv() {
    const list = selected.size > 0 ? sorted.filter((c) => selected.has(c.id)) : sorted
    const header = [
      'part_number',
      'name',
      'category',
      'value',
      'package',
      'manufacturer',
      'min_stock',
      'unit_price',
      'total_quantity',
      'locations',
      'datasheet_url',
      'notes',
    ]
    const body = list.map((c) => [
      c.part_number,
      c.name,
      categoriesById.get(c.category_id)?.path ?? c.category_name,
      c.value,
      c.package,
      c.manufacturer,
      c.min_stock,
      c.unit_price,
      c.total_quantity,
      (stockByComponent.get(c.id) ?? []).map((s) => `${s.path}: ${s.quantity}`).join('; '),
      c.datasheet_url,
      c.notes,
    ])
    downloadCSV(`kho-linh-kien-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...body])
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

  return (
    <div className={`kk-page ${refreshing ? 'is-refreshing' : ''}`}>
      <div className="kk-page-head">
        <div>
          <h1>Linh kiện</h1>
          <p>
            {loading ? 'Đang tải…' : `${fmtNum(components.length)} mã`}
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
              <button type="button" className="kk-btn kk-btn-outline" onClick={() => openTx({ type: 'in' })}>
                <ArrowDownToLine size={18} />
                Nhập / xuất kho
              </button>
              <button type="button" className="kk-btn kk-btn-outline" onClick={openImport}>
                <Upload size={18} />
                Nhập CSV
              </button>
            </>
          )}
          <button type="button" className="kk-btn kk-btn-outline" onClick={exportCsv} disabled={components.length === 0}>
            <Download size={18} />
            Xuất CSV
          </button>
        </div>
      </div>

      <div className="kk-card kk-toolbar">
        <div className="kk-search kk-search-page">
          <Search size={18} aria-hidden="true" />
          <input
            data-global-search
            type="search"
            value={q}
            placeholder="Tìm theo mã, tên, giá trị, package…"
            aria-label="Tìm linh kiện"
            onChange={(e) => setParam('q', e.target.value)}
          />
        </div>
        <select aria-label="Lọc theo loại" value={cat} onChange={(e) => setParam('cat', e.target.value)}>
          <option value="">Mọi loại</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {indentLabel(c)}
            </option>
          ))}
          <option value="none">Chưa phân loại</option>
        </select>
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
        <label className="kk-switch">
          <input type="checkbox" checked={low} onChange={(e) => setParam('low', e.target.checked ? '1' : '')} />
          <span className="kk-switch-track" aria-hidden="true" />
          Chỉ hiện sắp hết
        </label>
        {hasFilter && (
          <button type="button" className="kk-link" onClick={clearFilters}>
            Xóa bộ lọc
          </button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="kk-bulk" role="region" aria-label="Thao tác với mục đã chọn">
          <strong>Đã chọn {fmtNum(selected.size)}</strong>
          {canEdit && (
            <button type="button" className="kk-btn kk-btn-soft kk-btn-sm" onClick={() => openTx({ type: 'in', componentIds: [...selected] })}>
              Nhập / xuất các mục này
            </button>
          )}
          <button type="button" className="kk-btn kk-btn-soft kk-btn-sm" onClick={exportCsv}>
            <Download size={16} />
            Xuất CSV
          </button>
          <button type="button" className="kk-btn kk-btn-ghost kk-btn-sm" onClick={() => setSelected(new Set())}>
            <X size={16} />
            Bỏ chọn
          </button>
        </div>
      )}

      <div className="kk-card kk-table-card">
        {loading ? (
          <div className="kk-skel-list">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} h={52} r={10} />
            ))}
          </div>
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
              <table className="kk-table">
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
                    {COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        className={`${col.cls ?? ''} ${col.num ? 'is-num' : ''}`}
                        aria-sort={
                          sort.key === col.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : col.sortable ? 'none' : undefined
                        }
                      >
                        {col.sortable ? (
                          <button type="button" className="kk-sort" onClick={() => toggleSort(col.key)}>
                            {col.title}
                            {sort.key === col.key ? (
                              sort.dir === 'asc' ? (
                                <ArrowUp size={14} />
                              ) : (
                                <ArrowDown size={14} />
                              )
                            ) : (
                              <ArrowDownUp size={14} className="kk-sort-idle" />
                            )}
                          </button>
                        ) : (
                          col.title
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const where = stockByComponent.get(c.id) ?? []
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
                        </td>
                        <td data-label="Package" className="kk-col-pkg">
                          {c.package || '—'}
                        </td>
                        <td data-label="Vị trí" className="kk-col-loc">
                          {where.length === 0 ? (
                            '—'
                          ) : (
                            <span title={where.map((w) => `${w.path}: ${w.quantity}`).join('\n')}>
                              {where[0].path}
                              {where.length > 1 && <em className="kk-more"> +{where.length - 1}</em>}
                            </span>
                          )}
                        </td>
                        <td data-label="Tồn kho">
                          <StockBar qty={c.total_quantity} min={c.min_stock} status={c.status} />
                        </td>
                        <td data-label="Đơn giá" className="kk-col-price is-num">
                          {fmtPrice(c.unit_price)}
                        </td>
                        <td data-label="Trạng thái">
                          <StatusChip status={c.status} />
                        </td>
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
          </>
        )}
      </div>
    </div>
  )
}
