import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Download } from 'lucide-react'
import { useData } from '../data/DataContext'
import { useShell } from '../ShellContext'
import { Modal } from '../ui/Modal'
import { datedName } from '../lib/xlsx'
import { useXlsxExport } from '../ui/useXlsxExport'
import { fmtDate, fmtDateTime, fmtMoneyFull, fmtNum, fmtPrice } from '../lib/format'
import { stockCard } from '../lib/reportData'

// Màu theo đối tượng, cố định ở mọi biểu đồ của trang: linh kiện = 1, phí ship = 2, chi phí khác = 3
export const C_GOODS = 'var(--series-1)'
export const C_SHIP = 'var(--series-2)'
export const C_OTHER = 'var(--series-3)'

export const axisTick = { fontSize: 12, fill: 'var(--muted)' }
export const shortMoney = (v) =>
  Math.abs(v) >= 1e6 ? `${fmtNum(Math.round(v / 1e5) / 10)}tr` : Math.abs(v) >= 1e3 ? `${fmtNum(Math.round(v / 1e3))}k` : fmtNum(v)
export const signed = (n) => (n > 0 ? `+${fmtNum(n)}` : n < 0 ? `−${fmtNum(Math.abs(n))}` : '0')
export const signedMoney = (n) => (n > 0 ? `+${fmtMoneyFull(n)}` : n < 0 ? `−${fmtMoneyFull(Math.abs(n))}` : '0 đ')

