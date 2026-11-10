import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Ban,
  ClipboardList,
  Coins,
  Download,
  ExternalLink,
  Loader2,
  PackageCheck,
  Pencil,
  Plus,
  Receipt,
  Save,
  Trash2,
  Truck,
  Wallet,
  X,
} from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useData } from '../data/DataContext'
import { useShell } from '../ShellContext'
import { useToast } from '../ui/Toast'
import { Modal } from '../ui/Modal'
import { ConfirmDialog } from '../ui/dialogs'
import { StatCard } from '../ui/stats'
import { EmptyState, Field, QtyStepper, SelectWithCreate, Skeleton } from '../ui/common'
import { friendlyError, mustChange } from '../lib/api'
import { parseNumber } from '../lib/csv'
import { datedName } from '../lib/xlsx'
import { useXlsxExport } from '../ui/useXlsxExport'
import { fmtUnitPrice, packOf, packPrice } from '../lib/price'
import { fmtDate, fmtMoneyFull, fmtNum, fmtPrice, safeUrl } from '../lib/format'
import { EXPENSE_KINDS, ORDER_STATUS, isOpenOrder, orderCode, orderTotals, shopFromUrl, todayIso } from '../lib/orders'

const FILTERS = [
  { key: 'open', label: 'Đang chờ về' },
  { key: 'received', label: 'Đã nhận' },
  { key: 'cancelled', label: 'Đã hủy', onlyIfAny: true }, // hủy đơn giờ xóa hẳn đơn; chỉ còn đơn hủy kiểu cũ (nếu có)
  { key: 'all', label: 'Tất cả đơn' },
  { key: 'expenses', label: 'Khoản chi khác' },
]
const matches = (o, key) =>
  key === 'all' ? true : key === 'open' ? isOpenOrder(o) : o.status === key

/** "" -> null, "65.000" -> 65000, chữ linh tinh -> NaN */
function parseMoney(str) {
  const s = String(str ?? '').trim()
  if (s === '') return null
  return parseNumber(s)
}
const moneyText = (v) => (v === null || v === undefined || v === '' ? '' : String(Math.round(Number(v) * 100) / 100))
const monthKey = (iso) => String(iso ?? '').slice(0, 7)
const thisMonth = () => todayIso().slice(0, 7)

/** Tên hiển thị một món trong đơn (món trong kho lấy theo kho, món mới lấy theo thông tin đã ghi) */
export function describeLine(line, componentsById) {
  const comp = line.component_id ? componentsById.get(line.component_id) : null
  return {
    comp,
    part: comp?.part_number ?? line.part_number ?? '',
    name: comp?.name ?? line.name ?? '',
    pack: comp ? packOf(comp) : packOf(line),
  }
}

