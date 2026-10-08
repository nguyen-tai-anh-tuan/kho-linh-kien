import { useRef, useState } from 'react'
import { FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { supabase } from './supabaseClient'
import { useData } from './data/DataContext'
import { useToast } from './ui/Toast'
import { Modal } from './ui/Modal'
import { downloadCSV, mapHeaders, parseCSV, parseNumber } from './lib/csv'
import { friendlyError } from './lib/api'
import { fmtNum, normalize, safeUrl } from './lib/format'

const MAX_BYTES = 2 * 1024 * 1024
const MAX_ROWS = 2000

const TEMPLATE = [
  ['part_number', 'name', 'category', 'value', 'package', 'manufacturer', 'min_stock', 'unit_price', 'location', 'quantity', 'datasheet_url', 'notes'],
  ['ESP32-WROOM-32', 'ESP32 module', 'MCU', '', 'Module', 'Espressif', '5', '65000', 'Tủ A', '10', '', ''],
  ['RC0603FR-0710KL', 'Điện trở 10k 1%', 'Điện trở', '10k', '0603', 'Yageo', '200', '0.35', 'Tủ B', '500', '', 'Cuộn 5000 cái'],
]

/** Đọc và kiểm tra file CSV, chưa ghi gì vào database */
export function analyzeCsv(text, existingComponents) {
  const rows = parseCSV(text)
  if (rows.length < 2) return { fatal: 'File chưa có dòng dữ liệu nào. Hãy dùng file mẫu để tham khảo.' }
  if (rows.length - 1 > MAX_ROWS) return { fatal: `File có hơn ${fmtNum(MAX_ROWS)} dòng. Hãy chia nhỏ file rồi nhập từng phần.` }
  const map = mapHeaders(rows[0])
  if (map.part_number === undefined || map.name === undefined) {
    return {
      fatal: 'Không thấy cột mã linh kiện (part_number) và tên (name) ở dòng đầu tiên. Hãy dùng file mẫu để tham khảo.',
    }
  }

  const seen = new Set(existingComponents.map((c) => normalize(c.part_number)))
  const items = []
  const errors = []
  let duplicates = 0

  rows.slice(1).forEach((r, i) => {
    const line = i + 2
    const get = (field) => (map[field] === undefined ? '' : String(r[map[field]] ?? '').trim())
    const part = get('part_number')
    const name = get('name')
    if (!part && !name) return
    if (!part || !name) {
      errors.push(`Dòng ${line}: thiếu mã hoặc tên.`)
      return
    }
    const key = normalize(part)
    if (seen.has(key)) {
      duplicates++
      return
    }
    const min = get('min_stock') === '' ? 0 : parseNumber(get('min_stock'))
    if (!Number.isInteger(min) || min < 0) {
      errors.push(`Dòng ${line}: tồn tối thiểu "${get('min_stock')}" không hợp lệ.`)
      return
    }
    const price = get('unit_price') === '' ? null : parseNumber(get('unit_price'))
    if (price !== null && (Number.isNaN(price) || price < 0)) {
      errors.push(`Dòng ${line}: đơn giá "${get('unit_price')}" không hợp lệ.`)
      return
    }
    const qty = get('quantity') === '' ? 0 : parseNumber(get('quantity'))
    if (!Number.isInteger(qty) || qty < 0) {
      errors.push(`Dòng ${line}: số lượng "${get('quantity')}" không hợp lệ.`)
      return
    }
    if (qty > 0 && !get('location')) {
      errors.push(`Dòng ${line}: có số lượng nhưng chưa ghi vị trí.`)
      return
    }
    if (get('datasheet_url') && !safeUrl(get('datasheet_url'))) {
      errors.push(`Dòng ${line}: link datasheet phải bắt đầu bằng http:// hoặc https://`)
      return
    }
    seen.add(key)
    items.push({
      line,
      part_number: part,
      name,
      category: get('category'),
      value: get('value'),
      package: get('package'),
      manufacturer: get('manufacturer'),
      min_stock: min,
      unit_price: price,
      datasheet_url: get('datasheet_url'),
      notes: get('notes'),
      location: get('location'),
      quantity: qty,
    })
  })

  return { items, errors, duplicates, total: rows.length - 1 }
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))

