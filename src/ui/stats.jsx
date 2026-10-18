import { Link } from 'react-router-dom'
import { Boxes, Coins, Layers } from 'lucide-react'
import { fmtMoney, fmtMoneyFull, fmtNum } from '../lib/format'

/** Thẻ số liệu. to = mở trang khác, onClick = thao tác ngay trên trang */
export function StatCard({ Icon, label, value, note, tone = 'neutral', to, onClick, title, children }) {
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
      {children}
    </>
  )
  if (to) {
    return (
      <Link to={to} className={`kk-stat kk-stat-link kk-stat-${tone}`}>
        {inner}
      </Link>
    )
  }
  if (onClick) {
    return (
      <button type="button" className={`kk-stat kk-stat-link kk-stat-${tone}`} onClick={onClick}>
        {inner}
      </button>
    )
  }
  return <div className={`kk-stat kk-stat-${tone}`}>{inner}</div>
}

/** Số mã, tổng số cái, giá trị kho, và bao nhiêu mã đã có đơn giá */
export function stockStats(components) {
  let qty = 0
  let value = 0
  let priced = 0
  let pricedQty = 0
  for (const c of components) {
    qty += c.total_quantity
    if (Number(c.unit_price) > 0) {
      priced++
      pricedQty += c.total_quantity
      value += Number(c.stock_value) || 0
    }
  }
  return { types: components.length, qty, value, priced, pricedQty, unpriced: components.length - priced, unpricedQty: qty - pricedQty }
}

/**
 * Ba thẻ: loại linh kiện, tổng số lượng, giá trị kho (kèm mức độ đã điền đơn giá).
 * scope = chữ ghi thêm khi số liệu chỉ tính cho một phần kho (vd "theo bộ lọc").
 * onMissing / missingTo = bấm thẻ giá trị để xem các mã chưa có đơn giá.
 */
export function StockStatCards({ stats, scope, onMissing, missingTo }) {
  const { types, qty, value, priced, unpriced, unpricedQty } = stats
  const pct = types > 0 ? Math.round((priced / types) * 100) : 0
  const canOpen = unpriced > 0
  const valueTitle = [
    `Giá trị kho: ${fmtMoneyFull(value)}`,
    unpriced > 0 ? `Chưa tính ${fmtNum(unpriced)} mã chưa có đơn giá (${fmtNum(unpricedQty)} cái)` : 'Mọi mã đều đã có đơn giá',
  ].join('\n')
  const suffix = scope ? `, ${scope}` : ''

  return (
    <>
      <StatCard Icon={Boxes} label="Loại linh kiện" value={fmtNum(types)} note={`mã đang quản lý${suffix}`} />
      <StatCard Icon={Layers} label="Tổng số lượng" value={fmtNum(qty)} note={`cái trong kho${suffix}`} />
      <StatCard
        Icon={Coins}
        label="Giá trị kho"
        value={priced > 0 ? fmtMoney(value) : '—'}
        title={valueTitle}
        note={
          types === 0
            ? 'Chưa có linh kiện'
            : priced === 0
              ? 'Chưa có đơn giá, bấm để điền'
              : unpriced > 0
                ? `Đã có giá ${fmtNum(priced)}/${fmtNum(types)} mã${canOpen ? ', bấm để điền tiếp' : ''}`
                : `Đủ đơn giá cho ${fmtNum(types)} mã${suffix}`
        }
        to={canOpen ? missingTo : undefined}
        onClick={canOpen ? onMissing : undefined}
      >
        {types > 0 && (
          <span
            className={`kk-stat-meter ${pct === 100 ? 'is-full' : ''}`}
            role="img"
            aria-label={`Đã có đơn giá ${fmtNum(priced)} trên ${fmtNum(types)} mã`}
          >
            <i style={{ width: `${pct}%` }} />
          </span>
        )}
      </StatCard>
    </>
  )
}
