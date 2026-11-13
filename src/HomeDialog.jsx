import { useState } from 'react'
import { Loader2, MapPin, X } from 'lucide-react'
import { useData } from './data/DataContext'
import { useToast } from './ui/Toast'
import { Modal } from './ui/Modal'
import { ComponentPicker, Field } from './ui/common'
import { friendlyError } from './lib/api'
import { fmtNum } from './lib/format'
import { setHome } from './lib/moves'
import './moves.css'

/**
 * Gán chỗ cất mặc định: chọn nhiều linh kiện (kể cả món chưa có hàng) cho một ngăn.
 * Không đổi tồn kho, chỉ ghi nhớ "món này cất ở đây" để lần nhập sau tự chọn sẵn ngăn này.
 */
export default function HomeDialog({ location, onClose }) {
  const { componentsById, locationsById, homeOf, reload } = useData()
  const toast = useToast()
  const [ids, setIds] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function add(id) {
    if (!id) return
    setIds((list) => (list.includes(id) ? list : [...list, id]))
  }

  async function submit() {
    if (busy) return
    const todo = ids.filter((id) => homeOf.get(id) !== location.id)
    if (todo.length === 0) return setError(ids.length ? 'Các món đã chọn đều đang cất ở đây rồi.' : 'Hãy chọn ít nhất một linh kiện.')
    setBusy(true)
    setError('')
    try {
      await setHome(todo, location.id)
      await reload()
      toast.push({ message: `Đã gán ${fmtNum(todo.length)} linh kiện vào ${location.path}.` })
      onClose()
    } catch (e) {
      setError(friendlyError(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Gán linh kiện vào đây"
      subtitle={`Đặt ${location.path} làm chỗ cất mặc định. Tồn kho không đổi; lần nhập sau sẽ tự chọn sẵn ngăn này.`}
      onClose={onClose}
      footer={
        <>
          <span className="kk-foot-note">{ids.length ? `Đã chọn ${fmtNum(ids.length)} món` : 'Chưa chọn món nào'}</span>
          <button type="button" className="kk-btn kk-btn-ghost" onClick={onClose}>
            Hủy
          </button>
          <button type="button" className="kk-btn kk-btn-primary" onClick={submit} disabled={busy}>
            {busy ? <Loader2 size={18} className="kk-spin" /> : <MapPin size={18} />}
            {busy ? 'Đang lưu…' : 'Gán vào đây'}
          </button>
        </>
      }
    >
      <Field label="Thêm linh kiện" htmlFor="home-pick" hint="Chọn lần lượt từng món. Món chưa có hàng cũng gán được.">
        <ComponentPicker id="home-pick" value={null} autoFocus onChange={add} />
      </Field>

      {ids.length > 0 && (
        <ul className="kk-mv-picked">
          {ids.map((id) => {
            const c = componentsById.get(id)
            const cur = homeOf.get(id)
            return (
              <li key={id}>
                <span className="kk-mv-picked-main">
                  <b>{c?.part_number ?? '…'}</b>
                  <small>
                    {cur === location.id
                      ? 'Đã cất ở đây'
                      : cur
                        ? `Đang cất ở ${locationsById.get(cur)?.path ?? '…'}, sẽ đổi sang đây`
                        : c?.total_quantity > 0
                          ? `Chưa có chỗ cất mặc định, đang có ${fmtNum(c.total_quantity)} cái trong kho`
                          : 'Chưa có chỗ cất mặc định, chưa có hàng'}
                  </small>
                </span>
                <button
                  type="button"
                  className="kk-icon-btn"
                  aria-label={`Bỏ ${c?.part_number ?? ''} khỏi danh sách`}
                  onClick={() => setIds((list) => list.filter((x) => x !== id))}
                >
                  <X size={16} />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {error && (
        <p className="kk-form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}

/** Ô chọn chỗ cất mặc định của một linh kiện (dùng trong khung chi tiết) */
export function HomePicker({ comp, canEdit }) {
  const { locations, locationsById, homeOf, reload } = useData()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const cur = homeOf.get(comp.id) ?? ''

  if (!canEdit) return <span>{cur ? locationsById.get(cur)?.path : 'Chưa đặt'}</span>

  async function change(next) {
    setBusy(true)
    try {
      await setHome([comp.id], next || null)
      await reload()
      toast.push({ message: next ? `Chỗ cất của ${comp.part_number}: ${locationsById.get(next)?.path}.` : `Đã bỏ chỗ cất của ${comp.part_number}.` })
    } catch (e) {
      toast.push({ tone: 'error', message: friendlyError(e), duration: 9000 })
    } finally {
      setBusy(false)
    }
  }

  return (
    <select
      className="kk-mv-home-select"
      aria-label={`Chỗ cất mặc định của ${comp.part_number}`}
      value={cur}
      disabled={busy}
      onChange={(e) => change(e.target.value)}
    >
      <option value="">Chưa đặt</option>
      {locations.map((l) => (
        <option key={l.id} value={l.id}>
          {l.path}
        </option>
      ))}
    </select>
  )
}
