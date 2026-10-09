import { createClient } from '@supabase/supabase-js'

/**
 * Đọc kết quả mà link trong email mang về, TRƯỚC khi tạo client (Supabase sẽ xóa phần #... khỏi thanh địa chỉ).
 *  - linkError: link đặt lại mật khẩu đã hết hạn hoặc đã dùng rồi
 *  - recovery : link hợp lệ, người dùng cần đặt mật khẩu mới
 */
function readAuthLanding() {
  try {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const query = new URLSearchParams(window.location.search)
    const linkError = ['error_code', 'error_description'].some((k) => hash.has(k) || query.has(k))
    // Dọn lỗi khỏi địa chỉ để tải lại trang không báo lỗi lần nữa
    if (linkError) window.history.replaceState(null, '', window.location.pathname)
    return { linkError, recovery: !linkError && hash.get('type') === 'recovery' }
  } catch {
    return { linkError: false, recovery: false }
  }
}

export const authLanding = readAuthLanding()

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
