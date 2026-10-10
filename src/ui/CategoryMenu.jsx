import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, LayoutGrid } from 'lucide-react'
import { useData } from '../data/DataContext'

/**
 * Menu danh mục hai cột: bên trái là danh mục lớn, bên phải là danh mục con
 * (kèm danh mục chi tiết) của mục đang chọn.
 * - onPick: có thì tên danh mục bấm được (dùng để lọc / chọn).
 * - actions(category): các nút đặt cạnh từng danh mục (dùng trong Cài đặt).
 * - count(category): con số hiện cạnh tên.
 */
export function CategoryMega({ value, onPick, rootLabel, actions, count, activeRoot, onActiveRoot, page = false }) {
  const { categoriesById, categoryChildren, toneByCategory } = useData()
  const [inner, setInner] = useState(null)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  const roots = categoryChildren.get(null) ?? []
  const wanted = activeRoot ?? inner ?? categoriesById.get(value)?.root_id
  const root = roots.find((r) => r.id === wanted) ?? roots[0]
  if (!root) return null

  function activate(id) {
    clearTimeout(timer.current)
    setInner(id)
    onActiveRoot?.(id)
  }
  // Rê chuột thì chờ một nhịp để không nhảy mục khi đưa chuột chéo sang cột phải
  const hover = (id) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => activate(id), 120)
  }

  const kids = categoryChildren.get(root.id) ?? []
  const item = (c) => (
    <div className="kk-mega-item">
      {onPick ? (
        <button type="button" className={`kk-mega-name ${value === c.id ? 'is-on' : ''}`} onClick={() => onPick(c)}>
          {c.name}
        </button>
      ) : (
        <span className="kk-mega-name">{c.name}</span>
      )}
      {count && <span className="kk-mega-num">{count(c)}</span>}
      {actions?.(c)}
    </div>
  )

  return (
    <div className={`kk-mega ${page ? 'kk-mega-page' : ''}`}>
      <div className="kk-mega-in">
        <ul className="kk-mega-roots">
          {roots.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className={`kk-mega-root ${r.id === root.id ? 'is-active' : ''}`}
                aria-current={r.id === root.id ? 'true' : undefined}
                onMouseEnter={page ? undefined : () => hover(r.id)}
                onMouseLeave={() => clearTimeout(timer.current)}
                onFocus={() => activate(r.id)}
                onClick={() => activate(r.id)}
              >
                <i className={`kk-dot kk-tone-${toneByCategory.get(r.id) ?? 'x'}`} aria-hidden="true" />
                <span className="kk-mega-root-name">{r.name}</span>
                {count && <span className="kk-mega-num">{count(r)}</span>}
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>

        <div className="kk-mega-panel">
          <div className="kk-mega-head">
            {onPick ? (
              <button type="button" className={`kk-link ${value === root.id ? 'is-on' : ''}`} onClick={() => onPick(root)}>
                {rootLabel ? rootLabel(root) : root.name}
              </button>
            ) : (
              <strong>{root.name}</strong>
            )}
            {actions && <span className="kk-mega-head-actions">{actions(root)}</span>}
          </div>
          {kids.length === 0 ? (
            <p className="kk-muted-text">Danh mục này chưa có danh mục con.</p>
          ) : (
            <ul className="kk-mega-grid">
              {kids.map((k) => {
                const grand = categoryChildren.get(k.id) ?? []
                return (
                  <li key={k.id}>
                    {item(k)}
                    {grand.length > 0 && (
                      <ul className="kk-mega-sub">
                        {grand.map((g) => (
                          <li key={g.id}>{item(g)}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

/** Nút lọc theo danh mục trên thanh công cụ: bấm thì mở menu hai cột */
export function CategoryFilter({ value, onChange }) {
  const { categoriesById } = useData()
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  const picked = categoriesById.get(value)
  const label = value === 'none' ? 'Chưa phân loại' : (picked?.name ?? 'Mọi loại')

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (!box.current?.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function choose(id) {
    onChange(id)
    setOpen(false)
  }

  return (
    <div className="kk-catfilter" ref={box}>
      <button
        type="button"
        className={`kk-btn kk-btn-outline kk-catfilter-btn ${value ? 'is-set' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Lọc theo danh mục: ${picked?.path ?? label}`}
        title={picked?.path}
        onClick={() => setOpen((o) => !o)}
      >
        <LayoutGrid size={17} aria-hidden="true" />
        <span>{label}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="kk-catfilter-pop" role="dialog" aria-label="Chọn danh mục để lọc">
          <div className="kk-catfilter-top">
            <button type="button" className={`kk-pill ${!value ? 'is-on' : ''}`} onClick={() => choose('')}>
              Mọi loại
            </button>
            <button type="button" className={`kk-pill ${value === 'none' ? 'is-on' : ''}`} onClick={() => choose('none')}>
              Chưa phân loại
            </button>
          </div>
          <CategoryMega value={value} onPick={(c) => choose(c.id)} rootLabel={(r) => `Tất cả trong ${r.name}`} />
        </div>
      )}
    </div>
  )
}