/* ------------------------------------------------------------------ */
/* Khung một phần báo cáo: tiêu đề, biểu đồ / bảng, xuất Excel          */
/* ------------------------------------------------------------------ */
export function ReportCard({ title, summary, toolbar, children, table, exportOpts, empty, emptyText, className = '' }) {
  const [view, setView] = useState('chart')
  const xlsx = useXlsxExport()
  // Có cả biểu đồ (children) lẫn bảng thì cho đổi qua lại; chỉ có một thứ thì hiện thứ đó
  const both = Boolean(children) && Boolean(table)
  const showTable = table && (!children || view === 'table')
  return (
    <div className={`kk-card kk-chart-card kk-report-card ${className}`}>
      <div className="kk-card-head">
        <div>
          <h2>{title}</h2>
          {summary && <p className="kk-card-sub">{summary}</p>}
        </div>
        <div className="kk-report-tools">
          {both && (
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
      {toolbar}
      {empty ? <p className="kk-muted-text kk-chart-empty">{emptyText}</p> : showTable ? <DataTable {...table} /> : children}
    </div>
  )
}

/**
 * Bảng số liệu. columns: [{ key, title, num, fmt, render, className }], onRow = bấm vào dòng.
 * foot: dòng tổng (object theo key).
 */
export function DataTable({ columns, rows, onRow, rowTitle, foot, maxHeight = 460, rowKey = (r, i) => r.id ?? r.key ?? i }) {
  return (
    <div className="kk-table-scroll kk-report-table" style={{ maxHeight }}>
      <table className={`kk-mini-table ${onRow ? 'kk-rows-click' : ''}`}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={`${c.num ? 'is-num' : ''} ${c.className ?? ''}`}>
                {c.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={rowKey(r, i)}
              title={rowTitle?.(r)}
              tabIndex={onRow ? 0 : undefined}
              onClick={onRow ? () => onRow(r) : undefined}
              onKeyDown={
                onRow
                  ? (e) => {
                      if (e.key === 'Enter') onRow(r)
                    }
                  : undefined
              }
            >
              {columns.map((c) => (
                <td key={c.key} className={`${c.num ? 'is-num' : ''} ${c.className ?? ''}`}>
                  {c.render ? c.render(r) : c.fmt ? c.fmt(r[c.key]) : c.num ? fmtNum(r[c.key]) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {foot && (
          <tfoot>
            <tr>
              {columns.map((c, i) => (
                <td key={c.key} className={`${c.num ? 'is-num' : ''} ${c.className ?? ''}`}>
                  {i === 0 ? 'Tổng' : foot[c.key] === undefined ? '' : c.fmt ? c.fmt(foot[c.key]) : c.num ? fmtNum(foot[c.key]) : foot[c.key]}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

export function Tip({ active, payload, label, fmt = fmtMoneyFull, titleOf, showTotal, hint }) {
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
      {hint && <div className="kk-tip-hint">{hint}</div>}
    </div>
  )
}

export function Legend({ items }) {
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

/**
 * Danh sách xếp hạng có thanh ngang: tên dài vẫn đọc được trên một dòng.
 * segments: [{ key, color }] là các phần của thanh (cộng lại = tổng của dòng).
 */
export function RankList({ rows, segments, label, valueText, title, onClick }) {
  const total = (r) => segments.reduce((s, g) => s + Math.max(0, Number(r[g.key]) || 0), 0)
  const max = Math.max(0, ...rows.map(total))
  return (
    <ol className="kk-rank">
      {rows.map((r, i) => (
        <li key={r.id ?? i}>
          <button type="button" className="kk-rank-row" title={title?.(r)} onClick={() => onClick?.(r)}>
            <span className="kk-rank-no">{i + 1}</span>
            <span className="kk-rank-name">{label(r)}</span>
            <span className="kk-rank-val">{valueText(r)}</span>
            <span className="kk-rank-track" aria-hidden="true">
              {segments.map((g) => {
                const v = Math.max(0, Number(r[g.key]) || 0)
                return v > 0 && max > 0 ? <i key={g.key} style={{ width: `${Math.max(1.5, (v / max) * 100)}%`, background: g.color }} /> : null
              })}
            </span>
          </button>
        </li>
      ))}
    </ol>
  )
}

/* ------------------------------------------------------------------ */
/* Thẻ kho: từng lần nhập / xuất của một linh kiện trong kỳ             */
/* ------------------------------------------------------------------ */
export function StockCardModal({ componentId, tx, range, onClose }) {
  const { componentsById, locationsById, projectCode } = useData()
  const { openComponent } = useShell()
  const xlsx = useXlsxExport()
  const comp = componentsById.get(componentId)
  const card = useMemo(() => (comp ? stockCard(tx, comp, range.startMs, range.endMs) : null), [tx, comp, range])
  if (!comp) return null
  const where = (t) => locationsById.get(t.location_id)?.path ?? ''
  const detail = (t) =>
    [t.project_id ? projectCode(t.project_id) : '', t.unit_cost !== null && t.unit_cost !== undefined && t.is_purchase ? `giá ${fmtPrice(t.unit_cost)}` : '', t.note]
      .filter(Boolean)
      .join(' · ')
  return (
    <Modal
      title={`Thẻ kho: ${comp.part_number}`}
      subtitle={`${comp.name} · ${range.text}`}
      size="xl"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="kk-btn kk-btn-ghost" onClick={() => openComponent(comp.id)}>
            Mở chi tiết linh kiện
          </button>
          <span className="kk-push-right" />
          <button
            type="button"
            className="kk-btn kk-btn-outline"
            disabled={xlsx.busy}
            onClick={() =>
              xlsx.run({
                filename: datedName(`the-kho-${comp.part_number}`.replace(/[^\w.-]+/g, '-').slice(0, 60)),
                title: `Thẻ kho: ${comp.part_number}`,
                subtitle: `${comp.name} · ${range.text} · tồn đầu kỳ ${fmtNum(card.open)}`,
                sheet: 'Thẻ kho',
                rows: card.rows,
                columns: [
                  { header: 'Thời gian', value: (t) => fmtDateTime(t.created_at), width: 18 },
                  { header: 'Loại', value: (t) => t.kind, width: 14 },
                  { header: 'Vị trí', value: (t) => where(t), width: 22, wrap: true },
                  { header: 'Thay đổi', value: (t) => t.change, type: 'int', width: 11 },
                  { header: 'Tồn sau', value: (t) => t.balance, type: 'int', width: 11 },
                  { header: 'Chi tiết', value: (t) => detail(t), width: 40, wrap: true },
                ],
              })
            }
          >
            <Download size={18} />
            Xuất Excel
          </button>
        </>
      }
    >
      <div className="kk-card-strip">
        <span>
          Tồn đầu kỳ <strong>{fmtNum(card.open)}</strong>
        </span>
        <span>
          {fmtNum(card.rows.length)} lần thay đổi
        </span>
        <span>
          Tồn cuối kỳ <strong>{fmtNum(card.close)}</strong>
        </span>
      </div>
      {card.rows.length === 0 ? (
        <p className="kk-muted-text">Không có lần nhập, xuất hay điều chỉnh nào trong kỳ này.</p>
      ) : (
        <DataTable
          maxHeight={520}
          rows={card.rows}
          columns={[
            { key: 'created_at', title: 'Thời gian', render: (t) => fmtDateTime(t.created_at) },
            { key: 'kind', title: 'Loại', render: (t) => <span className={`kk-kind kk-kind-${t.change > 0 ? 'up' : t.change < 0 ? 'down' : 'zero'}`}>{t.kind}</span> },
            { key: 'loc', title: 'Vị trí', render: where },
            { key: 'change', title: 'Thay đổi', num: true, render: (t) => <span className={t.change > 0 ? 'kk-up' : t.change < 0 ? 'kk-down' : ''}>{signed(t.change)}</span> },
            { key: 'balance', title: 'Tồn sau', num: true },
            { key: 'detail', title: 'Chi tiết', render: detail, className: 'kk-cell-wrap' },
          ]}
        />
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Chi tiết một dự án: linh kiện đã dùng trong kỳ                       */
/* ------------------------------------------------------------------ */
export function ProjectUsageModal({ project, range, onPart, onClose }) {
  return (
    <Modal title={`${project.label}${project.name && project.name !== project.label ? ` · ${project.name}` : ''}`} subtitle={`Đã dùng trong kỳ ${range.text}`} size="lg" onClose={onClose}>
      <div className="kk-card-strip">
        <span>
          Linh kiện <strong>{fmtMoneyFull(project.value)}</strong>
        </span>
        <span>
          Chi phí khác <strong>{fmtMoneyFull(project.other)}</strong>
        </span>
        <span>
          Tổng <strong>{fmtMoneyFull(project.total)}</strong>
        </span>
      </div>
      {project.parts.length === 0 ? (
        <p className="kk-muted-text">Dự án này chưa dùng linh kiện nào trong kỳ (chỉ có chi phí khác).</p>
      ) : (
        <DataTable
          rows={project.parts}
          onRow={(r) => onPart(r.id)}
          rowTitle={() => 'Bấm để xem thẻ kho'}
          foot={{ qty: project.parts.reduce((s, r) => s + r.qty, 0), value: project.value }}
          columns={[
            { key: 'part', title: 'Linh kiện', render: (r) => <span title={r.name}>{r.part}</span> },
            { key: 'qty', title: 'Đã dùng', num: true },
            { key: 'value', title: 'Trị giá', num: true, fmt: fmtMoneyFull },
          ]}
        />
      )}
      <p className="kk-muted-text kk-report-foot">Trị giá tính theo đơn giá đang lưu trong kho. Không gồm tiền công.</p>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Lịch sử giá mua của một linh kiện                                   */
/* ------------------------------------------------------------------ */
export function PriceModal({ row, onClose }) {
  const points = row.buys.map((b) => ({ ...b, label: fmtDate(b.dateIso) }))
  return (
    <Modal title={`Giá mua: ${row.part}`} subtitle={row.name} size="lg" onClose={onClose}>
      <div className="kk-card-strip">
        <span>
          Thấp nhất <strong>{fmtPrice(row.min)}</strong>
        </span>
        <span>
          Cao nhất <strong>{fmtPrice(row.max)}</strong>
        </span>
        <span>
          Đơn giá kho <strong>{row.current > 0 ? fmtPrice(row.current) : '—'}</strong>
        </span>
      </div>
      {points.length > 1 && (
        <div className="kk-chart" style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--kk-grid)" />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--kk-axis)' }} tick={axisTick} />
              {/* Trục bám sát khoảng giá (không bắt đầu từ 0) để thấy rõ giá lên hay xuống */}
              <YAxis
                tickLine={false}
                axisLine={false}
                width={56}
                tick={axisTick}
                tickFormatter={shortMoney}
                domain={[(min) => Math.floor(min * 0.9), (max) => Math.ceil(max * 1.05)]}
              />
              <Tooltip
                content={<Tip fmt={fmtPrice} titleOf={(p) => `${p[0]?.payload?.label} · ${p[0]?.payload?.shop}`} />}
                cursor={{ stroke: 'var(--kk-axis)', strokeDasharray: '3 3' }}
                isAnimationActive={false}
              />
              <Line
                type="linear"
                dataKey="price"
                name="Giá mua / cái"
                stroke={C_GOODS}
                strokeWidth={2}
                dot={{ r: 4, fill: C_GOODS, stroke: 'var(--card)', strokeWidth: 2 }}
                activeDot={{ r: 6, stroke: 'var(--card)', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <DataTable
        rows={[...row.buys].reverse()}
        columns={[
          { key: 'dateIso', title: 'Ngày', render: (b) => fmtDate(b.dateIso) },
          { key: 'shop', title: 'Nơi mua', render: (b) => [b.order, b.shop].filter(Boolean).join(' · ') },
          { key: 'qty', title: 'Số lượng', num: true },
          { key: 'price', title: 'Giá / cái', num: true, fmt: fmtPrice },
          { key: 'total', title: 'Thành tiền', num: true, render: (b) => fmtMoneyFull(b.qty * b.price) },
        ]}
      />
    </Modal>
  )
}
