import { useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import { supabase } from './supabaseClient'
import { useData } from './data/DataContext'
import { useToast } from './ui/Toast'
import { Modal } from './ui/Modal'
import { CategoryPicker, Field, QtyStepper, SelectWithCreate } from './ui/common'
import { friendlyError } from './lib/api'
import { parseNumber } from './lib/csv'
import { fmtPrice, normalize, safeUrl } from './lib/format'
import { PRICE_UNITS, packOf, packPrice, supportsPriceUnit } from './lib/price'

const text = (v) => (v === null || v === undefined ? '' : String(v))

/** Form thêm mới (initial = null) hoặc sửa linh kiện (initial = dòng từ component_totals) */
export default function ComponentForm({ initial, onClose, onSaved }) {
  const { allComponents: components, locations, levels, levelFor, createLocation, reload } = useData()
  const toast = useToast()
  const editing = Boolean(initial)
  const unitReady = supportsPriceUnit(components) // database đã chạy sql/14_price_unit.sql
  const initPack = packOf(initial)

  const [f, setF] = useState({
    part_number: text(initial?.part_number),
    name: text(initial?.name),
    category_id: initial?.category_id ?? null,
    value: text(initial?.value),
    package: text(initial?.package),
    manufacturer: text(initial?.manufacturer),
    // Có mức chung thì để trống = theo mặc định; database cũ thì vẫn là một con số
    min_stock: levels.ready ? text(initial?.min_stock_own) : text(initial?.min_stock ?? 0),
    // Món tính theo hộp / bộ: ô đơn giá là giá một hộp, lưu xuống thì chia ra giá một cái
    unit_price: text(packPrice(initial?.unit_price, initPack)),
    price_unit: initPack?.unit ?? '',
    price_qty: text(initPack?.qty ?? ''),
    datasheet_url: text(initial?.datasheet_url),
    image_url: text(initial?.image_url),
    notes: text(initial?.notes),
  })
  const [initQty, setInitQty] = useState('')
  const [initLoc, setInitLoc] = useState(locations.length === 1 ? locations[0].id : null)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const set = (key) => (e) => setF((s) => ({ ...s, [key]: e.target.value }))

  const duplicate =
    f.part_number.trim() !== '' &&
    components.some((c) => c.id !== initial?.id && normalize(c.part_number) === normalize(f.part_number))

  // Mức mà linh kiện sẽ nhận nếu để trống ô "Tồn tối thiểu"
  const inherited = levelFor(f.category_id)
  const defaultHint = `Để trống thì theo ${inherited.category ? `danh mục ${inherited.category.name}` : 'mức chung'}: báo sắp hết khi tồn dưới ${inherited.value}.`

  // Gợi ý dưới ô đơn giá: món theo hộp thì cho thấy giá quy ra một cái
  const typedPrice = f.unit_price.trim() === '' ? NaN : parseNumber(f.unit_price)
  const typedQty = parseNumber(f.price_qty)
  const unitHint =
    f.price_unit && typedPrice >= 0 && Number.isInteger(typedQty) && typedQty >= 1
      ? `Quy ra khoảng ${fmtPrice(typedPrice / typedQty)} một cái.`
      : 'Dùng để tính giá trị kho.'

  function validate() {
    const e = {}
    if (!f.part_number.trim()) e.part_number = 'Nhập mã linh kiện.'
    if (!f.name.trim()) e.name = 'Nhập tên linh kiện.'
    const min = f.min_stock === '' ? 0 : parseNumber(f.min_stock)
    if (!Number.isInteger(min) || min < 0) e.min_stock = 'Nhập số nguyên từ 0 trở lên.'
    if (f.unit_price.trim() !== '') {
      const p = parseNumber(f.unit_price)
      if (Number.isNaN(p) || p < 0) e.unit_price = 'Nhập số tiền hợp lệ, ví dụ 3500 hoặc 0,35.'
    }
    if (f.price_unit) {
      const q = parseNumber(f.price_qty)
      if (!Number.isInteger(q) || q < 1) e.price_qty = `Nhập số cái trong một ${f.price_unit}, vd 840.`
    }
    if (f.datasheet_url.trim() && !safeUrl(f.datasheet_url)) e.datasheet_url = 'Link phải bắt đầu bằng http:// hoặc https://'
    if (f.image_url.trim() && !safeUrl(f.image_url)) e.image_url = 'Link phải bắt đầu bằng http:// hoặc https://'
    if (!editing && Number(initQty) > 0 && !initLoc) e.initLoc = 'Chọn vị trí để nhập số lượng ban đầu.'
    return e
  }

  async function submit(ev) {
    ev.preventDefault()
    if (saving) return
    const e = validate()
    setErrors(e)
    setFormError('')
    if (Object.keys(e).length > 0) return

    const payload = {
      part_number: f.part_number.trim(),
      name: f.name.trim(),
      category_id: f.category_id,
      value: f.value.trim() || null,
      package: f.package.trim() || null,
      manufacturer: f.manufacturer.trim() || null,
      min_stock: f.min_stock === '' ? (levels.ready ? null : 0) : parseNumber(f.min_stock),
      unit_price: f.unit_price.trim() === '' ? null : parseNumber(f.unit_price) / (f.price_unit ? parseNumber(f.price_qty) : 1),
      ...(unitReady ? { price_unit: f.price_unit || null, price_qty: f.price_unit ? parseNumber(f.price_qty) : null } : {}),
      datasheet_url: f.datasheet_url.trim() || null,
      image_url: f.image_url.trim() || null,
      notes: f.notes.trim() || null,
    }

    setSaving(true)
    const query = editing
      ? supabase.from('components').update(payload).eq('id', initial.id)
      : supabase.from('components').insert(payload)
    const { data, error } = await query.select('id').single()
    if (error) {
      setSaving(false)
      return setFormError(friendlyError(error))
    }

    let stockFailed = ''
    if (!editing && Number(initQty) > 0 && initLoc) {
      const { error: txError } = await supabase.from('transactions').insert({
        component_id: data.id,
        location_id: initLoc,
        type: 'in',
        quantity: Number(initQty),
        note: 'Tồn ban đầu',
      })
      if (txError) stockFailed = friendlyError(txError)
    }

    await reload()
    if (stockFailed) {
      toast.push({
        tone: 'error',
        message: `Đã thêm ${payload.part_number} nhưng chưa nhập được số lượng ban đầu. ${stockFailed}`,
        duration: 10000,
      })
    } else {
      toast.push({ message: editing ? `Đã lưu thay đổi cho ${payload.part_number}.` : `Đã thêm linh kiện ${payload.part_number}.` })
    }
    onSaved?.(data.id)
    onClose()
  }

  return (
    <Modal
      title={editing ? 'Sửa linh kiện' : 'Thêm linh kiện'}
      subtitle={editing ? initial.part_number : 'Chỉ mã và tên là bắt buộc, phần còn lại điền sau cũng được.'}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="kk-btn kk-btn-ghost" onClick={onClose}>
            Hủy
          </button>
          <button type="submit" form="component-form" className="kk-btn kk-btn-primary" disabled={saving}>
            {saving ? <Loader2 size={18} className="kk-spin" /> : <Save size={18} />}
            {saving ? 'Đang lưu…' : editing ? 'Lưu thay đổi' : 'Thêm linh kiện'}
          </button>
        </>
      }
    >
      <form id="component-form" className="kk-form-grid" onSubmit={submit} noValidate>
        <Field
          label="Mã linh kiện *"
          htmlFor="cf-part"
          error={errors.part_number}
          hint={duplicate ? 'Đã có linh kiện khác dùng mã này. Bạn vẫn có thể lưu nếu đây là món khác.' : undefined}
        >
          <input
            id="cf-part"
            data-autofocus
            value={f.part_number}
            placeholder="Vd: STM32F103C8T6"
            aria-invalid={errors.part_number ? true : undefined}
            onChange={set('part_number')}
          />
        </Field>
        <Field label="Tên *" htmlFor="cf-name" error={errors.name}>
          <input
            id="cf-name"
            value={f.name}
            placeholder="Vd: Vi điều khiển ARM Cortex-M3"
            aria-invalid={errors.name ? true : undefined}
            onChange={set('name')}
          />
        </Field>

        <Field label="Loại" htmlFor="cf-cat">
          <CategoryPicker id="cf-cat" value={f.category_id} onChange={(id) => setF((s) => ({ ...s, category_id: id }))} />
        </Field>
        <Field label="Giá trị" htmlFor="cf-value" hint="Vd: 10k, 100nF, 3.3V">
          <input id="cf-value" value={f.value} onChange={set('value')} />
        </Field>

        <Field label="Package" htmlFor="cf-pkg" hint="Vd: 0603, SOP-8, LQFP-48">
          <input id="cf-pkg" value={f.package} onChange={set('package')} />
        </Field>
        <Field label="Hãng sản xuất" htmlFor="cf-mfr">
          <input id="cf-mfr" value={f.manufacturer} onChange={set('manufacturer')} />
        </Field>

        <Field
          label={levels.ready ? 'Tồn tối thiểu (mức riêng)' : 'Tồn tối thiểu'}
          htmlFor="cf-min"
          error={errors.min_stock}
          hint={levels.ready ? defaultHint : 'Dưới mức này sẽ báo sắp hết.'}
        >
          <input
            id="cf-min"
            inputMode="numeric"
            value={f.min_stock}
            placeholder={levels.ready ? `Theo mặc định: ${inherited.value}` : undefined}
            onChange={set('min_stock')}
          />
        </Field>
        <Field
          label={f.price_unit ? `Đơn giá một ${f.price_unit} (đ)` : 'Đơn giá (đ)'}
          htmlFor="cf-price"
          error={errors.unit_price}
          hint={unitHint}
        >
          <input id="cf-price" inputMode="decimal" value={f.unit_price} onChange={set('unit_price')} />
        </Field>

        {unitReady && (
          <>
            <Field label="Giá tính theo" htmlFor="cf-punit" hint="Món bán theo hộp, bộ, combo... thì chọn ở đây.">
              <select id="cf-punit" value={f.price_unit} onChange={set('price_unit')}>
                <option value="">Từng cái</option>
                {PRICE_UNITS.map((u) => (
                  <option key={u} value={u}>
                    Theo {u}
                  </option>
                ))}
              </select>
            </Field>
            {f.price_unit ? (
              <Field label={`Số cái trong một ${f.price_unit} *`} htmlFor="cf-pqty" error={errors.price_qty} hint="Số lượng tồn kho vẫn đếm theo cái.">
                <input id="cf-pqty" inputMode="numeric" value={f.price_qty} placeholder="Vd: 840" onChange={set('price_qty')} />
              </Field>
            ) : (
              <span aria-hidden="true" />
            )}
          </>
        )}

        <Field label="Link datasheet" htmlFor="cf-ds" error={errors.datasheet_url} className="kk-span-2">
          <input id="cf-ds" type="url" value={f.datasheet_url} placeholder="https://" onChange={set('datasheet_url')} />
        </Field>
        <Field label="Link ảnh" htmlFor="cf-img" error={errors.image_url} className="kk-span-2">
          <input id="cf-img" type="url" value={f.image_url} placeholder="https://" onChange={set('image_url')} />
        </Field>
        <Field label="Ghi chú" htmlFor="cf-notes" className="kk-span-2">
          <textarea id="cf-notes" rows={3} value={f.notes} onChange={set('notes')} />
        </Field>

        {!editing && (
          <fieldset className="kk-span-2 kk-fieldset">
            <legend>Nhập kho luôn (không bắt buộc)</legend>
            <div className="kk-form-grid">
              <Field label="Số lượng ban đầu" htmlFor="cf-qty">
                <QtyStepper id="cf-qty" value={initQty} min={0} onChange={setInitQty} label="Số lượng ban đầu" />
              </Field>
              <Field label="Vị trí" htmlFor="cf-loc" error={errors.initLoc}>
                <SelectWithCreate
                  id="cf-loc"
                  value={initLoc}
                  onChange={setInitLoc}
                  placeholder="Chọn vị trí"
                  options={locations.map((l) => ({ value: l.id, label: l.path }))}
                  onCreate={createLocation}
                  createLabel="Thêm vị trí mới (vd: Tủ A, ngăn 1)"
                />
              </Field>
            </div>
          </fieldset>
        )}

        {formError && (
          <p className="kk-form-error kk-span-2" role="alert">
            {formError}
          </p>
        )}
      </form>
    </Modal>
  )
}
