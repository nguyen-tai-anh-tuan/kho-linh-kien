import { supabase } from '../supabaseClient'
import { fetchAll, isMissingSchema } from './api'

const BASE = 'id,project_id,component_id,quantity'

/**
 * Mọi dòng BOM. tracked = database đã có cột "issued" (đã chạy sql/11_bom_issued.sql),
 * tức là web nhớ được mỗi dòng đã xuất kho bao nhiêu. Chưa có thì coi như chưa xuất gì.
 */
export async function fetchBomLines() {
  try {
    const rows = await fetchAll(() => supabase.from('project_bom').select(`${BASE},issued`).order('id'))
    return { rows, tracked: true }
  } catch (e) {
    // Thiếu cả bảng thì báo lên để trang Dự án nhắc chạy file SQL; chỉ thiếu cột thì đọc kiểu cũ
    if (isMissingSchema(e)) throw e
    const rows = await fetchAll(() => supabase.from('project_bom').select(BASE).order('id'))
    return { rows: rows.map((r) => ({ ...r, issued: 0 })), tracked: false }
  }
}

/**
 * Trả linh kiện đã xuất cho một dự án về kho: ghi các giao dịch nhập vào đúng những vị trí
 * đã lấy hàng ra (lần xuất gần nhất trước). Phần không dò được trong lịch sử thì trả về fallbackLocationId.
 * Trả về các giao dịch đã ghi, hoặc null nếu không biết trả về vị trí nào.
 */
export async function returnToStock({ projectId, componentId, quantity, note, fallbackLocationId }) {
  const { data: outs, error } = await supabase
    .from('transactions')
    .select('location_id,quantity')
    .eq('project_id', projectId)
    .eq('component_id', componentId)
    .eq('type', 'out')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error

  const back = new Map()
  let left = quantity
  for (const t of outs) {
    if (left <= 0) break
    const take = Math.min(t.quantity, left)
    back.set(t.location_id, (back.get(t.location_id) ?? 0) + take)
    left -= take
  }
  if (left > 0) {
    const target = outs[0]?.location_id ?? fallbackLocationId
    if (!target) return null
    back.set(target, (back.get(target) ?? 0) + left)
  }

  const rows = [...back].map(([location_id, qty]) => ({
    component_id: componentId,
    location_id,
    type: 'in',
    quantity: qty,
    project_id: projectId,
    note,
  }))
  const res = await supabase.from('transactions').insert(rows).select('id,component_id,location_id,type,quantity,delta')
  if (res.error) throw res.error
  return res.data
}
