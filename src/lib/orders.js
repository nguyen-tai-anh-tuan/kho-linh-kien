import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { fetchAll, friendlyError, isMissingSchema } from './api'

/**
 * Đơn hàng, chi tiêu mua hàng và khoản chi khác (sql/17_purchase_orders.sql).
 * Chưa chạy file SQL đó thì mọi chỗ dùng tới đơn hàng tự ẩn đi, web chạy như trước.
 */

/** Số mã 1, 2, 3... hiển thị thành DH-01, DH-02... */
export const orderCode = (no) => (no ? `DH-${String(no).padStart(2, '0')}` : 'DH-?')

export const ORDER_STATUS = {
  ordered: { label: 'Đã đặt', tone: 'plan', open: true },
  shipping: { label: 'Đang giao', tone: 'plan', open: true },
  partial: { label: 'Nhận một phần', tone: 'warn', open: true },
  received: { label: 'Đã nhận', tone: 'ok', open: false },
  cancelled: { label: 'Đã hủy', tone: 'muted', open: false },
}
export const isOpenOrder = (o) => Boolean(ORDER_STATUS[o?.status]?.open)

/** Gợi ý loại cho khoản chi khác (gõ loại khác cũng được) */
export const EXPENSE_KINDS = ['Đặt mạch in', 'Dụng cụ', 'Vật tư tiêu hao', 'Phí ship lẻ', 'Khác']

/** Ngày hôm nay theo giờ máy, dạng YYYY-MM-DD (cho ô chọn ngày) */
export function todayIso() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Tên miền của link nơi bán, dùng để gợi ý nơi mua (vd "lcsc.com") */
export function shopFromUrl(url) {
  try {
    return new URL(String(url).trim()).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * Database đã chạy sql/17 chưa. Hỏi một lần cho cả web; chưa có thì lần sau hỏi lại
 * (chạy SQL xong chỉ cần tải lại trang).
 */
let readyProbe = null
export function probeOrdersReady() {
  readyProbe ??= supabase
    .from('purchase_orders')
    .select('id')
    .limit(1)
    .then(({ error }) => {
      if (error) readyProbe = null
      return !error
    })
  return readyProbe
}

export function useOrdersReady() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let off = false
    probeOrdersReady().then((ok) => !off && setReady(ok))
    return () => {
      off = true
    }
  }, [])
  return ready
}

/**
 * Mọi đơn hàng kèm các món trong đơn. missing = chưa chạy sql/17.
 * rows: [{ ...đơn, lines: [...] }] mới nhất trước.
 */
export function usePurchaseOrders(version) {
  const [state, setState] = useState({ rows: null, missing: false, error: '' })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let off = false
    Promise.all([
      fetchAll(() => supabase.from('purchase_orders').select('*').order('code_no', { ascending: false })),
      fetchAll(() => supabase.from('purchase_order_lines').select('*').order('created_at').order('id')),
    ])
      .then(([orders, lines]) => {
        if (off) return
        const byOrder = new Map()
        for (const l of lines) {
          const list = byOrder.get(l.order_id) ?? []
          list.push(l)
          byOrder.set(l.order_id, list)
        }
        setState({ rows: orders.map((o) => ({ ...o, lines: byOrder.get(o.id) ?? [] })), missing: false, error: '' })
      })
      .catch((e) => {
        if (off) return
        setState({ rows: [], missing: isMissingSchema(e), error: isMissingSchema(e) ? '' : friendlyError(e) })
      })
    return () => {
      off = true
    }
  }, [version, tick])
  const refresh = useCallback(() => setTick((n) => n + 1), [])
  return { ...state, refresh }
}

/** Khoản chi khác, mới nhất trước */
export function useExpenses(version) {
  const [state, setState] = useState({ rows: null, missing: false, error: '' })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let off = false
    fetchAll(() => supabase.from('other_expenses').select('*').order('spent_on', { ascending: false }).order('created_at', { ascending: false }))
      .then((rows) => !off && setState({ rows, missing: false, error: '' }))
      .catch((e) => {
        if (off) return
        setState({ rows: [], missing: isMissingSchema(e), error: isMissingSchema(e) ? '' : friendlyError(e) })
      })
    return () => {
      off = true
    }
  }, [version, tick])
  const refresh = useCallback(() => setTick((n) => n + 1), [])
  return { ...state, refresh }
}

/** Tiền hàng của một đơn: số đặt × đơn giá (món chưa có giá thì đếm riêng) */
export function orderTotals(order) {
  let goods = 0
  let unpriced = 0
  let qty = 0
  let received = 0
  for (const l of order.lines) {
    qty += l.quantity
    received += Math.min(l.received, l.quantity)
    if (l.unit_price === null || l.unit_price === undefined) unpriced++
    else goods += Number(l.unit_price) * l.quantity
  }
  const ship = Number(order.shipping_fee) || 0
  return { goods, ship, total: goods + ship, unpriced, qty, received }
}

/** Phần còn chờ về của các đơn đang mở, theo linh kiện: Map(component_id -> { quantity, orders: [đơn] }) */
export function pendingByComponent(orders) {
  const map = new Map()
  for (const o of orders ?? []) {
    if (!isOpenOrder(o)) continue
    for (const l of o.lines) {
      const left = l.quantity - l.received
      if (!l.component_id || left <= 0) continue
      const p = map.get(l.component_id) ?? { quantity: 0, orders: [] }
      p.quantity += left
      if (!p.orders.includes(o)) p.orders.push(o)
      map.set(l.component_id, p)
    }
  }
  return map
}
