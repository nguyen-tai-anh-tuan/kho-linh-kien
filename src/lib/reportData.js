/**
 * Tính số liệu cho trang Báo cáo. Toàn bộ là hàm thuần (không gọi Supabase), nhận dữ liệu đã tải:
 *   tx       : mọi giao dịch, cũ trước (id, created_at, type, quantity, delta, component_id, location_id,
 *              project_id, note, [is_purchase, unit_cost, order_id] nếu đã chạy sql/17)
 *   orders   : đơn hàng (id, code_no, shop, ordered_on, shipping_fee, status)
 *   expenses : khoản chi khác (id, spent_on, title, kind, amount, project_id, note)
 * Khoảng thời gian luôn là [startMs, endMs) theo giờ máy (giờ Việt Nam).
 */
import { orderCode } from './orders'

export const UNDO_NOTE = 'Hoàn tác giao dịch trước'

const pad = (n) => String(n).padStart(2, '0')
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
/** 'YYYY-MM-DD' -> mốc 0 giờ ngày đó (giờ máy) */
export const dayMs = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}
const tsOf = (t) => new Date(t.created_at).getTime()
export const monthLabel = (key) => {
  const [y, m] = key.split('-')
  return `T${Number(m)}/${y.slice(2)}`
}
export const priceOf = (c) => (Number(c?.unit_price) > 0 ? Number(c.unit_price) : 0)

/** Một giao dịch làm tồn kho thay đổi bao nhiêu */
export const deltaOf = (t) => (t.type === 'in' ? t.quantity : t.type === 'out' ? -t.quantity : Number(t.delta) || 0)
/** Xuất kho để dùng (không tính hoàn tác và trả lại hàng mua) */
export const isUse = (t) => t.type === 'out' && !t.is_purchase && t.note !== UNDO_NOTE
/** Linh kiện quay lại kho sau khi đã xuất dùng: trả lại từ BOM, hoàn tác một lần xuất */
export const isReturn = (t) =>
  t.type === 'in' && !t.is_purchase && (t.note === UNDO_NOTE || String(t.note ?? '').startsWith('Trả lại kho'))

/** Tên loại giao dịch cho thẻ kho */
export function kindOf(t) {
  if (t.type === 'adjust') return 'Điều chỉnh'
  if (t.type === 'in') {
    if (t.is_purchase) return 'Nhập mua'
    if (t.note === UNDO_NOTE) return 'Hoàn tác'
    if (String(t.note ?? '').startsWith('Trả lại kho')) return 'Trả lại kho'
    return 'Nhập khác'
  }
  if (t.is_purchase) return 'Hoàn tác mua'
  if (t.note === UNDO_NOTE) return 'Hoàn tác'
  return 'Xuất dùng'
}

/* ------------------------------------------------------------------ */
/* Khoảng thời gian                                                    */
/* ------------------------------------------------------------------ */

/**
 * preset: '3' | '6' | '12' (tháng, tính cả tháng này) hoặc 'custom' với from / to là 'YYYY-MM-DD' (gồm cả ngày to).
 * Trả về { startMs, endMs, prevStartMs, prevEndMs, months: [{ key, label, endMs }], text }
 */
export function makeRange(preset, from, to) {
  const now = new Date()
  let start
  let end
  if (preset === 'custom' && from && to && dayMs(from) <= dayMs(to)) {
    start = dayMs(from)
    end = dayMs(to) + 86400000
  } else {
    const n = Number(preset) || 6
    start = new Date(now.getFullYear(), now.getMonth() - (n - 1), 1).getTime()
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
  }
  const len = end - start
  const months = []
  const first = new Date(start)
  for (let d = new Date(first.getFullYear(), first.getMonth(), 1); d.getTime() < end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
    months.push({ key, label: monthLabel(key), endMs: Math.min(monthEnd, end) })
  }
  const fmt = (ms) => new Date(ms).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
  return { startMs: start, endMs: end, prevStartMs: start - len, prevEndMs: start, months, text: `${fmt(start)} – ${fmt(end - 1)}` }
}

