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

/* ---------------------------------------------------------------------
   Nơi lưu phiên đăng nhập.
   - 'tab'   : mỗi tab một phiên riêng (sessionStorage). Mở nhiều tab với nhiều tài khoản được,
               đăng xuất tab này không ảnh hưởng tab khác. Đóng tab là hết phiên.
   - 'shared': một phiên dùng chung cho mọi tab và còn sau khi đóng trình duyệt (localStorage),
               dành cho người tick "Giữ đăng nhập" lúc đăng nhập.
   Chế độ được chọn lúc tải trang và không đổi cho tới lần tải lại kế tiếp.
   --------------------------------------------------------------------- */
const SHARED_KEY = 'kho-auth-shared'
const MODE_KEY = 'kho_auth_mode'
const TAB_KEY = 'kho_tab_id'

function pickAuthStore() {
  try {
    // Bản cũ lưu phiên chung dưới tên mặc định của Supabase: bỏ đi để mọi người đăng nhập lại theo cách mới
    const ref = new URL(import.meta.env.VITE_SUPABASE_URL).hostname.split('.')[0]
    localStorage.removeItem(`sb-${ref}-auth-token`)

    let mode = sessionStorage.getItem(MODE_KEY)
    // Link đặt lại mật khẩu luôn mở phiên riêng, để không đè lên phiên dùng chung của các tab khác
    if (authLanding.recovery) mode = 'tab'
    if (mode !== 'tab' && mode !== 'shared') mode = localStorage.getItem(SHARED_KEY) ? 'shared' : 'tab'
    sessionStorage.setItem(MODE_KEY, mode)
    if (mode === 'shared') return { mode, storage: localStorage, storageKey: SHARED_KEY, tabId: null }

    let tabId = sessionStorage.getItem(TAB_KEY)
    if (!tabId) {
      tabId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
      sessionStorage.setItem(TAB_KEY, tabId)
    }
    return { mode, storage: sessionStorage, storageKey: `kho-auth-tab-${tabId}`, tabId }
  } catch {
    // Trình duyệt chặn lưu trữ: để Supabase tự xoay xở như mặc định
    return { mode: 'shared', storage: undefined, storageKey: undefined, tabId: null }
  }
}

const store = pickAuthStore()

/** Chế độ lưu phiên của tab này: 'tab' hoặc 'shared' */
export const authMode = store.mode

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
  auth: { storage: store.storage, storageKey: store.storageKey },
})

/** Đăng xuất chỉ phiên của tab này; các tab và thiết bị khác đang dùng cùng tài khoản không bị ảnh hưởng */
export const signOutHere = () => supabase.auth.signOut({ scope: 'local' })

/**
 * Chuyển phiên vừa đăng nhập sang chế độ người dùng chọn ("Giữ đăng nhập" hay không).
 * Trả về true nếu đã chuyển: khi đó phải tải lại trang để client dùng nơi lưu mới.
 */
export function moveSessionTo(mode) {
  if (mode === authMode || !store.storage) return false
  try {
    const target = mode === 'shared' ? localStorage : sessionStorage
    let targetKey = SHARED_KEY
    if (mode === 'tab') {
      const tabId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
      sessionStorage.setItem(TAB_KEY, tabId)
      targetKey = `kho-auth-tab-${tabId}`
    }
    const raw = store.storage.getItem(store.storageKey)
    if (!raw) return false
    target.setItem(targetKey, raw)
    store.storage.removeItem(store.storageKey)
    sessionStorage.setItem(MODE_KEY, mode)
    return true
  } catch {
    return false
  }
}

/**
 * Gọi sau khi đăng xuất để lần tải trang tới chọn lại chế độ từ đầu.
 * Trả về true nếu tab đang ở chế độ dùng chung: khi đó cần tải lại trang ngay,
 * để lần đăng nhập kế tiếp ở tab này không tự kéo các tab khác đăng nhập theo.
 */
export function resetAfterSignOut() {
  try {
    sessionStorage.removeItem(MODE_KEY)
    if (authMode === 'shared' && store.storage) {
      localStorage.removeItem(SHARED_KEY)
      return true
    }
  } catch {
    /* bỏ qua */
  }
  return false
}

// Tab được nhân bản (Duplicate tab) mang theo bản sao phiên của tab gốc. Hai tab giữ chung một phiên
// trong hai nơi lưu tách biệt sẽ làm nhau bị đăng xuất khi phiên được gia hạn, nên bản sao phải đăng nhập lại.
if (store.mode === 'tab' && store.tabId && 'BroadcastChannel' in globalThis) {
  const channel = new BroadcastChannel(`kho-tab-${store.tabId}`)
  channel.onmessage = (e) => {
    if (e.data === 'hello') channel.postMessage('taken')
    else if (e.data === 'taken') {
      try {
        sessionStorage.removeItem(store.storageKey)
        sessionStorage.removeItem(TAB_KEY)
        sessionStorage.removeItem(MODE_KEY)
      } catch {
        /* bỏ qua */
      }
      window.location.reload()
    }
  }
  channel.postMessage('hello')
}
