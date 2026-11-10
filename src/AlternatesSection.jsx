import { useState } from 'react'
import { Check, Loader2, Pencil, Plus, Replace, X } from 'lucide-react'
import { supabase } from './supabaseClient'
import { useData } from './data/DataContext'
import { useShell } from './ShellContext'
import { useToast } from './ui/Toast'
import { ComponentPicker, StatusChip } from './ui/common'
import { friendlyError, mustChange } from './lib/api'
import { fmtNum } from './lib/format'

/**
 * Phần "Linh kiện tương đương" trong khung chi tiết linh kiện (sql/18_alternates.sql).
 * Các món chung một nhóm thay được cho nhau. Mỗi món có một dòng ghi chú riêng.
 */
export default function AlternatesSection({ id }) {
  const { alternates, componentsById, reload } = useData()
  const { openComponent, canEdit, isAdmin } = useShell()
  const toast = useToast()
  const [adding, setAdding] = useState(false)
  const [pick, setPick] = useState(null)
  const [pickNote, setPickNote] = useState('')
  const [editing, setEditing] = useState(null) // { id, note }
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  if (!alternates.ready) {
    return isAdmin ? (
      <>
        <h3 className="kk-sub">Linh kiện tương đương</h3>
        <p className="kk-muted-text">Muốn ghi các món thay thế được cho nhau, hãy chạy file sql/18_alternates.sql trong Supabase rồi tải lại trang.</p>
      </>
    ) : null
  }

  const list = alternates.of(id)
  const myNote = alternates.note(id)

  async function run(kind, fn, done) {
    if (busy) return
    setBusy(kind)
    setError('')
    try {
      await fn()
      await reload()
      done?.()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy('')
    }
  }

  const add = () => {
    if (!pick) return setError('Chọn một linh kiện.')
    const part = componentsById.get(pick)?.part_number ?? ''
    return run(
      'add',
      async () => {
        const { error: err } = await supabase.rpc('link_alternate', { p_a: id, p_b: pick })
        if (err) throw err
        if (pickNote.trim()) {
          mustChange(await supabase.from('component_alternates').update({ note: pickNote.trim() }).eq('component_id', pick).select('component_id'))
        }
      },
      () => {
        toast.push({ message: `Đã ghi ${part} là linh kiện tương đương.` })
        setAdding(false)
        setPick(null)
        setPickNote('')
      },
    )
  }

  const remove = (alt) =>
    run(`del-${alt.comp.id}`, async () => {
      const { error: err } = await supabase.rpc('unlink_alternate', { p_component: alt.comp.id })
      if (err) throw err
    })

  const saveNote = () =>
    run(
      'note',
      async () => {
        mustChange(
          await supabase
            .from('component_alternates')
            .update({ note: editing.note.trim() || null })
            .eq('component_id', editing.id)
            .select('component_id'),
        )
      },
      () => setEditing(null),
    )

  const noteEditor = (cid) => (
    <span className="kk-alt-note-edit">
      <input
        data-autofocus
        value={editing.note}
        maxLength={200}
        aria-label="Ghi chú"
        placeholder="Vd: dòng chịu được thấp hơn, 800mA"
        onChange={(e) => setEditing({ id: cid, note: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            saveNote()
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            setEditing(null)
          }
        }}
      />
      <button type="button" className="kk-icon-btn" aria-label="Lưu ghi chú" onClick={saveNote} disabled={busy === 'note'}>
        {busy === 'note' ? <Loader2 size={16} className="kk-spin" /> : <Check size={16} />}
      </button>
      <button type="button" className="kk-icon-btn" aria-label="Hủy" onClick={() => setEditing(null)}>
        <X size={16} />
      </button>
    </span>
  )

  return (
    <>
      <h3 className="kk-sub">Linh kiện tương đương</h3>
      {list.length === 0 ? (
        <p className="kk-muted-text">Chưa ghi món nào thay thế được cho linh kiện này.</p>
      ) : (
        <>
          {(myNote || canEdit) && (
            <p className="kk-alt-self">
              {editing?.id === id ? (
                noteEditor(id)
              ) : (
                <>
                  <span>Ghi chú của món này: {myNote || <em className="kk-muted-text">chưa có</em>}</span>
                  {canEdit && (
                    <button type="button" className="kk-icon-btn kk-c-edit" aria-label="Sửa ghi chú của món này" onClick={() => setEditing({ id, note: myNote })}>
                      <Pencil size={14} />
                    </button>
                  )}
                </>
              )}
            </p>
          )}
          <ul className="kk-alt-list">
            {list.map((alt) => (
              <li key={alt.comp.id}>
                <Replace size={16} aria-hidden="true" className="kk-alt-ico" />
                <span className="kk-list-main">
                  <span>
                    <button type="button" className="kk-row-link" onClick={() => openComponent(alt.comp.id)}>
                      {alt.comp.part_number}
                    </button>{' '}
                    <span className="kk-cell-name">{alt.comp.name}</span>
                  </span>
                  {editing?.id === alt.comp.id ? (
                    noteEditor(alt.comp.id)
                  ) : (
                    <small>
                      {alt.comp.archived_at ? 'Đang ngừng dùng' : `Trong kho: ${fmtNum(alt.comp.total_quantity)}`}
                      {alt.note ? ` · ${alt.note}` : ''}
                    </small>
                  )}
                </span>
                {!alt.comp.archived_at && <StatusChip status={alt.comp.status} />}
                {canEdit && editing?.id !== alt.comp.id && (
                  <span className="kk-plan-actions">
                    <button
                      type="button"
                      className="kk-icon-btn kk-c-edit"
                      aria-label={`Sửa ghi chú của ${alt.comp.part_number}`}
                      title="Sửa ghi chú"
                      onClick={() => setEditing({ id: alt.comp.id, note: alt.note })}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="kk-icon-btn kk-c-del"
                      aria-label={`Gỡ ${alt.comp.part_number} khỏi nhóm tương đương`}
                      title="Gỡ khỏi nhóm tương đương"
                      disabled={busy === `del-${alt.comp.id}`}
                      onClick={() => remove(alt)}
                    >
                      {busy === `del-${alt.comp.id}` ? <Loader2 size={14} className="kk-spin" /> : <X size={14} />}
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {canEdit &&
        (adding ? (
          <div className="kk-alt-add">
            <ComponentPicker id="alt-pick" value={pick} onChange={setPick} />
            <input value={pickNote} maxLength={200} placeholder="Ghi chú cho món này (không bắt buộc)" aria-label="Ghi chú cho món tương đương" onChange={(e) => setPickNote(e.target.value)} />
            <div className="kk-alt-add-actions">
              <button type="button" className="kk-btn kk-btn-primary kk-btn-sm" onClick={add} disabled={busy === 'add'}>
                {busy === 'add' ? <Loader2 size={16} className="kk-spin" /> : <Check size={16} />}
                Ghi là tương đương
              </button>
              <button
                type="button"
                className="kk-btn kk-btn-ghost kk-btn-sm"
                onClick={() => {
                  setAdding(false)
                  setPick(null)
                  setError('')
                }}
              >
                Hủy
              </button>
            </div>
            <small className="kk-hint">Các món chung một nhóm thay được cho nhau. Nếu món vừa chọn đã có nhóm riêng, hai nhóm sẽ gộp làm một.</small>
          </div>
        ) : (
          <button type="button" className="kk-btn kk-btn-soft kk-btn-sm kk-alt-open" onClick={() => setAdding(true)}>
            <Plus size={16} />
            Thêm món tương đương
          </button>
        ))}
      {error && (
        <p className="kk-form-error" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