/* ------------------------------------------------------------------ */
/* Chi tiêu                                                            */
/* ------------------------------------------------------------------ */

/**
 * Từng khoản chi trong khoảng [startMs, endMs):
 * { id, dateIso, month, kind: 'goods' | 'ship' | 'other', what, source, shop, qty, unitCost, amount (null = chưa có giá), componentId, projectId, orderId }
 * Hàng theo đơn tính vào ngày đặt đơn (lúc trả tiền), hàng nhập lẻ tính theo ngày nhập.
 */
export function spendEntries({ tx, orders, expenses }, componentsById, startMs, endMs) {
  const ordersById = new Map(orders.map((o) => [o.id, o]))
  const out = []
  const inRange = (ms) => ms >= startMs && ms < endMs
  for (const t of tx) {
    if (!t.is_purchase || t.type === 'adjust') continue
    const sign = t.type === 'in' ? 1 : -1
    const o = ordersById.get(t.order_id)
    const dateIso = o ? String(o.ordered_on) : isoDate(new Date(t.created_at))
    if (!inRange(o ? dayMs(dateIso) : tsOf(t))) continue
    const c = componentsById.get(t.component_id)
    const cost = t.unit_cost === null || t.unit_cost === undefined ? null : Number(t.unit_cost)
    out.push({
      id: `t-${t.id}`,
      dateIso,
      month: dateIso.slice(0, 7),
      kind: 'goods',
      what: c?.part_number ?? 'Linh kiện đã xóa',
      name: c?.name ?? '',
      source: o ? `${orderCode(o.code_no)} · ${o.shop || 'Chưa ghi nơi mua'}` : sign < 0 ? 'Hoàn tác một lần mua' : 'Nhập kho (không qua đơn)',
      shop: o ? o.shop || 'Chưa ghi nơi mua' : 'Nhập kho (không qua đơn)',
      qty: sign * t.quantity,
      unitCost: cost,
      amount: cost === null ? null : sign * t.quantity * cost,
      componentId: t.component_id,
      orderId: o?.id ?? null,
    })
  }
  for (const o of orders) {
    const fee = Number(o.shipping_fee) || 0
    if (o.status === 'cancelled' || fee <= 0 || !inRange(dayMs(o.ordered_on))) continue
    out.push({
      id: `s-${o.id}`,
      dateIso: String(o.ordered_on),
      month: String(o.ordered_on).slice(0, 7),
      kind: 'ship',
      what: `Phí ship ${orderCode(o.code_no)}`,
      name: '',
      source: o.shop || 'Chưa ghi nơi mua',
      shop: o.shop || 'Chưa ghi nơi mua',
      amount: fee,
      orderId: o.id,
    })
  }
  for (const e of expenses) {
    if (!inRange(dayMs(e.spent_on))) continue
    out.push({
      id: `e-${e.id}`,
      dateIso: String(e.spent_on),
      month: String(e.spent_on).slice(0, 7),
      kind: 'other',
      what: e.title,
      name: e.note ?? '',
      source: e.kind || 'Khác',
      shop: null,
      amount: Number(e.amount) || 0,
      projectId: e.project_id,
    })
  }
  return out.sort((a, b) => b.dateIso.localeCompare(a.dateIso))
}

export const sumAmount = (list) => list.reduce((s, e) => s + (e.amount ?? 0), 0)

/** Gộp các khoản chi theo tháng (đủ mọi tháng của kỳ, kể cả tháng không chi gì) */
export function spendByMonth(entries, months) {
  const map = new Map(months.map((m) => [m.key, { key: m.key, label: m.label, goods: 0, ship: 0, other: 0, total: 0 }]))
  for (const e of entries) {
    const r = map.get(e.month)
    if (!r || e.amount === null) continue
    r[e.kind] += e.amount
    r.total += e.amount
  }
  return [...map.values()]
}

/** Theo nơi mua: tiền hàng + ship, số đơn */
export function spendByShop(entries) {
  const map = new Map()
  for (const e of entries) {
    if (e.kind === 'other' || e.amount === null) continue
    const r = map.get(e.shop) ?? { name: e.shop, goods: 0, ship: 0, total: 0, orders: new Set() }
    r[e.kind] += e.amount
    r.total += e.amount
    if (e.orderId) r.orders.add(e.orderId)
    map.set(e.shop, r)
  }
  return [...map.values()].map((r) => ({ ...r, count: r.orders.size })).sort((a, b) => b.total - a.total)
}

