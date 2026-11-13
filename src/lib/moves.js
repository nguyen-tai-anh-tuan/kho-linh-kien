import { supabase } from '../supabaseClient'
import { mustChange } from './api'

/*
 * Chuyển vị trí và chỗ cất mặc định (sql/19_move_stock.sql).
 * Chuyển vị trí không phải nhập hay xuất: tổng tồn giữ nguyên, Báo cáo không bị ảnh hưởng.
 */

/** moves: [{ component_id, from_location_id, to_location_id, quantity }] */
export async function moveStock(moves, note) {
  const { data, error } = await supabase.rpc('move_stock', { p_moves: moves, p_note: note?.trim() || null })
  if (error) throw error
  return data
}

/** Đặt chỗ cất mặc định cho nhiều linh kiện. locationId = null là bỏ gán */
export async function setHome(componentIds, locationId) {
  if (!componentIds.length) return
  mustChange(
    await supabase.from('components').update({ home_location_id: locationId }).in('id', componentIds).select('id'),
  )
}
