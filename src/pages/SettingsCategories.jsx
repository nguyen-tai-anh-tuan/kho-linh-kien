import { useMemo, useState } from 'react'
import { AlertTriangle, CornerDownRight, FolderPlus, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useData } from '../data/DataContext'
import { useShell } from '../ShellContext'
import { useToast } from '../ui/Toast'
import { Modal } from '../ui/Modal'
import { ConfirmDialog, NameDialog } from '../ui/dialogs'
import { Field, Skeleton } from '../ui/common'
import { CategoryMega } from '../ui/CategoryMenu'
import { friendlyError, mustChange } from '../lib/api'
import { indentLabel, subtreeIds } from '../lib/tree'
import { fmtNum, normalize } from '../lib/format'

// Tên gọi của ba tầng
const LEVELS = ['danh mục lớn', 'danh mục con', 'danh mục chi tiết']
const MAX_DEPTH = LEVELS.length - 1
const levelName = (depth) => LEVELS[Math.min(depth, MAX_DEPTH)]

/** Mục "Danh mục linh kiện" của trang Cài đặt: cây ba tầng, admin thêm / đổi tên / chuyển / xóa */
export default function SettingsCategories() {
  const { components, categories, categoryChildren, categoryTree, loading, reload, createCategory } = useData()
  const { isAdmin, canEdit } = useShell()
  const toast = useToast()
  const [activeRoot, setActiveRoot] = useState(null) // danh mục lớn đang xem ở cột trái
  const [dialog, setDialog] = useState(null) // { kind: 'add' | 'rename' | 'move' | 'delete', category }

  // Số linh kiện gắn trực tiếp vào từng danh mục, và tính cả các danh mục bên trong
  const { direct, total, uncategorized } = useMemo(() => {
    const direct = new Map()
    let uncategorized = 0
    for (const c of components) {
      if (c.category_id) direct.set(c.category_id, (direct.get(c.category_id) ?? 0) + 1)
      else uncategorized++
    }
    const total = new Map(
      categories.map((c) => [c.id, subtreeIds(categoryChildren, c.id).reduce((sum, id) => sum + (direct.get(id) ?? 0), 0)]),
    )
    return { direct, total, uncategorized }
  }, [components, categories, categoryChildren])

  const kidsOf = (id) => categoryChildren.get(id) ?? []
  // Số tầng nằm bên dưới một danh mục (0 = không có danh mục con)
  const heightOf = (id) => (kidsOf(id).length === 0 ? 0 : kidsOf(id).some((k) => kidsOf(k.id).length > 0) ? 2 : 1)
  const siblingNames = (parentId, exceptId) =>
    kidsOf(parentId ?? null)
      .filter((c) => c.id !== exceptId)
      .map((c) => normalize(c.name))

  async function add(name, parent) {
    const row = await createCategory(name, parent?.id ?? null)
    setActiveRoot(parent ? parent.root_id : row.id)
    toast.push({ message: `Đã thêm ${levelName(parent ? parent.depth + 1 : 0)} ${name}.` })
  }

  async function rename(category, name) {
    mustChange(await supabase.from('categories').update({ name }).eq('id', category.id).select('id'))
    await reload()
    toast.push({ message: `Đã đổi tên thành ${name}.` })
  }

  async function move(category, parentId) {
    const order = Math.max(0, ...kidsOf(parentId).map((c) => c.sort_order ?? 0)) + 1
    mustChange(
      await supabase.from('categories').update({ parent_id: parentId, sort_order: order }).eq('id', category.id).select('id'),
    )
    await reload()
    setActiveRoot(parentId ? categories.find((c) => c.id === parentId)?.root_id : category.id)
    toast.push({ message: `Đã chuyển ${category.name}.` })
  }

  async function remove(category) {
    const { error } = await supabase.rpc('delete_category', { target: category.id })
    if (error) throw error
    await reload()
    toast.push({ message: `Đã xóa ${levelName(category.depth)} ${category.name}.` })
  }

  // Các nút cạnh một danh mục: thành viên được thêm, còn đổi tên / chuyển / xóa là của admin
  const actions = (c) => {
    const kids = kidsOf(c.id)
    return (
      <span className="kk-cat-actions">
        {categoryTree && c.depth < MAX_DEPTH && (
          <button
            type="button"
            className="kk-icon-btn"
            aria-label={`Thêm ${levelName(c.depth + 1)} vào ${c.name}`}
            title={`Thêm ${levelName(c.depth + 1)}`}
            onClick={() => setDialog({ kind: 'add', category: c })}
          >
            <FolderPlus size={16} />
          </button>
        )}
        {isAdmin && (
          <button
            type="button"
            className="kk-icon-btn"
            aria-label={`Đổi tên ${c.name}`}
            title="Đổi tên"
            onClick={() => setDialog({ kind: 'rename', category: c })}
          >
            <Pencil size={16} />
          </button>
        )}
        {isAdmin && categoryTree && (
          <>
            <button
              type="button"
              className="kk-icon-btn"
              aria-label={`Chuyển ${c.name} sang danh mục khác`}
              title="Chuyển vào danh mục khác"
              onClick={() => setDialog({ kind: 'move', category: c })}
            >
              <CornerDownRight size={16} />
            </button>
            <button
              type="button"
              className="kk-icon-btn"
              aria-label={`Xóa ${c.name}`}
              title={kids.length > 0 ? 'Hãy xóa hoặc chuyển các danh mục bên trong trước' : 'Xóa danh mục'}
              disabled={kids.length > 0}
              onClick={() => setDialog({ kind: 'delete', category: c })}
            >
              <Trash2 size={16} />
            </button>
          </>
        )}
      </span>
    )
  }

  return (
    <section className="kk-card" aria-labelledby="set-cat">
      <div className="kk-card-head">
        <div>
          <h2 id="set-cat">Danh mục linh kiện</h2>
          <p className="kk-card-sub">
            Ba tầng: danh mục lớn, danh mục con, danh mục chi tiết. Linh kiện gắn được vào bất kỳ tầng nào.
          </p>
        </div>
        {canEdit && (
          <button type="button" className="kk-btn kk-btn-soft kk-btn-sm" onClick={() => setDialog({ kind: 'add', category: null })}>
            <Plus size={16} />
            Thêm danh mục lớn
          </button>
        )}
      </div>

      {isAdmin && !categoryTree && !loading && (
        <p className="kk-banner kk-banner-warn kk-cat-banner" role="status">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>
            Database chưa có danh mục nhiều tầng. Mở Supabase, vào SQL Editor, dán nội dung file sql/05_categories.sql rồi bấm Run,
            sau đó tải lại trang.
          </span>
        </p>
      )}

      {loading ? (
        <div className="kk-skel-list">
          <Skeleton h={40} r={10} />
          <Skeleton h={40} r={10} />
          <Skeleton h={40} r={10} />
        </div>
      ) : categories.length === 0 ? (
        <p className="kk-muted-text">
          {canEdit ? 'Chưa có danh mục nào. Thêm danh mục lớn đầu tiên, ví dụ "IC - Mạch tích hợp".' : 'Chưa có danh mục nào.'}
        </p>
      ) : (
        <>
          <CategoryMega
            page
            activeRoot={activeRoot}
            onActiveRoot={setActiveRoot}
            count={(c) => <span title={`${fmtNum(total.get(c.id) ?? 0)} linh kiện`}>{fmtNum(total.get(c.id) ?? 0)}</span>}
            actions={canEdit ? actions : undefined}
          />
          <p className="kk-muted-text kk-cat-note">
            Con số cạnh mỗi danh mục là số linh kiện bên trong, tính cả các danh mục con.
            {uncategorized > 0 && ` Còn ${fmtNum(uncategorized)} linh kiện chưa phân loại.`}
          </p>
        </>
      )}

      {dialog?.kind === 'add' && (
        <NameDialog
          title={`Thêm ${levelName(dialog.category ? dialog.category.depth + 1 : 0)}`}
          subtitle={dialog.category ? `Bên trong ${dialog.category.path}` : undefined}
          label="Tên danh mục"
          placeholder={dialog.category ? 'Vd: EEPROM' : 'Vd: IC - Mạch tích hợp'}
          submitLabel="Thêm danh mục"
          validate={(name) =>
            siblingNames(dialog.category?.id, null).includes(normalize(name)) ? 'Ở đây đã có danh mục trùng tên này.' : ''
          }
          onSubmit={(name) => add(name, dialog.category)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'rename' && (
        <NameDialog
          title={`Đổi tên ${levelName(dialog.category.depth)}`}
          subtitle={dialog.category.path}
          label="Tên mới"
          initial={dialog.category.name}
          submitLabel="Lưu tên mới"
          validate={(name) =>
            siblingNames(dialog.category.parent_id, dialog.category.id).includes(normalize(name))
              ? 'Ở đây đã có danh mục trùng tên này.'
              : ''
          }
          onSubmit={(name) => rename(dialog.category, name)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'move' && (
        <MoveDialog
          category={dialog.category}
          height={heightOf(dialog.category.id)}
          siblingNames={siblingNames}
          onMove={(parentId) => move(dialog.category, parentId)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={`Xóa ${levelName(dialog.category.depth)} ${dialog.category.name}?`}
          text={deleteText(dialog.category, direct.get(dialog.category.id) ?? 0, categories)}
          confirmLabel="Xóa danh mục"
          Icon={Trash2}
          onConfirm={() => remove(dialog.category)}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  )
}

function deleteText(category, count, categories) {
  if (count === 0) return 'Danh mục này chưa có linh kiện nào nên xóa sẽ không ảnh hưởng gì đến kho.'
  const parent = categories.find((c) => c.id === category.parent_id)
  const where = parent ? `chuyển lên danh mục "${parent.name}"` : 'chuyển về "Chưa phân loại"'
  return `${fmtNum(count)} linh kiện đang gắn vào danh mục này sẽ ${where}. Linh kiện và tồn kho không bị xóa.`
}

/** Chọn danh mục cha mới. Chỉ liệt kê những nơi chuyển tới được mà cây vẫn không quá ba tầng. */
function MoveDialog({ category, height, siblingNames, onMove, onClose }) {
  const { categories, categoryChildren } = useData()
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const inside = new Set(subtreeIds(categoryChildren, category.id))
  const options = categories.filter((c) => !inside.has(c.id) && c.id !== category.parent_id && c.depth + 1 + height <= MAX_DEPTH)
  const canBeRoot = category.parent_id !== null

  async function submit(ev) {
    ev.preventDefault()
    if (busy) return
    if (!target) return setError('Hãy chọn nơi chuyển tới.')
    const parentId = target === 'root' ? null : target
    if (siblingNames(parentId, category.id).includes(normalize(category.name))) {
      return setError('Nơi chuyển tới đã có danh mục trùng tên. Hãy đổi tên một trong hai trước.')
    }
    setBusy(true)
    setError('')
    try {
      await onMove(parentId)
      onClose()
    } catch (e) {
      setError(friendlyError(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Chuyển ${category.name}`}
      subtitle={`Đang ở: ${category.depth === 0 ? 'tầng danh mục lớn' : category.path}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="kk-btn kk-btn-ghost" onClick={onClose} disabled={busy}>
            Hủy
          </button>
          <button type="submit" form="move-category" className="kk-btn kk-btn-primary" disabled={busy || (!canBeRoot && options.length === 0)}>
            {busy && <Loader2 size={18} className="kk-spin" />}
            Chuyển danh mục
          </button>
        </>
      }
    >
      <form id="move-category" onSubmit={submit} noValidate>
        {!canBeRoot && options.length === 0 ? (
          <p className="kk-muted-text">
            Chưa có nơi nào chuyển tới được. Danh mục này còn danh mục bên trong, nên đặt nó vào danh mục khác sẽ làm cây sâu quá ba tầng.
          </p>
        ) : (
          <Field
            label="Chuyển vào"
            htmlFor="move-target"
            error={error}
            hint="Các danh mục bên trong và linh kiện đang gắn sẽ đi theo."
          >
            <select
              id="move-target"
              data-autofocus
              value={target}
              aria-invalid={error ? true : undefined}
              onChange={(e) => {
                setTarget(e.target.value)
                setError('')
              }}
            >
              <option value="">Chọn nơi chuyển tới</option>
              {canBeRoot && <option value="root">Đưa lên thành danh mục lớn</option>}
              {options.map((c) => (
                <option key={c.id} value={c.id}>
                  {indentLabel(c)}
                </option>
              ))}
            </select>
          </Field>
        )}
      </form>
    </Modal>
  )
}
