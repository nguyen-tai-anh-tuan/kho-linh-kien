const nf = new Intl.NumberFormat('vi-VN')
const nf1 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 })
const nf2 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 })

export const fmtNum = (n) => nf.format(Number(n) || 0)

/** Tiền rút gọn cho thẻ thống kê: 12,5 triệu, 1,2 tỷ, 850.000 đ */
export function fmtMoney(n) {
  const v = Number(n) || 0
  if (v >= 1e9) return `${nf1.format(v / 1e9)} tỷ`
  if (v >= 1e6) return `${nf1.format(v / 1e6)} triệu`
  return `${nf.format(Math.round(v))} đ`
}

export const fmtMoneyFull = (n) => `${nf.format(Math.round(Number(n) || 0))} đ`

/** Đơn giá có thể có số lẻ (vd: 0,35 đ) */
export function fmtPrice(n) {
  if (n === null || n === undefined || n === '') return '—'
  const v = Number(n)
  if (!Number.isFinite(v)) return '—'
  return `${nf2.format(v)} đ`
}

/** Bỏ dấu tiếng Việt + chữ thường, dùng để tìm kiếm không phân biệt dấu */
export function normalize(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
}

export function timeAgo(iso, now = Date.now()) {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const sec = Math.max(0, Math.round((now - t) / 1000))
  if (sec < 45) return 'vừa xong'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} phút trước`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr} giờ trước`
  const day = Math.round(hr / 24)
  if (day === 1) return 'hôm qua'
  if (day < 7) return `${day} ngày trước`
  return fmtDate(iso)
}

export function fmtDate(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function fmtDateTime(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** 'YYYY-MM-DD' -> 'dd/mm' */
export function fmtDay(isoDate) {
  const [, m, d] = String(isoDate).split('-')
  return d && m ? `${d}/${m}` : String(isoDate)
}

export function greeting(date = new Date()) {
  const h = date.getHours()
  if (h < 11) return 'Chào buổi sáng'
  if (h < 13) return 'Chào buổi trưa'
  if (h < 18) return 'Chào buổi chiều'
  return 'Chào buổi tối'
}

/** Chỉ cho phép http/https để tránh link độc hại (javascript:...) */
export function safeUrl(u) {
  if (!u) return null
  try {
    const x = new URL(String(u).trim())
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null
  } catch {
    return null
  }
}
