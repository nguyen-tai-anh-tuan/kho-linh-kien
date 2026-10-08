/** Lấy hết dữ liệu qua nhiều trang (Supabase mặc định chỉ trả tối đa 1000 dòng/lần). */
export async function fetchAll(buildQuery, pageSize = 1000) {
  const out = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1)
    if (error) throw error
    out.push(...data)
    if (data.length < pageSize) break
  }
  return out
}

/** Đổi lỗi kỹ thuật thành câu tiếng Việt dễ hiểu, nói rõ cách xử lý. */
export function friendlyError(error) {
  const msg = String(error?.message ?? error ?? '')
  const code = String(error?.code ?? '')
  const low = msg.toLowerCase()

  if (msg.includes('INSUFFICIENT_STOCK')) {
    const detail = error?.details ? ` (${error.details})` : ''
    return `Không đủ tồn kho để xuất${detail}. Hãy giảm số lượng hoặc kiểm tra lại vị trí.`
  }
  if (code === '23503') {
    return 'Dữ liệu này đang được dùng ở nơi khác (ví dụ linh kiện đã có lịch sử nhập/xuất) nên chưa thể xóa.'
  }
  if (code === '23505') return 'Dữ liệu bị trùng với một mục đã có.'
  if (code === '23514') return 'Giá trị nhập vào không hợp lệ (ví dụ số lượng phải lớn hơn 0).'
  if (code === '42501' || low.includes('row-level security') || low.includes('permission denied')) {
    return 'Bạn chưa có quyền thực hiện thao tác này. Hãy đăng xuất rồi đăng nhập lại.'
  }
  if (low.includes('failed to fetch') || low.includes('networkerror') || low.includes('load failed')) {
    return 'Không kết nối được máy chủ. Hãy kiểm tra mạng rồi thử lại.'
  }
  if (
    code === 'PGRST205' ||
    code === 'PGRST202' ||
    code === '42P01' ||
    code === '42703' ||
    low.includes('could not find the') ||
    low.includes('does not exist')
  ) {
    return 'Database chưa được nâng cấp. Hãy chạy file sql/02_dashboard.sql trong Supabase (SQL Editor) rồi tải lại trang.'
  }
  if (low.includes('jwt') || low.includes('not authenticated')) {
    return 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.'
  }
  return msg ? `Có lỗi xảy ra: ${msg}` : 'Có lỗi xảy ra, bạn thử lại nhé.'
}
