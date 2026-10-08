import { normalize } from './format'

/** Đọc CSV (tự nhận dấu phân cách , ; hoặc Tab, hỗ trợ ô có ngoặc kép và BOM). */
export function parseCSV(text) {
  const s = String(text).replace(/^﻿/, '')
  const firstLine = s.split(/\r?\n/, 1)[0] || ''
  const delim = [',', ';', '\t']
    .map((d) => [d, firstLine.split(d).length])
    .sort((a, b) => b[1] - a[1])[0][0]

  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cell += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === delim) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(cell)
      cell = ''
      rows.push(row)
      row = []
    } else {
      cell += ch
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

function cellOut(v) {
  if (v === null || v === undefined) return ''
  let s = String(v)
  // Chống "CSV injection": ô bắt đầu bằng = + - @ có thể bị Excel chạy như công thức
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCSV(rows) {
  return rows.map((r) => r.map(cellOut).join(',')).join('\r\n')
}

export function downloadCSV(filename, rows) {
  const blob = new Blob([`﻿${toCSV(rows)}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Các tên cột được chấp nhận (cả tiếng Việt lẫn tiếng Anh) */
export const CSV_FIELDS = {
  part_number: ['partnumber', 'mpn', 'ma', 'malinhkien', 'mahang', 'sku', 'code', 'partno'],
  name: ['name', 'ten', 'tenlinhkien'],
  category: ['category', 'loai', 'danhmuc', 'loailinhkien'],
  value: ['value', 'giatri'],
  package: ['package', 'kieuchan', 'dongoi'],
  manufacturer: ['manufacturer', 'hang', 'nhasanxuat', 'hangsanxuat', 'nsx'],
  min_stock: ['minstock', 'tontoithieu', 'toithieu', 'mucton'],
  unit_price: ['unitprice', 'price', 'gia', 'dongia'],
  datasheet_url: ['datasheeturl', 'datasheet', 'linkdatasheet'],
  notes: ['notes', 'note', 'ghichu'],
  location: ['location', 'vitri'],
  quantity: ['quantity', 'qty', 'soluong', 'ton'],
}

/** Ghép tiêu đề cột trong file với tên trường chuẩn. Trả về { field: chỉ số cột } */
export function mapHeaders(headerRow) {
  const map = {}
  headerRow.forEach((h, idx) => {
    const key = normalize(h).replace(/[^a-z0-9]/g, '')
    for (const [field, aliases] of Object.entries(CSV_FIELDS)) {
      if (map[field] === undefined && aliases.includes(key)) {
        map[field] = idx
        break
      }
    }
  })
  return map
}

/** Đổi chuỗi số kiểu "1.234,5" hoặc "1,234.5" hoặc "0,35" thành số. Trả về NaN nếu sai. */
export function parseNumber(str) {
  let s = String(str ?? '').trim().replace(/\s|đ|₫|vnd/gi, '')
  if (s === '') return NaN
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma > -1 && lastDot > -1) {
    // dấu nào đứng sau là dấu thập phân
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (lastComma > -1) {
    s = /,\d{3}$/.test(s) && s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.')
  } else if (lastDot > -1 && /^\d{1,3}(\.\d{3})+$/.test(s) && !s.startsWith('0.')) {
    // "65.000" hoặc "1.234.567": dấu chấm là dấu ngăn cách hàng nghìn (cách viết của Việt Nam)
    s = s.replace(/\./g, '')
  }
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN
}
