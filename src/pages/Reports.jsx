import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ClipboardCheck, Coins, Hourglass, PackageMinus, Search, TrendingDown, TrendingUp, Wallet, Warehouse } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useData } from '../data/DataContext'
import { EmptyState, Skeleton } from '../ui/common'
import { StatCard } from '../ui/stats'
import { CategoryFilter } from '../ui/CategoryMenu'
import { fetchAll, friendlyError } from '../lib/api'
import { datedName } from '../lib/xlsx'
import { fmtDate, fmtDateTime, fmtMoney, fmtMoneyFull, fmtNum, fmtPrice, normalize } from '../lib/format'
import { subtreeIds } from '../lib/tree'
import { probeOrdersReady } from '../lib/orders'
import {
  adjustments,
  compareText,
  idleComponents,
  makeRange,
  monthLabel,
  priceHistory,
  spendByKind,
  spendByMonth,
  spendByShop,
  spendEntries,
  stockMovement,
  stockValueByMonth,
  sumAmount,
  usage,
} from '../lib/reportData'
import {
  C_GOODS,
  C_OTHER,
  C_SHIP,
  Legend,
  PriceModal,
  ProjectUsageModal,
  RankList,
  ReportCard,
  StockCardModal,
  Tip,
  axisTick,
  shortMoney,
  signed,
  signedMoney,
} from './ReportParts'

const RANGE_KEY = 'kk-report-range'
const PRESETS = [
  { key: '3', label: '3 tháng' },
  { key: '6', label: '6 tháng' },
  { key: '12', label: '12 tháng' },
  { key: 'custom', label: 'Tùy chọn' },
]
const TABS = [
  { key: 'overview', label: 'Tổng quan' },
  { key: 'stock', label: 'Nhập – Xuất – Tồn' },
  { key: 'spend', label: 'Chi tiêu' },
  { key: 'adjust', label: 'Kiểm kê' },
  { key: 'price', label: 'Giá mua' },
]
const KIND_LABEL = { goods: 'Linh kiện', ship: 'Phí ship', other: 'Chi phí khác' }
const SQL17_TEXT = 'Mở Supabase, vào SQL Editor, dán nội dung file sql/17_purchase_orders.sql rồi bấm Run, sau đó tải lại trang.'

function readRange() {
  try {
    const v = JSON.parse(localStorage.getItem(RANGE_KEY) ?? 'null')
    if (v && PRESETS.some((p) => p.key === v.preset)) return v
  } catch {
    /* bỏ qua */
  }
  return { preset: '6', from: '', to: '' }
}