export default function ImportCsvModal({ onClose }) {
  const { components, categories, locations, reload } = useData()
  const toast = useToast()
  const inputRef = useRef(null)
  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // cho phép chọn lại đúng file này sau khi sửa
    if (!file) return
    setError('')
    setResult(null)
    setFileName(file.name)
    if (file.size > MAX_BYTES) return setResult({ fatal: 'File lớn hơn 2 MB. Hãy chia nhỏ file rồi nhập từng phần.' })
    const text = await file.text()
    setResult(analyzeCsv(text, components))
  }

  async function run() {
    const { items } = result
    setBusy(true)
    setError('')
    try {
      // 1) Tạo các loại mới
      const catIds = new Map(categories.map((c) => [normalize(c.name), c.id]))
      const newCats = new Map()
      items.forEach((it) => {
        if (it.category && !catIds.has(normalize(it.category))) newCats.set(normalize(it.category), it.category)
      })
      if (newCats.size) {
        const { data, error: err } = await supabase
          .from('categories')
          .insert([...newCats.values()].map((name) => ({ name })))
          .select('id,name')
        if (err) throw err
        data.forEach((c) => catIds.set(normalize(c.name), c.id))
      }

      // 2) Tạo các vị trí mới (khớp theo đường dẫn đầy đủ hoặc theo tên)
      const locIds = new Map()
      locations.forEach((l) => {
        locIds.set(normalize(l.path), l.id)
        if (!locIds.has(normalize(l.name))) locIds.set(normalize(l.name), l.id)
      })
      const newLocs = new Map()
      items.forEach((it) => {
        if (it.quantity > 0 && !locIds.has(normalize(it.location))) newLocs.set(normalize(it.location), it.location)
      })
      if (newLocs.size) {
        const { data, error: err } = await supabase
          .from('locations')
          .insert([...newLocs.values()].map((name) => ({ name })))
          .select('id,name')
        if (err) throw err
        data.forEach((l) => locIds.set(normalize(l.name), l.id))
      }

      // 3) Thêm linh kiện (theo từng đợt 200 dòng)
      const created = []
      for (const part of chunk(items, 200)) {
        const { data, error: err } = await supabase
          .from('components')
          .insert(
            part.map((it) => ({
              part_number: it.part_number,
              name: it.name,
              category_id: it.category ? catIds.get(normalize(it.category)) : null,
              value: it.value || null,
              package: it.package || null,
              manufacturer: it.manufacturer || null,
              min_stock: it.min_stock,
              unit_price: it.unit_price,
              datasheet_url: it.datasheet_url || null,
              notes: it.notes || null,
            })),
          )
          .select('id')
        if (err) throw err
        if (data.length !== part.length) throw new Error('Số dòng được tạo không khớp với file.')
        data.forEach((row, i) => created.push({ id: row.id, item: part[i] }))
      }

      // 4) Nhập số lượng ban đầu
      const txRows = created
        .filter(({ item }) => item.quantity > 0)
        .map(({ id, item }) => ({
          component_id: id,
          location_id: locIds.get(normalize(item.location)),
          type: 'in',
          quantity: item.quantity,
          note: 'Nhập từ file CSV',
        }))
      for (const part of chunk(txRows, 500)) {
        const { error: err } = await supabase.from('transactions').insert(part)
        if (err) throw err
      }

      await reload()
      toast.push({ message: `Đã nhập ${fmtNum(created.length)} linh kiện từ file CSV.` })
      onClose()
    } catch (err) {
      await reload()
      setError(
        `${friendlyError(err)} Một số dòng có thể đã được thêm. Bạn có thể chọn lại file này, các mã đã có sẽ tự được bỏ qua.`,
      )
      setBusy(false)
    }
  }

  const ready = result && !result.fatal && result.items.length > 0

  return (
    <Modal
      title="Nhập linh kiện từ CSV"
      subtitle="Thêm hàng loạt từ file Excel hoặc Google Sheets đã lưu dạng CSV."
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="kk-btn kk-btn-ghost" onClick={onClose}>
            Hủy
          </button>
          <button type="button" className="kk-btn kk-btn-primary" onClick={run} disabled={!ready || busy}>
            {busy ? <Loader2 size={18} className="kk-spin" /> : <Upload size={18} />}
            {busy ? 'Đang nhập…' : ready ? `Nhập ${fmtNum(result.items.length)} linh kiện` : 'Nhập linh kiện'}
          </button>
        </>
      }
    >
      <div className="kk-import">
        <p className="kk-explain">
          Dòng đầu tiên là tên cột. Bắt buộc có <b>part_number</b> (mã) và <b>name</b> (tên). Các cột khác không bắt buộc: category, value,
          package, manufacturer, min_stock, unit_price, location, quantity, datasheet_url, notes. Mã đã có trong kho sẽ được bỏ qua.
        </p>
        <div className="kk-import-actions">
          <input ref={inputRef} type="file" accept=".csv,.txt,text/csv" onChange={onFile} className="kk-file" aria-label="Chọn file CSV" />
          <button type="button" className="kk-btn kk-btn-outline" onClick={() => inputRef.current?.click()}>
            <FileSpreadsheet size={18} />
            {fileName || 'Chọn file CSV'}
          </button>
          <button type="button" className="kk-link" onClick={() => downloadCSV('mau-nhap-linh-kien.csv', TEMPLATE)}>
            Tải file mẫu
          </button>
        </div>

        {result?.fatal && (
          <p className="kk-form-error" role="alert">
            {result.fatal}
          </p>
        )}

        {result && !result.fatal && (
          <div className="kk-import-summary">
            <ul>
              <li>
                <strong>{fmtNum(result.items.length)}</strong> linh kiện sẵn sàng để nhập
              </li>
              {result.duplicates > 0 && (
                <li>
                  <strong>{fmtNum(result.duplicates)}</strong> dòng trùng mã đã có trong kho, sẽ được bỏ qua
                </li>
              )}
              {result.errors.length > 0 && (
                <li className="kk-warn-text">
                  <strong>{fmtNum(result.errors.length)}</strong> dòng có lỗi, sẽ không được nhập
                </li>
              )}
            </ul>

            {result.errors.length > 0 && (
              <ul className="kk-import-errors" aria-label="Các dòng lỗi">
                {result.errors.slice(0, 8).map((m) => (
                  <li key={m}>{m}</li>
                ))}
                {result.errors.length > 8 && <li>Và {fmtNum(result.errors.length - 8)} dòng lỗi khác.</li>}
              </ul>
            )}

            {result.items.length > 0 && (
              <div className="kk-table-scroll">
                <table className="kk-mini-table">
                  <thead>
                    <tr>
                      <th>Mã</th>
                      <th>Tên</th>
                      <th>Loại</th>
                      <th>Vị trí</th>
                      <th className="is-num">Số lượng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.slice(0, 6).map((it) => (
                      <tr key={it.line}>
                        <td>{it.part_number}</td>
                        <td>{it.name}</td>
                        <td>{it.category || '—'}</td>
                        <td>{it.location || '—'}</td>
                        <td className="is-num">{fmtNum(it.quantity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.items.length > 6 && <p className="kk-muted-text">Và {fmtNum(result.items.length - 6)} dòng nữa.</p>}
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="kk-form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
