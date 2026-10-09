import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowDownToLine, ChevronDown, ChevronRight, FolderPlus, Pencil, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useData } from '../data/DataContext'
import { useTx } from '../TxContext'
import { useShell } from '../ShellContext'
import { useToast } from '../ui/Toast'
import { ConfirmDialog, NameDialog } from '../ui/dialogs'
import { EmptyState, Skeleton, StatusChip } from '../ui/common'
import { mustChange } from '../lib/api'
import { buildTree, subtreeIds } from '../lib/tree'
import { fmtNum, normalize } from '../lib/format'

// Tên gọi theo tầng: tủ → ngăn → hộc (từ tầng thứ ba trở xuống đều gọi là hộc)
const LEVELS = ['tủ', 'ngăn', 'hộc']
const levelName = (depth) => LEVELS[Math.min(depth, LEVELS.length - 1)]

export default function LocationsPage() {
  const { locations, locationsById, componentsById, stock, loading, refreshing, error, reload } = useData()
  const { openTx } = useTx()
  const { openComponent, canEdit, isAdmin } = useShell()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [includeSub, setIncludeSub] = useState(true)
  const [dialog, setDialog] = useState(null) // { kind: 'add' | 'rename' | 'delete', loc }

  const childrenOf = useMemo(() => buildTree(locations), [locations])

  // Hàng đang nằm trực tiếp ở từng vị trí
  const itemsAt = useMemo(() => {
    const map = new Map()
    for (const s of stock) {
      if (s.quantity <= 0) continue
      const list = map.get(s.location_id) ?? []
      list.push(s)
      map.set(s.location_id, list)
    }
    return map
  }, [stock])

  // Số mã linh kiện khác nhau trong từng vị trí, tính cả các ngăn bên trong
  const kindsIn = useMemo(() => {
    const map = new Map()
    for (const l of locations) {
      const kinds = new Set()
      for (const id of subtreeIds(childrenOf, l.id)) {
        for (const s of itemsAt.get(id) ?? []) kinds.add(s.component_id)
      }
      map.set(l.id, kinds.size)
    }
    return map
  }, [locations, childrenOf, itemsAt])

  // Các dòng của cây đang hiện ra (bỏ qua nhánh đã thu gọn)
  const visible = useMemo(() => {
    const out = []
    const walk = (parentId, depth) => {
      for (const l of childrenOf.get(parentId) ?? []) {
        out.push({ loc: l, depth })
        if (!collapsed.has(l.id)) walk(l.id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }, [childrenOf, collapsed])

  const roots = childrenOf.get(null) ?? []
  const selected = locationsById.get(params.get('loc')) ?? roots[0] ?? null

  const rows = useMemo(() => {
    if (!selected) return []
    const ids = includeSub ? subtreeIds(childrenOf, selected.id) : [selected.id]
    const out = []
    for (const id of ids) {
      const loc = locationsById.get(id)
      for (const s of itemsAt.get(id) ?? []) {
        const comp = componentsById.get(s.component_id)
        if (!comp) continue
        out.push({
          key: `${s.component_id}|${id}`,
          comp,
          quantity: s.quantity,
          // Đường dẫn tính từ vị trí đang xem, để biết món nằm ở ngăn con nào
          inside: id === selected.id ? '' : (loc?.path ?? '').slice(selected.path.length + 3),
        })
      }
    }
    return out.sort((a, b) => a.comp.part_number.localeCompare(b.comp.part_number, 'vi', { numeric: true }))
  }, [selected, includeSub, childrenOf, itemsAt, locationsById, componentsById])

  function select(id) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (id) next.set('loc', id)
        else next.delete('loc')
        return next
      },
      { replace: true },
    )
  }

  function toggle(id) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const siblingNames = (parentId, exceptId) =>
    (childrenOf.get(parentId ?? null) ?? []).filter((l) => l.id !== exceptId).map((l) => normalize(l.name))

  async function addLocation(name, parent) {
    const { data, error: err } = await supabase
      .from('locations')
      .insert({ name, parent_id: parent?.id ?? null })
      .select('id')
      .single()
    if (err) throw err
    await reload()
    if (parent) setCollapsed((prev) => new Set([...prev].filter((id) => id !== parent.id)))
    select(data.id)
    toast.push({ message: `Đã thêm ${levelName(parent ? parent.depth + 1 : 0)} ${name}.` })
  }

  async function renameLocation(loc, name) {
    mustChange(await supabase.from('locations').update({ name }).eq('id', loc.id).select('id'))
    await reload()
    toast.push({ message: `Đã đổi tên thành ${name}.` })
  }

  async function deleteLocation(loc) {
    mustChange(await supabase.from('locations').delete().eq('id', loc.id).select('id'))
    select(loc.parent_id)
    await reload()
    toast.push({ message: `Đã xóa ${levelName(loc.depth)} ${loc.name}.` })
  }

  if (error) {
    return (
      <EmptyState title="Chưa tải được danh sách vị trí" text={error}>
        <button type="button" className="kk-btn kk-btn-primary" onClick={reload}>
          Thử lại
        </button>
      </EmptyState>
    )
  }

  const selectedKids = selected ? (childrenOf.get(selected.id) ?? []) : []
  const selectedHasStock = selected ? (kindsIn.get(selected.id) ?? 0) > 0 : false
  const deleteBlocked = selectedKids.length > 0
    ? 'Hãy xóa các ngăn bên trong trước.'
    : selectedHasStock
      ? 'Vị trí này đang có hàng. Hãy chuyển hoặc xuất hết hàng trước khi xóa.'
      : ''
  const totalQty = rows.reduce((sum, r) => sum + r.quantity, 0)

  return (
    <div className={`kk-page ${refreshing ? 'is-refreshing' : ''}`}>
      <div className="kk-page-head">
        <div>
          <h1>Vị trí</h1>
          <p>{loading ? 'Đang tải…' : `${fmtNum(locations.length)} vị trí, sắp theo tủ, ngăn, hộc`}</p>
        </div>
        {canEdit && (
          <div className="kk-quick">
            <button type="button" className="kk-btn kk-btn-primary" onClick={() => setDialog({ kind: 'add', loc: null })}>
              <Plus size={18} />
              Thêm tủ
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="kk-split">
          <Skeleton h={320} r={20} />
          <Skeleton h={320} r={20} />
        </div>
      ) : locations.length === 0 ? (
        <div className="kk-card">
          <EmptyState
            title="Chưa có vị trí nào"
            text={
              canEdit
                ? 'Tạo tủ đầu tiên, rồi thêm ngăn và hộc bên trong để biết từng món đang nằm ở đâu.'
                : 'Kho chưa có tủ, ngăn hay hộc nào.'
            }
          >
            {canEdit && (
              <button type="button" className="kk-btn kk-btn-primary" onClick={() => setDialog({ kind: 'add', loc: null })}>
                <Plus size={18} />
                Thêm tủ
              </button>
            )}
          </EmptyState>
        </div>
      ) : (
        <div className="kk-split">
          <nav className="kk-card kk-tree-card" aria-label="Cây vị trí">
            <ul className="kk-tree">
              {visible.map(({ loc, depth }) => {
                const kids = childrenOf.get(loc.id) ?? []
                const open = !collapsed.has(loc.id)
                const on = selected?.id === loc.id
                const kinds = kindsIn.get(loc.id) ?? 0
                return (
                  <li key={loc.id} className={`kk-tree-row ${on ? 'is-on' : ''}`} style={{ '--depth': depth }}>
                    {kids.length > 0 ? (
                      <button
                        type="button"
                        className="kk-tree-toggle"
                        aria-expanded={open}
                        aria-label={`${open ? 'Thu gọn' : 'Mở rộng'} ${loc.name}`}
                        onClick={() => toggle(loc.id)}
                      >
                        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                    ) : (
                      <span className="kk-tree-toggle" aria-hidden="true" />
                    )}
                    <button
                      type="button"
                      className="kk-tree-item"
                      aria-current={on ? 'true' : undefined}
                      onClick={() => select(loc.id)}
                    >
                      <span className="kk-tree-name">{loc.name}</span>
                      {kinds > 0 && (
                        <span className="kk-tree-count" aria-label={`${kinds} mã linh kiện`}>
                          {fmtNum(kinds)}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </nav>

          {selected && (
            <section className="kk-card kk-table-card" aria-label={`Bên trong ${selected.path}`}>
              <div className="kk-pane-head">
                <div className="kk-pane-titles">
                  <h2>{selected.path}</h2>
                  <p className="kk-card-sub">
                    {rows.length === 0
                      ? 'Chưa có hàng'
                      : `${fmtNum(rows.length)} dòng, tổng ${fmtNum(totalQty)} cái`}
                  </p>
                </div>
                {canEdit && (
                  <div className="kk-pane-actions">
                    <button
                      type="button"
                      className="kk-btn kk-btn-primary kk-btn-sm"
                      onClick={() => openTx({ type: 'in', locationId: selected.id })}
                    >
                      <ArrowDownToLine size={16} />
                      Nhập vào đây
                    </button>
                    <button
                      type="button"
                      className="kk-btn kk-btn-outline kk-btn-sm"
                      onClick={() => setDialog({ kind: 'add', loc: selected })}
                    >
                      <FolderPlus size={16} />
                      Thêm {levelName(selected.depth + 1)}
                    </button>
                    <button
                      type="button"
                      className="kk-icon-btn kk-icon-btn-boxed"
                      aria-label={`Đổi tên ${selected.name}`}
                      title="Đổi tên"
                      onClick={() => setDialog({ kind: 'rename', loc: selected })}
                    >
                      <Pencil size={16} />
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        className="kk-icon-btn kk-icon-btn-boxed"
                        aria-label={`Xóa ${selected.name}`}
                        title={deleteBlocked || 'Xóa vị trí'}
                        disabled={Boolean(deleteBlocked)}
                        onClick={() => setDialog({ kind: 'delete', loc: selected })}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {selectedKids.length > 0 && (
                <div className="kk-pane-bar">
                  <label className="kk-switch">
                    <input type="checkbox" checked={includeSub} onChange={(e) => setIncludeSub(e.target.checked)} />
                    <span className="kk-switch-track" aria-hidden="true" />
                    Gồm cả {fmtNum(selectedKids.length)} {levelName(selected.depth + 1)} bên trong
                  </label>
                </div>
              )}

              {rows.length === 0 ? (
                <EmptyState
                  title={`${selected.name} đang trống`}
                  text={
                    selectedKids.length > 0 && !includeSub
                      ? 'Không có món nào đặt trực tiếp ở đây. Bật "Gồm cả" để xem hàng trong các ngăn bên trong.'
                      : 'Chưa có món nào ở vị trí này.'
                  }
                >
                  {canEdit && (
                    <button
                      type="button"
                      className="kk-btn kk-btn-primary"
                      onClick={() => openTx({ type: 'in', locationId: selected.id })}
                    >
                      <ArrowDownToLine size={18} />
                      Nhập vào đây
                    </button>
                  )}
                </EmptyState>
              ) : (
                <div className="kk-table-scroll">
                  <table className="kk-table kk-table-plain">
                    <thead>
                      <tr>
                        <th>Linh kiện</th>
                        {includeSub && selectedKids.length > 0 && <th>Nằm ở</th>}
                        <th className="is-num">Số lượng</th>
                        <th>Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.key} onClick={() => openComponent(r.comp.id)}>
                          <td data-label="Linh kiện" className="kk-cell-main">
                            <button
                              type="button"
                              className="kk-row-link"
                              onClick={(e) => {
                                e.stopPropagation()
                                openComponent(r.comp.id)
                              }}
                            >
                              {r.comp.part_number}
                            </button>
                            <span className="kk-cell-name">{r.comp.name}</span>
                          </td>
                          {includeSub && selectedKids.length > 0 && <td data-label="Nằm ở">{r.inside || 'Ngay tại đây'}</td>}
                          <td data-label="Số lượng" className="is-num kk-strong-num">
                            {fmtNum(r.quantity)}
                          </td>
                          <td data-label="Trạng thái">
                            <StatusChip status={r.comp.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {dialog?.kind === 'add' && (
        <NameDialog
          title={`Thêm ${levelName(dialog.loc ? dialog.loc.depth + 1 : 0)}`}
          subtitle={dialog.loc ? `Bên trong ${dialog.loc.path}` : 'Tủ là tầng ngoài cùng, bên trong chia thành ngăn và hộc.'}
          label="Tên"
          placeholder={dialog.loc ? 'Vd: Ngăn 1' : 'Vd: Tủ A'}
          submitLabel="Thêm vị trí"
          validate={(name) =>
            siblingNames(dialog.loc?.id, null).includes(normalize(name)) ? 'Ở đây đã có vị trí trùng tên này.' : ''
          }
          onSubmit={(name) => addLocation(name, dialog.loc)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'rename' && (
        <NameDialog
          title={`Đổi tên ${levelName(dialog.loc.depth)}`}
          subtitle={dialog.loc.path}
          label="Tên mới"
          initial={dialog.loc.name}
          submitLabel="Lưu tên mới"
          validate={(name) =>
            siblingNames(dialog.loc.parent_id, dialog.loc.id).includes(normalize(name))
              ? 'Ở đây đã có vị trí trùng tên này.'
              : ''
          }
          onSubmit={(name) => renameLocation(dialog.loc, name)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={`Xóa ${levelName(dialog.loc.depth)} ${dialog.loc.name}?`}
          text={`Vị trí "${dialog.loc.path}" sẽ bị xóa khỏi kho. Việc này không hoàn tác được.`}
          confirmLabel="Xóa vị trí"
          Icon={Trash2}
          onConfirm={() => deleteLocation(dialog.loc)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}
