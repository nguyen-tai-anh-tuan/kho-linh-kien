import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { fetchAll, friendlyError } from '../lib/api'

/*
 * Lịch sử nhập / xuất / kiểm kê gọn của từng linh kiện, dùng cho trang Linh kiện:
 * lọc "mới nhập", "mới xuất", "lâu không dùng" và cột "Hoạt động gần nhất".
 * Chỉ ĐỌC bảng transactions (đã có sẵn), không cần chạy thêm SQL.
 * Tải lại mỗi khi dữ liệu kho được tải lại (version đổi), ví dụ sau một lần nhập / xuất.
 */

/**
 * byComponent: Map id -> [{ t, type, quantity, delta, from?, to? }] xếp từ mới tới cũ (type 'move' = chuyển vị trí).
 * at: mốc "bây giờ" lúc tải xong, dùng để tính "7 ngày qua", "2 ngày trước"...
 */
export function useActivity(version) {
  const [state, setState] = useState(() => ({ status: 'loading', byComponent: new Map(), error: null, at: Date.now() }))

  useEffect(() => {
    let alive = true
    // Các lần chuyển vị trí (sql/19_move_stock.sql). Chưa chạy file đó thì coi như không có.
    const movesQuery = fetchAll(() =>
      supabase
        .from('stock_moves')
        .select('id,component_id,quantity,from_location_id,to_location_id,created_at')
        .order('created_at', { ascending: false })
        .order('id'),
    ).catch(() => [])
    Promise.all([
      fetchAll(() =>
        supabase
          .from('transactions')
          .select('id,component_id,type,quantity,delta,created_at')
          .order('created_at', { ascending: false })
          .order('id'),
      ),
      movesQuery,
    ])
      .then(([rows, moveRows]) => {
        if (!alive) return
        const byComponent = new Map()
        const push = (componentId, e) => {
          if (!Number.isFinite(e.t)) return
          const list = byComponent.get(componentId) ?? []
          list.push(e)
          byComponent.set(componentId, list)
        }
        for (const r of rows) {
          push(r.component_id, { t: new Date(r.created_at).getTime(), type: r.type, quantity: r.quantity, delta: r.delta })
        }
        for (const m of moveRows) {
          push(m.component_id, {
            t: new Date(m.created_at).getTime(),
            type: 'move',
            quantity: m.quantity,
            from: m.from_location_id,
            to: m.to_location_id,
          })
        }
        if (moveRows.length) for (const list of byComponent.values()) list.sort((x, y) => y.t - x.t)
        setState({ status: 'ready', byComponent, error: null, at: Date.now() })
      })
      .catch((err) => {
        if (!alive) return
        // Giữ dữ liệu cũ (nếu có) để bảng không bị trống chỉ vì một lần tải lỗi
        setState((s) => ({ ...s, status: s.byComponent.size ? 'ready' : 'error', error: friendlyError(err), at: Date.now() }))
      })
    return () => {
      alive = false
    }
  }, [version])

  return state
}

/** Lần gần nhất có loại giao dịch types trong khoảng [from, to] (mốc thời gian ms). Không có thì null */
export function lastEvent(list, types, from = -Infinity, to = Infinity) {
  if (!list) return null
  for (const e of list) {
    if (e.t > to) continue
    if (e.t < from) return null // danh sách xếp mới -> cũ, đã qua khỏi khoảng
    if (!types || types.includes(e.type)) return e
  }
  return null
}

/** Tổng số lượng của loại giao dịch type trong khoảng [from, to] */
export function sumEvents(list, type, from = -Infinity, to = Infinity) {
  let n = 0
  for (const e of list ?? []) {
    if (e.t > to) continue
    if (e.t < from) break
    if (e.type === type) n += Number(e.quantity) || 0
  }
  return n
}
