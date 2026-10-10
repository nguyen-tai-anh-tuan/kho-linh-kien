import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { BellRing, Loader2, Search } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useData } from '../data/DataContext'
import { useShell } from '../ShellContext'
import { useToast } from '../ui/Toast'
import { ConfirmDialog } from '../ui/dialogs'
import { EmptyState, Field, QtyStepper, Skeleton, StatusChip } from '../ui/common'
import { friendlyError, mustChange } from '../lib/api'
import { fmtNum, normalize } from '../lib/format'
import { indentLabel, subtreeIds } from '../lib/tree'
import SettingsAccount from './SettingsAccount'
import SettingsCategories from './SettingsCategories'
import SettingsMembers from './SettingsMembers'

const MAX_ROWS = 50

export default function SettingsPage() {
  const { components, categories, categoriesById, categoryChildren, searchText, loading, refreshing, error, reload } = useData()
  const { openComponent, isAdmin, canEdit, profile } = useShell()
  const toast = useToast()
  const [dialog, setDialog] = useState(null) // { kind: 'bulk' }

  // Đặt mức cảnh báo cho cả nhóm
  const [scope, setScope] = useState('')
  const [level, setLevel] = useState(10)
  const [onlyUnset, setOnlyUnset] = useState(true)

  // Bảng sửa mức cảnh báo từng món
  const [q, setQ] = useState('')
  const [unsetOnly, setUnsetOnly] = useState(false)

  // Mở từ "Khác › Đổi mật khẩu" (/settings#account): cuộn thẳng tới mục Tài khoản
  const { hash } = useLocation()
  useEffect(() => {
    if (hash === '#account' && !loading) document.getElementById('account')?.scrollIntoView({ block: 'start' })
  }, [hash, loading])

  // Chọn một danh mục thì áp dụng cho cả các danh mục nằm bên trong nó
  const scopeIds = scope && scope !== 'all' && scope !== 'none' ? subtreeIds(categoryChildren, scope) : []
  const inScope = (c) => scope === 'all' || (scope === 'none' ? !c.category_id : scopeIds.includes(c.category_id))
  const targets = scope ? components.filter((c) => inScope(c) && (!onlyUnset || c.min_stock === 0)) : []
  const scopeLabel =
    scope === 'all' ? 'tất cả linh kiện' : scope === 'none' ? 'nhóm chưa phân loại' : `danh mục ${categoriesById.get(scope)?.name ?? ''}`

  const unsetCount = useMemo(() => components.filter((c) => c.min_stock === 0).length, [components])
  const matches = useMemo(() => {
    const terms = normalize(q).split(/\s+/).filter(Boolean)
    return components.filter((c) => {
      if (unsetOnly && c.min_stock !== 0) return false
      if (terms.length === 0) return true
      const text = searchText.get(c.id) ?? ''
      return terms.every((t) => text.includes(t))
    })
  }, [components, searchText, q, unsetOnly])

  async function applyBulk() {
    let query = supabase.from('components').update({ min_stock: Number(level) })
    if (scope === 'none') query = query.is('category_id', null)
    else if (scope === 'all') query = query.gte('min_stock', 0)
    else query = query.in('category_id', scopeIds)
    if (onlyUnset) query = query.eq('min_stock', 0)
    const changed = mustChange(await query.select('id'))
    await reload()
    toast.push({ message: `Đã đặt mức cảnh báo ${fmtNum(level)} cho ${fmtNum(changed.length)} linh kiện.` })
  }

  async function saveMin(component, value) {
    try {
      mustChange(await supabase.from('components').update({ min_stock: value }).eq('id', component.id).select('id'))
      await reload()
      toast.push({ message: `Đã đặt mức cảnh báo ${fmtNum(value)} cho ${component.part_number}.` })
      return true
    } catch (e) {
      toast.push({ tone: 'error', message: friendlyError(e), duration: 9000 })
      return false
    }
  }

  if (error) {
    return (
      <EmptyState title="Chưa tải được cài đặt" text={error}>
        <button type="button" className="kk-btn kk-btn-primary" onClick={reload}>
          Thử lại
        </button>
      </EmptyState>
    )
  }

  const levelValid = Number.isInteger(Number(level)) && level !== '' && Number(level) >= 0

  return (
    <div className={`kk-page kk-settings ${refreshing ? 'is-refreshing' : ''}`}>
      <div className="kk-page-head">
        <div>
          <h1>Cài đặt</h1>
          <p>
            {isAdmin
              ? 'Quản lý danh mục, mức cảnh báo sắp hết hàng và thành viên.'
              : canEdit
                ? 'Thêm danh mục, xem mức cảnh báo và quản lý tài khoản của bạn. Đổi tên, chuyển, xóa danh mục và đặt mức cảnh báo là việc của admin.'
                : 'Xem danh mục, mức cảnh báo và quản lý tài khoản của bạn.'}
          </p>
        </div>
      </div>

      {isAdmin && profile.legacy && (
        <p className="kk-banner kk-banner-warn" role="status">
          <BellRing size={18} aria-hidden="true" />
          <span>
            Chưa bật phân quyền: hiện ai đăng nhập được cũng có toàn quyền. Mở Supabase, vào SQL Editor, dán nội dung file
            sql/04_roles.sql rồi bấm Run, sau đó tải lại trang.
          </span>
        </p>
      )}
      {isAdmin && !profile.legacy && <SettingsMembers />}

      <SettingsCategories />

      {/* ---- Mức cảnh báo ---- */}
      <section className="kk-card" aria-labelledby="set-min">
        <div className="kk-card-head">
          <div>
            <h2 id="set-min">Mức cảnh báo sắp hết</h2>
            <p className="kk-card-sub">
              Khi tồn kho của một món xuống dưới mức này, món đó được đánh dấu "Sắp hết" và hiện trong danh sách cần mua thêm.
              {unsetCount > 0 && ` Hiện có ${fmtNum(unsetCount)} món chưa đặt mức (đang là 0).`}
            </p>
          </div>
        </div>

        {isAdmin && (
          <>
        <h3 className="kk-sub kk-sub-first">Đặt nhanh cho cả nhóm</h3>
        <div className="kk-bulk-form">
          <Field label="Áp dụng cho" htmlFor="set-scope">
            <select id="set-scope" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="">Chọn nhóm</option>
              <option value="all">Tất cả linh kiện</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {indentLabel(c)}
                </option>
              ))}
              <option value="none">Chưa phân loại</option>
            </select>
          </Field>
          <Field label="Mức cảnh báo" htmlFor="set-level">
            <QtyStepper id="set-level" value={level} min={0} label="Mức cảnh báo" onChange={setLevel} />
          </Field>
          <label className="kk-switch">
            <input type="checkbox" checked={onlyUnset} onChange={(e) => setOnlyUnset(e.target.checked)} />
            <span className="kk-switch-track" aria-hidden="true" />
            Chỉ những món chưa đặt mức
          </label>
          <button
            type="button"
            className="kk-btn kk-btn-primary"
            disabled={!scope || !levelValid || targets.length === 0}
            onClick={() => setDialog({ kind: 'bulk' })}
          >
            <BellRing size={18} />
            {scope && targets.length > 0 ? `Đặt cho ${fmtNum(targets.length)} linh kiện` : 'Đặt mức cảnh báo'}
          </button>
        </div>
        {scope && targets.length === 0 && (
          <p className="kk-muted-text kk-bulk-note">
            {onlyUnset
              ? 'Mọi linh kiện trong nhóm này đã có mức cảnh báo. Tắt "Chỉ những món chưa đặt mức" nếu bạn muốn ghi đè.'
              : 'Nhóm này chưa có linh kiện nào.'}
          </p>
        )}
          </>
        )}

        <h3 className={`kk-sub ${isAdmin ? '' : 'kk-sub-first'}`}>{isAdmin ? 'Sửa từng linh kiện' : 'Mức của từng linh kiện'}</h3>
        <div className="kk-toolbar kk-toolbar-flat">
          <div className="kk-search">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              value={q}
              placeholder="Tìm theo mã, tên, loại…"
              aria-label="Tìm linh kiện để xem mức cảnh báo"
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <label className="kk-switch">
            <input type="checkbox" checked={unsetOnly} onChange={(e) => setUnsetOnly(e.target.checked)} />
            <span className="kk-switch-track" aria-hidden="true" />
            Chỉ hiện món chưa đặt mức
          </label>
        </div>

        {loading ? (
          <div className="kk-skel-list">
            <Skeleton h={44} r={10} />
            <Skeleton h={44} r={10} />
          </div>
        ) : matches.length === 0 ? (
          <p className="kk-muted-text kk-bulk-note">
            {components.length === 0 ? 'Chưa có linh kiện nào trong kho.' : 'Không có linh kiện nào khớp. Thử đổi từ khóa hoặc tắt bộ lọc.'}
          </p>
        ) : (
          <>
            <div className="kk-table-scroll">
              <table className="kk-table kk-table-plain kk-table-static">
                <thead>
                  <tr>
                    <th>Linh kiện</th>
                    <th className="is-num">Tồn kho</th>
                    <th>Trạng thái</th>
                    <th>Mức cảnh báo</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.slice(0, MAX_ROWS).map((c) => (
                    <tr key={c.id}>
                      <td data-label="Linh kiện" className="kk-cell-main">
                        <button type="button" className="kk-row-link" onClick={() => openComponent(c.id)}>
                          {c.part_number}
                        </button>
                        <span className="kk-cell-name">{c.name}</span>
                      </td>
                      <td data-label="Tồn kho" className="is-num kk-strong-num">
                        {fmtNum(c.total_quantity)}
                      </td>
                      <td data-label="Trạng thái">
                        <StatusChip status={c.status} />
                      </td>
                      <td data-label="Mức cảnh báo">
                        {isAdmin ? (
                          <MinStockInput key={`${c.id}|${c.min_stock}`} component={c} onSave={saveMin} />
                        ) : (
                          <span className="kk-strong-num">{c.min_stock > 0 ? fmtNum(c.min_stock) : 'Chưa đặt'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {matches.length > MAX_ROWS && (
              <p className="kk-muted-text kk-bulk-note">
                Đang hiện {fmtNum(MAX_ROWS)} trong {fmtNum(matches.length)} linh kiện. Gõ vào ô tìm để thu hẹp danh sách.
              </p>
            )}
          </>
        )}
      </section>

      <SettingsAccount />

      {dialog?.kind === 'bulk' && (
        <ConfirmDialog
          title={`Đặt mức cảnh báo ${fmtNum(level)} cho ${fmtNum(targets.length)} linh kiện?`}
          text={
            onlyUnset
              ? `Áp dụng cho các món chưa đặt mức trong ${scopeLabel}. Những món đã có mức riêng được giữ nguyên.`
              : `Mức cảnh báo hiện tại của ${fmtNum(targets.length)} linh kiện trong ${scopeLabel} sẽ bị ghi đè, kể cả những món bạn đã đặt riêng.`
          }
          confirmLabel="Đặt mức cảnh báo"
          Icon={BellRing}
          danger={!onlyUnset}
          onConfirm={applyBulk}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

/** Ô sửa mức cảnh báo của một linh kiện: lưu khi rời ô hoặc nhấn Enter */
function MinStockInput({ component, onSave }) {
  const [value, setValue] = useState(String(component.min_stock ?? 0))
  const [busy, setBusy] = useState(false)

  async function commit() {
    const n = value === '' ? 0 : Number(value)
    if (n === component.min_stock) return setValue(String(n))
    setBusy(true)
    const ok = await onSave(component, n)
    if (!ok) setValue(String(component.min_stock ?? 0))
    setBusy(false)
  }

  return (
    <span className="kk-min-input">
      <input
        inputMode="numeric"
        autoComplete="off"
        aria-label={`Mức cảnh báo của ${component.part_number}`}
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, '').slice(0, 7))}
        onFocus={(e) => e.target.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.target.blur()
          else if (e.key === 'Escape') setValue(String(component.min_stock ?? 0))
        }}
      />
      {busy && <Loader2 size={16} className="kk-spin" aria-label="Đang lưu" />}
    </span>
  )
}