export function StatusPill({ status }) {
  const s = ORDER_STATUS[status] ?? { label: status, tone: 'muted' }
  return (
    <span className={`kk-order-status is-${s.tone}`}>
      {status === 'shipping' && <Truck size={13} aria-hidden="true" />}
      {s.label}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Thẻ "Đơn hàng" của trang Cần mua                                    */
/* ------------------------------------------------------------------ */
export default function OrdersTab({ orders, expenses, planItems }) {
  const { componentsById, projectsById, reload } = useData()
  // Hủy đơn / bỏ món khỏi đơn đưa món về lại danh sách mua trước: tải lại cả hai danh sách
  // (và dữ liệu chung, để nhãn "Trong đơn DH-xx" và số trên thanh bên cũng cập nhật ngay)
  const refreshAll = () => {
    orders.refresh()
    planItems?.refresh()
    reload()
  }
  const { canEdit, isAdmin } = useShell()
  const [filter, setFilter] = useState('open')
  const [dialog, setDialog] = useState(null) // { kind: 'order' | 'receive' | 'expense' | 'delete-expense', ... }
  const xlsx = useXlsxExport()

  const all = useMemo(() => (orders.rows ?? []).map((o) => ({ ...o, sum: orderTotals(o) })), [orders.rows])
  const rows = all.filter((o) => matches(o, filter))
  const expenseRows = useMemo(() => expenses.rows ?? [], [expenses.rows])
  const shops = useMemo(() => [...new Set(all.map((o) => o.shop).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')), [all])

  const stats = useMemo(() => {
    const open = all.filter(isOpenOrder)
    const month = thisMonth()
    const monthOrders = all.filter((o) => o.status !== 'cancelled' && monthKey(o.ordered_on) === month)
    const monthExp = expenseRows.filter((e) => monthKey(e.spent_on) === month)
    return {
      open: open.length,
      openMoney: open.reduce((s, o) => s + o.sum.total, 0),
      monthOrders: monthOrders.length,
      monthOrderMoney: monthOrders.reduce((s, o) => s + o.sum.total, 0),
      monthExp: monthExp.length,
      monthExpMoney: monthExp.reduce((s, e) => s + Number(e.amount || 0), 0),
    }
  }, [all, expenseRows])

  if (orders.rows === null || expenses.rows === null) {
    return (
      <div className="kk-card kk-skel-list">
        <Skeleton h={52} r={10} />
        <Skeleton h={52} r={10} />
      </div>
    )
  }
  if (orders.missing || expenses.missing) {
    return (
      <div className="kk-card">
        <EmptyState
          title="Chưa bật đơn hàng"
          text={
            isAdmin
              ? 'Mở Supabase, vào SQL Editor, dán nội dung file sql/17_purchase_orders.sql rồi bấm Run, sau đó tải lại trang.'
              : 'Hãy nhờ admin nâng cấp database.'
          }
        />
      </div>
    )
  }
  if (orders.error || expenses.error) {
    return (
      <div className="kk-card">
        <EmptyState title="Chưa tải được đơn hàng" text={orders.error || expenses.error}>
          <button
            type="button"
            className="kk-btn kk-btn-primary"
            onClick={() => {
              orders.refresh()
              expenses.refresh()
            }}
          >
            Thử lại
          </button>
        </EmptyState>
      </div>
    )
  }

  const showExpenses = filter === 'expenses'
  const projLabel = (id) => {
    const p = projectsById.get(id)
    return p ? [p.code, p.name].filter(Boolean).join(' · ') : ''
  }

  function exportXlsx() {
    if (showExpenses) {
      return xlsx.run({
        filename: datedName('chi-phi-khac'),
        title: 'Khoản chi khác',
        sheet: 'Chi phí khác',
        rows: expenseRows,
        columns: [
          { header: 'Ngày', value: (e) => fmtDate(e.spent_on), width: 12 },
          { header: 'Nội dung', value: (e) => e.title, width: 34, wrap: true },
          { header: 'Loại', value: (e) => e.kind, width: 18 },
          { header: 'Số tiền', value: (e) => Number(e.amount), type: 'money', width: 16, total: true },
          { header: 'Dự án', value: (e) => projLabel(e.project_id), width: 24, wrap: true },
          { header: 'Ghi chú', value: (e) => e.note, width: 30, wrap: true },
        ],
      })
    }
    // Mỗi món một dòng, có dòng tiêu đề cho từng đơn
    const list = []
    for (const o of rows) {
      list.push({ group: `${orderCode(o.code_no)} · ${o.shop || 'Chưa ghi nơi mua'} · đặt ${fmtDate(o.ordered_on)} · ${ORDER_STATUS[o.status]?.label ?? o.status}${o.sum.ship ? ` · ship ${fmtMoneyFull(o.sum.ship)}` : ''}` })
      for (const l of o.lines) list.push({ o, l, d: describeLine(l, componentsById) })
    }
    xlsx.run({
      filename: datedName('don-hang'),
      title: 'Đơn hàng',
      subtitle: FILTERS.find((f) => f.key === filter)?.label,
      sheet: 'Đơn hàng',
      rows: list,
      columns: [
        { header: 'Đơn', value: (r) => orderCode(r.o.code_no), width: 9 },
        { header: 'Mã linh kiện', value: (r) => r.d.part, width: 24, wrap: true },
        { header: 'Tên', value: (r) => r.d.name, width: 32, wrap: true },
        { header: 'Số đặt', value: (r) => r.l.quantity, type: 'int', width: 10, total: true },
        { header: 'Đã nhận', value: (r) => r.l.received, type: 'int', width: 10, total: true },
        { header: 'Đơn giá (1 cái)', value: (r) => (r.l.unit_price === null ? null : Number(r.l.unit_price)), type: 'money', width: 14 },
        { header: 'Thành tiền', value: (r) => (r.l.unit_price === null ? null : Number(r.l.unit_price) * r.l.quantity), type: 'money', width: 16, total: true },
        { header: 'Dự án', value: (r) => projLabel(r.l.project_id), width: 22, wrap: true },
      ],
    })
  }

  return (
    <>
      <section className="kk-stats kk-stats-3" aria-label="Tóm tắt đơn hàng">
        <StatCard
          Icon={Truck}
          label="Đơn đang chờ về"
          value={fmtNum(stats.open)}
          note={stats.open > 0 ? `trị giá ${fmtMoneyFull(stats.openMoney)}, kể cả ship` : 'Không có đơn nào đang chờ'}
          onClick={filter !== 'open' && stats.open > 0 ? () => setFilter('open') : undefined}
        />
        <StatCard
          Icon={Receipt}
          label="Đơn đặt trong tháng này"
          value={fmtMoneyFull(stats.monthOrderMoney)}
          note={`${fmtNum(stats.monthOrders)} đơn, kể cả ship`}
          to="/reports"
        />
        <StatCard
          Icon={Wallet}
          label="Khoản chi khác tháng này"
          value={fmtMoneyFull(stats.monthExpMoney)}
          note={`${fmtNum(stats.monthExp)} khoản`}
          onClick={filter !== 'expenses' ? () => setFilter('expenses') : undefined}
        />
      </section>

      <div className="kk-card kk-toolbar">
        <div className="kk-pills" role="group" aria-label="Lọc đơn hàng">
          {FILTERS.filter((f) => !f.onlyIfAny || all.some((o) => matches(o, f.key))).map((f) => (
            <button
              key={f.key}
              type="button"
              className={`kk-pill ${filter === f.key ? 'is-on' : ''}`}
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label} ({fmtNum(f.key === 'expenses' ? expenseRows.length : all.filter((o) => matches(o, f.key)).length)})
            </button>
          ))}
        </div>
        <span className="kk-push-right" />
        <button
          type="button"
          className="kk-btn kk-btn-outline"
          onClick={exportXlsx}
          disabled={(showExpenses ? expenseRows.length : rows.length) === 0 || xlsx.busy}
        >
          <Download size={18} />
          {xlsx.busy ? 'Đang xuất…' : 'Xuất Excel'}
        </button>
        {canEdit && (
          <button type="button" className="kk-btn kk-btn-primary" onClick={() => setDialog({ kind: 'expense', item: null })}>
            <Plus size={18} />
            Ghi khoản chi khác
          </button>
        )}
      </div>

      {showExpenses ? (
        <ExpenseTable
          rows={expenseRows}
          projLabel={projLabel}
          onEdit={(e) => setDialog({ kind: 'expense', item: e })}
          onDelete={(e) => setDialog({ kind: 'delete-expense', item: e })}
        />
      ) : (
        <div className="kk-card kk-table-card">
          {all.length === 0 ? (
            <EmptyState
              title="Chưa có đơn hàng nào"
              text='Vào thẻ "Danh sách mua trước", bấm nút "Cần mua" của một món để đặt hàng, hoặc tick chọn nhiều món rồi bấm "Tạo đơn hàng".'
            >
              <Link className="kk-btn kk-btn-primary" to="/buy?tab=plan">
                <ClipboardList size={18} />
                Mở danh sách mua trước
              </Link>
            </EmptyState>
          ) : rows.length === 0 ? (
            <EmptyState title="Không có đơn nào ở mục này" text="Chọn bộ lọc khác để xem." />
          ) : (
            <div className="kk-table-scroll">
              <table className="kk-table kk-table-plain kk-orders-table">
                <thead>
                  <tr>
                    <th>Đơn</th>
                    <th>Ngày đặt</th>
                    <th className="is-num">Đã nhận</th>
                    <th className="kk-col-price is-num">Tiền hàng</th>
                    <th className="kk-col-price is-num">Ship</th>
                    <th className="kk-col-price is-num">Tổng</th>
                    <th>Trạng thái</th>
                    {canEdit && <th className="kk-col-plan-act" aria-label="Thao tác" />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => (
                    <tr key={o.id} onClick={() => setDialog({ kind: 'order', id: o.id })}>
                      <td data-label="Đơn" className="kk-cell-main">
                        <button
                          type="button"
                          className="kk-row-link"
                          onClick={(e) => {
                            e.stopPropagation()
                            setDialog({ kind: 'order', id: o.id })
                          }}
                        >
                          {orderCode(o.code_no)} · {o.shop || 'Chưa ghi nơi mua'}
                        </button>
                        <span className="kk-cell-sub">
                          <span className="kk-cell-name">
                            {fmtNum(o.lines.length)} món
                            {o.order_ref ? ` · mã đơn ${o.order_ref}` : ''}
                          </span>
                        </span>
                      </td>
                      <td data-label="Ngày đặt">{fmtDate(o.ordered_on)}</td>
                      <td data-label="Đã nhận" className="is-num">
                        {fmtNum(o.sum.received)} / {fmtNum(o.sum.qty)}
                      </td>
                      <td data-label="Tiền hàng" className="kk-col-price is-num">
                        {fmtMoneyFull(o.sum.goods)}
                        {o.sum.unpriced > 0 && <small className="kk-note-sm">{fmtNum(o.sum.unpriced)} món chưa có giá</small>}
                      </td>
                      <td data-label="Ship" className="kk-col-price is-num">
                        {o.sum.ship ? fmtMoneyFull(o.sum.ship) : '—'}
                      </td>
                      <td data-label="Tổng" className="kk-col-price is-num kk-strong-num">
                        {fmtMoneyFull(o.sum.total)}
                      </td>
                      <td data-label="Trạng thái">
                        <StatusPill status={o.status} />
                      </td>
                      {canEdit && (
                        <td className="kk-col-plan-act" onClick={(e) => e.stopPropagation()}>
                          {isOpenOrder(o) && (
                            <button
                              type="button"
                              className="kk-btn kk-btn-soft kk-btn-sm kk-c-in"
                              onClick={() => setDialog({ kind: 'receive', id: o.id })}
                            >
                              <PackageCheck size={16} />
                              Nhận hàng
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {dialog?.kind === 'order' && all.find((o) => o.id === dialog.id) && (
        <OrderDialog
          order={all.find((o) => o.id === dialog.id)}
          shops={shops}
          onChanged={refreshAll}
          onReceive={() => setDialog({ kind: 'receive', id: dialog.id })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'receive' && all.find((o) => o.id === dialog.id) && (
        <ReceiveOrderDialog order={all.find((o) => o.id === dialog.id)} onDone={orders.refresh} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'expense' && <ExpenseForm initial={dialog.item} onSaved={expenses.refresh} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'delete-expense' && (
        <ConfirmDialog
          title={`Xóa khoản chi "${dialog.item.title}"?`}
          text={`Số tiền ${fmtMoneyFull(dialog.item.amount)} sẽ không còn tính vào báo cáo chi tiêu.`}
          confirmLabel="Xóa khoản chi"
          Icon={Trash2}
          onConfirm={async () => {
            mustChange(await supabase.from('other_expenses').delete().eq('id', dialog.item.id).select('id'))
            expenses.refresh()
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Bảng khoản chi khác                                                 */
/* ------------------------------------------------------------------ */
function ExpenseTable({ rows, projLabel, onEdit, onDelete }) {
  const { canEdit } = useShell()
  const total = rows.reduce((s, e) => s + Number(e.amount || 0), 0)
  return (
    <div className="kk-card kk-table-card">
      {rows.length === 0 ? (
        <EmptyState
          title="Chưa ghi khoản chi khác nào"
          text="Ghi ở đây những khoản không phải linh kiện trong kho: đặt mạch in, dụng cụ, thiếc hàn, phí ship lẻ... để báo cáo chi tiêu được đầy đủ."
        />
      ) : (
        <>
          <div className="kk-table-scroll">
            <table className="kk-table kk-table-plain kk-table-static">
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th>Nội dung</th>
                  <th>Loại</th>
                  <th className="kk-col-price is-num">Số tiền</th>
                  <th>Dự án</th>
                  {canEdit && <th className="kk-col-plan-act" aria-label="Thao tác" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td data-label="Ngày">{fmtDate(e.spent_on)}</td>
                    <td data-label="Nội dung" className="kk-cell-main">
                      <strong>{e.title}</strong>
                      {e.note && <span className="kk-plan-note">{e.note}</span>}
                    </td>
                    <td data-label="Loại">{e.kind || '—'}</td>
                    <td data-label="Số tiền" className="kk-col-price is-num kk-strong-num">
                      {fmtMoneyFull(e.amount)}
                    </td>
                    <td data-label="Dự án">{projLabel(e.project_id) || '—'}</td>
                    {canEdit && (
                      <td className="kk-col-plan-act">
                        <span className="kk-plan-actions">
                          <button type="button" className="kk-icon-btn kk-c-edit" aria-label={`Sửa ${e.title}`} title="Sửa" onClick={() => onEdit(e)}>
                            <Pencil size={16} />
                          </button>
                          <button type="button" className="kk-icon-btn kk-c-del" aria-label={`Xóa ${e.title}`} title="Xóa" onClick={() => onDelete(e)}>
                            <Trash2 size={16} />
                          </button>
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="kk-pager">
            <span>{fmtNum(rows.length)} khoản</span>
            <span>Tổng {fmtMoneyFull(total)}</span>
          </div>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Thêm / sửa khoản chi khác                                           */
/* ------------------------------------------------------------------ */
function ExpenseForm({ initial, onSaved, onClose }) {
  const { projects } = useData()
  const toast = useToast()
  const [f, setF] = useState({
    title: initial?.title ?? '',
    kind: initial?.kind ?? '',
    amount: moneyText(initial?.amount),
    spent_on: initial?.spent_on ?? todayIso(),
    project_id: initial?.project_id ?? null,
    note: initial?.note ?? '',
  })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (key) => (e) => setF((s) => ({ ...s, [key]: e.target.value }))

  async function submit(ev) {
    ev.preventDefault()
    if (saving) return
    const e = {}
    const amount = parseMoney(f.amount)
    if (!f.title.trim()) e.title = 'Nhập nội dung khoản chi.'
    if (amount === null || Number.isNaN(amount) || amount < 0) e.amount = 'Nhập số tiền hợp lệ, ví dụ 150000.'
    if (!f.spent_on) e.spent_on = 'Chọn ngày chi.'
    setErrors(e)
    setFormError('')
    if (Object.keys(e).length > 0) return
    const payload = {
      title: f.title.trim(),
      kind: f.kind.trim() || null,
      amount,
      spent_on: f.spent_on,
      project_id: f.project_id,
      note: f.note.trim() || null,
    }
    setSaving(true)
    try {
      if (initial) mustChange(await supabase.from('other_expenses').update(payload).eq('id', initial.id).select('id'))
      else mustChange(await supabase.from('other_expenses').insert(payload).select('id'))
      onSaved()
      toast.push({ message: initial ? 'Đã lưu khoản chi.' : `Đã ghi khoản chi ${fmtMoneyFull(amount)}.` })
      onClose()
    } catch (err) {
      setFormError(friendlyError(err))
      setSaving(false)
    }
  }

  return (
    <Modal
      title={initial ? 'Sửa khoản chi' : 'Ghi khoản chi khác'}
      subtitle="Khoản không phải linh kiện trong kho, vd đặt mạch in, dụng cụ, thiếc hàn."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="kk-btn kk-btn-ghost" onClick={onClose} disabled={saving}>
            Hủy
          </button>
          <button type="submit" form="expense-form" className="kk-btn kk-btn-primary" disabled={saving}>
            {saving ? <Loader2 size={18} className="kk-spin" /> : <Save size={18} />}
            {initial ? 'Lưu thay đổi' : 'Ghi khoản chi'}
          </button>
        </>
      }
    >
      <form id="expense-form" className="kk-form-grid" onSubmit={submit} noValidate>
        <Field label="Nội dung *" htmlFor="ex-title" error={errors.title} className="kk-span-2">
          <input id="ex-title" data-autofocus value={f.title} maxLength={200} placeholder="Vd: Đặt 10 mạch PRJ-10 ở JLCPCB" onChange={set('title')} />
        </Field>
        <Field label="Số tiền (đ) *" htmlFor="ex-amount" error={errors.amount}>
          <input id="ex-amount" inputMode="decimal" value={f.amount} placeholder="Vd: 150000" onChange={set('amount')} />
        </Field>
        <Field label="Ngày chi *" htmlFor="ex-date" error={errors.spent_on}>
          <input id="ex-date" type="date" value={f.spent_on} onChange={set('spent_on')} />
        </Field>
        <Field label="Loại" htmlFor="ex-kind" hint="Chọn gợi ý hoặc gõ loại khác.">
          <input id="ex-kind" list="ex-kind-list" value={f.kind} maxLength={60} onChange={set('kind')} />
          <datalist id="ex-kind-list">
            {EXPENSE_KINDS.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
        </Field>
        <Field label="Cho dự án (không bắt buộc)" htmlFor="ex-proj">
          <select id="ex-proj" value={f.project_id ?? ''} onChange={(e) => setF((s) => ({ ...s, project_id: e.target.value || null }))}>
            <option value="">Không gắn dự án</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code ? `${p.code} · ${p.name}` : p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ghi chú" htmlFor="ex-note" className="kk-span-2">
          <textarea id="ex-note" rows={2} maxLength={500} value={f.note} onChange={set('note')} />
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
/* Đặt hàng các món trong danh sách mua trước: tạo đơn mới, hoặc       */
/* thêm vào một đơn đang chờ về                                        */
/* ------------------------------------------------------------------ */
export function CreateOrderDialog({ items, shops = [], openOrders = [], onDone, onClose }) {
  const { componentsById } = useData()
  const toast = useToast()
  // Gợi ý nơi mua: tên miền chung của link nơi bán (nếu các món cùng một trang)
  const domains = [...new Set(items.map((it) => shopFromUrl(it.shop_url)).filter(Boolean))]
  const [mode, setMode] = useState('new') // 'new' = tạo đơn mới, 'add' = thêm vào đơn đang chờ
  const [target, setTarget] = useState(openOrders[0]?.id ?? null)
  const what =
    items.length === 1 ? (componentsById.get(items[0].component_id)?.part_number ?? items[0].part_number) : `${fmtNum(items.length)} món`
  const [f, setF] = useState({
    shop: domains.length === 1 ? domains[0] : '',
    order_ref: '',
    ordered_on: todayIso(),
    shipping: '',
    note: '',
  })
  const [error, setError] = useState('')
  const [shipError, setShipError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (key) => (e) => setF((s) => ({ ...s, [key]: e.target.value }))

  const goods = items.reduce((s, it) => {
    const comp = componentsById.get(it.component_id)
    const price = it.unit_price ?? (Number(comp?.unit_price) > 0 ? comp.unit_price : null)
    return price === null || price === undefined ? s : s + Number(price) * it.quantity
  }, 0)

  async function submit(ev) {
    ev.preventDefault()
    if (busy) return
    setError('')
    if (mode === 'add') {
      if (!target) return setError('Chọn đơn muốn thêm vào.')
      setBusy(true)
      const { error: addErr } = await supabase.rpc('add_to_purchase_order', { p_order: target, p_items: items.map((it) => it.id) })
      if (addErr) {
        setBusy(false)
        return setError(friendlyError(addErr))
      }
      const o = openOrders.find((x) => x.id === target)
      onDone(target)
      toast.push({ message: `Đã thêm ${what} vào ${orderCode(o?.code_no)}. Xem ở thẻ "Đơn hàng".` })
      return onClose()
    }
    const ship = parseMoney(f.shipping)
    if (ship !== null && (Number.isNaN(ship) || ship < 0)) return setShipError('Nhập số tiền hợp lệ, ví dụ 30000.')
    setShipError('')
    setBusy(true)
    const { data, error: err } = await supabase.rpc('create_purchase_order', {
      p_items: items.map((it) => it.id),
      p_shop: f.shop.trim() || null,
      p_ref: f.order_ref.trim() || null,
      p_ordered_on: f.ordered_on || null,
      p_shipping: ship ?? 0,
      p_note: f.note.trim() || null,
    })
    if (err) {
      setBusy(false)
      return setError(friendlyError(err))
    }
    onDone(data)
    toast.push({ message: `Đã đặt hàng ${what}. Xem ở thẻ "Đơn hàng".` })
    onClose()
  }

  return (
    <Modal
      title={`Đặt hàng ${what}`}
      subtitle={'Món đã đặt chuyển sang thẻ "Đơn hàng". Hàng về thì bấm "Nhận hàng" ở đó.'}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="kk-btn kk-btn-ghost" onClick={onClose} disabled={busy}>
            Hủy
          </button>
          <button type="submit" form="order-form" className="kk-btn kk-btn-primary" disabled={busy}>
            {busy ? <Loader2 size={18} className="kk-spin" /> : <Truck size={18} />}
            {mode === 'add' ? 'Thêm vào đơn' : 'Tạo đơn hàng'}
          </button>
        </>
      }
    >
      {openOrders.length > 0 && (
        <div className="kk-seg kk-seg-2" role="group" aria-label="Cách đặt hàng">
          <button type="button" className={`kk-seg-btn ${mode === 'new' ? 'is-on' : ''}`} aria-pressed={mode === 'new'} onClick={() => setMode('new')}>
            <Plus size={18} />
            Tạo đơn mới
          </button>
          <button type="button" className={`kk-seg-btn ${mode === 'add' ? 'is-on' : ''}`} aria-pressed={mode === 'add'} onClick={() => setMode('add')}>
            <Truck size={18} />
            Thêm vào đơn đang chờ
          </button>
        </div>
      )}
      {mode === 'add' ? (
        <form id="order-form" className="kk-order-pick" onSubmit={submit} noValidate>
          {openOrders.map((o) => (
            <label key={o.id} className={`kk-order-pick-row ${target === o.id ? 'is-on' : ''}`}>
              <input type="radio" name="order-target" checked={target === o.id} onChange={() => setTarget(o.id)} />
              <span>
                <strong>
                  {orderCode(o.code_no)} · {o.shop || 'Chưa ghi nơi mua'}
                </strong>
                <small>
                  Đặt {fmtDate(o.ordered_on)} · {fmtNum(o.lines.length)} món · {ORDER_STATUS[o.status]?.label}
                </small>
              </span>
            </label>
          ))}
        </form>
      ) : (
      <form id="order-form" className="kk-form-grid" onSubmit={submit} noValidate>
        <Field label="Nơi mua" htmlFor="od-shop" hint="Vd: LCSC, Shopee - Hshop. Để trống được, sửa sau.">
          <input id="od-shop" data-autofocus list="od-shop-list" value={f.shop} maxLength={80} onChange={set('shop')} />
          <datalist id="od-shop-list">
            {shops.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <Field label="Mã đơn của shop (không bắt buộc)" htmlFor="od-ref">
          <input id="od-ref" value={f.order_ref} maxLength={80} onChange={set('order_ref')} />
        </Field>
        <Field label="Ngày đặt" htmlFor="od-date">
          <input id="od-date" type="date" value={f.ordered_on} onChange={set('ordered_on')} />
        </Field>
        <Field label="Phí ship (đ)" htmlFor="od-ship" error={shipError} hint="Ghi riêng cho cả đơn, không cộng vào đơn giá linh kiện.">
          <input id="od-ship" inputMode="decimal" value={f.shipping} placeholder="0" onChange={set('shipping')} />
        </Field>
        <Field label="Ghi chú" htmlFor="od-note" className="kk-span-2">
          <textarea id="od-note" rows={2} maxLength={500} value={f.note} onChange={set('note')} />
        </Field>
      </form>
      )}
      <ul className="kk-order-items">
        {items.map((it) => {
          const comp = componentsById.get(it.component_id)
          return (
            <li key={it.id}>
              <strong>{comp?.part_number ?? it.part_number}</strong>
              <span>{comp?.name ?? it.name}</span>
              <b>× {fmtNum(it.quantity)}</b>
            </li>
          )
        })}
      </ul>
      <p className="kk-muted-text">Tiền hàng ước tính: {fmtMoneyFull(goods)} (món chưa có đơn giá chưa tính).</p>
      {error && (
        <p className="kk-form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Chi tiết một đơn: sửa thông tin, đổi trạng thái, hủy / đóng đơn      */
/* ------------------------------------------------------------------ */
function OrderDialog({ order, shops, onChanged, onReceive, onClose }) {
  const { componentsById, projectsById } = useData()
  const { canEdit, openComponent } = useShell()
  const toast = useToast()
  const open = isOpenOrder(order)
  const [f, setF] = useState({
    shop: order.shop ?? '',
    order_ref: order.order_ref ?? '',
    ordered_on: order.ordered_on,
    shipping: moneyText(order.shipping_fee),
    note: order.note ?? '',
  })
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [closing, setClosing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const set = (key) => (e) => setF((s) => ({ ...s, [key]: e.target.value }))
  const sum = order.sum
  const anyReceived = order.lines.some((l) => l.received > 0)
  const dirty =
    f.shop !== (order.shop ?? '') ||
    f.order_ref !== (order.order_ref ?? '') ||
    f.ordered_on !== order.ordered_on ||
    f.shipping !== moneyText(order.shipping_fee) ||
    f.note !== (order.note ?? '')

  async function run(kind, fn) {
    if (busy) return
    setBusy(kind)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy('')
    }
  }

  const saveInfo = () =>
    run('save', async () => {
      const ship = parseMoney(f.shipping)
      if (ship !== null && (Number.isNaN(ship) || ship < 0)) throw new Error('Phí ship không hợp lệ, ví dụ 30000.')
      mustChange(
        await supabase
          .from('purchase_orders')
          .update({
            shop: f.shop.trim() || null,
            order_ref: f.order_ref.trim() || null,
            ordered_on: f.ordered_on || order.ordered_on,
            shipping_fee: ship ?? 0,
            note: f.note.trim() || null,
          })
          .eq('id', order.id)
          .select('id'),
      )
      onChanged()
      toast.push({ message: `Đã lưu ${orderCode(order.code_no)}.` })
    })

  const setStatus = (status) =>
    run(status, async () => {
      mustChange(await supabase.from('purchase_orders').update({ status }).eq('id', order.id).select('id'))
      onChanged()
    })

  // Bỏ một món chưa nhận khỏi đơn: món về lại danh sách mua trước ("Cần mua"); hết món thì đơn tự mất
  const removeLine = (line, part) =>
    run(`del-${line.id}`, async () => {
      const { data: gone, error: err } = await supabase.rpc('remove_order_line', { p_line: line.id })
      if (err) throw err
      onChanged()
      toast.push({
        message: gone
          ? `Đã bỏ ${part}. ${orderCode(order.code_no)} không còn món nào nên đã được xóa; món đã về lại danh sách mua trước.`
          : `Đã bỏ ${part} khỏi ${orderCode(order.code_no)}, món đã về lại danh sách mua trước.`,
      })
      if (gone) onClose()
    })

  return (
    <Modal
      title={`${orderCode(order.code_no)} · ${order.shop || 'Chưa ghi nơi mua'}`}
      subtitle={`Đặt ngày ${fmtDate(order.ordered_on)}${order.received_at ? `, nhận lần đầu ${fmtDate(order.received_at)}` : ''}`}
      headerExtra={<StatusPill status={order.status} />}
      size="lg"
      onClose={onClose}
      footer={
        canEdit ? (
          <>
            {open && (
              <button type="button" className="kk-btn kk-btn-ghost kk-c-del" onClick={() => setClosing(true)} disabled={Boolean(busy)}>
                <Ban size={18} />
                {anyReceived ? 'Đóng đơn' : 'Hủy đơn'}
              </button>
            )}
            {order.status === 'cancelled' && (
              <button type="button" className="kk-btn kk-btn-ghost kk-c-del" onClick={() => setDeleting(true)} disabled={Boolean(busy)}>
                <Trash2 size={18} />
                Xóa đơn
              </button>
            )}
            <span className="kk-push-right" />
            {dirty && (
              <button type="button" className="kk-btn kk-btn-outline" onClick={saveInfo} disabled={Boolean(busy)}>
                {busy === 'save' ? <Loader2 size={18} className="kk-spin" /> : <Save size={18} />}
                Lưu thông tin
              </button>
            )}
            {open && (
              <button type="button" className="kk-btn kk-btn-primary kk-c-in" onClick={onReceive} disabled={Boolean(busy)}>
                <PackageCheck size={18} />
                Nhận hàng
              </button>
            )}
          </>
        ) : null
      }
    >
      {open && canEdit && (
        <div className="kk-pills kk-order-steps" role="group" aria-label="Trạng thái đơn">
          {['ordered', 'shipping'].map((s) => (
            <button
              key={s}
              type="button"
              className={`kk-pill ${order.status === s ? 'is-on' : ''}`}
              aria-pressed={order.status === s}
              disabled={Boolean(busy) || order.status === 'partial'}
              onClick={() => order.status !== s && setStatus(s)}
            >
              {busy === s && <Loader2 size={14} className="kk-spin" />}
              {ORDER_STATUS[s].label}
            </button>
          ))}
          {order.status === 'partial' && <span className="kk-muted-text">Đã nhận một phần, đang chờ phần còn lại.</span>}
        </div>
      )}

      <div className="kk-form-grid">
        <Field label="Nơi mua" htmlFor="ov-shop">
          <input id="ov-shop" list="ov-shop-list" value={f.shop} maxLength={80} disabled={!canEdit} onChange={set('shop')} />
          <datalist id="ov-shop-list">
            {shops.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <Field label="Mã đơn của shop" htmlFor="ov-ref">
          <input id="ov-ref" value={f.order_ref} maxLength={80} disabled={!canEdit} onChange={set('order_ref')} />
        </Field>
        <Field label="Ngày đặt" htmlFor="ov-date">
          <input id="ov-date" type="date" value={f.ordered_on} disabled={!canEdit} onChange={set('ordered_on')} />
        </Field>
        <Field label="Phí ship (đ)" htmlFor="ov-ship">
          <input id="ov-ship" inputMode="decimal" value={f.shipping} placeholder="0" disabled={!canEdit} onChange={set('shipping')} />
        </Field>
        <Field label="Ghi chú" htmlFor="ov-note" className="kk-span-2">
          <textarea id="ov-note" rows={2} maxLength={500} value={f.note} disabled={!canEdit} onChange={set('note')} />
        </Field>
      </div>

      <div className="kk-table-scroll kk-order-lines">
        <table className="kk-mini-table">
          <thead>
            <tr>
              <th>Linh kiện</th>
              <th className="is-num">Đặt</th>
              <th className="is-num">Đã nhận</th>
              <th className="is-num">Đơn giá</th>
              <th className="is-num">Thành tiền</th>
              <th>Dự án</th>
              {open && canEdit && <th aria-label="Thao tác" />}
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l) => {
              const d = describeLine(l, componentsById)
              const p = projectsById.get(l.project_id)
              const url = safeUrl(l.shop_url)
              return (
                <tr key={l.id}>
                  <td>
                    {d.comp ? (
                      <button type="button" className="kk-row-link" onClick={() => openComponent(d.comp.id)}>
                        {d.part}
                      </button>
                    ) : (
                      <strong>{d.part}</strong>
                    )}
                    <span className="kk-plan-note">
                      {d.name}
                      {!d.comp && ' · linh kiện mới'}
                      {url && (
                        <>
                          {' · '}
                          <a className="kk-link" href={url} target="_blank" rel="noopener noreferrer">
                            link <ExternalLink size={12} />
                          </a>
                        </>
                      )}
                    </span>
                  </td>
                  <td className="is-num">{fmtNum(l.quantity)}</td>
                  <td className={`is-num ${l.received < l.quantity ? 'kk-warn-text' : ''}`}>{fmtNum(l.received)}</td>
                  <td className="is-num">{l.unit_price === null ? '—' : fmtUnitPrice(l.unit_price, d.pack)}</td>
                  <td className="is-num">{l.unit_price === null ? '—' : fmtMoneyFull(Number(l.unit_price) * l.quantity)}</td>
                  <td>{p ? p.code || p.name : '—'}</td>
                  {open && canEdit && (
                    <td>
                      {l.received === 0 && (
                        <button
                          type="button"
                          className="kk-icon-btn kk-c-del"
                          aria-label={`Bỏ ${d.part} khỏi đơn, đưa về lại danh sách mua trước`}
                          title="Bỏ khỏi đơn (về lại Cần mua)"
                          disabled={Boolean(busy)}
                          onClick={() => removeLine(l, d.part)}
                        >
                          {busy === `del-${l.id}` ? <Loader2 size={14} className="kk-spin" /> : <X size={14} />}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="kk-order-sum">
        <span>Tiền hàng {fmtMoneyFull(sum.goods)}</span>
        <span>Ship {fmtMoneyFull(sum.ship)}</span>
        <strong>Tổng {fmtMoneyFull(sum.total)}</strong>
      </p>
      {sum.unpriced > 0 && <p className="kk-muted-text">{fmtNum(sum.unpriced)} món chưa có đơn giá nên chưa tính vào tổng.</p>}
      {error && (
        <p className="kk-form-error" role="alert">
          {error}
        </p>
      )}

      {closing && (
        <CloseOrderDialog
          order={order}
          anyReceived={anyReceived}
          onDone={(status) => {
            onChanged()
            if (status === 'deleted') onClose()
          }}
          onClose={() => setClosing(false)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Xóa ${orderCode(order.code_no)}?`}
          text="Đơn đã hủy sẽ bị xóa hẳn khỏi danh sách. Không ảnh hưởng tới kho."
          confirmLabel="Xóa đơn"
          Icon={Trash2}
          onConfirm={async () => {
            mustChange(await supabase.from('purchase_orders').delete().eq('id', order.id).eq('status', 'cancelled').select('id'))
            onChanged()
            onClose()
          }}
          onClose={() => setDeleting(false)}
        />
      )}
    </Modal>
  )
}

function CloseOrderDialog({ order, anyReceived, onDone, onClose }) {
  const toast = useToast()
  const [back, setBack] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const left = order.lines.filter((l) => l.received < l.quantity).length

  async function run() {
    if (busy) return
    setBusy(true)
    setError('')
    const { data, error: err } = await supabase.rpc('close_purchase_order', { p_order: order.id, p_back_to_list: back })
    if (err) {
      setBusy(false)
      return setError(friendlyError(err))
    }
    toast.push({
      message:
        data === 'deleted'
          ? `Đã hủy ${orderCode(order.code_no)}. ${fmtNum(order.lines.length)} món đã về lại danh sách mua trước ("Cần mua").`
          : `Đã đóng ${orderCode(order.code_no)}${back && left > 0 ? `, ${fmtNum(left)} món chưa nhận đã về lại danh sách mua trước` : ''}.`,
    })
    onClose()
    onDone(data)
  }

  return (
    <Modal
      title={anyReceived ? `Đóng ${orderCode(order.code_no)}?` : `Hủy ${orderCode(order.code_no)}?`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="kk-btn kk-btn-ghost" data-autofocus onClick={onClose} disabled={busy}>
            Giữ lại
          </button>
          <button type="button" className="kk-btn kk-btn-danger" onClick={run} disabled={busy}>
            {busy ? <Loader2 size={18} className="kk-spin" /> : <Ban size={18} />}
            {anyReceived ? 'Đóng đơn' : 'Hủy đơn'}
          </button>
        </>
      }
    >
      <p className="kk-confirm-text">
        {anyReceived
          ? 'Đơn sẽ được đóng với số lượng đã nhận. Phần chưa nhận sẽ không chờ nữa.'
          : 'Các món trong đơn sẽ về lại danh sách mua trước ở trạng thái "Cần mua", và đơn này bị xóa. Kho không thay đổi gì.'}
      </p>
      {anyReceived && left > 0 && (
        <label className="kk-price-sync">
          <input type="checkbox" checked={back} onChange={(e) => setBack(e.target.checked)} />
          Đưa {fmtNum(left)} món chưa nhận về lại danh sách mua trước
        </label>
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
/* Nhận hàng: số thực nhận, vị trí cất, đơn giá thực tế cho từng món    */
/* ------------------------------------------------------------------ */
function ReceiveOrderDialog({ order, onDone, onClose }) {
  const { componentsById, locations, createLocation, reload } = useData()
  const toast = useToast()
  const pending = order.lines.filter((l) => l.received < l.quantity)
  const startLines = pending.length > 0 ? pending : order.lines
  const firstLoc = locations.length === 1 ? locations[0].id : null
  const [rows, setRows] = useState(() =>
    startLines.map((l) => {
      const d = describeLine(l, componentsById)
      return {
        line: l,
        d,
        qty: Math.max(0, l.quantity - l.received),
        loc: null,
        price: moneyText(packPrice(l.unit_price, d.pack)),
      }
    }),
  )
  const [allLoc, setAllLoc] = useState(firstLoc)
  const [toStock, setToStock] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [attempted, setAttempted] = useState(false)
  const patch = (id, p) => setRows((rs) => rs.map((r) => (r.line.id === id ? { ...r, ...p } : r)))
  const locOf = (r) => r.loc ?? allLoc
  const locOptions = locations.map((l) => ({ value: l.id, label: l.path }))

  const active = rows.filter((r) => Number(r.qty) > 0)
  const priceOf = (r) => {
    const v = parseMoney(r.price)
    if (v === null) return null
    if (Number.isNaN(v) || v < 0) return NaN
    return r.d.pack ? v / r.d.pack.qty : v
  }
  const total = active.reduce((s, r) => {
    const p = priceOf(r)
    return p === null || Number.isNaN(p) ? s : s + p * Number(r.qty)
  }, 0)

  async function submit() {
    if (busy) return
    setAttempted(true)
    setError('')
    if (active.length === 0) return setError('Nhập số lượng thực nhận cho ít nhất một món.')
    if (active.some((r) => !locOf(r))) return setError('Chọn vị trí cất (chọn một vị trí chung ở trên, hoặc riêng từng món).')
    if (active.some((r) => Number.isNaN(priceOf(r)))) return setError('Có đơn giá không hợp lệ. Nhập số, ví dụ 3500, hoặc để trống.')
    setBusy(true)
    const { data, error: err } = await supabase.rpc('receive_purchase_order', {
      p_order: order.id,
      p_update_price: toStock,
      p_lines: active.map((r) => ({
        line_id: r.line.id,
        qty: Number(r.qty),
        location_id: locOf(r),
        unit_price: priceOf(r),
      })),
    })
    if (err) {
      setBusy(false)
      return setError(friendlyError(err))
    }
    await reload()
    onDone()
    toast.push({ message: `${orderCode(order.code_no)}: đã nhập kho ${fmtNum(data)} món.`, duration: 7000 })
    onClose()
  }

  return (
    <Modal
      title={`Nhận hàng ${orderCode(order.code_no)}`}
      subtitle={order.shop || undefined}
      size="xl"
      onClose={onClose}
      footer={
        <>
          <span className="kk-foot-note">
            {fmtNum(active.length)} món · {fmtMoneyFull(total)}
          </span>
          <button type="button" className="kk-btn kk-btn-ghost" onClick={onClose} disabled={busy}>
            Hủy
          </button>
          <button type="button" className="kk-btn kk-btn-primary kk-c-in" onClick={submit} disabled={busy}>
            {busy ? <Loader2 size={18} className="kk-spin" /> : <PackageCheck size={18} />}
            {busy ? 'Đang nhập kho…' : 'Nhập kho'}
          </button>
        </>
      }
    >
      <div className="kk-form-grid">
        <Field label="Cất tất cả vào vị trí" htmlFor="ro-loc" hint="Món nào cất chỗ khác thì chọn riêng ở bảng dưới.">
          <SelectWithCreate
            id="ro-loc"
            value={allLoc}
            onChange={setAllLoc}
            placeholder="Chọn vị trí"
            options={locOptions}
            onCreate={createLocation}
            createLabel="Thêm vị trí mới"
          />
        </Field>
        <Field label="Đơn giá">
          <label className="kk-price-sync">
            <input type="checkbox" checked={toStock} onChange={(e) => setToStock(e.target.checked)} />
            Cập nhật đơn giá thực tế vào kho
          </label>
        </Field>
      </div>
      <div className="kk-table-scroll">
        <table className="kk-mini-table kk-receive-table">
          <thead>
            <tr>
              <th>Linh kiện</th>
              <th className="is-num">Đặt / đã nhận</th>
              <th>Nhận lần này</th>
              <th>Đơn giá (đ)</th>
              <th>Vị trí riêng</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const badPrice = attempted && Number(r.qty) > 0 && Number.isNaN(priceOf(r))
              return (
                <tr key={r.line.id}>
                  <td>
                    <strong>{r.d.part}</strong>
                    <span className="kk-plan-note">
                      {r.d.name}
                      {!r.d.comp && ' · linh kiện mới, sẽ được tạo khi nhập kho'}
                    </span>
                  </td>
                  <td className="is-num">
                    {fmtNum(r.line.quantity)} / {fmtNum(r.line.received)}
                  </td>
                  <td>
                    <QtyStepper value={r.qty} min={0} label={`Số nhận ${r.d.part}`} onChange={(v) => patch(r.line.id, { qty: v })} />
                  </td>
                  <td>
                    <input
                      className="kk-receive-price"
                      inputMode="decimal"
                      value={r.price}
                      aria-label={`Đơn giá ${r.d.part}`}
                      aria-invalid={badPrice || undefined}
                      placeholder="Chưa có giá"
                      onChange={(e) => patch(r.line.id, { price: e.target.value })}
                    />
                    <small className="kk-note-sm">{r.d.pack ? `/ ${r.d.pack.unit} (${fmtNum(r.d.pack.qty)} cái)` : '/ cái'}</small>
                    {r.d.comp && Number(r.d.comp.unit_price) > 0 && (
                      <small className="kk-note-sm">Kho: {fmtPrice(packPrice(r.d.comp.unit_price, r.d.pack))}</small>
                    )}
                  </td>
                  <td>
                    <select
                      value={r.loc ?? ''}
                      aria-label={`Vị trí cất ${r.d.part}`}
                      aria-invalid={(attempted && Number(r.qty) > 0 && !locOf(r)) || undefined}
                      onChange={(e) => patch(r.line.id, { loc: e.target.value || null })}
                    >
                      <option value="">{allLoc ? 'Như vị trí chung' : 'Chọn vị trí'}</option>
                      {locOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="kk-muted-text">
        <Coins size={14} aria-hidden="true" /> Món nào chưa về thì để số nhận bằng 0, lần sau bấm "Nhận hàng" tiếp. Món mua cho dự án sẽ tự thêm vào BOM nếu BOM chưa có.
      </p>
      {error && (
        <p className="kk-form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}
