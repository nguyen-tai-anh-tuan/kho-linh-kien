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