/** Khoản chi khác theo loại */
export function spendByKind(entries) {
  const map = new Map()
  for (const e of entries) {
    if (e.kind !== 'other') continue
    map.set(e.source, (map.get(e.source) ?? 0) + e.amount)
  }
  return [...map].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount)
}

/* ------------------------------------------------------------------ */
/* Tồn kho: nhập – xuất – tồn, giá trị theo tháng                       */
/* ------------------------------------------------------------------ */

/** Tổng thay đổi của các giao dịch từ mốc ms trở về sau, theo linh kiện */
function deltasFrom(tx, ms) {
  const map = new Map()
  for (const t of tx) {
    if (tsOf(t) < ms) continue
    map.set(t.component_id, (map.get(t.component_id) ?? 0) + deltaOf(t))
  }
  return map
}

/** Tồn của mọi linh kiện tại mốc ms: Map(id -> số lượng) */
export function stockAt(tx, components, ms) {
  const after = deltasFrom(tx, ms)
  return new Map(components.map((c) => [c.id, Math.max(0, c.total_quantity - (after.get(c.id) ?? 0))]))
}

/**
 * Báo cáo nhập – xuất – tồn: mỗi linh kiện một dòng.
 * open / close = tồn đầu kỳ / cuối kỳ; buy = nhập mua; inOther = nhập khác (tồn ban đầu, trả lại, hoàn tác...);
 * out = xuất; adj = điều chỉnh (±). Luôn đúng: open + buy + inOther − out + adj = close.
 */
export function stockMovement(tx, components, startMs, endMs) {
  const openMap = stockAt(tx, components, startMs)
  const closeMap = stockAt(tx, components, endMs)
  const mov = new Map()
  for (const t of tx) {
    const ms = tsOf(t)
    if (ms < startMs || ms >= endMs) continue
    const m = mov.get(t.component_id) ?? { buy: 0, inOther: 0, out: 0, adj: 0, count: 0 }
    if (t.type === 'in') m[t.is_purchase ? 'buy' : 'inOther'] += t.quantity
    else if (t.type === 'out') m.out += t.quantity
    else m.adj += Number(t.delta) || 0
    m.count++
    mov.set(t.component_id, m)
  }
  return components.map((c) => {
    const m = mov.get(c.id) ?? { buy: 0, inOther: 0, out: 0, adj: 0, count: 0 }
    const close = closeMap.get(c.id) ?? 0
    return {
      id: c.id,
      part: c.part_number,
      name: c.name,
      categoryId: c.category_id,
      archived: Boolean(c.archived_at),
      open: openMap.get(c.id) ?? 0,
      ...m,
      close,
      price: priceOf(c),
      value: close * priceOf(c),
    }
  })
}

/** Giá trị kho cuối mỗi tháng (ước tính theo đơn giá đang lưu) */
export function stockValueByMonth(tx, components, months) {
  const price = new Map(components.map((c) => [c.id, priceOf(c)]))
  return months.map((m) => {
    const at = stockAt(tx, components, Math.min(m.endMs, Date.now() + 1))
    let value = 0
    let qty = 0
    for (const [id, q] of at) {
      qty += q
      value += q * (price.get(id) ?? 0)
    }
    return { key: m.key, label: m.label, value, qty }
  })
}

/* ------------------------------------------------------------------ */
/* Sử dụng: theo linh kiện, theo dự án, nằm im                          */
/* ------------------------------------------------------------------ */

