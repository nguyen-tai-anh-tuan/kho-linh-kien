import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  Coins,
  Layers,
  PackagePlus,
  SlidersHorizontal,
  ShoppingCart,
} from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useData } from '../data/DataContext'
import { useTx } from '../TxContext'
import { useShell } from '../ShellContext'
import { EmptyState, Skeleton, TraceLoader } from '../ui/common'
import { friendlyError } from '../lib/api'
import { fmtDay, fmtMoney, fmtMoneyFull, fmtNum, greeting, timeAgo } from '../lib/format'

export default function Overview() {
  const { components, categories, toneByCategory, loading, refreshing, error, reload, version } = useData()
  const { openTx } = useTx()
  const { openComponent, openForm } = useShell()

  /* ---- số liệu tổng hợp ---- */
  const stats = useMemo(() => {
    let qty = 0
    let value = 0
    let attention = 0
    let out = 0
    let hasPrice = false
    for (const c of components) {
      qty += c.total_quantity
      value += Number(c.stock_value) || 0
      if (Number(c.unit_price) > 0) hasPrice = true
      if (c.status === 'low' || c.status === 'out') attention++
      if (c.status === 'out') out++
    }
    return { types: components.length, qty, value, hasPrice, attention, out }
  }, [components])

  const toBuy = useMemo(
    () => components.filter((c) => c.shortage > 0).sort((a, b) => b.shortage - a.shortage),
    [components],
  )

  const slices = useMemo(() => {
    const byCat = new Map()
    for (const c of components) {
      if (c.total_quantity <= 0) continue
      const key = c.category_id ?? 'none'
      byCat.set(key, (byCat.get(key) ?? 0) + c.total_quantity)
    }
    const nameOf = new Map(categories.map((c) => [c.id, c.name]))
    const list = [...byCat.entries()]
      .map(([id, value]) => ({
        id,
        name: nameOf.get(id) ?? 'Chưa phân loại',
        value,
        tone: id === 'none' ? null : toneByCategory.get(id),
      }))
      .sort((a, b) => b.value - a.value)
    const head = list.filter((s) => s.id !== 'none').slice(0, 5)
    const restValue = list.filter((s) => !head.includes(s)).reduce((sum, s) => sum + s.value, 0)
    const result = head.map((s) => ({ ...s, color: `var(--series-${(s.tone ?? 0) + 1})` }))
    if (restValue > 0) result.push({ id: 'other', name: 'Khác', value: restValue, tone: null, color: 'var(--kk-other)' })
    return result
  }, [components, categories, toneByCategory])

  /* ---- dữ liệu theo ngày và hoạt động gần đây ---- */
  const [flow, setFlow] = useState(null)
  const [activity, setActivity] = useState(null)
  const [extraError, setExtraError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function run() {
      const [f, a] = await Promise.all([
        supabase.rpc('daily_flow', { days: 30 }),
        supabase.from('transactions_feed').select('*').order('created_at', { ascending: false }).limit(8),
      ])
      if (cancelled) return
      const err = f.error || a.error
      if (err) return setExtraError(friendlyError(err))
      setExtraError('')
      setFlow(f.data.map((r) => ({ day: r.day, label: fmtDay(r.day), qty_in: Number(r.qty_in), qty_out: Number(r.qty_out) })))
      setActivity(a.data)
    }
    run()
    return () => {
      cancelled = true
    }
  }, [version])

  if (loading) return <OverviewSkeleton />
  if (error) {
    return (
      <EmptyState title="Chưa tải được dữ liệu kho" text={error}>
        <button type="button" className="kk-btn kk-btn-primary" onClick={reload}>
          Thử lại
        </button>
      </EmptyState>
    )
  }
  if (components.length === 0) {
    return (
      <EmptyState title="Chưa có linh kiện nào" text="Thêm món đầu tiên của bạn nhé. Bạn cũng có thể nhập cả danh sách từ file CSV.">
        <button type="button" className="kk-btn kk-btn-primary" onClick={() => openForm(null)}>
          <PackagePlus size={18} />
          Thêm linh kiện
        </button>
      </EmptyState>
    )
  }

  const flowTotals = flow ? flow.reduce((t, r) => ({ in: t.in + r.qty_in, out: t.out + r.qty_out }), { in: 0, out: 0 }) : null

  return (
    <div className={`kk-page ${refreshing ? 'is-refreshing' : ''}`}>
      <div className="kk-page-head">
        <div>
          <h1>{greeting()} 👋</h1>
          <p>Đây là tình hình kho của bạn.</p>
        </div>
        <div className="kk-quick">
          <button type="button" className="kk-btn kk-btn-primary" onClick={() => openTx({ type: 'in' })}>
            <ArrowDownToLine size={18} />
            Nhập kho
          </button>
          <button type="button" className="kk-btn kk-btn-outline" onClick={() => openTx({ type: 'out' })}>
            <ArrowUpFromLine size={18} />
            Xuất kho
          </button>
          <button type="button" className="kk-btn kk-btn-outline" onClick={() => openForm(null)}>
            <PackagePlus size={18} />
            Thêm linh kiện
          </button>
        </div>
      </div>

      <section className="kk-stats" aria-label="Số liệu tổng quan">
        <StatCard Icon={Boxes} label="Loại linh kiện" value={fmtNum(stats.types)} note="mã đang quản lý" />
        <StatCard Icon={Layers} label="Tổng số lượng" value={fmtNum(stats.qty)} note="cái trong kho" />
        <StatCard
          Icon={Coins}
          label="Giá trị kho"
          value={stats.hasPrice ? fmtMoney(stats.value) : '—'}
          title={stats.hasPrice ? fmtMoneyFull(stats.value) : undefined}
          note={stats.hasPrice ? 'theo đơn giá đã nhập' : 'Điền đơn giá để tính'}
        />
        <StatCard
          Icon={AlertTriangle}
          tone={stats.attention > 0 ? 'warn' : 'good'}
          label="Sắp hết hàng"
          value={fmtNum(stats.attention)}
          note={stats.attention > 0 ? (stats.out > 0 ? `gồm ${fmtNum(stats.out)} món đã hết, bấm để xem` : 'bấm để xem danh sách') : 'Mọi thứ đều đủ hàng'}
          to={stats.attention > 0 ? '/components?low=1' : undefined}
        />
      </section>

      <section className="kk-grid-charts">
        <ChartCard
          title="Nhập và xuất 30 ngày qua"
          summary={flowTotals ? `Nhập ${fmtNum(flowTotals.in)} cái, xuất ${fmtNum(flowTotals.out)} cái` : null}
          loading={flow === null && !extraError}
          error={extraError}
          tableData={flow}
          tableColumns={[
            { key: 'label', title: 'Ngày' },
            { key: 'qty_in', title: 'Nhập', num: true },
            { key: 'qty_out', title: 'Xuất', num: true },
          ]}
          tableRows={flow ? flow.filter((r) => r.qty_in || r.qty_out) : null}
          emptyText="Chưa có giao dịch nào trong 30 ngày qua."
          isEmpty={flow ? flowTotals.in + flowTotals.out === 0 : false}
        >
          <FlowChart data={flow ?? []} />
        </ChartCard>

        <ChartCard
          title="Tồn kho theo loại"
          summary={`${fmtNum(stats.qty)} cái`}
          tableData={slices}
          tableColumns={[
            { key: 'name', title: 'Loại' },
            { key: 'value', title: 'Số lượng', num: true },
          ]}
          tableRows={slices}
          emptyText="Chưa có hàng trong kho."
          isEmpty={slices.length === 0}
        >
          <DonutChart slices={slices} total={stats.qty} />
        </ChartCard>
      </section>

      <section className="kk-grid-lists">
        <div className="kk-card">
          <div className="kk-card-head">
            <h2>Cần mua thêm</h2>
            {toBuy.length > 6 && (
              <Link className="kk-link" to="/components?low=1">
                Xem tất cả {fmtNum(toBuy.length)} món
              </Link>
            )}
          </div>
          {toBuy.length === 0 ? (
            <p className="kk-muted-text">Kho đang đủ hàng, chưa có món nào dưới mức tối thiểu.</p>
          ) : (
            <ul className="kk-list">
              {toBuy.slice(0, 6).map((c) => (
                <li key={c.id}>
                  <button type="button" className="kk-list-row" onClick={() => openComponent(c.id)}>
                    <span className="kk-list-ico kk-ico-warn">
                      <ShoppingCart size={16} />
                    </span>
                    <span className="kk-list-main">
                      <strong>{c.part_number}</strong>
                      <span className="kk-sub-text">
                        {c.name}. Còn {fmtNum(c.total_quantity)}, tối thiểu {fmtNum(c.min_stock)}
                      </span>
                    </span>
                    <span className="kk-shortage">Thiếu {fmtNum(c.shortage)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="kk-card">
          <div className="kk-card-head">
            <h2>Hoạt động gần đây</h2>
            {activity && activity.length > 0 && (
              <Link className="kk-link" to="/history">
                Xem toàn bộ lịch sử
              </Link>
            )}
          </div>
          {activity === null && !extraError ? (
            <div className="kk-skel-list">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} h={40} r={10} />
              ))}
            </div>
          ) : activity && activity.length > 0 ? (
            <ul className="kk-list">
              {activity.map((t) => (
                <li key={t.id}>
                  <button type="button" className="kk-list-row" onClick={() => openComponent(t.component_id)}>
                    <ActivityIcon type={t.type} />
                    <span className="kk-list-main">
                      <span>{describeTx(t)}</span>
                      <small>{timeAgo(t.created_at)}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="kk-muted-text">Chưa có giao dịch nào. Thử nhập kho món đầu tiên nhé.</p>
          )}
        </div>
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function StatCard({ Icon, label, value, note, tone = 'neutral', to, title }) {
  const inner = (
    <>
      <span className={`kk-stat-ico kk-stat-ico-${tone}`}>
        <Icon size={20} />
      </span>
      <span className="kk-stat-label">{label}</span>
      <strong className="kk-stat-value" title={title}>
        {value}
      </strong>
      <span className="kk-stat-note">{note}</span>
    </>
  )
  return to ? (
    <Link to={to} className={`kk-stat kk-stat-link kk-stat-${tone}`}>
      {inner}
    </Link>
  ) : (
    <div className={`kk-stat kk-stat-${tone}`}>{inner}</div>
  )
}

function ChartCard({ title, summary, children, loading, error, isEmpty, emptyText, tableColumns, tableRows }) {
  const [view, setView] = useState('chart')
  return (
    <div className="kk-card kk-chart-card">
      <div className="kk-card-head">
        <div>
          <h2>{title}</h2>
          {summary && <p className="kk-card-sub">{summary}</p>}
        </div>
        <div className="kk-toggle" role="group" aria-label="Cách xem">
          <button type="button" aria-pressed={view === 'chart'} onClick={() => setView('chart')}>
            Biểu đồ
          </button>
          <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>
            Bảng
          </button>
        </div>
      </div>
      {error ? (
        <p className="kk-form-error">{error}</p>
      ) : loading ? (
        <Skeleton h={240} r={14} />
      ) : isEmpty ? (
        <p className="kk-muted-text kk-chart-empty">{emptyText}</p>
      ) : view === 'chart' ? (
        children
      ) : (
        <div className="kk-table-scroll">
          <table className="kk-mini-table">
            <thead>
              <tr>
                {tableColumns.map((c) => (
                  <th key={c.key} className={c.num ? 'is-num' : ''}>
                    {c.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(tableRows ?? []).map((r, i) => (
                <tr key={r.id ?? r.day ?? i}>
                  {tableColumns.map((c) => (
                    <td key={c.key} className={c.num ? 'is-num' : ''}>
                      {c.num ? fmtNum(r[c.key]) : r[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ChartTip({ active, payload, label, titleOf }) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="kk-tip">
      <div className="kk-tip-title">{titleOf ? titleOf(payload, label) : label}</div>
      {payload.map((p) => (
        <div key={p.dataKey ?? p.name} className="kk-tip-row">
          <i className="kk-tip-key" style={{ background: p.color || p.payload?.color }} />
          <strong>{fmtNum(p.value)}</strong>
          <span>{p.name}</span>
        </div>
      ))}
    </div>
  )
}

function FlowChart({ data }) {
  return (
    <>
      <ul className="kk-legend" aria-label="Chú thích">
        <li>
          <i className="kk-legend-key" style={{ background: 'var(--series-1)' }} />
          Nhập
        </li>
        <li>
          <i className="kk-legend-key" style={{ background: 'var(--series-2)' }} />
          Xuất
        </li>
      </ul>
      <div className="kk-chart" style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }} barGap={2} barCategoryGap="24%">
            <CartesianGrid vertical={false} stroke="var(--kk-grid)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: 'var(--kk-axis)' }}
              interval={4}
              tick={{ fontSize: 12, fill: 'var(--muted)' }}
            />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={44} tick={{ fontSize: 12, fill: 'var(--muted)' }} />
            <Tooltip content={<ChartTip />} cursor={{ fill: 'var(--kk-hover)' }} isAnimationActive={false} />
            <Bar dataKey="qty_in" name="Nhập" fill="var(--series-1)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="qty_out" name="Xuất" fill="var(--series-2)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}

function DonutChart({ slices, total }) {
  return (
    <div className="kk-donut">
      <div className="kk-donut-chart">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="96%"
              paddingAngle={2}
              stroke="var(--card)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {slices.map((s) => (
                <Cell key={s.id} fill={s.color} />
              ))}
            </Pie>
            <Tooltip content={<ChartTip titleOf={(p) => p[0]?.name} />} isAnimationActive={false} />
          </PieChart>
        </ResponsiveContainer>
        <div className="kk-donut-center" aria-hidden="true">
          <strong>{fmtNum(total)}</strong>
          <span>cái</span>
        </div>
      </div>
      <ul className="kk-donut-legend">
        {slices.map((s) => (
          <li key={s.id}>
            <i className="kk-legend-key" style={{ background: s.color }} />
            <span className="kk-donut-name">{s.name}</span>
            <strong>{fmtNum(s.value)}</strong>
            <small>{Math.round((s.value / total) * 100)}%</small>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ActivityIcon({ type }) {
  const map = {
    in: { Icon: ArrowDownToLine, cls: 'kk-ico-in' },
    out: { Icon: ArrowUpFromLine, cls: 'kk-ico-out' },
    adjust: { Icon: SlidersHorizontal, cls: 'kk-ico-adj' },
  }
  const { Icon, cls } = map[type] ?? map.adjust
  return (
    <span className={`kk-list-ico ${cls}`}>
      <Icon size={16} />
    </span>
  )
}

function describeTx(t) {
  const name = t.component_name
  const where = t.location_path ? ` ${t.type === 'out' ? 'từ' : 'tại'} ${t.location_path}` : ''
  if (t.type === 'in') return `Nhập ${fmtNum(t.quantity)} × ${name} vào ${t.location_path ?? 'kho'}`
  if (t.type === 'out') {
    const proj = t.project_name ? ` cho dự án ${t.project_name}` : ''
    return `Xuất ${fmtNum(t.quantity)} × ${name}${where}${proj}`
  }
  const before = t.delta === null || t.delta === undefined ? null : t.quantity - t.delta
  return before === null
    ? `Điều chỉnh tồn ${name}${where}: còn ${fmtNum(t.quantity)}`
    : `Điều chỉnh tồn ${name}${where}: ${fmtNum(before)} → ${fmtNum(t.quantity)}`
}

function OverviewSkeleton() {
  return (
    <div className="kk-page" aria-busy="true">
      <TraceLoader label="Đang tải kho của bạn" />
      <div className="kk-page-head">
        <div>
          <Skeleton w={220} h={30} />
          <Skeleton w={180} h={16} style={{ marginTop: 10 }} />
        </div>
      </div>
      <div className="kk-stats">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} h={132} r={20} />
        ))}
      </div>
      <div className="kk-grid-charts">
        <Skeleton h={330} r={20} />
        <Skeleton h={330} r={20} />
      </div>
    </div>
  )
}
