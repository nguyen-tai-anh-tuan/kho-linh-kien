export const MIN_PASSWORD = 6
export const RESET_COOLDOWN = 60 // giây phải đợi giữa hai lần gửi email đặt lại mật khẩu

const RECOVERY_KEY = 'kho_recovery'
const RESET_SENT_KEY = 'kho_reset_sent_at'

/** Chấm mật khẩu mới: chỉ điều kiện đầu là bắt buộc, hai điều kiện sau để mật khẩu khó đoán hơn */
export function checkPassword(password) {
  const long = password.length >= MIN_PASSWORD
  const mixed = /\p{L}/u.test(password) && /\d/.test(password)
  const extra = password.length >= 10 || /[^\p{L}\d\s]/u.test(password)
  const rules = [
    { key: 'long', met: long, text: `Ít nhất ${MIN_PASSWORD} ký tự` },
    { key: 'mixed', met: mixed, text: 'Nên có cả chữ và số' },
    { key: 'extra', met: extra, text: 'Nên dài từ 10 ký tự hoặc có ký tự đặc biệt' },
  ]
  const score = password === '' ? 0 : long ? 1 + Number(mixed) + Number(extra) : 1
  const label = password === '' ? '' : long ? ['', 'Yếu', 'Khá', 'Mạnh'][score] : 'Quá ngắn'
  return { rules, score, label, valid: long }
}

/** Lỗi của cặp ô "mật khẩu mới" và "nhập lại". Trả về { password, confirm }, chuỗi rỗng là hợp lệ. */
export function passwordProblems(password, confirm) {
  return {
    password: password.length < MIN_PASSWORD ? `Mật khẩu cần có ít nhất ${MIN_PASSWORD} ký tự.` : '',
    confirm: confirm === '' ? 'Hãy nhập lại mật khẩu mới.' : confirm !== password ? 'Hai mật khẩu chưa khớp nhau.' : '',
  }
}

/** Đổi lỗi đăng nhập của Supabase thành câu tiếng Việt dễ hiểu */
export function translateAuthError(error) {
  const message = String(error?.message ?? error ?? '')
  const code = String(error?.code ?? '')
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Sai email hoặc mật khẩu. Bạn kiểm tra lại nhé.'
  if (m.includes('email not confirmed')) return 'Tài khoản này chưa được xác nhận email.'
  if (code === 'same_password' || m.includes('different from the old password')) {
    return 'Mật khẩu mới phải khác mật khẩu đang dùng.'
  }
  if (code === 'weak_password' || m.includes('weak password')) {
    return 'Mật khẩu này quá dễ đoán. Hãy chọn mật khẩu dài hơn, có cả chữ và số.'
  }
  if (code === 'over_email_send_rate_limit' || m.includes('security purposes')) {
    return 'Bạn vừa yêu cầu gửi email. Vui lòng đợi khoảng một phút rồi thử lại.'
  }
  if (m.includes('rate limit') || m.includes('too many')) {
    return 'Bạn thử quá nhiều lần, vui lòng đợi một lúc rồi thử lại.'
  }
  if (code === 'session_not_found' || m.includes('session missing') || m.includes('jwt')) {
    return 'Phiên làm việc đã hết hạn. Hãy yêu cầu link mới hoặc đăng nhập lại.'
  }
  if (m.includes('failed to fetch') || m.includes('network')) return 'Không kết nối được máy chủ. Hãy kiểm tra mạng của bạn.'
  return `Có lỗi xảy ra: ${message}`
}

/* ---- Đang ở giữa bước đặt lại mật khẩu: nhớ lại để tải lại trang không bị bỏ qua bước này ---- */
export function isRecoveryPending() {
  try {
    return localStorage.getItem(RECOVERY_KEY) === '1'
  } catch {
    return false
  }
}

export function setRecoveryPending(on) {
  try {
    if (on) localStorage.setItem(RECOVERY_KEY, '1')
    else localStorage.removeItem(RECOVERY_KEY)
  } catch {
    /* bỏ qua nếu trình duyệt chặn lưu */
  }
}

/* ---- Đếm ngược giữa hai lần gửi email ---- */
export function markResetSent() {
  try {
    sessionStorage.setItem(RESET_SENT_KEY, String(Date.now()))
  } catch {
    /* bỏ qua */
  }
}

export function resetCooldownLeft() {
  try {
    const sent = Number(sessionStorage.getItem(RESET_SENT_KEY)) || 0
    return Math.max(0, Math.ceil(RESET_COOLDOWN - (Date.now() - sent) / 1000))
  } catch {
    return 0
  }
}
