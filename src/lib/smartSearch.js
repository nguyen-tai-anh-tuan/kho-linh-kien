import { normalize } from './format'

/*
 * Tìm kiếm "hiểu" giá trị linh kiện: 10k = 10kΩ = 10000 = 10 kΩ, 4k7 = 4,7k = 4700,
 * 100nF = 0,1uF = 100n, 4R7 = 4,7Ω, 1M = 1MΩ...
 * Mỗi từ gõ vào phải khớp (hoặc theo chữ, hoặc theo giá trị số), nên gõ "0805 10k" ra đúng
 * điện trở 10k chân 0805.
 */

const PREFIX = { p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, μ: 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9 }
const PREFIX_RE = '[pnuµμmkKMG]'
// Đơn vị: nhận cả chữ thường (người dùng hay gõ 5v, 100nf)
const UNIT_RE = '(?:Ω|[oO][hH][mM][sS]?|[hH][zZ]|[fFhHvVaAwWrR])'

// 4k7, 2M2, 4R7, 100n5 (kiểu ghi chữ cái thay dấu phẩy)
const INFIX = new RegExp(`^(\\d+)(${PREFIX_RE}|[rR])(\\d+)(${UNIT_RE})?$`)
// 10, 4.7, 4,7k, 100nF, 10kΩ, 45V, 0.1A, 100R
const PLAIN = new RegExp(`^(\\d+(?:[.,]\\d+)?)(${PREFIX_RE})?(${UNIT_RE})?$`)

function unitOf(u) {
  if (!u) return null
  const x = u.toLowerCase()
  if (x === 'ω' || x === 'r' || x.startsWith('ohm')) return 'ohm'
  return x // f, h, hz, v, a, w
}

/** Đọc một từ thành giá trị số. Trả về null nếu không phải dạng số. plain = số trơn, không đơn vị */
export function parseQty(token) {
  const t = String(token ?? '').trim()
  if (!t) return null
  let m = INFIX.exec(t)
  if (m) {
    const isR = m[2] === 'r' || m[2] === 'R'
    const v = Number(`${m[1]}.${m[3]}`) * (isR ? 1 : PREFIX[m[2]])
    return { v, unit: isR ? 'ohm' : unitOf(m[4]), plain: false }
  }
  m = PLAIN.exec(t)
  if (!m) return null
  const v = Number(m[1].replace(',', '.')) * (m[2] ? PREFIX[m[2]] : 1)
  if (!Number.isFinite(v)) return null
  return { v, unit: unitOf(m[3]), plain: !m[2] && !m[3] }
}

/** Tách chuỗi thành các từ; "10 kΩ" (số rồi đơn vị cách nhau) được ghép lại thành "10kΩ" */
function words(s) {
  const raw = String(s ?? '')
    .split(/[\s/;()[\]]+|,\s+/)
    .filter(Boolean)
  const out = []
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i]
    const next = raw[i + 1]
    if (/^\d+(?:[.,]\d+)?$/.test(w) && next && new RegExp(`^${PREFIX_RE}?${UNIT_RE}?$`).test(next) && next.length <= 4) {
      out.push(w + next)
      i++
    } else out.push(w)
  }
  return out
}

/** Các giá trị số có trong một chuỗi (vd tên "BC547 NPN 45V 0.1A" -> 45 V, 0,1 A) */
export function quantitiesIn(...texts) {
  const out = []
  for (const text of texts) {
    for (const w of words(text)) {
      const q = parseQty(w)
      if (q) out.push(q)
    }
  }
  return out
}

const same = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b), 1e-15)

function qtyMatch(want, have) {
  // Hai số trơn (không đơn vị) thì để so theo chữ, tránh "92" khớp với "TO-92"
  if (want.plain && have.plain) return false
  // Số trơn bắt đầu bằng 0 (vd 0805, 0603) là tên package, không phải giá trị
  if (!same(want.v, have.v)) return false
  return !want.unit || !have.unit || want.unit === have.unit
}

/** Chuẩn bị câu tìm: mỗi từ kèm dạng bỏ dấu và giá trị số (nếu có) */
export function parseQuery(q) {
  return words(q)
    .map((w) => {
      const text = normalize(w)
      const qty = /^0\d/.test(w) ? null : parseQty(w)
      return { text, qty }
    })
    .filter((t) => t.text)
}

/** entry = { text: chuỗi đã bỏ dấu, qtys: [...] } */
export function matches(entry, terms) {
  if (!terms.length) return true
  return terms.every((t) => entry.text.includes(t.text) || (t.qty && entry.qtys.some((h) => qtyMatch(t.qty, h))))
}