/** Đã dùng trong kỳ (xuất dùng trừ phần trả lại), theo linh kiện và theo dự án */
export function usage(tx, componentsById, projectsById, expenses, startMs, endMs) {
  const byComp = new Map()
  const byProj = new Map()
  for (const t of tx) {
    const ms = tsOf(t)
    if (ms < startMs || ms >= endMs) continue
    const sign = isUse(t) ? 1 : isReturn(t) ? -1 : 0
    if (!sign) continue
    const value = sign * t.quantity * priceOf(componentsById.get(t.component_id))
    byComp.set(t.component_id, (byComp.get(t.component_id) ?? 0) + sign * t.quantity)
    if (t.project_id) {
      const p = byProj.get(t.project_id) ?? { qty: 0, value: 0, other: 0, parts: new Map() }
      p.qty += sign * t.quantity
      p.value += value
      p.parts.set(t.component_id, (p.parts.get(t.component_id) ?? 0) + sign * t.quantity)
      byProj.set(t.project_id, p)
    }
  }
  for (const e of expenses) {
    const ms = dayMs(e.spent_on)
    if (!e.project_id || ms < startMs || ms >= endMs) continue
    const p = byProj.get(e.project_id) ?? { qty: 0, value: 0, other: 0, parts: new Map() }
    p.other += Number(e.amount) || 0
    byProj.set(e.project_id, p)
  }
  const used = [...byComp]
    .filter(([, q]) => q > 0)
    .map(([id, q]) => {
      const c = componentsById.get(id)
      return { id, part: c?.part_number ?? 'Linh kiện đã xóa', name: c?.name ?? '', qty: q, value: q * priceOf(c) }
    })
    .sort((a, b) => b.qty - a.qty || b.value - a.value)
  const projects = [...byProj]
    .map(([id, p]) => {
      const pr = projectsById.get(id)
      const value = Math.max(0, p.value)
      return {
        id,
        label: pr ? pr.code || pr.name : 'Dự án đã xóa',
        name: pr?.name ?? '',
        qty: Math.max(0, p.qty),
        value,
        other: p.other,
        total: value + p.other,
        parts: [...p.parts]
          .filter(([, q]) => q > 0)
          .map(([cid, q]) => {
            const c = componentsById.get(cid)
            return { id: cid, part: c?.part_number ?? 'Linh kiện đã xóa', name: c?.name ?? '', qty: q, value: q * priceOf(c) }
          })
          .sort((a, b) => b.value - a.value || b.qty - a.qty),
      }
    })
    .filter((r) => r.total > 0 || r.qty > 0)
    .sort((a, b) => b.total - a.total)
  const usedValue = used.reduce((s, r) => s + r.value, 0)
  return { used, projects, usedValue, usedQty: used.reduce((s, r) => s + r.qty, 0) }
}

/** Còn hàng nhưng không xuất dùng lần nào trong kỳ */
export function idleComponents(tx, components, usedIds, startMs) {
  const lastUse = new Map()
  for (const t of tx) if (isUse(t)) lastUse.set(t.component_id, t.created_at)
  return components
    .filter((c) => !c.archived_at && c.total_quantity > 0 && !usedIds.has(c.id))
    .filter((c) => !lastUse.has(c.id) || new Date(lastUse.get(c.id)).getTime() < startMs)
    .map((c) => ({ id: c.id, part: c.part_number, name: c.name, qty: c.total_quantity, value: c.total_quantity * priceOf(c), last: lastUse.get(c.id) ?? null }))
    .sort((a, b) => b.value - a.value || b.qty - a.qty)
}

/* ------------------------------------------------------------------ */
/* Kiểm kê: các lần điều chỉnh                                          */
/* ------------------------------------------------------------------ */

/** Mỗi lần điều chỉnh trong kỳ: trước -> sau, lệch, trị giá lệch (theo đơn giá đang lưu) */
export function adjustments(tx, componentsById, startMs, endMs) {
  const rows = []
  for (const t of tx) {
    if (t.type !== 'adjust') continue
    const ms = tsOf(t)
    if (ms < startMs || ms >= endMs) continue
    const delta = Number(t.delta) || 0
    if (delta === 0) continue
    const c = componentsById.get(t.component_id)
    rows.push({
      id: t.id,
      at: t.created_at,
      componentId: t.component_id,
      part: c?.part_number ?? 'Linh kiện đã xóa',
      name: c?.name ?? '',
      locationId: t.location_id,
      before: t.quantity - delta,
      after: t.quantity,
      delta,
      value: delta * priceOf(c),
      note: t.note ?? '',
    })
  }
  rows.sort((a, b) => b.at.localeCompare(a.at))
  const loss = rows.filter((r) => r.delta < 0).reduce((s, r) => s + r.value, 0)
  const gain = rows.filter((r) => r.delta > 0).reduce((s, r) => s + r.value, 0)
  return { rows, loss, gain, net: loss + gain }
}

