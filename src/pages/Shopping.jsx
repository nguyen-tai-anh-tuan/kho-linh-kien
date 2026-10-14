import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowDownToLine, ChevronLeft, ChevronRight, ClipboardCopy, Download, Search } from 'lucide-react'
import { useData } from '../data/DataContext'
import PurchasePlan, { usePurchaseItems } from './PurchasePlan'
import { useBuyList } from '../data/useBuyList'
import { useTx } from '../TxContext'
import { useShell } from '../ShellContext'
import { useToast } from '../ui/Toast'
import { CategoryChip, EmptyState, Skeleton, StatusChip, StockBar } from '../ui/common'
import { CategoryFilter } from '../ui/CategoryMenu'
import { downloadCSV } from '../lib/csv'
import { fmtMoneyFull, fmtNum, fmtPrice, normalize } from '../lib/format'
import { subtreeIds } from '../lib/tree'

const KINDS = [
  { key: '', label: 'Tất cả' },
  { key: 'out', label: 'Hết hàng' },
  { key: 'low', label: 'Sắp hết' },
  { key: 'bom', label: 'Thiếu cho dự án' },
]

// Mỗi linh kiện hiện tối đa chừng này nhãn dự án, còn lại gộp vào "+N dự án khác"
const MAX_TAGS = 3
const PAGE_SIZE = 10

