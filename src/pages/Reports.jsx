import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Coins, Download, Hourglass, TrendingUp, Wallet } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useData } from '../data/DataContext'
import { useShell } from '../ShellContext'
import { EmptyState, Skeleton } from '../ui/common'
import { StatCard } from '../ui/stats'
import { fetchAll, friendlyError } from '../lib/api'
import { datedName } from '../lib/xlsx'
import { useXlsxExport } from '../ui/useXlsxExport'
import { fmtDate, fmtMoney, fmtMoneyFull, fmtNum } from '../lib/format'
import { probeOrdersReady } from '../lib/orders'

const RANGES = [3, 6, 12]
const RANGE_KEY = 'kk-report-months'
const UNDO_NOTE = 'Hoàn tác giao dịch trước'

// Màu theo đối tượng, cố định ở mọi biểu đồ: linh kiện = 1, phí ship = 2, chi phí khác = 3
const C_GOODS = 'var(--series-1)'
const C_SHIP = 'var(--series-2)'
const C_OTHER = 'var(--series-3)'

const pad = (n) => String(n).padStart(2, '0')
const monthOfTs = (iso) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}
const monthLabel = (key) => {
  const [y, m] = key.split('-')
  return `T${Number(m)}/${y.slice(2)}`
}

/** Các tháng của kỳ báo cáo, cũ trước: [{ key: '2026-09', label: 'T9/26', end: Date đầu tháng sau }] */
function monthsBack(n) {
  const now = new Date()
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
    out.push({ key, label: monthLabel(key), start: d, end: new Date(d.getFullYear(), d.getMonth() + 1, 1) })
  }
  return out
}

/** Một giao dịch làm tồn kho thay đổi bao nhiêu */
const deltaOf = (t) => (t.type === 'in' ? t.quantity : t.type === 'out' ? -t.quantity : Number(t.delta) || 0)
/** Xuất kho để dùng (không tính hoàn tác và trả hàng mua) */
const isUse = (t) => t.type === 'out' && !t.is_purchase && t.note !== UNDO_NOTE
/** Linh kiện quay lại kho sau khi đã xuất dùng: trả lại từ BOM, hoàn tác một lần xuất */
const isReturn = (t) => t.type === 'in' && !t.is_purchase && (t.note === UNDO_NOTE || String(t.note ?? '').startsWith('Trả lại kho'))
const priceOf = (c) => (Number(c?.unit_price) > 0 ? Number(c.unit_price) : 0)

function readRange() {
  try {
    const v = Number(localStorage.getItem(RANGE_KEY))
    return RANGES.includes(v) ? v : 6
  } catch {
    return 6
  }
}

