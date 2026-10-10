import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowDownToLine, ClipboardCopy, Download, Search } from 'lucide-react'
import { useData } from '../data/DataContext'
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
]

/** Số lượng nên mua để về lại mức tối thiểu. Hết hàng mà chưa đặt mức tối thiểu thì gợi ý mua ít nhất 1. */
const needOf = (c) => Math.max(c.shortage ?? 0, 1)

/** Trang "Cần mua": mọi linh kiện đang hết hàng hoặc dưới mức tồn tối thiểu */
export default function ShoppingPage() {
  const { components, categoriesById, categoryChildren, toneByCategory, searchText, loading, refreshing, error, reload } = useData()
  const { openTx } = useTx()
  const { openComponent, canEdit } = useShell()
  const toast = useToast()
  const [params, setParams] = useSearchParams()

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

  // Hết hàng xếp trước, rồi tới món thiếu nhiều nhất
  const toBuy = useMemo(
    () =>
      components
        .filter((c) => c.status !== 'ok')
        .sort(
          (a, b) =>
            (a.status === 'out' ? 0 : 1) - (b.status === 'out' ? 0 : 1) ||
            needOf(b) - needOf(a) ||
            a.part_number.localeCompare(b.part_number, 'vi', { numeric: true }),
        ),
    [components],
  )
  const outCount = toBuy.filter((c) => c.status === 'out').length

  const rows = useMemo(() => {
    const terms = normalize(q).split(/\s+/).filter(Boolean)
    const catIds = cat && cat !== 'none' ? new Set(subtreeIds(categoryChildren, cat)) : null
    return toBuy.filter((c) => {
      if (kind && c.status !== kind) return false
      if (cat === 'none' && c.category_id) return false
      if (catIds && !catIds.has(c.category_id)) return false
      if (terms.length) {
        const text = searchText.get(c.id) ?? ''
        if (!terms.every((t) => text.includes(t))) return false
      }
      return true
    })
  }, [toBuy, searchText, categoryChildren, q, kind, cat])

  const priced = rows.filter((c) => Number(c.unit_price) > 0)
  const cost = priced.reduce((sum, c) => sum + needOf(c) * Number(c.unit_price), 0)

  function exportCsv() {
    const header = ['part_number', 'name', 'category', 'package', 'manufacturer', 'total_quantity', 'min_stock', 'need', 'unit_price', 'amount']
    const body = rows.map((c) => [
      c.part_number,
      c.name,
      categoriesById.get(c.category_id)?.path ?? c.category_name,
      c.package,
      c.manufacturer,
      c.total_quantity,
      c.min_stock,
      needOf(c),
      c.unit_price,
      Number(c.unit_price) > 0 ? needOf(c) * Number(c.unit_price) : '',
    ])
    downloadCSV(`can-mua-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...body])
  }

  async function copyList() {
    const text = rows.map((c) => `${c.part_number} x ${needOf(c)}${c.package ? ` (${c.package})` : ''}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast.push({ message: `Đã chép ${fmtNum(rows.length)} dòng. Dán vào tin nhắn hoặc ô tìm kiếm của nơi bán.` })
    } catch {
      toast.push({ tone: 'error', message: 'Trình duyệt không cho chép. Bạn dùng nút Xuất CSV nhé.' })
    }
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
                : `${fmtNum(toBuy.length)} mã cần mua: ${fmtNum(outCount)} hết hàng, ${fmtNum(toBuy.length - outCount)} sắp hết`}
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
            text="Không có linh kiện nào hết hàng hoặc dưới mức tồn tối thiểu. Đặt mức tồn tối thiểu cho linh kiện để được nhắc khi sắp hết."
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
                  {rows.map((c) => (
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
                        <span className="kk-shortage" title={c.min_stock > 0 ? 'Số lượng để về lại mức tối thiểu' : 'Chưa đặt mức tối thiểu, gợi ý mua ít nhất 1'}>
                          {fmtNum(needOf(c))}
                        </span>
                      </td>
                      <td data-label="Đơn giá" className="kk-col-price is-num">
                        {fmtPrice(c.unit_price)}
                      </td>
                      <td data-label="Thành tiền" className="kk-col-price is-num">
                        {Number(c.unit_price) > 0 ? fmtMoneyFull(needOf(c) * Number(c.unit_price)) : '—'}
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
                  ))}
                </tbody>
              </table>
            </div>
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