/** Trang "Cần mua": mọi linh kiện đang hết hàng hoặc dưới mức tồn tối thiểu */
export default function ShoppingPage() {
  const { categoriesById, categoryChildren, toneByCategory, searchText, loading, refreshing, error, reload, version } = useData()
  const { openTx } = useTx()
  const { openComponent, canEdit } = useShell()
  const toast = useToast()
  const [params, setParams] = useSearchParams()

  const tab = params.get('tab') === 'plan' ? 'plan' : 'auto' // 'auto' = theo tồn kho, 'plan' = danh sách mua trước
  const planItems = usePurchaseItems(version)
  const q = params.get('q') ?? ''
  const kind = params.get('kind') ?? ''
  const cat = params.get('cat') ?? ''
  const hasFilter = Boolean(q || kind || cat)

  function setParam(key, value) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )
  }

  const { bomByComponent, toBuy, need } = useBuyList()
  const bomShort = (c) => bomByComponent.get(c.id)?.short ?? 0

  const outCount = toBuy.filter((c) => c.status === 'out').length
  const lowCount = toBuy.filter((c) => c.status === 'low').length
  const bomCount = toBuy.filter((c) => bomShort(c) > 0).length

  const rows = useMemo(() => {
    const terms = normalize(q).split(/\s+/).filter(Boolean)
    const catIds = cat && cat !== 'none' ? new Set(subtreeIds(categoryChildren, cat)) : null
    return toBuy.filter((c) => {
      if (kind === 'bom' ? !((bomByComponent.get(c.id)?.short ?? 0) > 0) : kind && c.status !== kind) return false
      if (cat === 'none' && c.category_id) return false
      if (catIds && !catIds.has(c.category_id)) return false
      if (terms.length) {
        const text = searchText.get(c.id) ?? ''
        if (!terms.every((t) => text.includes(t))) return false
      }
      return true
    })
  }, [toBuy, bomByComponent, searchText, categoryChildren, q, kind, cat])

  // Chia trang; chép danh sách, xuất CSV và ước tính chi phí vẫn tính trên toàn bộ danh sách đang lọc
  const [paging, setPaging] = useState({ key: '', page: 0 })
  const pagingKey = `${q}|${kind}|${cat}`
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const page = Math.min(paging.key === pagingKey ? paging.page : 0, pageCount - 1)
  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const goTo = (n) => setPaging({ key: pagingKey, page: n })

  const priced = rows.filter((c) => Number(c.unit_price) > 0)
  const cost = priced.reduce((sum, c) => sum + need(c) * Number(c.unit_price), 0)

  function exportCsv() {
    const header = ['part_number', 'name', 'category', 'package', 'manufacturer', 'total_quantity', 'min_stock', 'project_need', 'need', 'unit_price', 'amount']
    const body = rows.map((c) => [
      c.part_number,
      c.name,
      categoriesById.get(c.category_id)?.path ?? c.category_name,
      c.package,
      c.manufacturer,
      c.total_quantity,
      c.min_stock,
      bomByComponent.get(c.id)?.total ?? 0,
      need(c),
      c.unit_price,
      Number(c.unit_price) > 0 ? need(c) * Number(c.unit_price) : '',
    ])
    downloadCSV(`can-mua-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...body])
  }

  async function copyList() {
    const text = rows.map((c) => `${c.part_number} x ${need(c)}${c.package ? ` (${c.package})` : ''}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast.push({ message: `Đã chép ${fmtNum(rows.length)} dòng. Dán vào tin nhắn hoặc ô tìm kiếm của nơi bán.` })
    } catch {
      toast.push({ tone: 'error', message: 'Trình duyệt không cho chép. Bạn dùng nút Xuất CSV nhé.' })
    }
  }

  const tabs = (
    <div className="kk-seg kk-seg-2 kk-buy-tabs" role="tablist" aria-label="Loại danh sách">
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'auto'}
        className={`kk-seg-btn ${tab === 'auto' ? 'is-on' : ''}`}
        onClick={() => setParams(new URLSearchParams(), { replace: true })}
      >
        Theo tồn kho
        {toBuy.length > 0 && <span className="kk-badge">{fmtNum(toBuy.length)}</span>}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'plan'}
        className={`kk-seg-btn ${tab === 'plan' ? 'is-on' : ''}`}
        onClick={() => setParams(new URLSearchParams({ tab: 'plan' }), { replace: true })}
      >
        Danh sách mua trước
        {planItems.rows?.length > 0 && <span className="kk-badge kk-badge-plan">{fmtNum(planItems.rows.length)}</span>}
      </button>
    </div>
  )

  if (tab === 'plan') {
    return (
      <div className={`kk-page ${refreshing ? 'is-refreshing' : ''}`}>
        <div className="kk-page-head">
          <div>
            <h1>Cần mua</h1>
            <p>Lên trước những món định mua, kể cả linh kiện chưa có trong kho. Mua về thì bấm “Đã mua” để nhập kho.</p>
          </div>
        </div>
        {tabs}
        <PurchasePlan items={planItems} />
      </div>
    )
  }

  if (error) {
    return (
      <EmptyState title="Chưa tải được danh sách cần mua" text={error}>
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
          <h1>Cần mua</h1>
          <p>
            {loading
              ? 'Đang tải…'
              : toBuy.length === 0
                ? 'Kho đang đủ hàng.'
                : `${fmtNum(toBuy.length)} mã cần mua: ${fmtNum(outCount)} hết hàng, ${fmtNum(lowCount)} sắp hết, ${fmtNum(bomCount)} thiếu cho dự án`}
          </p>
        </div>
        <div className="kk-quick">
          <button type="button" className="kk-btn kk-btn-outline" onClick={copyList} disabled={rows.length === 0}>
            <ClipboardCopy size={18} />
            Chép danh sách
          </button>
          <button type="button" className="kk-btn kk-btn-outline" onClick={exportCsv} disabled={rows.length === 0}>
            <Download size={18} />
            Xuất CSV
          </button>
        </div>
      </div>

      {tabs}

      <div className="kk-card kk-toolbar">
        <div className="kk-search kk-search-page">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            value={q}
            placeholder="Tìm theo mã, tên, giá trị, package…"
            aria-label="Tìm trong danh sách cần mua"
            onChange={(e) => setParam('q', e.target.value)}
          />
        </div>
        <div className="kk-pills" role="group" aria-label="Lọc theo tình trạng">
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              className={`kk-pill ${kind === k.key ? 'is-on' : ''}`}
              aria-pressed={kind === k.key}
              onClick={() => setParam('kind', k.key)}
            >
              {k.label}
            </button>
          ))}
        </div>
        <CategoryFilter value={cat} onChange={(id) => setParam('cat', id)} />
        {hasFilter && (
          <button type="button" className="kk-link" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
            Xóa bộ lọc
          </button>
        )}
      </div>

      <div className="kk-card kk-table-card">
        {loading ? (
          <div className="kk-skel-list">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} h={52} r={10} />
            ))}
          </div>
        ) : toBuy.length === 0 ? (
          <EmptyState
            title="Chưa có gì cần mua"
            text="Không có linh kiện nào hết hàng, dưới mức tồn tối thiểu hoặc thiếu so với BOM của các dự án."
          />
        ) : rows.length === 0 ? (
          <EmptyState title="Không có linh kiện nào khớp" text="Thử đổi từ khóa hoặc bỏ bớt bộ lọc.">
            <button type="button" className="kk-btn kk-btn-outline" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
              Xóa bộ lọc
            </button>
          </EmptyState>
        ) : (
          <>
            <div className="kk-table-scroll">
              <table className="kk-table">
                <thead>
                  <tr>
                    <th>Linh kiện</th>
                    <th className="kk-col-pkg">Package</th>
                    <th>Tồn kho</th>
                    <th className="is-num">Tối thiểu</th>
                    <th className="is-num">Nên mua</th>
                    <th className="kk-col-price is-num">Đơn giá</th>
                    <th className="kk-col-price is-num">Thành tiền</th>
                    <th>Trạng thái</th>
                    {canEdit && <th className="kk-col-buy" aria-label="Thao tác" />}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((c) => {
                    const bom = bomByComponent.get(c.id)
                    return (
                    <tr key={c.id} onClick={() => openComponent(c.id)}>
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
                          <span className="kk-cell-name">{c.name}</span>
                          <CategoryChip
                            name={c.category_name}
                            tone={toneByCategory.get(c.category_id)}
                            title={categoriesById.get(c.category_id)?.path}
                          />
                        </span>
                        {bom?.short > 0 && (
                          <span className="kk-buy-why" onClick={(e) => e.stopPropagation()}>
                            {bom.uses.slice(0, MAX_TAGS).map((u) => (
                              <Link
                                key={u.project.id}
                                className="kk-prj"
                                to={`/projects?p=${u.project.id}`}
                                title={`${u.project.name}: mỗi bộ cần ${fmtNum(u.quantity)}. Bấm để mở dự án.`}
                              >
                                {u.project.code || u.project.name} ×{fmtNum(u.quantity)}
                              </Link>
                            ))}
                            {bom.uses.length > MAX_TAGS && (
                              <span
                                className="kk-buy-more"
                                title={bom.uses
                                  .slice(MAX_TAGS)
                                  .map((u) => `${u.project.code ? `${u.project.code} ` : ''}${u.project.name}: ${fmtNum(u.quantity)}`)
                                  .join('\n')}
                              >
                                +{fmtNum(bom.uses.length - MAX_TAGS)} dự án khác
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                      <td data-label="Package" className="kk-col-pkg">
                        {c.package || '—'}
                      </td>
                      <td data-label="Tồn kho">
                        <StockBar qty={c.total_quantity} min={c.min_stock} status={c.status} />
                      </td>
                      <td data-label="Tối thiểu" className="is-num">
                        {c.min_stock > 0 ? fmtNum(c.min_stock) : '—'}
                      </td>
                      <td data-label="Nên mua" className="is-num">
                        <span
                          className="kk-shortage"
                          title={
                            bom?.short > 0 && bom.short >= (c.shortage ?? 0)
                              ? `Dự án cần ${fmtNum(bom.total)}, kho có ${fmtNum(c.total_quantity)}`
                              : c.shortage > 0
                                ? 'Số lượng để về lại mức tối thiểu'
                                : 'Gợi ý mua ít nhất 1'
                          }
                        >
                          {fmtNum(need(c))}
                        </span>
                      </td>
                      <td data-label="Đơn giá" className="kk-col-price is-num">
                        {fmtPrice(c.unit_price)}
                      </td>
                      <td data-label="Thành tiền" className="kk-col-price is-num">
                        {Number(c.unit_price) > 0 ? fmtMoneyFull(need(c) * Number(c.unit_price)) : '—'}
                      </td>
                      <td data-label="Trạng thái">
                        <StatusChip status={c.status} />
                      </td>
                      {canEdit && (
                        <td className="kk-col-buy" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="kk-btn kk-btn-soft kk-btn-sm"
                            title="Mua về rồi thì bấm để nhập kho"
                            onClick={() => openTx({ type: 'in', componentId: c.id })}
                          >
                            <ArrowDownToLine size={16} />
                            Nhập
                          </button>
                        </td>
                      )}
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {rows.length > PAGE_SIZE && (
              <div className="kk-pager">
                <span>
                  Hiển thị {fmtNum(page * PAGE_SIZE + 1)} đến {fmtNum(page * PAGE_SIZE + pageRows.length)} trong {fmtNum(rows.length)} linh kiện
                </span>
                <div>
                  <button
                    type="button"
                    className="kk-icon-btn kk-icon-btn-boxed"
                    aria-label="Trang trước"
                    disabled={page === 0}
                    onClick={() => goTo(page - 1)}
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
                    onClick={() => goTo(page + 1)}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            )}
            <div className="kk-pager">
              <span>
                {fmtNum(rows.length)} linh kiện
                {hasFilter ? ` (trong ${fmtNum(toBuy.length)} mã cần mua)` : ''}
              </span>
              <span>
                {priced.length === 0
                  ? 'Chưa có đơn giá để ước tính chi phí'
                  : `Ước tính ${fmtMoneyFull(cost)}${priced.length < rows.length ? `, chưa tính ${fmtNum(rows.length - priced.length)} mã chưa có đơn giá` : ''}`}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
