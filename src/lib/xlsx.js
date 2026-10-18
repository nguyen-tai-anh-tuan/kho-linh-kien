import { safeUrl } from './format'

/**
 * Xuất file Excel (.xlsx) có định dạng sẵn: tiêu đề, hàng tên cột tô màu và cố định khi cuộn,
 * bộ lọc ở từng cột, số có dấu phân cách, tiền có "đ", dòng kẻ xen màu và dòng tổng cộng.
 * Thư viện exceljs khá nặng nên chỉ tải khi người dùng bấm xuất.
 *
 * columns: [{ header, value: (row) => giá trị, type, width, wrap, tone: (row) => 'ok' | 'warn' | 'danger', total }]
 *   type: 'text' (mặc định) | 'int' | 'money' | 'link'
 *   total: true thì cộng cột này ở dòng "Tổng cộng" (cột int / money)
 * rows: dữ liệu gốc. Dòng { group: 'Tên nhóm' } là dòng tiêu đề nhóm, kéo dài hết bảng.
 */
export async function downloadXlsx({ filename, title, subtitle, sheet = 'Dữ liệu', columns, rows }) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Kho Linh Kiện'
  wb.created = new Date()
  const ws = wb.addWorksheet(sheet.slice(0, 31), {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  })

  const n = columns.length
  const C = {
    brand: 'FF0D9488',
    brandDark: 'FF0A6F66',
    head: 'FFFFFFFF',
    zebra: 'FFF3FAF9',
    group: 'FFE3F4F1',
    line: 'FFD9E5E3',
    muted: 'FF5B6B70',
    total: 'FFFFF6DD',
    tone: { ok: 'FF0F8A47', warn: 'FFA35F00', danger: 'FFD6343A' },
  }
  const FMT = { int: '#,##0', money: '#,##0" đ"' }
  ws.columns = columns.map((c) => ({ width: c.width ?? 14 }))

  // 1) Tiêu đề và dòng mô tả
  const dataCount = rows.filter((r) => !r.group).length
  const stamp = new Date().toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
  ws.mergeCells(1, 1, 1, n)
  Object.assign(ws.getCell(1, 1), { value: title })
  ws.getCell(1, 1).font = { size: 15, bold: true, color: { argb: C.brandDark } }
  ws.getRow(1).height = 26
  ws.mergeCells(2, 1, 2, n)
  ws.getCell(2, 1).value = [subtitle, `Xuất lúc ${stamp}`, `${dataCount.toLocaleString('vi-VN')} dòng`].filter(Boolean).join('  ·  ')
  ws.getCell(2, 1).font = { italic: true, size: 10, color: { argb: C.muted } }

  // 2) Hàng tên cột
  const HEAD = 4
  const head = ws.getRow(HEAD)
  columns.forEach((c, i) => {
    const cell = head.getCell(i + 1)
    cell.value = c.header
    cell.font = { bold: true, color: { argb: C.head } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.brand } }
    cell.alignment = { vertical: 'middle', horizontal: c.type === 'int' || c.type === 'money' ? 'right' : 'left', wrapText: true }
    cell.border = { bottom: { style: 'thin', color: { argb: C.brandDark } } }
  })
  head.height = 30

  // 3) Dữ liệu
  let r = HEAD
  let stripe = 0
  for (const row of rows) {
    r++
    const xr = ws.getRow(r)
    if (row.group) {
      ws.mergeCells(r, 1, r, n)
      const cell = xr.getCell(1)
      cell.value = row.group
      cell.font = { bold: true, color: { argb: C.brandDark } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.group } }
      xr.height = 20
      stripe = 0
      continue
    }
    stripe++
    columns.forEach((c, i) => {
      const cell = xr.getCell(i + 1)
      let v = c.value(row)
      if (v === undefined || v === '') v = null
      if ((c.type === 'int' || c.type === 'money') && v !== null) v = Number(v)
      if (c.type === 'link' && v) {
        const url = safeUrl(v)
        cell.value = url ? { text: c.linkText ?? url, hyperlink: url } : v
        if (url) cell.font = { color: { argb: 'FF2A6FC9' }, underline: true }
      } else {
        cell.value = v
      }
      if (FMT[c.type]) cell.numFmt = FMT[c.type]
      cell.alignment = {
        vertical: 'top',
        horizontal: c.type === 'int' || c.type === 'money' ? 'right' : 'left',
        wrapText: Boolean(c.wrap),
      }
      const tone = c.tone?.(row)
      if (tone) cell.font = { bold: true, color: { argb: C.tone[tone] } }
      if (stripe % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.zebra } }
      cell.border = { bottom: { style: 'hair', color: { argb: C.line } } }
    })
  }
  const lastData = r

  // 4) Dòng tổng cộng
  if (columns.some((c) => c.total) && lastData > HEAD) {
    r++
    const xr = ws.getRow(r)
    const firstTotal = columns.findIndex((c) => c.total)
    columns.forEach((c, i) => {
      const cell = xr.getCell(i + 1)
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.total } }
      cell.border = { top: { style: 'thin', color: { argb: C.brandDark } } }
      cell.font = { bold: true }
      if (c.total) {
        const sum = rows.reduce((acc, row) => (row.group ? acc : acc + (Number(c.value(row)) || 0)), 0)
        cell.value = sum
        cell.numFmt = FMT[c.type] ?? FMT.int
        cell.alignment = { horizontal: 'right' }
      }
    })
    xr.getCell(1).value = firstTotal === 0 ? xr.getCell(1).value : 'Tổng cộng'
    xr.height = 20
  }

  // 5) Cố định hàng tên cột khi cuộn, bật bộ lọc
  ws.views = [{ state: 'frozen', ySplit: HEAD, showGridLines: false }]
  if (lastData > HEAD) ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: lastData, column: n } }

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Tình trạng tồn kho: chữ và màu trong file Excel */
const STOCK = { ok: ['Còn hàng', 'ok'], low: ['Sắp hết', 'warn'], out: ['Hết hàng', 'danger'] }
export const stockText = (status) => STOCK[status]?.[0] ?? ''
export const stockTone = (status) => STOCK[status]?.[1]

/** Tên file kèm ngày: "kho-linh-kien-2026-10-18.xlsx" */
export const datedName = (base) => `${base}-${new Date().toISOString().slice(0, 10)}.xlsx`
