import { fmtNum, fmtPrice } from './format'

/**
 * Đơn giá theo hộp / bộ / combo (sql/14_price_unit.sql).
 * Database luôn lưu unit_price = giá MỘT CÁI; price_unit + price_qty chỉ để nhập và hiển thị
 * theo đơn vị người bán (vd 108.300 đ / hộp 840 cái).
 */
export const PRICE_UNITS = ['hộp', 'bộ', 'combo', 'gói', 'cuộn', 'vỉ', 'túi']

/** Database đã có hai cột mới chưa (dòng từ component_totals có khóa price_qty) */
export const supportsPriceUnit = (components) => components.some((c) => c && 'price_qty' in c)

/** { unit, qty } nếu linh kiện tính giá theo hộp / bộ...; null nếu tính theo cái */
export function packOf(comp) {
  const unit = comp?.price_unit?.trim()
  if (!unit) return null
  return { unit, qty: Math.max(1, Number(comp.price_qty) || 1) }
}

/** Giá một đơn vị bán (hộp, bộ...) từ giá một cái; làm tròn để 108299,9999 hiện đúng 108.300 */
export function packPrice(unitPrice, pack) {
  if (unitPrice === null || unitPrice === undefined || unitPrice === '') return null
  const v = Number(unitPrice) * (pack?.qty ?? 1)
  return Math.round(v * 100) / 100
}

/** "108.300 đ / hộp" hoặc "3.500 đ" */
export function fmtUnitPrice(unitPrice, pack) {
  const p = packPrice(unitPrice, pack)
  if (p === null) return fmtPrice(null)
  return pack ? `${fmtPrice(p)} / ${pack.unit}` : fmtPrice(p)
}

/** "1 hộp = 840 cái, khoảng 128,93 đ/cái" */
export function packNote(unitPrice, pack) {
  if (!pack) return ''
  const per = Number(unitPrice) > 0 ? `, khoảng ${fmtPrice(Number(unitPrice))}/cái` : ''
  return `1 ${pack.unit} = ${fmtNum(pack.qty)} cái${per}`
}