export default function ReportsPage() {
  const { allComponents, componentsById, projectsById, version } = useData()
  const { isAdmin } = useShell()
  const [range, setRange] = useState(readRange)
  const [data, setData] = useState(null) // { tx, orders, expenses, ready }
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  function pickRange(n) {
    setRange(n)
    try {
      localStorage.setItem(RANGE_KEY, String(n))
    } catch {
      /* trình duyệt chặn lưu thì thôi */
    }
  }

  useEffect(() => {
    let off = false
    async function run() {
      try {
        const ready = await probeOrdersReady()
        const cols = `id,created_at,type,quantity,delta,component_id,project_id,note${ready ? ',is_purchase,unit_cost,order_id' : ''}`
        const [tx, orders, expenses] = await Promise.all([
          fetchAll(() => supabase.from('transactions').select(cols).order('created_at').order('id')),
          ready ? fetchAll(() => supabase.from('purchase_orders').select('id,code_no,shop,ordered_on,shipping_fee,status').order('code_no')) : [],
          ready ? fetchAll(() => supabase.from('other_expenses').select('id,spent_on,title,kind,amount,project_id').order('spent_on')) : [],
        ])
        if (off) return
        setData({ tx, orders, expenses, ready })
        setError('')
      } catch (e) {
        if (!off) setError(friendlyError(e))
      }
    }
    run()
    return () => {
      off = true
    }
  }, [version, attempt])

  const months = useMemo(() => monthsBack(range), [range])
  const rangeStart = months[0].start

  const report = useMemo(() => {
    if (!data) return null
    const inRange = new Set(months.map((m) => m.key))
    const ordersById = new Map(data.orders.map((o) => [o.id, o]))

    /* 1) Chi tiêu theo tháng: hàng mua (theo giá mua), phí ship của đơn, khoản chi khác */
    const spend = new Map(months.map((m) => [m.key, { key: m.key, label: m.label, goods: 0, ship: 0, other: 0 }]))
    const byShop = new Map()
    const shopRow = (name) => {
      const r = byShop.get(name) ?? { name, goods: 0, ship: 0, count: 0 }
      byShop.set(name, r)
      return r
    }
    let unpricedBuys = 0
    for (const t of data.tx) {
      if (!t.is_purchase) continue
      const sign = t.type === 'in' ? 1 : t.type === 'out' ? -1 : 0
      if (!sign) continue
      const o = ordersById.get(t.order_id)
      // Hàng theo đơn tính vào tháng đặt đơn (lúc trả tiền), hàng nhập lẻ tính theo ngày nhập
      const mk = o ? String(o.ordered_on).slice(0, 7) : monthOfTs(t.created_at)
      if (!inRange.has(mk)) continue
      if (t.unit_cost === null || t.unit_cost === undefined) {
        if (sign > 0) unpricedBuys++
        continue
      }
      const amount = sign * t.quantity * Number(t.unit_cost)
      spend.get(mk).goods += amount
      const s = shopRow(o ? o.shop || 'Chưa ghi nơi mua' : 'Nhập kho (không qua đơn)')
      s.goods += amount
    }
    for (const o of data.orders) {
      if (o.status === 'cancelled') continue
      const mk = String(o.ordered_on).slice(0, 7)
      if (!inRange.has(mk)) continue
      const s = shopRow(o.shop || 'Chưa ghi nơi mua')
      s.count++
      const fee = Number(o.shipping_fee) || 0
      spend.get(mk).ship += fee
      s.ship += fee
    }
    const byKind = new Map()
    for (const e of data.expenses) {
      const mk = String(e.spent_on).slice(0, 7)
      if (!inRange.has(mk)) continue
      const amount = Number(e.amount) || 0
      spend.get(mk).other += amount
      const k = e.kind || 'Khác'
      byKind.set(k, (byKind.get(k) ?? 0) + amount)
    }
    const spendRows = [...spend.values()].map((r) => ({ ...r, total: r.goods + r.ship + r.other }))
    const spendTotal = spendRows.reduce((s, r) => s + r.total, 0)
    const shopRows = [...byShop.values()].map((r) => ({ ...r, total: r.goods + r.ship })).sort((a, b) => b.total - a.total)
    const kindRows = [...byKind].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount)

    /* 2) Giá trị kho cuối mỗi tháng: lùi từ tồn hiện tại theo lịch sử, nhân đơn giá hiện tại */
    const now = new Map(allComponents.map((c) => [c.id, c.total_quantity]))
    const valueRows = []
    const after = new Map() // tổng thay đổi của các giao dịch sau mốc thời gian đang xét
    let i = data.tx.length - 1
    for (const m of [...months].reverse()) {
      const end = m.end.getTime()
      for (; i >= 0 && new Date(data.tx[i].created_at).getTime() >= end; i--) {
        const t = data.tx[i]
        after.set(t.component_id, (after.get(t.component_id) ?? 0) + deltaOf(t))
      }
      let value = 0
      let qty = 0
      for (const [id, q] of now) {
        const atEnd = Math.max(0, q - (after.get(id) ?? 0))
        qty += atEnd
        value += atEnd * priceOf(componentsById.get(id))
      }
      valueRows.unshift({ key: m.key, label: m.label, value, qty })
    }

    /* 3) và 5) Linh kiện đã dùng trong kỳ: theo linh kiện và theo dự án (xuất dùng trừ phần trả lại) */
    const startMs = rangeStart.getTime()
    const usedBy = new Map()
    const projUse = new Map()
    const lastUse = new Map()
    for (const t of data.tx) {
      if (isUse(t)) lastUse.set(t.component_id, t.created_at)
      if (new Date(t.created_at).getTime() < startMs) continue
      const sign = isUse(t) ? 1 : isReturn(t) ? -1 : 0
      if (!sign) continue
      usedBy.set(t.component_id, (usedBy.get(t.component_id) ?? 0) + sign * t.quantity)
      if (t.project_id) {
        const p = projUse.get(t.project_id) ?? { qty: 0, value: 0, other: 0 }
        p.qty += sign * t.quantity
        p.value += sign * t.quantity * priceOf(componentsById.get(t.component_id))
        projUse.set(t.project_id, p)
      }
    }
    const usedRows = [...usedBy]
      .filter(([, q]) => q > 0)
      .map(([id, q]) => {
        const c = componentsById.get(id)
        return { id, part: c?.part_number ?? '?', name: c?.name ?? '', qty: q, value: q * priceOf(c) }
      })
      .sort((a, b) => b.qty - a.qty || b.value - a.value)
    for (const e of data.expenses) {
      if (!e.project_id || !inRange.has(String(e.spent_on).slice(0, 7))) continue
      const p = projUse.get(e.project_id) ?? { qty: 0, value: 0, other: 0 }
      p.other += Number(e.amount) || 0
      projUse.set(e.project_id, p)
    }
    const projectRows = [...projUse]
      .map(([id, p]) => {
        const pr = projectsById.get(id)
        return {
          id,
          label: pr ? pr.code || pr.name : 'Dự án đã xóa',
          name: pr?.name ?? '',
          qty: Math.max(0, p.qty),
          value: Math.max(0, p.value),
          other: p.other,
          total: Math.max(0, p.value) + p.other,
        }
      })
      .filter((r) => r.total > 0 || r.qty > 0)
      .sort((a, b) => b.total - a.total)

    /* 4) Linh kiện nằm im: còn hàng nhưng không xuất dùng lần nào trong kỳ */
    const idleRows = allComponents
      .filter((c) => !c.archived_at && c.total_quantity > 0 && !(usedBy.get(c.id) > 0))
      .filter((c) => !lastUse.has(c.id) || new Date(lastUse.get(c.id)).getTime() < startMs)
      .map((c) => ({ id: c.id, part: c.part_number, name: c.name, qty: c.total_quantity, value: c.total_quantity * priceOf(c), last: lastUse.get(c.id) ?? null }))
      .sort((a, b) => b.value - a.value || b.qty - a.qty)

    return { spendRows, spendTotal, shopRows, kindRows, unpricedBuys, valueRows, usedRows, projectRows, idleRows }
  }, [data, months, rangeStart, allComponents, componentsById, projectsById])

  if (error) {
    return (
      <EmptyState title="Chưa tải được dữ liệu báo cáo" text={error}>
        <button type="button" className="kk-btn kk-btn-primary" onClick={() => setAttempt((n) => n + 1)}>
          Thử lại
        </button>
      </EmptyState>
    )
  }

  const idleValue = report ? report.idleRows.reduce((s, r) => s + r.value, 0) : 0
  const lastValue = report ? report.valueRows[report.valueRows.length - 1]?.value ?? 0 : 0

  return (
    <div className="kk-page">
      <div className="kk-page-head">
        <div>
          <h1>Báo cáo</h1>
          <p>Chi tiêu, giá trị kho và tình hình dùng linh kiện trong {range} tháng gần đây (tính cả tháng này).</p>
        </div>
        <div className="kk-toggle kk-report-range" role="group" aria-label="Khoảng thời gian">
          {RANGES.map((n) => (
            <button key={n} type="button" aria-pressed={range === n} onClick={() => pickRange(n)}>
              {n} tháng
            </button>
          ))}
        </div>
      </div>

      {!report ? (
        <>
          <div className="kk-stats">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} h={132} r={20} />
            ))}
          </div>
          <div className="kk-grid-charts">
            <Skeleton h={330} r={20} />
            <Skeleton h={330} r={20} />
          </div>
        </>
      ) : (
        <>
          <section className="kk-stats" aria-label="Số liệu chính">
            <StatCard
              Icon={Wallet}
              label={`Chi tiêu ${range} tháng`}
              value={data.ready ? fmtMoney(report.spendTotal) : '—'}
              title={data.ready ? fmtMoneyFull(report.spendTotal) : undefined}
              note={data.ready ? 'linh kiện, ship và chi phí khác' : 'cần chạy sql/17_purchase_orders.sql'}
            />
            <StatCard
              Icon={Coins}
              label="Trung bình mỗi tháng"
              value={data.ready ? fmtMoney(report.spendTotal / range) : '—'}
              title={data.ready ? fmtMoneyFull(report.spendTotal / range) : undefined}
              note="chi tiêu"
            />
            <StatCard Icon={TrendingUp} label="Giá trị kho hiện tại" value={fmtMoney(lastValue)} title={fmtMoneyFull(lastValue)} note="theo đơn giá đang lưu" />
            <StatCard
              Icon={Hourglass}
              tone={report.idleRows.length > 0 ? 'warn' : 'good'}
              label="Đang nằm im"
              value={fmtMoney(idleValue)}
              title={fmtMoneyFull(idleValue)}
              note={`${fmtNum(report.idleRows.length)} mã không xuất dùng trong kỳ`}
            />
          </section>

          <SpendCard report={report} ready={data.ready} isAdmin={isAdmin} range={range} />

          <section className="kk-grid-charts">
            <StockValueCard rows={report.valueRows} />
            <ProjectCard rows={report.projectRows} range={range} />
          </section>

          <section className="kk-grid-charts">
            <TopUsedCard rows={report.usedRows} range={range} />
            <IdleCard rows={report.idleRows} range={range} />
          </section>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Khung chung: biểu đồ / bảng, xuất Excel                             */
/* ------------------------------------------------------------------ */
function ReportCard({ title, summary, children, columns, rows, exportOpts, empty, emptyText, wide, tableOnly }) {
  const [view, setView] = useState('chart')
  const xlsx = useXlsxExport()
  const showTable = tableOnly || view === 'table'
  return (
    <div className={`kk-card kk-chart-card ${wide ? 'kk-report-wide' : ''}`}>
      <div className="kk-card-head">
        <div>
          <h2>{title}</h2>
          {summary && <p className="kk-card-sub">{summary}</p>}
        </div>
        <div className="kk-report-tools">
          {!tableOnly && (
            <div className="kk-toggle" role="group" aria-label="Cách xem">
              <button type="button" aria-pressed={view === 'chart'} onClick={() => setView('chart')}>
                Biểu đồ
              </button>
              <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>
                Bảng
              </button>
            </div>
          )}
          {exportOpts && (
            <button
              type="button"
              className="kk-icon-btn kk-icon-btn-boxed"
              aria-label={`Xuất Excel: ${title}`}
              title="Xuất Excel"
              disabled={empty || xlsx.busy}
              onClick={() => xlsx.run(exportOpts)}
            >
              <Download size={18} />
            </button>
          )}
        </div>
      </div>
      {empty ? (
        <p className="kk-muted-text kk-chart-empty">{emptyText}</p>
      ) : showTable ? (
        <div className="kk-table-scroll kk-report-table">
          <table className="kk-mini-table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={c.num ? 'is-num' : ''}>
                    {c.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id ?? r.key ?? r.name ?? i}>
                  {columns.map((c) => (
                    <td key={c.key} className={c.num ? 'is-num' : ''}>
                      {c.render ? c.render(r) : c.fmt ? c.fmt(r[c.key]) : c.num ? fmtNum(r[c.key]) : r[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </div>
  )
}

function Tip({ active, payload, label, fmt = fmtMoneyFull, titleOf, showTotal }) {
  if (!active || !payload || payload.length === 0) return null
  const total = payload.reduce((s, p) => s + (Number(p.value) || 0), 0)
  return (
    <div className="kk-tip">
      <div className="kk-tip-title">{titleOf ? titleOf(payload, label) : label}</div>
      {payload.map((p) => (
        <div key={p.dataKey ?? p.name} className="kk-tip-row">
          <i className="kk-tip-key" style={{ background: p.color || p.payload?.color }} />
          <strong>{fmt(p.value)}</strong>
          <span>{p.name}</span>
        </div>
      ))}
      {showTotal && payload.length > 1 && (
        <div className="kk-tip-row kk-tip-total">
          <strong>{fmt(total)}</strong>
          <span>Tổng</span>
        </div>
      )}
    </div>
  )
}

function Legend({ items }) {
  return (
    <ul className="kk-legend" aria-label="Chú thích">
      {items.map((it) => (
        <li key={it.label}>
          <i className="kk-legend-key" style={{ background: it.color }} />
          {it.label}
        </li>
      ))}
    </ul>
  )
}

const axisTick = { fontSize: 12, fill: 'var(--muted)' }
const shortMoney = (v) => (Math.abs(v) >= 1e6 ? `${fmtNum(Math.round(v / 1e5) / 10)}tr` : Math.abs(v) >= 1e3 ? `${fmtNum(Math.round(v / 1e3))}k` : fmtNum(v))

/* ------------------------------------------------------------------ */
/* 1) Chi tiêu theo tháng                                              */
/* ------------------------------------------------------------------ */
function SpendCard({ report, ready, isAdmin, range }) {
  if (!ready) {
    return (
      <div className="kk-card kk-report-wide">
        <div className="kk-card-head">
          <h2>Chi tiêu theo tháng</h2>
        </div>
        <EmptyState
          title="Chưa bật ghi chi tiêu"
          text={
            isAdmin
              ? 'Mở Supabase, vào SQL Editor, dán nội dung file sql/17_purchase_orders.sql rồi bấm Run, sau đó tải lại trang.'
              : 'Hãy nhờ admin nâng cấp database.'
          }
        />
      </div>
    )
  }
  const { spendRows, spendTotal, shopRows, kindRows, unpricedBuys } = report
  const notes = [
    `Tổng ${fmtMoneyFull(spendTotal)}`,
    unpricedBuys > 0 ? `${fmtNum(unpricedBuys)} lần mua chưa có giá nên chưa tính` : '',
  ].filter(Boolean)
  return (
    <>
      <ReportCard
        wide
        title="Chi tiêu theo tháng"
        summary={notes.join(' · ')}
        empty={spendTotal === 0}
        emptyText={`Chưa có khoản chi nào trong ${range} tháng gần đây. Chi tiêu được ghi khi bạn nhận hàng theo đơn, bấm "Đã mua", nhập kho hàng mua, hoặc ghi khoản chi khác.`}
        columns={[
          { key: 'label', title: 'Tháng' },
          { key: 'goods', title: 'Linh kiện', num: true, fmt: fmtMoneyFull },
          { key: 'ship', title: 'Phí ship', num: true, fmt: fmtMoneyFull },
          { key: 'other', title: 'Chi phí khác', num: true, fmt: fmtMoneyFull },
          { key: 'total', title: 'Tổng', num: true, fmt: fmtMoneyFull },
        ]}
        rows={spendRows}
        exportOpts={{
          filename: datedName('chi-tieu'),
          title: 'Chi tiêu theo tháng',
          subtitle: `${range} tháng gần đây`,
          sheet: 'Chi tiêu',
          rows: spendRows,
          columns: [
            { header: 'Tháng', value: (r) => r.label, width: 10 },
            { header: 'Linh kiện', value: (r) => Math.round(r.goods), type: 'money', width: 16, total: true },
            { header: 'Phí ship', value: (r) => Math.round(r.ship), type: 'money', width: 14, total: true },
            { header: 'Chi phí khác', value: (r) => Math.round(r.other), type: 'money', width: 16, total: true },
            { header: 'Tổng', value: (r) => Math.round(r.total), type: 'money', width: 16, total: true },
          ],
        }}
      >
        <Legend
          items={[
            { label: 'Linh kiện', color: C_GOODS },
            { label: 'Phí ship', color: C_SHIP },
            { label: 'Chi phí khác', color: C_OTHER },
          ]}
        />
        <div className="kk-chart" style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={spendRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
              <CartesianGrid vertical={false} stroke="var(--kk-grid)" />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--kk-axis)' }} tick={axisTick} />
              <YAxis tickLine={false} axisLine={false} width={52} tick={axisTick} tickFormatter={shortMoney} />
              <Tooltip content={<Tip showTotal />} cursor={{ fill: 'var(--kk-hover)' }} isAnimationActive={false} />
              <Bar dataKey="goods" name="Linh kiện" stackId="s" fill={C_GOODS} stroke="var(--card)" strokeWidth={2} isAnimationActive={false} />
              <Bar dataKey="ship" name="Phí ship" stackId="s" fill={C_SHIP} stroke="var(--card)" strokeWidth={2} isAnimationActive={false} />
              <Bar dataKey="other" name="Chi phí khác" stackId="s" fill={C_OTHER} stroke="var(--card)" strokeWidth={2} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ReportCard>

      <section className="kk-grid-charts">
        <ReportCard
          tableOnly
          title="Theo nơi mua"
          summary="Tiền linh kiện và phí ship theo từng nơi mua"
          empty={shopRows.length === 0}
          emptyText="Chưa có lần mua nào trong kỳ."
          columns={[
            { key: 'name', title: 'Nơi mua' },
            { key: 'count', title: 'Số đơn', num: true, render: (r) => (r.count ? fmtNum(r.count) : '—') },
            { key: 'goods', title: 'Linh kiện', num: true, fmt: fmtMoneyFull },
            { key: 'ship', title: 'Ship', num: true, fmt: fmtMoneyFull },
            { key: 'total', title: 'Tổng', num: true, fmt: fmtMoneyFull },
          ]}
          rows={shopRows}
          exportOpts={{
            filename: datedName('chi-tieu-noi-mua'),
            title: 'Chi tiêu theo nơi mua',
            subtitle: `${range} tháng gần đây`,
            sheet: 'Nơi mua',
            rows: shopRows,
            columns: [
              { header: 'Nơi mua', value: (r) => r.name, width: 28 },
              { header: 'Số đơn', value: (r) => r.count, type: 'int', width: 10, total: true },
              { header: 'Linh kiện', value: (r) => Math.round(r.goods), type: 'money', width: 16, total: true },
              { header: 'Ship', value: (r) => Math.round(r.ship), type: 'money', width: 14, total: true },
              { header: 'Tổng', value: (r) => Math.round(r.total), type: 'money', width: 16, total: true },
            ],
          }}
        />
        <ReportCard
          tableOnly
          title="Chi phí khác theo loại"
          summary={
            <>
              Ghi thêm ở trang <Link className="kk-link" to="/buy?tab=orders">Cần mua → Đơn hàng</Link>
            </>
          }
          empty={kindRows.length === 0}
          emptyText="Chưa có khoản chi khác nào trong kỳ."
          columns={[
            { key: 'name', title: 'Loại' },
            { key: 'amount', title: 'Số tiền', num: true, fmt: fmtMoneyFull },
          ]}
          rows={kindRows}
        />
      </section>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* 2) Giá trị kho cuối mỗi tháng                                       */
/* ------------------------------------------------------------------ */
function StockValueCard({ rows }) {
  return (
    <ReportCard
      title="Giá trị kho cuối mỗi tháng"
      summary="Ước tính: số tồn cuối tháng × đơn giá đang lưu"
      empty={rows.every((r) => r.value === 0)}
      emptyText="Chưa có linh kiện nào có đơn giá."
      columns={[
        { key: 'label', title: 'Tháng' },
        { key: 'qty', title: 'Số lượng (cái)', num: true },
        { key: 'value', title: 'Giá trị', num: true, fmt: fmtMoneyFull },
      ]}
      rows={rows}
      exportOpts={{
        filename: datedName('gia-tri-kho'),
        title: 'Giá trị kho cuối mỗi tháng',
        subtitle: 'Ước tính theo đơn giá đang lưu',
        sheet: 'Giá trị kho',
        rows,
        columns: [
          { header: 'Tháng', value: (r) => r.label, width: 10 },
          { header: 'Số lượng (cái)', value: (r) => r.qty, type: 'int', width: 16 },
          { header: 'Giá trị', value: (r) => Math.round(r.value), type: 'money', width: 18 },
        ],
      }}
    >
      <div className="kk-chart" style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--kk-grid)" />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--kk-axis)' }} tick={axisTick} />
            <YAxis tickLine={false} axisLine={false} width={52} tick={axisTick} tickFormatter={shortMoney} />
            <Tooltip content={<Tip />} cursor={{ stroke: 'var(--kk-axis)', strokeDasharray: '3 3' }} isAnimationActive={false} />
            <Line
              type="monotone"
              dataKey="value"
              name="Giá trị kho"
              stroke={C_GOODS}
              strokeWidth={2}
              dot={{ r: 4, fill: C_GOODS, stroke: 'var(--card)', strokeWidth: 2 }}
              activeDot={{ r: 6, stroke: 'var(--card)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ReportCard>
  )
}

/* ------------------------------------------------------------------ */
/* 3) Linh kiện dùng nhiều nhất                                        */
/* ------------------------------------------------------------------ */
function TopUsedCard({ rows, range }) {
  const { openComponent } = useShell()
  const top = rows.slice(0, 10)
  return (
    <ReportCard
      title="Linh kiện dùng nhiều nhất"
      summary={`Top 10 theo số lượng xuất dùng trong ${range} tháng (đã trừ phần trả lại)`}
      empty={top.length === 0}
      emptyText="Chưa xuất dùng linh kiện nào trong kỳ."
      columns={[
        {
          key: 'part',
          title: 'Linh kiện',
          render: (r) => (
            <button type="button" className="kk-row-link" onClick={() => openComponent(r.id)}>
              {r.part}
            </button>
          ),
        },
        { key: 'qty', title: 'Đã dùng', num: true },
        { key: 'value', title: 'Trị giá', num: true, fmt: fmtMoneyFull },
      ]}
      rows={rows}
      exportOpts={{
        filename: datedName('linh-kien-dung-nhieu'),
        title: 'Linh kiện đã dùng',
        subtitle: `${range} tháng gần đây`,
        sheet: 'Đã dùng',
        rows,
        columns: [
          { header: 'Mã linh kiện', value: (r) => r.part, width: 26 },
          { header: 'Tên', value: (r) => r.name, width: 34, wrap: true },
          { header: 'Đã dùng (cái)', value: (r) => r.qty, type: 'int', width: 14, total: true },
          { header: 'Trị giá', value: (r) => Math.round(r.value), type: 'money', width: 16, total: true },
        ],
      }}
    >
      <div className="kk-chart" style={{ height: Math.max(160, top.length * 30 + 20) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={top} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid horizontal={false} stroke="var(--kk-grid)" />
            <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={axisTick} />
            <YAxis type="category" dataKey="part" width={120} tickLine={false} axisLine={{ stroke: 'var(--kk-axis)' }} tick={axisTick} />
            <Tooltip
              content={<Tip fmt={(v) => `${fmtNum(v)} cái`} titleOf={(p) => `${p[0]?.payload?.part} · ${p[0]?.payload?.name}`} />}
              cursor={{ fill: 'var(--kk-hover)' }}
              isAnimationActive={false}
            />
            <Bar dataKey="qty" name="Đã dùng" fill={C_GOODS} radius={[0, 4, 4, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ReportCard>
  )
}

/* ------------------------------------------------------------------ */
/* 4) Linh kiện nằm im                                                 */
/* ------------------------------------------------------------------ */
function IdleCard({ rows, range }) {
  const { openComponent } = useShell()
  const total = rows.reduce((s, r) => s + r.value, 0)
  return (
    <ReportCard
      tableOnly
      title="Linh kiện nằm im"
      summary={`Còn hàng nhưng không xuất dùng trong ${range} tháng. Tổng trị giá ${fmtMoneyFull(total)}`}
      empty={rows.length === 0}
      emptyText="Món nào còn hàng cũng đã được dùng trong kỳ."
      columns={[
        {
          key: 'part',
          title: 'Linh kiện',
          render: (r) => (
            <button type="button" className="kk-row-link" title={r.name} onClick={() => openComponent(r.id)}>
              {r.part}
            </button>
          ),
        },
        { key: 'qty', title: 'Tồn', num: true },
        { key: 'value', title: 'Trị giá', num: true, render: (r) => (r.value > 0 ? fmtMoneyFull(r.value) : '—') },
        { key: 'last', title: 'Dùng lần cuối', render: (r) => (r.last ? fmtDate(r.last) : 'Chưa dùng') },
      ]}
      rows={rows.slice(0, 50)}
      exportOpts={{
        filename: datedName('linh-kien-nam-im'),
        title: 'Linh kiện nằm im',
        subtitle: `Không xuất dùng trong ${range} tháng gần đây`,
        sheet: 'Nằm im',
        rows,
        columns: [
          { header: 'Mã linh kiện', value: (r) => r.part, width: 26 },
          { header: 'Tên', value: (r) => r.name, width: 34, wrap: true },
          { header: 'Tồn (cái)', value: (r) => r.qty, type: 'int', width: 12, total: true },
          { header: 'Trị giá', value: (r) => (r.value > 0 ? Math.round(r.value) : null), type: 'money', width: 16, total: true },
          { header: 'Dùng lần cuối', value: (r) => (r.last ? fmtDate(r.last) : 'Chưa dùng'), width: 16 },
        ],
      }}
    >
      {null}
    </ReportCard>
  )
}

/* ------------------------------------------------------------------ */
/* 5) Theo dự án                                                       */
/* ------------------------------------------------------------------ */
function ProjectCard({ rows, range }) {
  const top = rows.slice(0, 10)
  return (
    <ReportCard
      title="Chi phí theo dự án"
      summary={`Linh kiện đã xuất cho dự án × đơn giá, cộng chi phí khác gắn dự án, trong ${range} tháng`}
      empty={rows.length === 0}
      emptyText="Chưa xuất linh kiện cho dự án nào trong kỳ."
      columns={[
        { key: 'label', title: 'Dự án', render: (r) => <span title={r.name}>{r.label}</span> },
        { key: 'qty', title: 'Số linh kiện', num: true },
        { key: 'value', title: 'Linh kiện', num: true, fmt: fmtMoneyFull },
        { key: 'other', title: 'Chi phí khác', num: true, fmt: fmtMoneyFull },
        { key: 'total', title: 'Tổng', num: true, fmt: fmtMoneyFull },
      ]}
      rows={rows}
      exportOpts={{
        filename: datedName('chi-phi-du-an'),
        title: 'Chi phí theo dự án',
        subtitle: `${range} tháng gần đây (không gồm tiền công)`,
        sheet: 'Dự án',
        rows,
        columns: [
          { header: 'Dự án', value: (r) => [r.label, r.name].filter(Boolean).join(' · '), width: 34, wrap: true },
          { header: 'Số linh kiện (cái)', value: (r) => r.qty, type: 'int', width: 16, total: true },
          { header: 'Linh kiện', value: (r) => Math.round(r.value), type: 'money', width: 16, total: true },
          { header: 'Chi phí khác', value: (r) => Math.round(r.other), type: 'money', width: 16, total: true },
          { header: 'Tổng', value: (r) => Math.round(r.total), type: 'money', width: 16, total: true },
        ],
      }}
    >
      <Legend
        items={[
          { label: 'Linh kiện', color: C_GOODS },
          { label: 'Chi phí khác', color: C_OTHER },
        ]}
      />
      <div className="kk-chart" style={{ height: Math.max(160, top.length * 32 + 20) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={top} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid horizontal={false} stroke="var(--kk-grid)" />
            <XAxis type="number" tickLine={false} axisLine={false} tick={axisTick} tickFormatter={shortMoney} />
            <YAxis type="category" dataKey="label" width={80} tickLine={false} axisLine={{ stroke: 'var(--kk-axis)' }} tick={axisTick} />
            <Tooltip content={<Tip showTotal titleOf={(p) => [p[0]?.payload?.label, p[0]?.payload?.name].filter(Boolean).join(' · ')} />} cursor={{ fill: 'var(--kk-hover)' }} isAnimationActive={false} />
            <Bar dataKey="value" name="Linh kiện" stackId="p" fill={C_GOODS} stroke="var(--card)" strokeWidth={2} isAnimationActive={false} />
            <Bar dataKey="other" name="Chi phí khác" stackId="p" fill={C_OTHER} stroke="var(--card)" strokeWidth={2} radius={[0, 4, 4, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ReportCard>
  )
}
