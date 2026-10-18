import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  Coins,
  Download,
  ExternalLink,
  Loader2,
  PackageCheck,
  PackagePlus,
  Pencil,
  Plus,
  Save,
  ShoppingCart,
  Trash2,
  Truck,
} from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useData } from '../data/DataContext'
import { useShell } from '../ShellContext'
import { useToast } from '../ui/Toast'
import { Modal } from '../ui/Modal'
import { ConfirmDialog } from '../ui/dialogs'
import { InlinePrice } from '../ui/PriceEdit'
import { StatCard } from '../ui/stats'
import { CategoryChip, CategoryPicker, ComponentPicker, EmptyState, Field, QtyStepper, SelectWithCreate, Skeleton } from '../ui/common'
import { friendlyError, isMissingSchema, mustChange } from '../lib/api'
import { downloadCSV, parseNumber } from '../lib/csv'
import { fmtMoneyFull, fmtNum, fmtPrice, normalize, safeUrl } from '../lib/format'

const PAGE_SIZE = 10
const STATUS = {
  todo: { label: 'Cần mua', next: 'ordered' },
  ordered: { label: 'Đã đặt hàng', next: 'todo' },
}
const FILTERS = [
  { key: '', label: 'Tất cả' },
  { key: 'todo', label: 'Cần mua' },
  { key: 'ordered', label: 'Đã đặt hàng' },
  { key: 'noprice', label: 'Chưa có giá' },
]
const matches = (r, key) => !key || (key === 'noprice' ? r.price === null : r.item.status === key)

/** Tổng tiền của một nhóm món: chỉ cộng món đã có đơn giá, đếm riêng món chưa có giá */
function costOf(list) {
  let cost = 0
  let priced = 0
  for (const r of list) {
    if (r.price === null) continue
    cost += r.price * r.item.quantity
    priced++
  }
  return { cost, priced, count: list.length, unpriced: list.length - priced }
}

/** Danh sách mua trước. missing = database chưa chạy sql/13_purchase_list.sql. */
export function usePurchaseItems(version) {
  const [state, setState] = useState({ rows: null, missing: false, error: '' })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let off = false
    supabase
      .from('purchase_items')
      .select('*')
      .order('created_at')
      .then(({ data, error }) => {
        if (off) return
        if (error) setState({ rows: [], missing: isMissingSchema(error), error: isMissingSchema(error) ? '' : friendlyError(error) })
        else setState({ rows: data, missing: false, error: '' })
      })
    return () => {
      off = true
    }
  }, [version, tick])
  const refresh = useCallback(() => setTick((n) => n + 1), [])
  return { ...state, refresh }
}

/** Ghép một món với linh kiện trong kho (nếu có) để lấy mã, tên, danh mục hiển thị */
function describe(item, componentsById) {
  const comp = item.component_id ? componentsById.get(item.component_id) : null
  return {
    comp,
    part: comp?.part_number ?? item.part_number ?? '',
    name: comp?.name ?? item.name ?? '',
    categoryId: comp?.category_id ?? item.category_id ?? null,
    pkg: comp?.package ?? item.package ?? '',
    price: item.unit_price !== null && item.unit_price !== undefined ? Number(item.unit_price) : comp?.unit_price ? Number(comp.unit_price) : null,
    stockPrice: Number(comp?.unit_price) > 0 ? Number(comp.unit_price) : null,
  }
}

/**
 * Lưu đơn giá của một món. Món có trong kho và toStock: ghi vào đơn giá của linh kiện
 * (giá trị kho, trang Cần mua cùng cập nhật), món trong danh sách thì đi theo đơn giá kho.
 */
async function savePrice(item, price, toStock) {
  if (item.component_id && toStock && price !== null) {
    mustChange(await supabase.from('components').update({ unit_price: price }).eq('id', item.component_id).select('id'))
    if (item.unit_price !== null && item.unit_price !== undefined) {
      mustChange(await supabase.from('purchase_items').update({ unit_price: null }).eq('id', item.id).select('id'))
    }
    return true
  }
  mustChange(await supabase.from('purchase_items').update({ unit_price: price }).eq('id', item.id).select('id'))
  return false
}

