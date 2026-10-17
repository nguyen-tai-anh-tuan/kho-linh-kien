import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowDownToLine, ChevronLeft, ChevronRight, ClipboardCopy, Download, ListPlus, Loader2, Search, Truck, X } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useData } from '../data/DataContext'
import PurchasePlan, { PlanForm, usePurchaseItems } from './PurchasePlan'
import { useBuyList } from '../data/useBuyList'
import { useTx } from '../TxContext'
import { useShell } from '../ShellContext'
import { useToast } from '../ui/Toast'
import { CategoryChip, EmptyState, Skeleton, StatusChip, StockBar } from '../ui/common'
import { CategoryFilter } from '../ui/CategoryMenu'
import { friendlyError, mustChange } from '../lib/api'
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
  const unplannedOnly = params.get('plan') === 'no'
  const hasFilter = Boolean(q || kind || cat || unplannedOnly)
  const [selected, setSelected] = useState(() => new Set())
  const [planDialog, setPlanDialog] = useState(null) // món điền sẵn cho form "Thêm món cần mua"
  const [adding, setAdding] = useState(false)

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

  // Linh kiện đã nằm trong danh sách mua trước: để không lên danh sách (và đặt mua) hai lần
  const planReady = planItems.rows !== null && !planItems.missing && !planItems.error
  const planned = useMemo(() => {
    const map = new Map()
    for (const it of planItems.rows ?? []) {
      if (!it.component_id) continue
      const p = map.get(it.component_id) ?? { quantity: 0, ordered: true }
      p.quantity += it.quantity
      p.ordered = p.ordered && it.status === 'ordered'
      map.set(it.component_id, p)
    }
    return map
  }, [planItems.rows])
  const canPlan = canEdit && planReady
  const unplannedCount = toBuy.filter((c) => !planned.has(c.id)).length
  const outUnplanned = toBuy.filter((c) => c.status === 'out' && !planned.has(c.id))

  /** Điền sẵn một món: số "Nên mua", và dự án nếu chỉ thiếu cho đúng một dự án */
  function presetOf(c) {
    const bom = bomByComponent.get(c.id)
    return {
      component_id: c.id,
      quantity: need(c),
      project_id: bom?.short > 0 && bom.uses.length === 1 ? bom.uses[0].project.id : null,
    }
  }

  async function addToPlan(list) {
    const fresh = list.filter((c) => !planned.has(c.id))
    if (adding || fresh.length === 0) return
    setAdding(true)
    try {
      const data = mustChange(await supabase.from('purchase_items').insert(fresh.map(presetOf)).select('id'))
      const ids = data.map((r) => r.id)
      planItems.refresh()
      setSelected(new Set())
      toast.push({
        duration: 9000,
        message: `Đã thêm ${fmtNum(fresh.length)} món vào danh sách mua trước${fresh.length < list.length ? ` (bỏ qua ${fmtNum(list.length - fresh.length)} món đã có sẵn)` : ''}.`,
        action: ids.length
          ? {
              label: 'Hoàn tác',
              onClick: async () => {
                const { error: err } = await supabase.from('purchase_items').delete().in('id', ids)
                planItems.refresh()
                if (err) toast.push({ tone: 'error', message: friendlyError(err), duration: 9000 })
              },
            }
          : undefined,
      })
    } catch (e) {
      toast.push({ tone: 'error', message: friendlyError(e), duration: 9000 })
    } finally {
      setAdding(false)
    }
  }

  const rows = useMemo(() => {
    const terms = normalize(q).split(/\s+/).filter(Boolean)
    const catIds = cat && cat !== 'none' ? new Set(subtreeIds(categoryChildren, cat)) : null
    return toBuy.filter((c) => {
      if (kind === 'bom' ? !((bomByComponent.get(c.id)?.short ?? 0) > 0) : kind && c.status !== kind) return false
      if (unplannedOnly && planned.has(c.id)) return false
      if (cat === 'none' && c.category_id) return false
      if (catIds && !catIds.has(c.category_id)) return false
      if (terms.length) {
        const text = searchText.get(c.id) ?? ''
        if (!terms.every((t) => text.includes(t))) return false
      }
      return true
    })
  }, [toBuy, bomByComponent, searchText, categoryChildren, planned, q, kind, cat, unplannedOnly])

  // Chia trang; chép danh sách, xuất CSV và ước tính chi phí vẫn tính trên toàn bộ danh sách đang lọc
  const [paging, setPaging] = useState({ key: '', page: 0 })
  const pagingKey = `${q}|${kind}|${cat}|${unplannedOnly}`
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const page = Math.min(paging.key === pagingKey ? paging.page : 0, pageCount - 1)
  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const goTo = (n) => setPaging({ key: pagingKey, page: n })

  // Chỉ chọn được món chưa lên danh sách mua trước
  const selectable = pageRows.filter((c) => !planned.has(c.id))
  const chosen = toBuy.filter((c) => selected.has(c.id) && !planned.has(c.id))
  const allOnPage = selectable.length > 0 && selectable.every((c) => selected.has(c.id))
  const someOnPage = selectable.some((c) => selected.has(c.id))
  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allOnPage) selectable.forEach((c) => next.delete(c.id))
      else selectable.forEach((c) => next.add(c.id))
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
        {(planReady ? unplannedCount : toBuy.length) > 0 && (
          <span className="kk-badge" title={planReady ? 'Số mã cần mua chưa lên danh sách mua trước' : undefined}>
            {fmtNum(planReady ? unplannedCount : toBuy.length)}
          </span>
        )}
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
                : `${fmtNum(toBuy.length)} mã cần mua: ${fmtNum(outCount)} hết hàng, ${fmtNum(lowCount)} sắp hết, ${fmtNum(bomCount)} thiếu cho dự án${planReady && unplannedCount < toBuy.length ? `. Còn ${fmtNum(unplannedCount)} mã chưa lên danh sách mua trước` : ''}`}
          </p>
        </div>
        <div className="kk-quick">
          {canPlan && outUnplanned.length > 0 && (
            <button
              type="button"
              className="kk-btn kk-btn-primary"
              disabled={adding}
              title="Đưa mọi món hết hàng chưa có trong danh sách mua trước vào danh sách đó"
              onClick={() => addToPlan(outUnplanned)}
            >
              {adding ? <Loader2 size={18} className="kk-spin" /> : <ListPlus size={18} />}
              Lên DS {fmtNum(outUnplanned.length)} món hết hàng
            </button>
          )}
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
        {planReady && (
          <button
            type="button"
            className={`kk-pill ${unplannedOnly ? 'is-on' : ''}`}
            aria-pressed={unplannedOnly}
            title="Chỉ hiện món chưa có trong danh sách mua trước"
            onClick={() => setParam('plan', unplannedOnly ? '' : 'no')}
          >
            Chưa lên DS ({fmtNum(unplannedCount)})
          </button>
        )}
        <CategoryFilter value={cat} onChange={(id) => setParam('cat', id)} />
        {hasFilter && (
          <button type="button" className="kk-link" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
            Xóa bộ lọc
          </button>
        )}
      </div>

      {canPlan && chosen.length > 0 && (
        <div className="kk-bulk" role="region" aria-label="Thao tác với mục đã chọn">
          <strong>Đã chọn {fmtNum(chosen.length)}</strong>
          <button type="button" className="kk-btn kk-btn-primary kk-btn-sm" disabled={adding} onClick={() => addToPlan(chosen)}>
            {adding ? <Loader2 size={16} className="kk-spin" /> : <ListPlus size={16} />}
            Thêm vào danh sách mua trước
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
                    {canPlan && (
                      <th className="kk-col-check">
                        <input
                          type="checkbox"
                          aria-label="Chọn tất cả món chưa lên danh sách trên trang này"
                          checked={allOnPage}
                          disabled={selectable.length === 0}
                          ref={(el) => {
                            if (el) el.indeterminate = !allOnPage && someOnPage
                          }}
                          onChange={toggleAll}
                        />
                      </th>
                    )}
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
                    const plan = planned.get(c.id)
                    return (
                    <tr key={c.id} className={selected.has(c.id) && !plan ? 'is-selected' : ''} onClick={() => openComponent(c.id)}>
                      {canPlan && (
                        <td className="kk-col-check" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={plan ? `${c.part_number} đã có trong danh sách mua trước` : `Chọn ${c.part_number}`}
                            checked={selected.has(c.id) && !plan}
                            disabled={Boolean(plan)}
                            onChange={() => toggleOne(c.id)}
                          />
                        </td>
                      )}
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
                        <span className="kk-buy-state">
                          <StatusChip status={c.status} />
                          {plan && (
                            <Link
                              className={`kk-plan-status ${plan.ordered ? 'is-ordered' : 'is-todo'}`}
                              to="/buy?tab=plan"
                              title={`Đã có trong danh sách mua trước: ${fmtNum(plan.quantity)}. Bấm để xem.`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {plan.ordered && <Truck size={13} />}
                              {plan.ordered ? 'Đã đặt' : 'Đã lên DS'} ×{fmtNum(plan.quantity)}
                            </Link>
                          )}
                        </span>
                      </td>
                      {canEdit && (
                        <td className="kk-col-buy" onClick={(e) => e.stopPropagation()}>
                          <span className="kk-plan-actions">
                          {canPlan && !plan && (
                            <button
                              type="button"
                              className="kk-btn kk-btn-outline kk-btn-sm"
                              title="Thêm vào danh sách mua trước (sửa được số lượng, link shop, dự án)"
                              onClick={() => setPlanDialog(presetOf(c))}
                            >
                              <ListPlus size={16} />
                              Lên DS
                            </button>
                          )}
                          <button
                            type="button"
                            className="kk-btn kk-btn-soft kk-btn-sm"
                            title="Mua về rồi thì bấm để nhập kho"
                            onClick={() => openTx({ type: 'in', componentId: c.id })}
                          >
                            <ArrowDownToLine size={16} />
                            Nhập
                          </button>
                          </span>
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

      {planDialog && <PlanForm preset={planDialog} onSaved={planItems.refresh} onClose={() => setPlanDialog(null)} />}
    </div>
  )
}
