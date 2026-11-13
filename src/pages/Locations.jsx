import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ArrowDownToLine,
  ArrowRightLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderPlus,
  MapPin,
  MapPinOff,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useData } from '../data/DataContext'
import { useTx } from '../TxContext'
import { useShell } from '../ShellContext'
import { useToast } from '../ui/Toast'
import { ConfirmDialog, NameDialog } from '../ui/dialogs'
import { EmptyState, RowThumb, Skeleton, StatusChip } from '../ui/common'
import { friendlyError, mustChange } from '../lib/api'
import { setHome } from '../lib/moves'
import MoveDialog from '../MoveDialog'
import HomeDialog from '../HomeDialog'
import { buildTree, subtreeIds } from '../lib/tree'
import { fmtNum, normalize } from '../lib/format'

// Tên gọi theo tầng: tủ → ngăn → hộc (từ tầng thứ ba trở xuống đều gọi là hộc)
const LEVELS = ['tủ', 'ngăn', 'hộc']
const PAGE_SIZE = 10 // số linh kiện trên một trang của bảng bên phải
const levelName = (depth) => LEVELS[Math.min(depth, LEVELS.length - 1)]

export default function LocationsPage() {
  const { locations, locationsById, componentsById, stock, loading, refreshing, error, reload, homeOf, moves } = useData()
  const { openTx } = useTx()
  const { openComponent, canEdit, isAdmin } = useShell()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [includeSub, setIncludeSub] = useState(true)
  const [dialog, setDialog] = useState(null) // { kind: 'add' | 'rename' | 'delete', loc }
  const [paging, setPaging] = useState({ key: '', page: 0 }) // trang đang xem của từng vị trí
  const [picked, setPicked] = useState({ key: '', set: new Set() }) // các dòng đang tick để chuyển cả loạt
  const [moveDlg, setMoveDlg] = useState(null) // { lines, to }
  const [homeDlg, setHomeDlg] = useState(false)

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
          locationId: id,
          quantity: s.quantity,
          isHome: homeOf.get(s.component_id) === id,
          // Đường dẫn tính từ vị trí đang xem, để biết món nằm ở ngăn con nào
          inside: id === selected.id ? '' : (loc?.path ?? '').slice(selected.path.length + 3),
        })
      }
    }
    // Món được gán chỗ cất ở đây nhưng hiện chưa có hàng ở đây (sql/19_move_stock.sql)
    const idSet = new Set(ids)
    const hasHere = new Set(out.map((r) => r.key))
    for (const [compId, locId] of homeOf) {
      if (!idSet.has(locId) || hasHere.has(`${compId}|${locId}`)) continue
      const comp = componentsById.get(compId)
      if (!comp || comp.archived_at) continue
      const loc = locationsById.get(locId)
      out.push({
        key: `${compId}|${locId}|home`,
        comp,
        locationId: locId,
        quantity: 0,
        homeOnly: true,
        inside: locId === selected.id ? '' : (loc?.path ?? '').slice(selected.path.length + 3),
      })
    }
    return out.sort((a, b) => a.comp.part_number.localeCompare(b.comp.part_number, 'vi', { numeric: true }))
  }, [selected, includeSub, childrenOf, itemsAt, locationsById, componentsById, homeOf])

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

  // Chia trang bảng linh kiện. Đổi vị trí hoặc bật/tắt "gồm ngăn con" thì quay về trang đầu.
  const pagingKey = `${selected?.id ?? ''}|${includeSub}`
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const page = Math.min(paging.key === pagingKey ? paging.page : 0, pageCount - 1)
  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const goTo = (n) => setPaging({ key: pagingKey, page: n })

  // Tick để chuyển cả loạt (chỉ các dòng đang có hàng). Đổi vị trí đang xem thì bỏ hết dấu tick.
  const canMove = canEdit && moves.ready
  const stockRows = rows.filter((r) => !r.homeOnly)
  const pickedSet = picked.key === pagingKey ? picked.set : new Set()
  const pickedRows = stockRows.filter((r) => pickedSet.has(r.key))
  const allPicked = stockRows.length > 0 && pickedRows.length === stockRows.length
  const togglePick = (key) => {
    const next = new Set(pickedSet)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setPicked({ key: pagingKey, set: next })
  }
  const togglePickAll = () => setPicked({ key: pagingKey, set: allPicked ? new Set() : new Set(stockRows.map((r) => r.key)) })
  const linesOf = (list) => list.map((r) => ({ componentId: r.comp.id, fromLocationId: r.locationId, qty: r.quantity }))

  async function unassign(r) {
    try {
      await setHome([r.comp.id], null)
      await reload()
      toast.push({ message: `Đã bỏ gán ${r.comp.part_number} khỏi ${locationsById.get(r.locationId)?.path ?? 'vị trí này'}.` })
    } catch (e) {
      toast.push({ tone: 'error', message: friendlyError(e), duration: 9000 })
    }
  }

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
                    {stockRows.length === 0
                      ? rows.length
                        ? `Chưa có hàng, ${fmtNum(rows.length)} món được gán chỗ cất ở đây`
                        : 'Chưa có hàng'
                      : `${fmtNum(stockRows.length)} dòng, tổng ${fmtNum(totalQty)} cái${rows.length > stockRows.length ? `, thêm ${fmtNum(rows.length - stockRows.length)} món gán chỗ cất` : ''}`}
                  </p>
                </div>
                {canEdit && (
                  <div className="kk-pane-actions">
                    <button
                      type="button"
                      className="kk-btn kk-btn-primary kk-btn-sm kk-c-in"
                      onClick={() => openTx({ type: 'in', locationId: selected.id })}
                    >
                      <ArrowDownToLine size={16} />
                      Nhập vào đây
                    </button>
                    {canMove && (
                      <button
                        type="button"
                        className="kk-btn kk-btn-outline kk-btn-sm"
                        title="Đưa hàng đang nằm ở ngăn khác vào đây"
                        onClick={() => setMoveDlg({ lines: [], to: selected.id })}
                      >
                        <ArrowRightLeft size={16} />
                        Chuyển hàng vào đây
                      </button>
                    )}
                    {moves.homesReady && (
                      <button
                        type="button"
                        className="kk-btn kk-btn-outline kk-btn-sm"
                        title="Đặt đây làm chỗ cất mặc định cho linh kiện, kể cả món chưa có hàng"
                        onClick={() => setHomeDlg(true)}
                      >
                        <MapPin size={16} />
                        Gán linh kiện
                      </button>
                    )}
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
                      className="kk-icon-btn kk-icon-btn-boxed kk-c-edit"
                      aria-label={`Đổi tên ${selected.name}`}
                      title="Đổi tên"
                      onClick={() => setDialog({ kind: 'rename', loc: selected })}
                    >
                      <Pencil size={16} />
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        className="kk-icon-btn kk-icon-btn-boxed kk-c-del"
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
                      className="kk-btn kk-btn-primary kk-c-in"
                      onClick={() => openTx({ type: 'in', locationId: selected.id })}
                    >
                      <ArrowDownToLine size={18} />
                      Nhập vào đây
                    </button>
                  )}
                </EmptyState>
              ) : (
                <>
                {canMove && pickedRows.length > 0 && (
                  <div className="kk-mv-bulk" role="region" aria-label="Thao tác với các dòng đã chọn">
                    <strong>
                      Đã chọn {fmtNum(pickedRows.length)} dòng, {fmtNum(pickedRows.reduce((n, r) => n + r.quantity, 0))} cái
                    </strong>
                    <button
                      type="button"
                      className="kk-btn kk-btn-primary kk-btn-sm"
                      onClick={() => setMoveDlg({ lines: linesOf(pickedRows), to: null })}
                    >
                      <ArrowRightLeft size={16} />
                      Chuyển sang ngăn khác
                    </button>
                    <button type="button" className="kk-btn kk-btn-ghost kk-btn-sm" onClick={() => setPicked({ key: pagingKey, set: new Set() })}>
                      <X size={16} />
                      Bỏ chọn
                    </button>
                  </div>
                )}
                <div className="kk-table-scroll">
                  <table className="kk-table kk-table-plain">
                    <thead>
                      <tr>
                        {canMove && (
                          <th className="kk-col-check">
                            <input
                              type="checkbox"
                              aria-label="Chọn tất cả các dòng đang có hàng (mọi trang)"
                              title="Chọn tất cả các dòng đang có hàng (mọi trang)"
                              checked={allPicked}
                              disabled={stockRows.length === 0}
                              ref={(el) => {
                                if (el) el.indeterminate = !allPicked && pickedRows.length > 0
                              }}
                              onChange={togglePickAll}
                            />
                          </th>
                        )}
                        <th>Linh kiện</th>
                        {includeSub && selectedKids.length > 0 && <th>Nằm ở</th>}
                        <th className="is-num">Số lượng</th>
                        <th>Trạng thái</th>
                        {(canMove || (canEdit && moves.homesReady)) && (
                          <th className="kk-mv-rowact">
                            <span className="kk-mv-sr">Thao tác</span>
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((r) => (
                        <tr key={r.key} className={r.homeOnly ? 'kk-mv-homerow' : pickedSet.has(r.key) ? 'is-selected' : ''} onClick={() => openComponent(r.comp.id)}>
                          {canMove && (
                            <td className="kk-col-check" onClick={(e) => e.stopPropagation()}>
                              {!r.homeOnly && (
                                <input
                                  type="checkbox"
                                  aria-label={`Chọn ${r.comp.part_number}`}
                                  checked={pickedSet.has(r.key)}
                                  onChange={() => togglePick(r.key)}
                                />
                              )}
                            </td>
                          )}
                          <td data-label="Linh kiện" className="kk-cell-main">
                            <div className="kk-cell-media">
                              <RowThumb url={r.comp.image_url} />
                              <div className="kk-cell-body">
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
                                {r.homeOnly ? (
                                  <span className="kk-mv-homechip kk-mv-homechip-empty">
                                    <MapPin size={12} aria-hidden="true" />
                                    Chỗ cất, chưa có hàng ở đây
                                  </span>
                                ) : (
                                  r.isHome && (
                                    <span className="kk-mv-homechip" title="Chỗ cất mặc định của linh kiện này">
                                      <MapPin size={12} aria-hidden="true" />
                                      Chỗ cất
                                    </span>
                                  )
                                )}
                              </div>
                            </div>
                          </td>
                          {includeSub && selectedKids.length > 0 && <td data-label="Nằm ở">{r.inside || 'Ngay tại đây'}</td>}
                          <td data-label="Số lượng" className="is-num kk-strong-num">
                            {fmtNum(r.quantity)}
                          </td>
                          <td data-label="Trạng thái">
                            <StatusChip status={r.comp.status} />
                          </td>
                          {(canMove || (canEdit && moves.homesReady)) && (
                            <td className="kk-mv-rowact" onClick={(e) => e.stopPropagation()}>
                              {r.homeOnly ? (
                                <button
                                  type="button"
                                  className="kk-mv-rowbtn"
                                  title="Bỏ chỗ cất mặc định ở đây"
                                  onClick={() => unassign(r)}
                                >
                                  <MapPinOff size={14} aria-hidden="true" />
                                  Bỏ gán
                                </button>
                              ) : (
                                canMove && (
                                  <button
                                    type="button"
                                    className="kk-mv-rowbtn"
                                    title="Chuyển sang ngăn khác"
                                    onClick={() => setMoveDlg({ lines: linesOf([r]), to: null })}
                                  >
                                    <ArrowRightLeft size={14} aria-hidden="true" />
                                    Chuyển đi
                                  </button>
                                )
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </>
              )}
              {rows.length > PAGE_SIZE && (
                <div className="kk-pager">
                  <span>
                    Hiển thị {fmtNum(page * PAGE_SIZE + 1)} đến {fmtNum(page * PAGE_SIZE + pageRows.length)} trong {fmtNum(rows.length)} dòng
                  </span>
                  <div>
                    <button
                      type="button"
                      className="kk-icon-btn kk-icon-btn-boxed"
                      aria-label="Trang trước"
                      disabled={page === 0}
                      onClick={() => goTo(page - 1)}
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <span className="kk-pager-num">
                      {page + 1} / {pageCount}
                    </span>
                    <button
                      type="button"
                      className="kk-icon-btn kk-icon-btn-boxed"
                      aria-label="Trang sau"
                      disabled={page >= pageCount - 1}
                      onClick={() => goTo(page + 1)}
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {moveDlg && <MoveDialog lines={moveDlg.lines} toLocationId={moveDlg.to} onClose={() => setMoveDlg(null)} />}
      {homeDlg && selected && <HomeDialog location={selected} onClose={() => setHomeDlg(false)} />}
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