/** Thẻ "Danh sách mua trước" của trang Cần mua */
export default function PurchasePlan({ items }) {
  const { componentsById, categoriesById, toneByCategory, projectsById, reload } = useData()
  const { openComponent, canEdit, isAdmin } = useShell()
  const toast = useToast()
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(0)
  const [dialog, setDialog] = useState(null) // { kind: 'form' | 'receive' | 'delete', item }
  const [busyId, setBusyId] = useState(null)

  const all = useMemo(() => (items.rows ?? []).map((it) => ({ item: it, ...describe(it, componentsById) })), [items.rows, componentsById])
  const rows = all.filter((r) => matches(r, filter))
  const sum = useMemo(
    () => ({
      all: costOf(all),
      todo: costOf(all.filter((r) => r.item.status === 'todo')),
      ordered: costOf(all.filter((r) => r.item.status === 'ordered')),
    }),
    [all],
  )
  const pickFilter = (key) => {
    setFilter(key)
    setPage(0)
  }
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)
  const priced = rows.filter((r) => r.price !== null)
  const cost = priced.reduce((sum, r) => sum + r.price * r.item.quantity, 0)

  async function toggleStatus(r) {
    setBusyId(r.item.id)
    try {
      const next = STATUS[r.item.status]?.next ?? 'todo'
      mustChange(await supabase.from('purchase_items').update({ status: next }).eq('id', r.item.id).select('id'))
      items.refresh()
    } catch (e) {
      toast.push({ tone: 'error', message: friendlyError(e), duration: 9000 })
    } finally {
      setBusyId(null)
    }
  }

  async function changePrice(r, price, toStock) {
    const inStock = await savePrice(r.item, price, toStock)
    if (inStock) await reload()
    items.refresh()
    toast.push({
      message:
        price === null
          ? `Đã xóa đơn giá dự kiến của ${r.part}.`
          : `Đã lưu đơn giá ${fmtPrice(price)} cho ${r.part}${inStock ? ', cập nhật luôn vào kho' : ''}.`,
    })
  }

  async function copyList() {
    const text = rows.map((r) => `${r.part} x ${r.item.quantity}${r.pkg ? ` (${r.pkg})` : ''}${r.item.shop_url ? ` ${r.item.shop_url}` : ''}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast.push({ message: `Đã chép ${fmtNum(rows.length)} dòng.` })
    } catch {
      toast.push({ tone: 'error', message: 'Trình duyệt không cho chép. Bạn dùng nút Xuất CSV nhé.' })
    }
  }

  function exportCsv() {
    const header = ['part_number', 'name', 'category', 'package', 'quantity', 'unit_price', 'amount', 'project', 'status', 'shop_url', 'note', 'in_stock']
    const body = rows.map((r) => [
      r.part,
      r.name,
      categoriesById.get(r.categoryId)?.path ?? '',
      r.pkg,
      r.item.quantity,
      r.price ?? '',
      r.price !== null ? r.price * r.item.quantity : '',
      projectsById.get(r.item.project_id)?.code || projectsById.get(r.item.project_id)?.name || '',
      STATUS[r.item.status]?.label ?? r.item.status,
      r.item.shop_url,
      r.item.note,
      r.comp ? 'co' : 'moi',
    ])
    downloadCSV(`mua-truoc-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...body])
  }

  if (items.rows === null) {
    return (
      <div className="kk-card kk-skel-list">
        <Skeleton h={52} r={10} />
        <Skeleton h={52} r={10} />
      </div>
    )
  }
  if (items.missing) {
    return (
      <div className="kk-card">
        <EmptyState
          title="Chưa bật danh sách mua trước"
          text={
            isAdmin
              ? 'Mở Supabase, vào SQL Editor, dán nội dung file sql/13_purchase_list.sql rồi bấm Run, sau đó tải lại trang.'
              : 'Hãy nhờ admin nâng cấp database.'
          }
        />
      </div>
    )
  }
  if (items.error) {
    return (
      <div className="kk-card">
        <EmptyState title="Chưa tải được danh sách mua trước" text={items.error}>
          <button type="button" className="kk-btn kk-btn-primary" onClick={items.refresh}>
            Thử lại
          </button>
        </EmptyState>
      </div>
    )
  }

  const pct = sum.all.count > 0 ? Math.round((sum.all.priced / sum.all.count) * 100) : 0
  const moneyOf = (g) => (g.priced > 0 ? fmtMoneyFull(g.cost) : '—')
  const missingNote = (g) => (g.unpriced > 0 ? `, ${fmtNum(g.unpriced)} món chưa có giá` : '')

  return (
    <>
      {all.length > 0 && (
        <section className="kk-stats kk-stats-3" aria-label="Chi phí ước tính">
          <StatCard
            Icon={Coins}
            label="Tổng chi phí ước tính"
            value={moneyOf(sum.all)}
            title={`Đơn giá × số lượng của ${fmtNum(sum.all.priced)} món đã có giá`}
            note={
              sum.all.unpriced > 0
                ? `Đã có giá ${fmtNum(sum.all.priced)}/${fmtNum(sum.all.count)} món, bấm để điền tiếp`
                : `Đủ giá cho ${fmtNum(sum.all.count)} món`
            }
            onClick={sum.all.unpriced > 0 && filter !== 'noprice' ? () => pickFilter('noprice') : undefined}
          >
            <span
              className={`kk-stat-meter ${pct === 100 ? 'is-full' : ''}`}
              role="img"
              aria-label={`Đã có đơn giá ${fmtNum(sum.all.priced)} trên ${fmtNum(sum.all.count)} món`}
            >
              <i style={{ width: `${pct}%` }} />
            </span>
          </StatCard>
          <StatCard
            Icon={ShoppingCart}
            label="Còn phải mua"
            value={moneyOf(sum.todo)}
            note={`${fmtNum(sum.todo.count)} món chưa đặt${missingNote(sum.todo)}`}
            onClick={sum.todo.count > 0 && filter !== 'todo' ? () => pickFilter('todo') : undefined}
          />
          <StatCard
            Icon={Truck}
            label="Đã đặt hàng"
            value={moneyOf(sum.ordered)}
            note={`${fmtNum(sum.ordered.count)} món đang chờ về${missingNote(sum.ordered)}`}
            onClick={sum.ordered.count > 0 && filter !== 'ordered' ? () => pickFilter('ordered') : undefined}
          />
        </section>
      )}

      <div className="kk-card kk-toolbar">
        <div className="kk-pills" role="group" aria-label="Lọc theo trạng thái">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`kk-pill ${filter === f.key ? 'is-on' : ''}`}
              aria-pressed={filter === f.key}
              onClick={() => pickFilter(f.key)}
            >
              {f.label} ({fmtNum(all.filter((r) => matches(r, f.key)).length)})
            </button>
          ))}
        </div>
        <span className="kk-push-right" />
        <button type="button" className="kk-btn kk-btn-outline" onClick={copyList} disabled={rows.length === 0}>
          <ClipboardCopy size={18} />
          Chép danh sách
        </button>
        <button type="button" className="kk-btn kk-btn-outline" onClick={exportCsv} disabled={rows.length === 0}>
          <Download size={18} />
          Xuất CSV
        </button>
        {canEdit && (
          <button type="button" className="kk-btn kk-btn-primary" onClick={() => setDialog({ kind: 'form', item: null })}>
            <Plus size={18} />
            Thêm món cần mua
          </button>
        )}
      </div>

      <div className="kk-card kk-table-card">
        {all.length === 0 ? (
          <EmptyState
            title="Danh sách mua trước đang trống"
            text={
              canEdit
                ? 'Lên trước những linh kiện định mua, kể cả linh kiện chưa có trong kho. Mua về thì bấm "Đã mua" để nhập kho.'
                : 'Khi có người lên danh sách mua trước, bạn sẽ thấy ở đây.'
            }
          >
            {canEdit && (
              <button type="button" className="kk-btn kk-btn-primary" onClick={() => setDialog({ kind: 'form', item: null })}>
                <Plus size={18} />
                Thêm món cần mua
              </button>
            )}
          </EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState
            title={filter === 'noprice' ? 'Món nào cũng đã có đơn giá' : 'Không có món nào ở trạng thái này'}
            text="Chọn bộ lọc khác để xem."
          />
        ) : (
          <>
            <div className="kk-table-scroll">
              <table className="kk-table kk-table-plain kk-table-static kk-buy-table">
                <thead>
                  <tr>
                    <th>Linh kiện</th>
                    <th className="kk-col-pkg">Package</th>
                    <th className="is-num">Số lượng</th>
                    <th className="kk-col-price is-num">Đơn giá</th>
                    <th className="kk-col-price is-num">Thành tiền</th>
                    <th>Dự án</th>
                    <th>Nơi bán</th>
                    <th>Trạng thái</th>
                    {canEdit && <th className="kk-col-plan-act" aria-label="Thao tác" />}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => {
                    const project = projectsById.get(r.item.project_id)
                    const url = safeUrl(r.item.shop_url)
                    const busy = busyId === r.item.id
                    return (
                      <tr key={r.item.id}>
                        <td data-label="Linh kiện" className="kk-cell-main">
                          {r.comp ? (
                            <button type="button" className="kk-row-link" onClick={() => openComponent(r.comp.id)}>
                              {r.part}
                            </button>
                          ) : (
                            <strong className="kk-plan-part">{r.part}</strong>
                          )}
                          <span className="kk-cell-sub">
                            <span className="kk-cell-name">{r.name}</span>
                            {r.comp ? (
                              <span className="kk-plan-badge">Có trong kho: {fmtNum(r.comp.total_quantity)}</span>
                            ) : (
                              <span className="kk-plan-badge is-new">Linh kiện mới</span>
                            )}
                            {r.categoryId && (
                              <CategoryChip
                                name={categoriesById.get(r.categoryId)?.name}
                                tone={toneByCategory.get(r.categoryId)}
                                title={categoriesById.get(r.categoryId)?.path}
                              />
                            )}
                          </span>
                          {r.item.note && <span className="kk-plan-note">{r.item.note}</span>}
                        </td>
                        <td data-label="Package" className="kk-col-pkg">
                          {r.pkg || '—'}
                        </td>
                        <td data-label="Số lượng" className="is-num kk-strong-num">
                          {fmtNum(r.item.quantity)}
                        </td>
                        <td data-label="Đơn giá" className="kk-col-price is-num">
                          <InlinePrice
                            value={r.price}
                            canEdit={canEdit}
                            label={r.part}
                            option={r.comp ? { label: 'Cập nhật vào kho', defaultChecked: true } : undefined}
                            onSave={(price, toStock) => changePrice(r, price, toStock)}
                            note={
                              r.stockPrice !== null && r.price !== null && r.price !== r.stockPrice ? (
                                <small className="kk-price-note" title="Đơn giá dự kiến khác với đơn giá đang lưu trong kho">
                                  Kho: {fmtPrice(r.stockPrice)}
                                </small>
                              ) : null
                            }
                          />
                        </td>
                        <td data-label="Thành tiền" className="kk-col-price is-num">
                          {r.price !== null ? fmtMoneyFull(r.price * r.item.quantity) : '—'}
                        </td>
                        <td data-label="Dự án">
                          {project ? (
                            <Link className="kk-prj" to={`/projects?p=${project.id}`} title={project.name}>
                              {project.code || project.name}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td data-label="Nơi bán">
                          {url ? (
                            <a className="kk-link" href={url} target="_blank" rel="noopener noreferrer" title={url}>
                              Mở link
                              <ExternalLink size={13} />
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td data-label="Trạng thái">
                          {canEdit ? (
                            <button
                              type="button"
                              className={`kk-plan-status is-${r.item.status}`}
                              disabled={busy}
                              title={r.item.status === 'todo' ? 'Bấm khi đã đặt hàng' : 'Bấm để đưa về "Cần mua"'}
                              onClick={() => toggleStatus(r)}
                            >
                              {busy ? <Loader2 size={13} className="kk-spin" /> : r.item.status === 'ordered' ? <Truck size={13} /> : null}
                              {STATUS[r.item.status]?.label ?? r.item.status}
                            </button>
                          ) : (
                            <span className={`kk-plan-status is-${r.item.status}`}>{STATUS[r.item.status]?.label ?? r.item.status}</span>
                          )}
                        </td>
                        {canEdit && (
                          <td className="kk-col-plan-act">
                            <span className="kk-plan-actions">
                              <button type="button" className="kk-btn kk-btn-soft kk-btn-sm kk-c-in" onClick={() => setDialog({ kind: 'receive', item: r.item })}>
                                <PackageCheck size={16} />
                                Đã mua
                              </button>
                              <button
                                type="button"
                                className="kk-icon-btn kk-c-edit"
                                aria-label={`Sửa ${r.part}`}
                                title="Sửa"
                                onClick={() => setDialog({ kind: 'form', item: r.item })}
                              >
                                <Pencil size={16} />
                              </button>
                              <button
                                type="button"
                                className="kk-icon-btn kk-c-del"
                                aria-label={`Xóa ${r.part} khỏi danh sách`}
                                title="Xóa khỏi danh sách"
                                onClick={() => setDialog({ kind: 'delete', item: r.item, part: r.part })}
                              >
                                <Trash2 size={16} />
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
                  Hiển thị {fmtNum(safePage * PAGE_SIZE + 1)} đến {fmtNum(safePage * PAGE_SIZE + pageRows.length)} trong {fmtNum(rows.length)} món
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
            <div className="kk-pager">
              <span>{fmtNum(rows.length)} món</span>
              <span>
                {priced.length === 0
                  ? 'Chưa có đơn giá để ước tính chi phí'
                  : `Ước tính ${fmtMoneyFull(cost)}${priced.length < rows.length ? `, chưa tính ${fmtNum(rows.length - priced.length)} món chưa có đơn giá` : ''}`}
              </span>
            </div>
          </>
        )}
      </div>

      {dialog?.kind === 'form' && <PlanForm initial={dialog.item} onSaved={items.refresh} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'receive' && <ReceiveDialog item={dialog.item} onDone={items.refresh} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={`Xóa ${dialog.part} khỏi danh sách mua trước?`}
          text="Chỉ xóa khỏi danh sách, không ảnh hưởng tới kho."
          confirmLabel="Xóa khỏi danh sách"
          Icon={Trash2}
          onConfirm={async () => {
            mustChange(await supabase.from('purchase_items').delete().eq('id', dialog.item.id).select('id'))
            items.refresh()
            toast.push({ message: `Đã xóa ${dialog.part} khỏi danh sách mua trước.` })
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Thêm / sửa một món trong danh sách mua trước                        */
/* ------------------------------------------------------------------ */
const text = (v) => (v === null || v === undefined ? '' : String(v))

/** initial = sửa một món đã có; preset = thêm mới nhưng điền sẵn (vd từ thẻ "Theo tồn kho") */
export function PlanForm({ initial, preset, onSaved, onClose }) {
  const { allComponents, componentsById, projects, reload } = useData()
  const toast = useToast()
  const seed = initial ?? preset
  const [mode, setMode] = useState(seed?.component_id ? 'stock' : 'new') // 'stock' = linh kiện đã có trong kho
  const [f, setF] = useState({
    component_id: seed?.component_id ?? null,
    part_number: text(seed?.part_number),
    name: text(seed?.name),
    category_id: seed?.category_id ?? null,
    value: text(seed?.value),
    package: text(seed?.package),
    manufacturer: text(seed?.manufacturer),
    quantity: seed?.quantity ?? 1,
    unit_price: text(seed?.unit_price),
    shop_url: text(seed?.shop_url),
    note: text(seed?.note),
    project_id: seed?.project_id ?? null,
  })
  const [toStock, setToStock] = useState(true) // lưu đơn giá vào linh kiện trong kho
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (key) => (e) => setF((s) => ({ ...s, [key]: e.target.value }))

  // Gõ mã trùng với linh kiện đã có: sẽ nối vào linh kiện đó thay vì tạo mới khi mua về
  const sameCode =
    mode === 'new' && f.part_number.trim() ? allComponents.find((c) => normalize(c.part_number) === normalize(f.part_number)) : null
  const stockComp = mode === 'stock' ? (f.component_id ? componentsById.get(f.component_id) : null) : sameCode

  async function submit(ev) {
    ev.preventDefault()
    if (saving) return
    const e = {}
    const useStock = mode === 'stock' || Boolean(sameCode)
    if (mode === 'stock' && !f.component_id) e.component_id = 'Chọn linh kiện trong kho.'
    if (mode === 'new' && !f.part_number.trim()) e.part_number = 'Nhập mã linh kiện.'
    if (mode === 'new' && !sameCode && !f.name.trim()) e.name = 'Nhập tên linh kiện.'
    if (!(Number(f.quantity) >= 1)) e.quantity = 'Nhập số lượng lớn hơn 0.'
    const price = f.unit_price.trim() === '' ? null : parseNumber(f.unit_price)
    if (price !== null && (Number.isNaN(price) || price < 0)) e.unit_price = 'Nhập số tiền hợp lệ, ví dụ 3500.'
    if (f.shop_url.trim() && !safeUrl(f.shop_url)) e.shop_url = 'Link phải bắt đầu bằng http:// hoặc https://'
    setErrors(e)
    setFormError('')
    if (Object.keys(e).length > 0) return

    const payload = useStock
      ? {
          component_id: mode === 'stock' ? f.component_id : sameCode.id,
          part_number: null,
          name: null,
          category_id: null,
          value: null,
          package: null,
          manufacturer: null,
        }
      : {
          component_id: null,
          part_number: f.part_number.trim(),
          name: f.name.trim(),
          category_id: f.category_id,
          value: f.value.trim() || null,
          package: f.package.trim() || null,
          manufacturer: f.manufacturer.trim() || null,
        }
    Object.assign(payload, {
      quantity: Number(f.quantity),
      unit_price: price,
      shop_url: f.shop_url.trim() || null,
      note: f.note.trim() || null,
      project_id: f.project_id,
    })

    // Món có trong kho: đơn giá ghi vào linh kiện, món trong danh sách đi theo đơn giá kho
    const stockId = useStock ? payload.component_id : null
    const priceToStock = Boolean(stockId) && toStock && price !== null
    if (priceToStock) payload.unit_price = null

    setSaving(true)
    try {
      if (priceToStock) {
        mustChange(await supabase.from('components').update({ unit_price: price }).eq('id', stockId).select('id'))
        await reload()
      }
      if (initial) mustChange(await supabase.from('purchase_items').update(payload).eq('id', initial.id).select('id'))
      else mustChange(await supabase.from('purchase_items').insert(payload).select('id'))
      onSaved()
      toast.push({ message: initial ? 'Đã lưu thay đổi.' : 'Đã thêm vào danh sách mua trước.' })
      onClose()
    } catch (err) {
      setFormError(friendlyError(err))
      setSaving(false)
    }
  }

  return (
    <Modal
      title={initial ? 'Sửa món cần mua' : 'Thêm món cần mua'}
      subtitle="Mua về thì bấm “Đã mua” để nhập kho."
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="kk-btn kk-btn-ghost" onClick={onClose} disabled={saving}>
            Hủy
          </button>
          <button type="submit" form="plan-form" className="kk-btn kk-btn-primary" disabled={saving}>
            {saving ? <Loader2 size={18} className="kk-spin" /> : <Save size={18} />}
            {initial ? 'Lưu thay đổi' : 'Thêm vào danh sách'}
          </button>
        </>
      }
    >
      <div className="kk-seg kk-seg-2" role="group" aria-label="Loại linh kiện">
        <button type="button" className={`kk-seg-btn ${mode === 'new' ? 'is-on' : ''}`} aria-pressed={mode === 'new'} onClick={() => setMode('new')}>
          <PackagePlus size={18} />
          Linh kiện mới
        </button>
        <button type="button" className={`kk-seg-btn ${mode === 'stock' ? 'is-on' : ''}`} aria-pressed={mode === 'stock'} onClick={() => setMode('stock')}>
          <PackageCheck size={18} />
          Có sẵn trong kho
        </button>
      </div>

      <form id="plan-form" className="kk-form-grid" onSubmit={submit} noValidate>
        {mode === 'stock' ? (
          <Field label="Linh kiện trong kho *" htmlFor="pl-comp" error={errors.component_id} className="kk-span-2">
            <ComponentPicker id="pl-comp" value={f.component_id} invalid={Boolean(errors.component_id)} onChange={(id) => setF((s) => ({ ...s, component_id: id }))} />
          </Field>
        ) : (
          <>
            <Field
              label="Mã linh kiện *"
              htmlFor="pl-part"
              error={errors.part_number}
              hint={sameCode ? `Mã này đã có trong kho (${sameCode.name}). Mua về sẽ nhập thêm vào linh kiện đó.` : undefined}
            >
              <input id="pl-part" data-autofocus value={f.part_number} placeholder="Vd: AMS1117-3.3" aria-invalid={errors.part_number ? true : undefined} onChange={set('part_number')} />
            </Field>
            <Field label="Tên *" htmlFor="pl-name" error={errors.name}>
              <input id="pl-name" value={f.name} placeholder="Vd: IC ổn áp 3.3V 1A" disabled={Boolean(sameCode)} aria-invalid={errors.name ? true : undefined} onChange={set('name')} />
            </Field>
            {!sameCode && (
              <>
                <Field label="Loại" htmlFor="pl-cat">
                  <CategoryPicker id="pl-cat" value={f.category_id} onChange={(id) => setF((s) => ({ ...s, category_id: id }))} />
                </Field>
                <Field label="Giá trị" htmlFor="pl-value" hint="Vd: 10k, 100nF, 3.3V">
                  <input id="pl-value" value={f.value} onChange={set('value')} />
                </Field>
                <Field label="Package" htmlFor="pl-pkg">
                  <input id="pl-pkg" value={f.package} placeholder="Vd: SOT-223" onChange={set('package')} />
                </Field>
                <Field label="Hãng sản xuất" htmlFor="pl-mfr">
                  <input id="pl-mfr" value={f.manufacturer} onChange={set('manufacturer')} />
                </Field>
              </>
            )}
          </>
        )}

        <Field label="Số lượng cần mua *" htmlFor="pl-qty" error={errors.quantity}>
          <QtyStepper id="pl-qty" value={f.quantity} min={1} label="Số lượng cần mua" invalid={Boolean(errors.quantity)} onChange={(v) => setF((s) => ({ ...s, quantity: v }))} />
        </Field>
        <Field
          label="Đơn giá (đ)"
          htmlFor="pl-price"
          error={errors.unit_price}
          hint={
            stockComp
              ? Number(stockComp.unit_price) > 0
                ? `Đơn giá trong kho: ${fmtPrice(stockComp.unit_price)}. Để trống thì dùng giá này.`
                : 'Linh kiện này chưa có đơn giá trong kho.'
              : undefined
          }
        >
          <input
            id="pl-price"
            inputMode="decimal"
            value={f.unit_price}
            placeholder={Number(stockComp?.unit_price) > 0 ? String(Number(stockComp.unit_price)) : undefined}
            onChange={set('unit_price')}
          />
          {stockComp && (
            <label className="kk-price-sync">
              <input type="checkbox" checked={toStock} onChange={(e) => setToStock(e.target.checked)} />
              Cập nhật đơn giá này vào kho
            </label>
          )}
        </Field>
        <Field label="Link nơi bán" htmlFor="pl-url" error={errors.shop_url} className="kk-span-2">
          <input id="pl-url" type="url" value={f.shop_url} placeholder="https://…" onChange={set('shop_url')} />
        </Field>
        <Field
          label="Mua cho dự án (không bắt buộc)"
          htmlFor="pl-proj"
          hint="Mua về sẽ tự thêm linh kiện vào BOM của dự án này nếu BOM chưa có."
          className="kk-span-2"
        >
          <select id="pl-proj" value={f.project_id ?? ''} onChange={(e) => setF((s) => ({ ...s, project_id: e.target.value || null }))}>
            <option value="">Không gắn dự án</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code ? `${p.code} · ${p.name}` : p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ghi chú" htmlFor="pl-note" className="kk-span-2">
          <textarea id="pl-note" rows={2} maxLength={500} value={f.note} onChange={set('note')} />
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

/* ------------------------------------------------------------------ */
/* Đã mua: tạo linh kiện (nếu là món mới), nhập kho, gắn vào BOM        */
/* ------------------------------------------------------------------ */
function ReceiveDialog({ item, onDone, onClose }) {
  const { allComponents, componentsById, locations, projectsById, levels, createLocation, reload } = useData()
  const { openComponent } = useShell()
  const toast = useToast()
  const existing =
    (item.component_id && componentsById.get(item.component_id)) ||
    (item.part_number ? allComponents.find((c) => normalize(c.part_number) === normalize(item.part_number)) : null) ||
    null
  const project = projectsById.get(item.project_id)
  const [qty, setQty] = useState(item.quantity)
  const [loc, setLoc] = useState(locations.length === 1 ? locations[0].id : null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const part = existing?.part_number ?? item.part_number
  const name = existing?.name ?? item.name

  async function run() {
    if (busy) return
    if (!(Number(qty) >= 1)) return setError('Nhập số lượng thực nhận lớn hơn 0.')
    if (!loc) return setError('Chọn vị trí cất linh kiện.')
    setBusy(true)
    setError('')
    let componentId = existing?.id ?? null
    const notes = []
    try {
      // 1) Món mới: tạo linh kiện, rồi nối dòng danh sách vào linh kiện đó ngay (bấm lại sẽ không tạo trùng)
      if (!componentId) {
        const { data, error: err } = await supabase
          .from('components')
          .insert({
            part_number: item.part_number.trim(),
            name: item.name.trim(),
            category_id: item.category_id,
            value: item.value,
            package: item.package,
            manufacturer: item.manufacturer,
            unit_price: item.unit_price,
            notes: item.note,
            min_stock: levels.ready ? null : 0,
          })
          .select('id')
          .single()
        if (err) throw err
        componentId = data.id
        await supabase.from('purchase_items').update({ component_id: componentId }).eq('id', item.id)
      } else if (item.unit_price !== null && item.unit_price !== undefined && !(Number(existing.unit_price) > 0)) {
        // Linh kiện có sẵn nhưng chưa có đơn giá: lấy đơn giá vừa mua
        await supabase.from('components').update({ unit_price: item.unit_price }).eq('id', componentId)
      }

      // 2) Nhập kho số lượng thực nhận
      const { error: txErr } = await supabase.from('transactions').insert({
        component_id: componentId,
        location_id: loc,
        type: 'in',
        quantity: Number(qty),
        note: project ? `Mua về cho ${project.code || project.name}` : 'Mua về theo danh sách mua trước',
      })
      if (txErr) throw txErr

      // 3) Mua cho dự án: thêm vào BOM nếu BOM chưa có linh kiện này
      if (project) {
        const { data: line } = await supabase.from('project_bom').select('id').eq('project_id', project.id).eq('component_id', componentId).maybeSingle()
        if (!line) {
          const { error: bomErr } = await supabase.from('project_bom').insert({ project_id: project.id, component_id: componentId, quantity: item.quantity })
          notes.push(bomErr ? `chưa thêm được vào BOM của ${project.code || project.name}` : `đã thêm vào BOM của ${project.code || project.name}`)
        } else {
          notes.push(`BOM của ${project.code || project.name} đã có linh kiện này nên giữ nguyên`)
        }
      }

      // 4) Xong thì bỏ khỏi danh sách mua trước
      await supabase.from('purchase_items').delete().eq('id', item.id)
      await reload()
      onDone()
      const id = componentId
      toast.push({
        duration: 9000,
        message: `Đã nhập kho ${fmtNum(qty)} × ${part}${existing ? '' : ' (linh kiện mới)'}${notes.length ? `; ${notes.join('; ')}` : ''}.`,
        action: { label: 'Xem linh kiện', onClick: () => openComponent(id) },
      })
      onClose()
    } catch (e) {
      // Có thể đã làm xong một phần (vd đã tạo linh kiện): tải lại để màn hình đúng với dữ liệu
      await reload()
      onDone()
      setError(friendlyError(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Đã mua ${part}`}
      subtitle={name}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="kk-btn kk-btn-ghost" onClick={onClose} disabled={busy}>
            Hủy
          </button>
          <button type="button" className="kk-btn kk-btn-primary kk-c-in" onClick={run} disabled={busy}>
            {busy ? <Loader2 size={18} className="kk-spin" /> : <PackageCheck size={18} />}
            {busy ? 'Đang nhập kho…' : 'Nhập kho'}
          </button>
        </>
      }
    >
      <p className={`kk-banner ${existing ? 'kk-banner-ok' : 'kk-banner-warn'} kk-receive-banner`}>
        {existing ? <PackageCheck size={18} aria-hidden="true" /> : <AlertTriangle size={18} aria-hidden="true" />}
        <span>
          {existing
            ? `Linh kiện đã có trong kho (đang có ${fmtNum(existing.total_quantity)}). Số mua về sẽ được cộng thêm.`
            : 'Linh kiện mới: web sẽ tạo linh kiện trong trang Linh kiện với thông tin bạn đã ghi, rồi nhập kho.'}
          {project && ` Mua cho dự án ${project.code || project.name}.`}
        </span>
      </p>
      <div className="kk-form-grid">
        <Field label="Số lượng thực nhận *" htmlFor="rc-qty" hint={`Đã lên danh sách ${fmtNum(item.quantity)}.`}>
          <QtyStepper id="rc-qty" value={qty} min={1} label="Số lượng thực nhận" onChange={setQty} />
        </Field>
        <Field label="Cất vào vị trí *" htmlFor="rc-loc">
          <SelectWithCreate
            id="rc-loc"
            value={loc}
            onChange={setLoc}
            placeholder="Chọn vị trí"
            options={locations.map((l) => ({ value: l.id, label: l.path }))}
            onCreate={createLocation}
            createLabel="Thêm vị trí mới"
          />
        </Field>
      </div>
      {error && (
        <p className="kk-form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}
