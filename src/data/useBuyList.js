import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { fetchAll } from '../lib/api'
import { useData } from './DataContext'

/**
 * Số lượng nên mua: đủ để về lại mức tối thiểu VÀ đủ lắp mỗi dự án một bộ (lấy số lớn hơn).
 * Hết hàng mà không có yêu cầu nào thì gợi ý mua ít nhất 1.
 */
const needOf = (c, bom) => Math.max(c.shortage ?? 0, bom?.short ?? 0, 1)

/**
 * Danh sách cần mua, dùng chung cho trang Cần mua, thẻ ở Tổng quan và con số trên thanh bên:
 * linh kiện hết hàng, dưới mức tối thiểu, hoặc không đủ cho BOM của các dự án.
 * refreshKey đổi thì tải lại BOM (BOM được sửa ở trang Dự án mà không tải lại cả kho).
 */
export function useBuyList(refreshKey) {
  const { components, projects, version } = useData()
  const [bomLines, setBomLines] = useState([])

  useEffect(() => {
    let off = false
    fetchAll(() => supabase.from('project_bom').select('id,project_id,component_id,quantity').order('id'))
      .then((rows) => !off && setBomLines(rows))
      .catch(() => !off && setBomLines([])) // chưa có bảng BOM thì chỉ tính theo mức tối thiểu
    return () => {
      off = true
    }
  }, [version, refreshKey])

  // Với mỗi linh kiện: tổng số cần để lắp mỗi dự án một bộ, và còn thiếu bao nhiêu so với tồn kho
  const bomByComponent = useMemo(() => {
    const byId = new Map(projects.map((p) => [p.id, p]))
    const map = new Map()
    for (const l of bomLines) {
      if (!byId.has(l.project_id)) continue
      const item = map.get(l.component_id) ?? { total: 0, short: 0, uses: [] }
      item.total += Number(l.quantity) || 0
      item.uses.push({ project: byId.get(l.project_id), quantity: Number(l.quantity) || 0 })
      map.set(l.component_id, item)
    }
    for (const c of components) {
      const item = map.get(c.id)
      if (item) item.short = Math.max(0, item.total - c.total_quantity)
    }
    return map
  }, [bomLines, projects, components])

  // Hết hàng xếp trước, rồi tới món thiếu nhiều nhất
  const toBuy = useMemo(
    () =>
      components
        .filter((c) => c.status !== 'ok' || (bomByComponent.get(c.id)?.short ?? 0) > 0)
        .sort(
          (a, b) =>
            (a.status === 'out' ? 0 : 1) - (b.status === 'out' ? 0 : 1) ||
            needOf(b, bomByComponent.get(b.id)) - needOf(a, bomByComponent.get(a.id)) ||
            a.part_number.localeCompare(b.part_number, 'vi', { numeric: true }),
        ),
    [components, bomByComponent],
  )

  const need = useCallback((c) => needOf(c, bomByComponent.get(c.id)), [bomByComponent])
  return { bomByComponent, toBuy, need }
}