export default function ReportsPage() {
  const { allComponents, componentsById, projectsById, version } = useData()
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'overview'
  const [rangeOpt, setRangeOpt] = useState(readRange)
  const [data, setData] = useState(null) // { tx, orders, expenses, ready }
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [modal, setModal] = useState(null) // { kind: 'card' | 'project' | 'price', ... }

  function changeRange(next) {
    const v = { ...rangeOpt, ...next }
    if (v.preset === 'custom' && (!v.from || !v.to)) {
      // Lần đầu chọn "Tùy chọn": điền sẵn từ đầu tháng này tới hôm nay
      const now = new Date()
      const p = (n) => String(n).padStart(2, '0')
      v.from ||= `${now.getFullYear()}-${p(now.getMonth() + 1)}-01`
      v.to ||= `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
    }
    setRangeOpt(v)
    try {
      localStorage.setItem(RANGE_KEY, JSON.stringify(v))
    } catch {
      /* trình duyệt chặn lưu thì thôi */
    }
  }
  function goTab(key, extra = {}) {
    const next = new URLSearchParams({ tab: key, ...extra })
    if (key === 'overview') next.delete('tab')
    setParams(next, { replace: true })
  }

  useEffect(() => {
    let off = false
    async function run() {
      try {
        const ready = await probeOrdersReady()
        const cols = `id,created_at,type,quantity,delta,component_id,location_id,project_id,note${ready ? ',is_purchase,unit_cost,order_id' : ''}`
        const [tx, orders, expenses] = await Promise.all([
          fetchAll(() => supabase.from('transactions').select(cols).order('created_at').order('id')),
          ready ? fetchAll(() => supabase.from('purchase_orders').select('id,code_no,shop,ordered_on,shipping_fee,status').order('code_no')) : [],
          ready ? fetchAll(() => supabase.from('other_expenses').select('id,spent_on,title,kind,amount,project_id,note').order('spent_on')) : [],
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

  const range = useMemo(() => makeRange(rangeOpt.preset, rangeOpt.from, rangeOpt.to), [rangeOpt])

  // Số liệu dùng chung cho nhiều thẻ (tính một lần mỗi khi đổi kỳ hoặc dữ liệu)
  const core = useMemo(() => {
    if (!data) return null
    const spend = spendEntries(data, componentsById, range.startMs, range.endMs)
    const prevSpend = spendEntries(data, componentsById, range.prevStartMs, range.prevEndMs)
    const use = usage(data.tx, componentsById, projectsById, data.expenses, range.startMs, range.endMs)
    const prevUse = usage(data.tx, componentsById, projectsById, data.expenses, range.prevStartMs, range.prevEndMs)
    const adj = adjustments(data.tx, componentsById, range.startMs, range.endMs)
    const prevAdj = adjustments(data.tx, componentsById, range.prevStartMs, range.prevEndMs)
    const movement = stockMovement(data.tx, allComponents, range.startMs, range.endMs)
    const openValue = movement.reduce((s, r) => s + r.open * r.price, 0)
    const closeValue = movement.reduce((s, r) => s + r.value, 0)
    return { spend, prevSpend, use, prevUse, adj, prevAdj, movement, openValue, closeValue }
  }, [data, range, allComponents, componentsById, projectsById])

  if (error) {
    return (
      <EmptyState title="Chưa tải được dữ liệu báo cáo" text={error}>
        <button type="button" className="kk-btn kk-btn-primary" onClick={() => setAttempt((n) => n + 1)}>
          Thử lại
        </button>
      </EmptyState>
    )
  }

  const openCard = (componentId) => setModal({ kind: 'card', componentId })

  return (
    <div className="kk-page">
      <div className="kk-page-head">
        <div>
          <h1>Báo cáo</h1>
          <p>Kỳ báo cáo: {range.text}. Các thẻ số liệu so sánh với kỳ liền trước có cùng độ dài.</p>
        </div>
      </div>

      <div className="kk-card kk-toolbar kk-report-bar">
        <div className="kk-toggle" role="group" aria-label="Khoảng thời gian">
          {PRESETS.map((p) => (
            <button key={p.key} type="button" aria-pressed={rangeOpt.preset === p.key} onClick={() => changeRange({ preset: p.key })}>
              {p.label}
            </button>
          ))}
        </div>
        {rangeOpt.preset === 'custom' && (
          <div className="kk-report-dates">
            <label>
              Từ ngày
              <input type="date" value={rangeOpt.from} max={rangeOpt.to || undefined} onChange={(e) => changeRange({ from: e.target.value })} />
            </label>
            <label>
              đến ngày
              <input type="date" value={rangeOpt.to} min={rangeOpt.from || undefined} onChange={(e) => changeRange({ to: e.target.value })} />
            </label>
          </div>
        )}
      </div>

      <div className="kk-pills kk-report-tabs" role="tablist" aria-label="Loại báo cáo">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`kk-pill ${tab === t.key ? 'is-on' : ''}`}
            onClick={() => goTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!core ? (
        <>
          <div className="kk-stats">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} h={132} r={20} />
            ))}
          </div>
          <Skeleton h={330} r={20} />
        </>
      ) : tab === 'stock' ? (
        <StockTab rows={core.movement} range={range} openValue={core.openValue} closeValue={core.closeValue} onRow={openCard} />
      ) : tab === 'spend' ? (
        <SpendTab
          ready={data.ready}
          entries={core.spend}
          prevTotal={sumAmount(core.prevSpend)}
          range={range}
          month={params.get('m') ?? ''}
          setMonth={(m) => goTab('spend', m ? { m } : {})}
          onPart={openCard}
        />
      ) : tab === 'adjust' ? (
        <AdjustTab adj={core.adj} prev={core.prevAdj} range={range} onPart={openCard} />
      ) : tab === 'price' ? (
        <PriceTab ready={data.ready} data={data} onRow={(row) => setModal({ kind: 'price', row })} />
      ) : (
        <OverviewTab
          data={data}
          core={core}
          range={range}
          goTab={goTab}
          onPart={openCard}
          onProject={(project) => setModal({ kind: 'project', project })}
        />
      )}

      {modal?.kind === 'card' && <StockCardModal componentId={modal.componentId} tx={data.tx} range={range} onClose={() => setModal(null)} />}
      {modal?.kind === 'project' && (
        <ProjectUsageModal project={modal.project} range={range} onPart={(id) => setModal({ kind: 'card', componentId: id })} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'price' && <PriceModal row={modal.row} onClose={() => setModal(null)} />}
    </div>
  )
}

/* ================================================================== */
/* Thẻ Tổng quan                                                      */
/* ================================================================== */
function OverviewTab({ data, core, range, goTab, onPart, onProject }) {
  const { allComponents } = useData()
  const { spend, prevSpend, use, prevUse, adj, prevAdj, openValue, closeValue } = core
  const spendTotal = sumAmount(spend)
  const idle = useMemo(() => idleComponents(data.tx, allComponents, new Set(use.used.map((r) => r.id)), range.startMs), [data.tx, allComponents, use, range])
  const idleValue = idle.reduce((s, r) => s + r.value, 0)
  const valueRows = useMemo(() => stockValueByMonth(data.tx, allComponents, range.months), [data.tx, allComponents, range])

  return (
    <>
      <section className="kk-stats" aria-label="Số liệu chính">
        <StatCard
          Icon={Wallet}
          label="Chi tiêu"
          value={data.ready ? fmtMoney(spendTotal) : '—'}
          title={data.ready ? fmtMoneyFull(spendTotal) : undefined}
          note={data.ready ? compareText(spendTotal, sumAmount(prevSpend)) || 'linh kiện, ship và chi phí khác' : 'cần chạy sql/17_purchase_orders.sql'}
          onClick={data.ready ? () => goTab('spend') : undefined}
        />
        <StatCard
          Icon={PackageMinus}
          label="Linh kiện đã dùng"
          value={fmtMoney(use.usedValue)}
          title={fmtMoneyFull(use.usedValue)}
          note={[`${fmtNum(use.usedQty)} cái`, compareText(use.usedValue, prevUse.usedValue)].filter(Boolean).join(' · ')}
          onClick={() => goTab('stock')}
        />
        <StatCard
          Icon={closeValue >= openValue ? TrendingUp : TrendingDown}
          label="Giá trị kho cuối kỳ"
          value={fmtMoney(closeValue)}
          title={fmtMoneyFull(closeValue)}
          note={`${signedMoney(closeValue - openValue)} so với đầu kỳ`}
          onClick={() => goTab('stock')}
        />
        <StatCard
          Icon={ClipboardCheck}
          tone={adj.loss < 0 ? 'warn' : 'neutral'}
          label="Lệch khi kiểm kê"
          value={adj.rows.length ? signedMoney(adj.net) : '—'}
          note={adj.rows.length ? [`${fmtNum(adj.rows.length)} lần điều chỉnh`, compareText(Math.abs(adj.net), Math.abs(prevAdj.net))].filter(Boolean).join(' · ') : 'Không điều chỉnh lần nào'}
          onClick={() => goTab('adjust')}
        />
      </section>

      {data.ready ? (
        <SpendChartCard entries={spend} range={range} onMonth={(m) => goTab('spend', { m })} hint="Bấm vào một cột để xem từng khoản chi của tháng đó." />
      ) : (
        <div className="kk-card kk-report-card">
          <EmptyState title="Chưa bật ghi chi tiêu" text={SQL17_TEXT} />
        </div>
      )}

      <section className="kk-grid-charts">
        <ReportCard
          title="Giá trị kho cuối mỗi tháng"
          summary="Ước tính: số tồn cuối tháng × đơn giá đang lưu"
          empty={valueRows.every((r) => r.value === 0)}
          emptyText="Chưa có linh kiện nào có đơn giá."
          table={{
            rows: valueRows,
            columns: [
              { key: 'label', title: 'Tháng' },
              { key: 'qty', title: 'Số lượng (cái)', num: true },
              { key: 'value', title: 'Giá trị', num: true, fmt: fmtMoneyFull },
            ],
          }}
          exportOpts={{
            filename: datedName('gia-tri-kho'),
            title: 'Giá trị kho cuối mỗi tháng',
            subtitle: `${range.text} · ước tính theo đơn giá đang lưu`,
            sheet: 'Giá trị kho',
            rows: valueRows,
            columns: [
              { header: 'Tháng', value: (r) => r.label, width: 10 },
              { header: 'Số lượng (cái)', value: (r) => r.qty, type: 'int', width: 16 },
              { header: 'Giá trị', value: (r) => Math.round(r.value), type: 'money', width: 18 },
            ],
          }}
        >
          <div className="kk-chart" style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={valueRows} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
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

        <ReportCard
          title="Chi phí theo dự án"
          summary="Linh kiện đã xuất cho dự án × đơn giá, cộng chi phí khác gắn dự án. Bấm vào dự án để xem chi tiết."
          empty={use.projects.length === 0}
          emptyText="Chưa xuất linh kiện cho dự án nào trong kỳ."
          table={{
            rows: use.projects,
            onRow: onProject,
            columns: [
              { key: 'label', title: 'Dự án', render: (r) => <span title={r.name}>{r.label}</span> },
              { key: 'qty', title: 'Số linh kiện', num: true },
              { key: 'value', title: 'Linh kiện', num: true, fmt: fmtMoneyFull },
              { key: 'other', title: 'Chi phí khác', num: true, fmt: fmtMoneyFull },
              { key: 'total', title: 'Tổng', num: true, fmt: fmtMoneyFull },
            ],
          }}
          exportOpts={{
            filename: datedName('chi-phi-du-an'),
            title: 'Chi phí theo dự án',
            subtitle: `${range.text} · không gồm tiền công`,
            sheet: 'Dự án',
            rows: use.projects,
            columns: [
              { header: 'Dự án', value: (r) => [r.label, r.name].filter((x, i, a) => x && a.indexOf(x) === i).join(' · '), width: 34, wrap: true },
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
          <RankList
            rows={use.projects.slice(0, 10)}
            segments={[
              { key: 'value', color: C_GOODS },
              { key: 'other', color: C_OTHER },
            ]}
            label={(r) => (r.name && r.name !== r.label ? `${r.label} · ${r.name}` : r.label)}
            valueText={(r) => <strong>{fmtMoneyFull(r.total)}</strong>}
            title={(r) => `Linh kiện ${fmtMoneyFull(r.value)}, chi phí khác ${fmtMoneyFull(r.other)}. Bấm để xem chi tiết.`}
            onClick={onProject}
          />
        </ReportCard>
      </section>

      <section className="kk-grid-charts">
        <ReportCard
          title="Linh kiện dùng nhiều nhất"
          summary="Top 10 theo số lượng xuất dùng (đã trừ phần trả lại). Bấm để xem thẻ kho."
          empty={use.used.length === 0}
          emptyText="Chưa xuất dùng linh kiện nào trong kỳ."
          table={{
            rows: use.used,
            onRow: (r) => onPart(r.id),
            columns: [
              { key: 'part', title: 'Linh kiện', render: (r) => <span title={r.name}>{r.part}</span> },
              { key: 'qty', title: 'Đã dùng', num: true },
              { key: 'value', title: 'Trị giá', num: true, fmt: fmtMoneyFull },
            ],
          }}
          exportOpts={{
            filename: datedName('linh-kien-da-dung'),
            title: 'Linh kiện đã dùng',
            subtitle: range.text,
            sheet: 'Đã dùng',
            rows: use.used,
            columns: [
              { header: 'Mã linh kiện', value: (r) => r.part, width: 30, wrap: true },
              { header: 'Tên', value: (r) => r.name, width: 34, wrap: true },
              { header: 'Đã dùng (cái)', value: (r) => r.qty, type: 'int', width: 14, total: true },
              { header: 'Trị giá', value: (r) => Math.round(r.value), type: 'money', width: 16, total: true },
            ],
          }}
        >
          <RankList
            rows={use.used.slice(0, 10)}
            segments={[{ key: 'qty', color: C_GOODS }]}
            label={(r) => r.part}
            valueText={(r) => (
              <>
                <strong>{fmtNum(r.qty)}</strong> cái
              </>
            )}
            title={(r) => `${r.part}${r.name && r.name !== r.part ? ` · ${r.name}` : ''}\nĐã dùng ${fmtNum(r.qty)} cái${r.value > 0 ? `, trị giá ${fmtMoneyFull(r.value)}` : ''}`}
            onClick={(r) => onPart(r.id)}
          />
        </ReportCard>

        <ReportCard
          title="Linh kiện nằm im"
          summary={`Còn hàng nhưng không xuất dùng trong kỳ · trị giá ${fmtMoneyFull(idleValue)}`}
          empty={idle.length === 0}
          emptyText="Món nào còn hàng cũng đã được dùng trong kỳ."
          table={{
            rows: idle.slice(0, 100),
            onRow: (r) => onPart(r.id),
            columns: [
              { key: 'part', title: 'Linh kiện', render: (r) => <span title={r.name}>{r.part}</span>, className: 'kk-cell-clip' },
              { key: 'qty', title: 'Tồn', num: true },
              { key: 'value', title: 'Trị giá', num: true, render: (r) => (r.value > 0 ? fmtMoneyFull(r.value) : '—') },
              { key: 'last', title: 'Dùng lần cuối', render: (r) => (r.last ? fmtDate(r.last) : 'Chưa dùng') },
            ],
          }}
          exportOpts={{
            filename: datedName('linh-kien-nam-im'),
            title: 'Linh kiện nằm im',
            subtitle: `Không xuất dùng trong kỳ ${range.text}`,
            sheet: 'Nằm im',
            rows: idle,
            columns: [
              { header: 'Mã linh kiện', value: (r) => r.part, width: 30, wrap: true },
              { header: 'Tên', value: (r) => r.name, width: 34, wrap: true },
              { header: 'Tồn (cái)', value: (r) => r.qty, type: 'int', width: 12, total: true },
              { header: 'Trị giá', value: (r) => (r.value > 0 ? Math.round(r.value) : null), type: 'money', width: 16, total: true },
              { header: 'Dùng lần cuối', value: (r) => (r.last ? fmtDate(r.last) : 'Chưa dùng'), width: 16 },
            ],
          }}
        />
      </section>
      <p className="kk-muted-text kk-report-foot">
        <Hourglass size={14} aria-hidden="true" /> Trị giá linh kiện đã dùng, nằm im và giá trị kho đều tính theo đơn giá đang lưu trong kho. Chi tiêu tính theo giá mua thực tế.
      </p>
    </>
  )
}

/** Biểu đồ chi tiêu theo tháng (cột chồng). onMonth = bấm vào một cột. */
function SpendChartCard({ entries, range, onMonth, activeMonth, hint }) {
  const rows = useMemo(() => spendByMonth(entries, range.months), [entries, range])
  const total = rows.reduce((s, r) => s + r.total, 0)
  const unpriced = entries.filter((e) => e.amount === null).length
  const click = (d) => {
    const key = d?.payload?.key ?? d?.key
    if (key && onMonth) onMonth(key)
  }
  return (
    <ReportCard
      className="kk-report-wide"
      title="Chi tiêu theo tháng"
      summary={[`Tổng ${fmtMoneyFull(total)}`, unpriced > 0 ? `${fmtNum(unpriced)} lần mua chưa có giá nên chưa tính` : '', hint].filter(Boolean).join(' · ')}
      empty={total === 0}
      emptyText="Chưa có khoản chi nào trong kỳ. Chi tiêu được ghi khi bạn nhận hàng theo đơn, bấm “Đã mua”, nhập kho hàng mua, hoặc ghi khoản chi khác."
      table={{
        rows,
        onRow: onMonth ? (r) => onMonth(r.key) : undefined,
        foot: {
          goods: rows.reduce((s, r) => s + r.goods, 0),
          ship: rows.reduce((s, r) => s + r.ship, 0),
          other: rows.reduce((s, r) => s + r.other, 0),
          total,
        },
        columns: [
          { key: 'label', title: 'Tháng' },
          { key: 'goods', title: 'Linh kiện', num: true, fmt: fmtMoneyFull },
          { key: 'ship', title: 'Phí ship', num: true, fmt: fmtMoneyFull },
          { key: 'other', title: 'Chi phí khác', num: true, fmt: fmtMoneyFull },
          { key: 'total', title: 'Tổng', num: true, fmt: fmtMoneyFull },
        ],
      }}
      exportOpts={{
        filename: datedName('chi-tieu-theo-thang'),
        title: 'Chi tiêu theo tháng',
        subtitle: range.text,
        sheet: 'Chi tiêu',
        rows,
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
          <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%" style={onMonth ? { cursor: 'pointer' } : undefined}>
            <CartesianGrid vertical={false} stroke="var(--kk-grid)" />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--kk-axis)' }} tick={axisTick} />
            <YAxis tickLine={false} axisLine={false} width={52} tick={axisTick} tickFormatter={shortMoney} />
            <Tooltip content={<Tip showTotal hint={onMonth ? 'Bấm để xem từng khoản' : undefined} />} cursor={{ fill: 'var(--kk-hover)' }} isAnimationActive={false} />
            {[
              { key: 'goods', name: 'Linh kiện', color: C_GOODS },
              { key: 'ship', name: 'Phí ship', color: C_SHIP },
              { key: 'other', name: 'Chi phí khác', color: C_OTHER, top: true },
            ].map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.name}
                stackId="s"
                fill={s.color}
                stroke="var(--card)"
                strokeWidth={2}
                radius={s.top ? [4, 4, 0, 0] : undefined}
                fillOpacity={1}
                isAnimationActive={false}
                onClick={click}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {activeMonth && <p className="kk-muted-text">Đang xem chi tiết {monthLabel(activeMonth)} ở bảng bên dưới.</p>}
    </ReportCard>
  )
}

/* ================================================================== */
/* Thẻ Nhập – Xuất – Tồn                                               */
/* ================================================================== */
function StockTab({ rows, range, openValue, closeValue, onRow }) {
  const { categoriesById, categoryChildren } = useData()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [changedOnly, setChangedOnly] = useState(true)

  const list = useMemo(() => {
    const terms = normalize(q).split(/\s+/).filter(Boolean)
    const catIds = cat && cat !== 'none' ? new Set(subtreeIds(categoryChildren, cat)) : null
    return rows
      .filter((r) => (changedOnly ? r.count > 0 : r.count > 0 || r.close > 0 || !r.archived))
      .filter((r) => (cat === 'none' ? !r.categoryId : !catIds || catIds.has(r.categoryId)))
      .filter((r) => !terms.length || terms.every((t) => normalize(`${r.part} ${r.name}`).includes(t)))
      .sort((a, b) => b.count - a.count || a.part.localeCompare(b.part, 'vi', { numeric: true }))
  }, [rows, q, cat, changedOnly, categoryChildren])

  const sum = (key) => list.reduce((s, r) => s + r[key], 0)
  const foot = { open: sum('open'), buy: sum('buy'), inOther: sum('inOther'), out: sum('out'), adj: sum('adj'), close: sum('close'), value: sum('value') }
  const totalBuy = rows.reduce((s, r) => s + r.buy, 0)
  const totalOut = rows.reduce((s, r) => s + r.out, 0)

  return (
    <>
      <section className="kk-stats" aria-label="Tóm tắt nhập xuất tồn">
        <StatCard Icon={Warehouse} label="Giá trị đầu kỳ" value={fmtMoney(openValue)} title={fmtMoneyFull(openValue)} note="theo đơn giá đang lưu" />
        <StatCard Icon={TrendingUp} label="Đã nhập mua" value={`${fmtNum(totalBuy)} cái`} note={`${fmtNum(rows.filter((r) => r.buy > 0).length)} mã linh kiện`} />
        <StatCard Icon={PackageMinus} label="Đã xuất" value={`${fmtNum(totalOut)} cái`} note={`${fmtNum(rows.filter((r) => r.out > 0).length)} mã linh kiện`} />
        <StatCard Icon={Coins} label="Giá trị cuối kỳ" value={fmtMoney(closeValue)} title={fmtMoneyFull(closeValue)} note={`${signedMoney(closeValue - openValue)} so với đầu kỳ`} />
      </section>

      <ReportCard
        title="Nhập – Xuất – Tồn theo linh kiện"
        summary="Đầu kỳ + nhập − xuất ± điều chỉnh = cuối kỳ. Bấm vào một dòng để xem thẻ kho (từng lần thay đổi)."
        toolbar={
          <div className="kk-report-filters">
            <div className="kk-search">
              <Search size={18} aria-hidden="true" />
              <input type="search" value={q} placeholder="Tìm mã, tên linh kiện…" aria-label="Tìm linh kiện" onChange={(e) => setQ(e.target.value)} />
            </div>
            <CategoryFilter value={cat} onChange={setCat} />
            <button type="button" className={`kk-pill ${changedOnly ? 'is-on' : ''}`} aria-pressed={changedOnly} onClick={() => setChangedOnly((v) => !v)}>
              Chỉ món có thay đổi
            </button>
          </div>
        }
        empty={list.length === 0}
        emptyText={changedOnly ? 'Không có linh kiện nào thay đổi trong kỳ (theo bộ lọc đang chọn).' : 'Không có linh kiện nào khớp bộ lọc.'}
        table={{
          rows: list,
          onRow: (r) => onRow(r.id),
          rowTitle: () => 'Bấm để xem thẻ kho',
          foot,
          maxHeight: 560,
          columns: [
            { key: 'part', title: 'Linh kiện', className: 'kk-cell-clip', render: (r) => <span title={`${r.part}\n${r.name}\n${categoriesById.get(r.categoryId)?.path ?? ''}`}>{r.part}</span> },
            { key: 'open', title: 'Đầu kỳ', num: true },
            { key: 'buy', title: 'Nhập mua', num: true, render: (r) => (r.buy ? <span className="kk-up">+{fmtNum(r.buy)}</span> : '—') },
            { key: 'inOther', title: 'Nhập khác', num: true, render: (r) => (r.inOther ? <span className="kk-up">+{fmtNum(r.inOther)}</span> : '—') },
            { key: 'out', title: 'Xuất', num: true, render: (r) => (r.out ? <span className="kk-down">−{fmtNum(r.out)}</span> : '—') },
            { key: 'adj', title: 'Điều chỉnh', num: true, fmt: signed, render: (r) => (r.adj ? <span className={r.adj > 0 ? 'kk-up' : 'kk-down'}>{signed(r.adj)}</span> : '—') },
            { key: 'close', title: 'Cuối kỳ', num: true, render: (r) => <strong>{fmtNum(r.close)}</strong> },
            { key: 'value', title: 'Giá trị cuối kỳ', num: true, render: (r) => (r.price > 0 ? fmtMoneyFull(r.value) : '—'), fmt: fmtMoneyFull },
          ],
        }}
        exportOpts={{
          filename: datedName('nhap-xuat-ton'),
          title: 'Báo cáo nhập – xuất – tồn',
          subtitle: range.text,
          sheet: 'Nhập xuất tồn',
          rows: list,
          columns: [
            { header: 'Mã linh kiện', value: (r) => r.part, width: 30, wrap: true },
            { header: 'Tên', value: (r) => r.name, width: 32, wrap: true },
            { header: 'Danh mục', value: (r) => categoriesById.get(r.categoryId)?.path ?? '', width: 24, wrap: true },
            { header: 'Tồn đầu kỳ', value: (r) => r.open, type: 'int', width: 12, total: true },
            { header: 'Nhập mua', value: (r) => r.buy, type: 'int', width: 11, total: true },
            { header: 'Nhập khác', value: (r) => r.inOther, type: 'int', width: 11, total: true },
            { header: 'Xuất', value: (r) => r.out, type: 'int', width: 10, total: true },
            { header: 'Điều chỉnh', value: (r) => r.adj, type: 'int', width: 11, total: true },
            { header: 'Tồn cuối kỳ', value: (r) => r.close, type: 'int', width: 12, total: true },
            { header: 'Đơn giá', value: (r) => (r.price > 0 ? r.price : null), type: 'money', width: 12 },
            { header: 'Giá trị cuối kỳ', value: (r) => (r.price > 0 ? Math.round(r.value) : null), type: 'money', width: 16, total: true },
          ],
        }}
      />
      <p className="kk-muted-text kk-report-foot">
        “Nhập khác” gồm tồn ban đầu, trả lại kho từ BOM và hoàn tác. Số lượng tính trên mọi vị trí cộng lại.
      </p>
    </>
  )
}

/* ================================================================== */
/* Thẻ Chi tiêu                                                        */
/* ================================================================== */
function SpendTab({ ready, entries, prevTotal, range, month, setMonth, onPart }) {
  const { projectsById } = useData()
  if (!ready) {
    return (
      <div className="kk-card kk-report-card">
        <EmptyState title="Chưa bật ghi chi tiêu" text={SQL17_TEXT} />
      </div>
    )
  }
  const total = sumAmount(entries)
  const shown = month ? entries.filter((e) => e.month === month) : entries
  const shownTotal = sumAmount(shown)
  const shops = spendByShop(shown)
  const kinds = spendByKind(shown)
  const byKind = (k) => sumAmount(shown.filter((e) => e.kind === k))
  const monthsWithSpend = range.months.filter((m) => entries.some((e) => e.month === m.key))
  const scope = month ? monthLabel(month) : 'cả kỳ'

  return (
    <>
      <section className="kk-stats" aria-label="Tóm tắt chi tiêu">
        <StatCard Icon={Wallet} label={`Tổng chi ${scope}`} value={fmtMoney(shownTotal)} title={fmtMoneyFull(shownTotal)} note={month ? `trong tổng ${fmtMoneyFull(total)} của kỳ` : compareText(total, prevTotal) || 'so với kỳ trước'} />
        <StatCard Icon={PackageMinus} label="Linh kiện" value={fmtMoney(byKind('goods'))} title={fmtMoneyFull(byKind('goods'))} note="theo giá mua thực tế" />
        <StatCard Icon={TrendingUp} label="Phí ship" value={fmtMoney(byKind('ship'))} title={fmtMoneyFull(byKind('ship'))} note={`${fmtNum(shown.filter((e) => e.kind === 'ship').length)} đơn có ship`} />
        <StatCard Icon={Coins} label="Chi phí khác" value={fmtMoney(byKind('other'))} title={fmtMoneyFull(byKind('other'))} note={`${fmtNum(shown.filter((e) => e.kind === 'other').length)} khoản`} />
      </section>

      <SpendChartCard entries={entries} range={range} onMonth={(m) => setMonth(m === month ? '' : m)} activeMonth={month} hint="Bấm vào một cột để lọc theo tháng." />

      <section className="kk-grid-charts kk-grid-even">
        <ReportCard
          title="Theo nơi mua"
          summary={`Tiền linh kiện và phí ship · ${scope}`}
          empty={shops.length === 0}
          emptyText="Chưa mua gì trong khoảng này."
          table={{
            rows: shops,
            rowKey: (r) => r.name,
            foot: { count: shops.reduce((s, r) => s + r.count, 0), goods: shops.reduce((s, r) => s + r.goods, 0), ship: shops.reduce((s, r) => s + r.ship, 0), total: shops.reduce((s, r) => s + r.total, 0) },
            columns: [
              { key: 'name', title: 'Nơi mua', className: 'kk-cell-clip' },
              { key: 'count', title: 'Số đơn', num: true, render: (r) => (r.count ? fmtNum(r.count) : '—') },
              { key: 'goods', title: 'Linh kiện', num: true, fmt: fmtMoneyFull },
              { key: 'ship', title: 'Ship', num: true, fmt: fmtMoneyFull },
              { key: 'total', title: 'Tổng', num: true, fmt: fmtMoneyFull },
            ],
          }}
          exportOpts={{
            filename: datedName('chi-tieu-noi-mua'),
            title: 'Chi tiêu theo nơi mua',
            subtitle: month ? `${monthLabel(month)} · ${range.text}` : range.text,
            sheet: 'Nơi mua',
            rows: shops,
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
          title="Chi phí khác theo loại"
          summary={
            <>
              {scope} · ghi thêm ở{' '}
              <Link className="kk-link" to="/buy?tab=orders">
                Cần mua → Đơn hàng
              </Link>
            </>
          }
          empty={kinds.length === 0}
          emptyText="Không có khoản chi khác nào trong khoảng này."
          table={{
            rows: kinds,
            rowKey: (r) => r.name,
            foot: { amount: kinds.reduce((s, r) => s + r.amount, 0) },
            columns: [
              { key: 'name', title: 'Loại' },
              { key: 'amount', title: 'Số tiền', num: true, fmt: fmtMoneyFull },
            ],
          }}
        />
      </section>

      <ReportCard
        title={`Từng khoản chi · ${scope}`}
        summary="Mua linh kiện (theo đơn hoặc nhập lẻ), phí ship và chi phí khác. Bấm vào dòng linh kiện để xem thẻ kho."
        toolbar={
          monthsWithSpend.length > 0 && (
            <div className="kk-pills kk-report-filters" role="group" aria-label="Lọc theo tháng">
              <button type="button" className={`kk-pill ${!month ? 'is-on' : ''}`} aria-pressed={!month} onClick={() => setMonth('')}>
                Cả kỳ
              </button>
              {monthsWithSpend.map((m) => (
                <button key={m.key} type="button" className={`kk-pill ${month === m.key ? 'is-on' : ''}`} aria-pressed={month === m.key} onClick={() => setMonth(m.key)}>
                  {m.label}
                </button>
              ))}
            </div>
          )
        }
        empty={shown.length === 0}
        emptyText="Không có khoản chi nào trong khoảng này."
        table={{
          rows: shown,
          onRow: (e) => e.componentId && onPart(e.componentId),
          foot: { amount: shownTotal },
          maxHeight: 560,
          columns: [
            { key: 'dateIso', title: 'Ngày', render: (e) => fmtDate(e.dateIso) },
            { key: 'kind', title: 'Loại', render: (e) => <span className={`kk-spend-kind is-${e.kind}`}>{KIND_LABEL[e.kind]}</span> },
            {
              key: 'what',
              title: 'Khoản chi',
              className: 'kk-cell-clip',
              render: (e) => (
                <span title={[e.what, e.name].filter(Boolean).join('\n')}>
                  {e.what}
                  {e.kind === 'goods' && e.qty ? ` × ${fmtNum(Math.abs(e.qty))}` : ''}
                  {e.projectId && projectsById.get(e.projectId) ? ` · ${projectsById.get(e.projectId).code || projectsById.get(e.projectId).name}` : ''}
                </span>
              ),
            },
            { key: 'source', title: 'Nơi mua / loại chi', className: 'kk-cell-clip' },
            {
              key: 'amount',
              title: 'Số tiền',
              num: true,
              render: (e) => (e.amount === null ? <span className="kk-muted-text">chưa có giá</span> : e.amount < 0 ? <span className="kk-up">{signedMoney(e.amount)}</span> : fmtMoneyFull(e.amount)),
              fmt: fmtMoneyFull,
            },
          ],
        }}
        exportOpts={{
          filename: datedName('chi-tiet-chi-tieu'),
          title: `Chi tiết chi tiêu · ${scope}`,
          subtitle: range.text,
          sheet: 'Chi tiết',
          rows: shown,
          columns: [
            { header: 'Ngày', value: (e) => fmtDate(e.dateIso), width: 12 },
            { header: 'Loại', value: (e) => KIND_LABEL[e.kind], width: 14 },
            { header: 'Khoản chi', value: (e) => e.what, width: 32, wrap: true },
            { header: 'Số lượng', value: (e) => (e.kind === 'goods' ? e.qty : null), type: 'int', width: 10 },
            { header: 'Đơn giá', value: (e) => (e.kind === 'goods' ? e.unitCost : null), type: 'money', width: 12 },
            { header: 'Nơi mua / loại chi', value: (e) => e.source, width: 26, wrap: true },
            { header: 'Số tiền', value: (e) => (e.amount === null ? null : Math.round(e.amount)), type: 'money', width: 16, total: true },
          ],
        }}
      />
    </>
  )
}

/* ================================================================== */
/* Thẻ Kiểm kê                                                         */
/* ================================================================== */
function AdjustTab({ adj, prev, range, onPart }) {
  const { locationsById } = useData()
  // Món hay lệch nhất: gộp theo linh kiện
  const byPart = useMemo(() => {
    const map = new Map()
    for (const r of adj.rows) {
      const p = map.get(r.componentId) ?? { id: r.componentId, part: r.part, name: r.name, times: 0, delta: 0, value: 0 }
      p.times++
      p.delta += r.delta
      p.value += r.value
      map.set(r.componentId, p)
    }
    return [...map.values()].sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || b.times - a.times)
  }, [adj])
  const where = (r) => locationsById.get(r.locationId)?.path ?? ''

  return (
    <>
      <section className="kk-stats" aria-label="Tóm tắt kiểm kê">
        <StatCard Icon={ClipboardCheck} label="Lần điều chỉnh" value={fmtNum(adj.rows.length)} note={compareText(adj.rows.length, prev.rows.length) || 'trong kỳ'} />
        <StatCard Icon={TrendingDown} tone={adj.loss < 0 ? 'warn' : 'neutral'} label="Hụt so với sổ" value={signedMoney(adj.loss)} note={`${fmtNum(adj.rows.filter((r) => r.delta < 0).length)} lần đếm ra ít hơn`} />
        <StatCard Icon={TrendingUp} label="Dư so với sổ" value={signedMoney(adj.gain)} note={`${fmtNum(adj.rows.filter((r) => r.delta > 0).length)} lần đếm ra nhiều hơn`} />
        <StatCard Icon={Coins} label="Chênh lệch ròng" value={signedMoney(adj.net)} note={compareText(Math.abs(adj.net), Math.abs(prev.net)) || 'hụt + dư'} />
      </section>

      <section className="kk-grid-charts">
        <ReportCard
          title="Từng lần điều chỉnh"
          summary="Số trên sổ trước khi đếm → số đếm được thực tế. Bấm vào dòng để xem thẻ kho."
          empty={adj.rows.length === 0}
          emptyText="Không có lần điều chỉnh nào làm thay đổi tồn kho trong kỳ."
          table={{
            rows: adj.rows,
            onRow: (r) => onPart(r.componentId),
            maxHeight: 520,
            foot: { delta: adj.rows.reduce((s, r) => s + r.delta, 0), value: adj.net },
            columns: [
              { key: 'at', title: 'Thời gian', render: (r) => fmtDateTime(r.at) },
              { key: 'part', title: 'Linh kiện', className: 'kk-cell-clip', render: (r) => <span title={`${r.part}\n${r.name}${r.note ? `\n${r.note}` : ''}`}>{r.part}</span> },
              { key: 'loc', title: 'Vị trí', className: 'kk-cell-clip', render: where },
              { key: 'change', title: 'Sổ → Đếm', num: true, render: (r) => `${fmtNum(r.before)} → ${fmtNum(r.after)}` },
              { key: 'delta', title: 'Lệch', num: true, render: (r) => <span className={r.delta > 0 ? 'kk-up' : 'kk-down'}>{signed(r.delta)}</span>, fmt: signed },
              { key: 'value', title: 'Trị giá lệch', num: true, render: (r) => (r.value ? signedMoney(r.value) : '—'), fmt: signedMoney },
            ],
          }}
          exportOpts={{
            filename: datedName('kiem-ke'),
            title: 'Các lần điều chỉnh khi kiểm kê',
            subtitle: range.text,
            sheet: 'Kiểm kê',
            rows: adj.rows,
            columns: [
              { header: 'Thời gian', value: (r) => fmtDateTime(r.at), width: 18 },
              { header: 'Mã linh kiện', value: (r) => r.part, width: 28, wrap: true },
              { header: 'Vị trí', value: (r) => where(r), width: 22, wrap: true },
              { header: 'Trên sổ', value: (r) => r.before, type: 'int', width: 10 },
              { header: 'Đếm được', value: (r) => r.after, type: 'int', width: 11 },
              { header: 'Lệch', value: (r) => r.delta, type: 'int', width: 9, total: true },
              { header: 'Trị giá lệch', value: (r) => Math.round(r.value), type: 'money', width: 15, total: true },
              { header: 'Ghi chú', value: (r) => r.note, width: 28, wrap: true },
            ],
          }}
        />
        <ReportCard
          title="Món hay lệch nhất"
          summary="Gộp theo linh kiện, xếp theo trị giá lệch"
          empty={byPart.length === 0}
          emptyText="Chưa có món nào bị lệch."
          table={{
            rows: byPart.slice(0, 30),
            onRow: (r) => onPart(r.id),
            columns: [
              { key: 'part', title: 'Linh kiện', className: 'kk-cell-clip', render: (r) => <span title={r.name}>{r.part}</span> },
              { key: 'times', title: 'Số lần', num: true },
              { key: 'delta', title: 'Tổng lệch', num: true, render: (r) => <span className={r.delta > 0 ? 'kk-up' : r.delta < 0 ? 'kk-down' : ''}>{signed(r.delta)}</span> },
              { key: 'value', title: 'Trị giá', num: true, render: (r) => (r.value ? signedMoney(r.value) : '—') },
            ],
          }}
        />
      </section>
      <p className="kk-muted-text kk-report-foot">Trị giá lệch tính theo đơn giá đang lưu trong kho.</p>
    </>
  )
}

/* ================================================================== */
/* Thẻ Giá mua                                                         */
/* ================================================================== */
function PriceTab({ ready, data, onRow }) {
  const { componentsById } = useData()
  const [q, setQ] = useState('')
  const rows = useMemo(() => (ready ? priceHistory(data, componentsById) : []), [ready, data, componentsById])
  const list = useMemo(() => {
    const terms = normalize(q).split(/\s+/).filter(Boolean)
    return terms.length ? rows.filter((r) => terms.every((t) => normalize(`${r.part} ${r.name} ${r.lastShop}`).includes(t))) : rows
  }, [rows, q])

  if (!ready) {
    return (
      <div className="kk-card kk-report-card">
        <EmptyState title="Chưa bật ghi giá mua" text={SQL17_TEXT} />
      </div>
    )
  }
  const up = rows.filter((r) => r.change > 0).length
  const down = rows.filter((r) => r.change < 0).length

  return (
    <>
      <section className="kk-stats kk-stats-3" aria-label="Tóm tắt giá mua">
        <StatCard Icon={Coins} label="Mã đã có giá mua" value={fmtNum(rows.length)} note={`${fmtNum(rows.reduce((s, r) => s + r.count, 0))} lần mua có ghi giá`} />
        <StatCard Icon={TrendingUp} tone={up > 0 ? 'warn' : 'neutral'} label="Lần mua gần nhất đắt hơn" value={fmtNum(up)} note="so với lần mua trước đó" />
        <StatCard Icon={TrendingDown} tone={down > 0 ? 'good' : 'neutral'} label="Lần mua gần nhất rẻ hơn" value={fmtNum(down)} note="so với lần mua trước đó" />
      </section>
      <ReportCard
        title="Lịch sử giá mua"
        summary="Toàn bộ các lần mua có ghi giá (không theo kỳ). Bấm vào một dòng để xem từng lần mua và biểu đồ giá."
        toolbar={
          <div className="kk-report-filters">
            <div className="kk-search">
              <Search size={18} aria-hidden="true" />
              <input type="search" value={q} placeholder="Tìm mã, tên linh kiện, nơi mua…" aria-label="Tìm trong lịch sử giá" onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
        }
        empty={list.length === 0}
        emptyText={rows.length === 0 ? 'Chưa có lần mua nào có ghi giá. Giá mua được ghi khi nhận hàng theo đơn, bấm “Đã mua”, hoặc nhập kho hàng mua.' : 'Không có linh kiện nào khớp.'}
        table={{
          rows: list,
          onRow,
          maxHeight: 560,
          columns: [
            { key: 'part', title: 'Linh kiện', className: 'kk-cell-clip', render: (r) => <span title={`${r.part}\n${r.name}`}>{r.part}</span> },
            { key: 'count', title: 'Số lần mua', num: true },
            {
              key: 'last',
              title: 'Giá gần nhất',
              num: true,
              render: (r) => (
                <>
                  {fmtPrice(r.last)}
                  {r.change !== null && Math.round(r.change) !== 0 && (
                    <small className={`kk-price-change ${r.change > 0 ? 'is-up' : 'is-down'}`}>
                      {r.change > 0 ? '↑' : '↓'}
                      {Math.abs(Math.round(r.change))}%
                    </small>
                  )}
                </>
              ),
            },
            { key: 'min', title: 'Thấp nhất', num: true, fmt: fmtPrice },
            { key: 'max', title: 'Cao nhất', num: true, fmt: fmtPrice },
            { key: 'current', title: 'Đơn giá kho', num: true, render: (r) => (r.current > 0 ? fmtPrice(r.current) : '—') },
            { key: 'lastShop', title: 'Mua lần cuối', className: 'kk-cell-clip', render: (r) => `${fmtDate(r.lastDate)} · ${r.lastShop}` },
            { key: 'cheapestShop', title: 'Nơi rẻ nhất', className: 'kk-cell-clip', render: (r) => r.cheapestShop ?? '—' },
          ],
        }}
        exportOpts={{
          filename: datedName('lich-su-gia-mua'),
          title: 'Lịch sử giá mua',
          subtitle: 'Mỗi lần mua một dòng',
          sheet: 'Giá mua',
          rows: list.flatMap((r) => r.buys.map((b) => ({ r, b }))),
          columns: [
            { header: 'Mã linh kiện', value: (x) => x.r.part, width: 28, wrap: true },
            { header: 'Ngày mua', value: (x) => fmtDate(x.b.dateIso), width: 12 },
            { header: 'Nơi mua', value: (x) => [x.b.order, x.b.shop].filter(Boolean).join(' · '), width: 26, wrap: true },
            { header: 'Số lượng', value: (x) => x.b.qty, type: 'int', width: 10 },
            { header: 'Giá / cái', value: (x) => x.b.price, type: 'money', width: 12 },
            { header: 'Thành tiền', value: (x) => Math.round(x.b.qty * x.b.price), type: 'money', width: 15, total: true },
          ],
        }}
      />
    </>
  )
}