/* ------------------------------------------------------------------ */
/* Giá mua                                                             */
/* ------------------------------------------------------------------ */

/** Lịch sử giá mua (toàn bộ, không theo kỳ): mỗi linh kiện một dòng, kèm các lần mua cũ trước */
export function priceHistory({ tx, orders }, componentsById) {
  const ordersById = new Map(orders.map((o) => [o.id, o]))
  const map = new Map()
  for (const t of tx) {
    if (!t.is_purchase || t.type !== 'in' || t.unit_cost === null || t.unit_cost === undefined) continue
    const o = ordersById.get(t.order_id)
    const list = map.get(t.component_id) ?? []
    list.push({
      id: t.id,
      at: o ? dayMs(o.ordered_on) : tsOf(t),
      dateIso: o ? String(o.ordered_on) : isoDate(new Date(t.created_at)),
      shop: o ? o.shop || 'Chưa ghi nơi mua' : 'Nhập kho (không qua đơn)',
      order: o ? orderCode(o.code_no) : '',
      qty: t.quantity,
      price: Number(t.unit_cost),
    })
    map.set(t.component_id, list)
  }
  return [...map]
    .map(([id, buys]) => {
      buys.sort((a, b) => a.at - b.at)
      const c = componentsById.get(id)
      const prices = buys.map((b) => b.price)
      const last = buys[buys.length - 1]
      const prev = buys.length > 1 ? buys[buys.length - 2] : null
      // Nơi mua rẻ nhất (theo giá thấp nhất từng mua ở nơi đó)
      const byShop = new Map()
      for (const b of buys) byShop.set(b.shop, Math.min(byShop.get(b.shop) ?? Infinity, b.price))
      const cheapest = [...byShop].sort((a, b) => a[1] - b[1])[0]
      return {
        id,
        part: c?.part_number ?? 'Linh kiện đã xóa',
        name: c?.name ?? '',
        comp: c,
        buys,
        count: buys.length,
        qty: buys.reduce((s, b) => s + b.qty, 0),
        min: Math.min(...prices),
        max: Math.max(...prices),
        last: last.price,
        lastDate: last.dateIso,
        lastShop: last.shop,
        change: prev && prev.price > 0 ? ((last.price - prev.price) / prev.price) * 100 : null,
        cheapestShop: byShop.size > 1 ? cheapest?.[0] : null,
        current: priceOf(c),
      }
    })
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate))
}

/* ------------------------------------------------------------------ */
/* Thẻ kho của một linh kiện                                           */
/* ------------------------------------------------------------------ */

/** Tồn đầu kỳ và từng giao dịch trong kỳ kèm số tồn sau giao dịch (tổng mọi vị trí) */
export function stockCard(tx, comp, startMs, endMs) {
  const mine = tx.filter((t) => t.component_id === comp.id)
  let after = 0
  for (const t of mine) if (tsOf(t) >= startMs) after += deltaOf(t)
  const open = comp.total_quantity - after
  let running = open
  const rows = []
  for (const t of mine) {
    const ms = tsOf(t)
    if (ms < startMs || ms >= endMs) continue
    const d = deltaOf(t)
    running += d
    rows.push({ ...t, kind: kindOf(t), change: d, balance: running })
  }
  return { open, close: running, rows }
}

/** "↑ 15% so với kỳ trước" (hoặc rỗng khi không so được) */
export function compareText(cur, prev) {
  if (!(prev > 0)) return cur > 0 ? 'kỳ trước chưa có' : ''
  const pct = Math.round(((cur - prev) / prev) * 100)
  if (pct === 0) return 'bằng kỳ trước'
  return `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}% so với kỳ trước`
}
