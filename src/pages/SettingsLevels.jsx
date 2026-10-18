import { useState } from 'react'
import { AlertTriangle, BellRing, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useData } from '../data/DataContext'
import { useShell } from '../ShellContext'
import { useToast } from '../ui/Toast'
import { ConfirmDialog } from '../ui/dialogs'
import { CategoryPicker, Field, QtyStepper, Skeleton } from '../ui/common'
import { friendlyError, mustChange } from '../lib/api'
import { fmtNum } from '../lib/format'
import { subtreeIds } from '../lib/tree'

const MAX_OWN = 12
const validLevel = (v) => v !== '' && Number.isInteger(Number(v)) && Number(v) >= 0

/**
 * Mục "Mức cảnh báo sắp hết" của trang Cài đặt.
 * Mức của một linh kiện: mức riêng (nếu có) -> mức của danh mục gần nhất -> mức chung.
 */
export default function SettingsLevels() {
  const { allComponents, categories, categoriesById, categoryChildren, levels, loading, reload } = useData()
  const { openComponent, isAdmin } = useShell()
  const toast = useToast()
  const [general, setGeneral] = useState(null) // null = chưa sửa, đang hiện mức đã lưu
  const [savingGeneral, setSavingGeneral] = useState(false)
  const [target, setTarget] = useState('')
  const [level, setLevel] = useState(10)
  const [adding, setAdding] = useState(false)
  const [dialog, setDialog] = useState(null) // { kind: 'reset' } | { kind: 'clear', category }

  const withLevel = categories.filter((c) => levels.byCategory.has(c.id))
  const own = allComponents.filter((c) => c.min_stock_own !== null && c.min_stock_own !== undefined)
  const generalValue = general ?? levels.defaultMin
  const generalChanged = validLevel(generalValue) && Number(generalValue) !== levels.defaultMin

  // Số linh kiện đang thật sự lấy mức từ danh mục này
  const usedBy = (id) => allComponents.filter((c) => c.min_source === 'category' && c.min_category_id === id).length
  const insideCount = (id) => {
    const ids = new Set(subtreeIds(categoryChildren, id))
    return allComponents.filter((c) => ids.has(c.category_id)).length
  }

  async function run(work, message) {
    try {
      await work()
      await reload()
      toast.push({ message })
      return true
    } catch (e) {
      toast.push({ tone: 'error', message: friendlyError(e), duration: 9000 })
      return false
    }
  }

  async function saveGeneral() {
    const n = Number(generalValue)
    setSavingGeneral(true)
    const ok = await run(
      async () => mustChange(await supabase.from('settings').update({ default_min_stock: n }).eq('id', true).select('id')),
      `Đã đặt mức cảnh báo chung là ${fmtNum(n)}.`,
    )
    if (ok) setGeneral(null)
    setSavingGeneral(false)
  }

  const saveCategory = (category, value) =>
    run(
      async () => mustChange(await supabase.from('categories').update({ min_stock: value }).eq('id', category.id).select('id')),
      value === null ? `Đã bỏ mức riêng của danh mục ${category.name}.` : `Đã đặt mức ${fmtNum(value)} cho danh mục ${category.name}.`,
    )

  async function addCategory() {
    const category = categoriesById.get(target)
    if (!category || !validLevel(level)) return
    setAdding(true)
    if (await saveCategory(category, Number(level))) setTarget('')
    setAdding(false)
  }

  async function resetOwn() {
    const changed = mustChange(await supabase.from('components').update({ min_stock: null }).not('min_stock', 'is', null).select('id'))
    await reload()
    toast.push({ message: `Đã đưa ${fmtNum(changed.length)} linh kiện về mức mặc định.` })
  }

  return (
    <section className="kk-card" aria-labelledby="set-min">
      <div className="kk-card-head">
        <div>
          <h2 id="set-min">Mức cảnh báo sắp hết</h2>
          <p className="kk-card-sub">
            Khi tồn kho của một món xuống dưới mức này, món đó được đánh dấu "Sắp hết" và hiện trong trang Cần mua. Mỗi linh kiện
            lấy mức riêng của nó nếu có, không thì lấy mức của danh mục gần nhất, không nữa thì lấy mức chung.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="kk-skel-list">
          <Skeleton h={44} r={10} />
          <Skeleton h={44} r={10} />
        </div>
      ) : !levels.ready ? (
        <p className="kk-banner kk-banner-warn" role="status">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>
            Database chưa có mức cảnh báo chung và theo danh mục.
            {isAdmin
              ? ' Mở Supabase, vào SQL Editor, dán nội dung file sql/08_warning_levels.sql rồi bấm Run, sau đó tải lại trang.'
              : ' Hãy nhờ admin nâng cấp database.'}
          </span>
        </p>
      ) : (
        <>
          {/* ---- Mức chung ---- */}
          <h3 className="kk-sub kk-sub-first">Mức chung cho cả kho</h3>
          {isAdmin ? (
            <div className="kk-bulk-form">
              <Field label="Báo sắp hết khi tồn dưới" htmlFor="lv-general">
                <QtyStepper id="lv-general" value={generalValue} min={0} label="Mức cảnh báo chung" onChange={setGeneral} />
              </Field>
              <button type="button" className="kk-btn kk-btn-primary" disabled={!generalChanged || savingGeneral} onClick={saveGeneral}>
                {savingGeneral ? <Loader2 size={18} className="kk-spin" /> : <BellRing size={18} />}
                Lưu mức chung
              </button>
              {general !== null && generalChanged && (
                <button type="button" className="kk-link kk-filter-clear" onClick={() => setGeneral(null)}>
                  Bỏ thay đổi
                </button>
              )}
            </div>
          ) : (
            <p className="kk-muted-text">
              Báo sắp hết khi tồn dưới <strong>{fmtNum(levels.defaultMin)}</strong>.
            </p>
          )}
          {levels.defaultMin === 0 && (
            <p className="kk-muted-text kk-bulk-note">Mức 0 nghĩa là không báo "Sắp hết", chỉ báo khi hết hẳn hàng.</p>
          )}

          {/* ---- Mức theo danh mục ---- */}
          <h3 className="kk-sub">Mức riêng theo danh mục</h3>
          {withLevel.length === 0 ? (
            <p className="kk-muted-text">
              Chưa có danh mục nào đặt mức riêng. Dùng cho nhóm cần giữ nhiều hàng, ví dụ điện trở hay tụ điện.
            </p>
          ) : (
            <ul className="kk-rows kk-level-rows">
              {withLevel.map((c) => (
                <li key={c.id}>
                  <span className="kk-rows-name">
                    {c.name}
                    {c.depth > 0 && <small>{c.path.slice(0, -(c.name.length + 3))}</small>}
                  </span>
                  <span className="kk-rows-meta">áp dụng cho {fmtNum(usedBy(c.id))} linh kiện</span>
                  {isAdmin ? (
                    <>
                      <LevelInput
                        key={`${c.id}|${levels.byCategory.get(c.id)}`}
                        label={`Mức cảnh báo của danh mục ${c.name}`}
                        value={levels.byCategory.get(c.id)}
                        onSave={(n) => saveCategory(c, n)}
                      />
                      <button
                        type="button"
                        className="kk-icon-btn kk-c-del"
                        aria-label={`Bỏ mức riêng của danh mục ${c.name}`}
                        title="Bỏ mức riêng, quay về mức phía trên"
                        onClick={() => setDialog({ kind: 'clear', category: c })}
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  ) : (
                    <strong className="kk-strong-num">{fmtNum(levels.byCategory.get(c.id))}</strong>
                  )}
                </li>
              ))}
            </ul>
          )}

          {isAdmin && categories.length > 0 && (
            <div className="kk-bulk-form kk-level-add">
              <Field label="Danh mục" htmlFor="lv-cat" hint={target && levels.byCategory.has(target) ? `Danh mục này đang có mức ${fmtNum(levels.byCategory.get(target))}, đặt lại sẽ thay mức đó.` : 'Áp dụng cho cả các danh mục nằm bên trong nó.'}>
                <CategoryPicker
                  id="lv-cat"
                  value={target || null}
                  allowNone={false}
                  placeholder="Bấm để chọn hoặc gõ để tìm danh mục…"
                  onChange={(id) => setTarget(id ?? '')}
                />
              </Field>
              <Field label="Mức cảnh báo" htmlFor="lv-level" hint={target ? `Danh mục này đang có ${fmtNum(insideCount(target))} linh kiện.` : ' '}>
                <QtyStepper id="lv-level" value={level} min={0} label="Mức cảnh báo của danh mục" onChange={setLevel} />
              </Field>
              <button type="button" className="kk-btn kk-btn-soft" disabled={!target || !validLevel(level) || adding} onClick={addCategory}>
                {adding ? <Loader2 size={18} className="kk-spin" /> : <BellRing size={18} />}
                Đặt mức cho danh mục
              </button>
            </div>
          )}

          {/* ---- Mức riêng của từng linh kiện ---- */}
          <h3 className="kk-sub">Linh kiện có mức riêng</h3>
          {own.length === 0 ? (
            <p className="kk-muted-text">
              Chưa có linh kiện nào đặt mức riêng. Khi cần, mở linh kiện, bấm Sửa và nhập "Tồn tối thiểu".
            </p>
          ) : (
            <>
              <p className="kk-muted-text">
                {fmtNum(own.length)} linh kiện đang dùng mức riêng, không theo mức chung hay danh mục:
              </p>
              <div className="kk-level-own">
                {own.slice(0, MAX_OWN).map((c) => (
                  <button key={c.id} type="button" className="kk-pill" onClick={() => openComponent(c.id)}>
                    {c.part_number}: {fmtNum(c.min_stock_own)}
                  </button>
                ))}
                {own.length > MAX_OWN && <span className="kk-muted-text">và {fmtNum(own.length - MAX_OWN)} linh kiện khác</span>}
              </div>
              {isAdmin && (
                <button type="button" className="kk-btn kk-btn-outline kk-btn-sm kk-level-reset" onClick={() => setDialog({ kind: 'reset' })}>
                  <RotateCcw size={16} />
                  Đưa tất cả về mặc định
                </button>
              )}
            </>
          )}
        </>
      )}

      {dialog?.kind === 'clear' && (
        <ConfirmDialog
          title={`Bỏ mức riêng của danh mục ${dialog.category.name}?`}
          text={`${fmtNum(usedBy(dialog.category.id))} linh kiện đang theo mức này sẽ quay về mức của danh mục phía trên, hoặc mức chung.`}
          confirmLabel="Bỏ mức riêng"
          Icon={Trash2}
          onConfirm={async () => {
            const ok = await saveCategory(dialog.category, null)
            if (!ok) throw new Error('Chưa bỏ được mức riêng. Bạn thử lại nhé.')
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'reset' && (
        <ConfirmDialog
          title={`Đưa ${fmtNum(own.length)} linh kiện về mức mặc định?`}
          text="Mức riêng của các linh kiện này sẽ bị bỏ. Từ đó chúng theo mức của danh mục, hoặc mức chung."
          confirmLabel="Đưa về mặc định"
          Icon={RotateCcw}
          danger
          onConfirm={resetOwn}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  )
}

/** Ô sửa một mức cảnh báo: lưu khi rời ô hoặc nhấn Enter */
function LevelInput({ label, value, onSave }) {
  const [text, setText] = useState(String(value))
  const [busy, setBusy] = useState(false)

  async function commit() {
    if (text === '' || Number(text) === value) return setText(String(value))
    setBusy(true)
    const ok = await onSave(Number(text))
    if (!ok) setText(String(value))
    setBusy(false)
  }

  return (
    <span className="kk-min-input">
      <input
        inputMode="numeric"
        autoComplete="off"
        aria-label={label}
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, '').slice(0, 7))}
        onFocus={(e) => e.target.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.target.blur()
          else if (e.key === 'Escape') setText(String(value))
        }}
      />
      {busy && <Loader2 size={16} className="kk-spin" aria-label="Đang lưu" />}
    </span>
  )
}
