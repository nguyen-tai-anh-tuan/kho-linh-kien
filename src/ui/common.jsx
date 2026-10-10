import { useId, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, XCircle, Minus, Plus, Loader2 } from 'lucide-react'
import { useData } from '../data/DataContext'
import { CategoryMega } from './CategoryMenu'
import { friendlyError } from '../lib/api'
import { fmtNum, normalize } from '../lib/format'

/* ------------------------------------------------------------------ */
/* Khung xương + vạch mạch có xung vàng chạy khi đang tải             */
/* ------------------------------------------------------------------ */
export function Skeleton({ w = '100%', h = 16, r = 8, style }) {
  return <span className="kk-skel" style={{ width: w, height: h, borderRadius: r, ...style }} aria-hidden="true" />
}

export function TraceLoader({ label = 'Đang tải dữ liệu' }) {
  return (
    <div className="kk-trace" role="status" aria-label={label}>
      <svg viewBox="0 0 240 24" preserveAspectRatio="none" aria-hidden="true">
        <path className="kk-trace-base" d="M0 12H70L82 4H130L142 20H170L180 12H240" pathLength="100" />
        <path className="kk-trace-pulse" d="M0 12H70L82 4H130L142 20H170L180 12H240" pathLength="100" />
      </svg>
      <span>{label}…</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Trạng thái trống                                                    */
/* ------------------------------------------------------------------ */
export function EmptyState({ title, text, children }) {
  return (
    <div className="kk-empty">
      <svg viewBox="0 0 120 96" width="120" height="96" aria-hidden="true">
        <path d="M0 60H26L36 50H50" className="kk-empty-trace" />
        <path d="M120 36H96L86 46H70" className="kk-empty-trace" />
        <path d="M60 96V80" className="kk-empty-trace" />
        <rect x="38" y="24" width="44" height="44" rx="9" className="kk-empty-chip" />
        <rect x="50" y="36" width="20" height="20" rx="5" className="kk-empty-core" />
        <circle cx="26" cy="60" r="4" className="kk-empty-pad" />
        <circle cx="96" cy="36" r="4" className="kk-empty-pad" />
        <circle cx="60" cy="80" r="4" className="kk-empty-pad" />
      </svg>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {children && <div className="kk-empty-actions">{children}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Chip trạng thái / loại                                              */
/* ------------------------------------------------------------------ */
const STATUS = {
  ok: { label: 'Còn hàng', Icon: CheckCircle2 },
  low: { label: 'Sắp hết', Icon: AlertTriangle },
  out: { label: 'Hết hàng', Icon: XCircle },
}

export function StatusChip({ status }) {
  const s = STATUS[status] ?? STATUS.ok
  return (
    <span className={`kk-status kk-status-${status}`}>
      <s.Icon size={14} aria-hidden="true" />
      {s.label}
    </span>
  )
}

export function CategoryChip({ name, tone, title }) {
  if (!name) return <span className="kk-chip kk-chip-none">Chưa phân loại</span>
  return (
    <span className="kk-chip" title={title}>
      <i className={`kk-dot kk-tone-${tone ?? 'x'}`} aria-hidden="true" />
      {name}
    </span>
  )
}

/** Thanh tồn kho: vạch giữa là mức tối thiểu, thanh đầy ở mức gấp đôi tối thiểu */
export function StockBar({ qty, min, status }) {
  const pct = min > 0 ? Math.min(100, (qty / (min * 2)) * 100) : 0
  return (
    <div className="kk-stock">
      <span className="kk-stock-num">{fmtNum(qty)}</span>
      {min > 0 && (
        <span
          className="kk-stock-bar"
          role="img"
          aria-label={`Tồn ${fmtNum(qty)}, tối thiểu ${fmtNum(min)}`}
          title={`Tối thiểu ${fmtNum(min)}`}
        >
          <i className={`kk-stock-fill kk-fill-${status}`} style={{ width: `${pct}%` }} />
          <b className="kk-stock-mark" />
        </span>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Ô nhập có nhãn                                                      */
/* ------------------------------------------------------------------ */
export function Field({ label, htmlFor, hint, error, children, className = '' }) {
  return (
    <div className={`kk-field ${className}`}>
      {label && <label htmlFor={htmlFor}>{label}</label>}
      {children}
      {hint && !error && <small className="kk-hint">{hint}</small>}
      {error && (
        <small className="kk-field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Ô chọn có nút "+" để tạo nhanh mục mới                              */
/* ------------------------------------------------------------------ */
export function SelectWithCreate({
  id,
  value,
  onChange,
  options,
  placeholder = 'Chọn…',
  onCreate,
  createLabel = 'Thêm mới',
  disabled,
  invalid,
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    if (busy) return
    if (!name.trim()) return setErr('Hãy nhập tên.')
    setBusy(true)
    setErr('')
    try {
      const row = await onCreate(name)
      onChange(row.id)
      setAdding(false)
      setName('')
    } catch (e) {
      setErr(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  if (adding) {
    return (
      <div className="kk-create">
        <div className="kk-create-row">
          <input
            data-autofocus
            value={name}
            placeholder={createLabel}
            aria-label={createLabel}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submit()
              } else if (e.key === 'Escape') {
                e.stopPropagation()
                setAdding(false)
                setErr('')
              }
            }}
          />
          <button type="button" className="kk-btn kk-btn-primary kk-btn-sm" onClick={submit} disabled={busy}>
            {busy ? <Loader2 size={16} className="kk-spin" /> : 'Thêm'}
          </button>
          <button
            type="button"
            className="kk-btn kk-btn-ghost kk-btn-sm"
            onClick={() => {
              setAdding(false)
              setErr('')
            }}
          >
            Hủy
          </button>
        </div>
        {err && (
          <small className="kk-field-error" role="alert">
            {err}
          </small>
        )}
      </div>
    )
  }

  return (
    <div className="kk-select-row">
      <select
        id={id}
        value={value ?? ''}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {onCreate && (
        <button
          type="button"
          className="kk-icon-btn kk-icon-btn-boxed"
          aria-label={createLabel}
          title={createLabel}
          disabled={disabled}
          onClick={() => setAdding(true)}
        >
          <Plus size={18} />
        </button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Ô số lượng có nút - / +                                             */
/* ------------------------------------------------------------------ */
export function QtyStepper({ value, onChange, min = 0, id, label = 'Số lượng', invalid }) {
  const num = value === '' || value === null ? NaN : Number(value)
  const dec = () => onChange(Number.isNaN(num) ? min : Math.max(min, num - 1))
  const inc = () => onChange(Number.isNaN(num) ? Math.max(min, 1) : num + 1)
  return (
    <div className={`kk-stepper ${invalid ? 'is-invalid' : ''}`}>
      <button type="button" aria-label="Giảm 1" onClick={dec} disabled={!(num > min)}>
        <Minus size={16} />
      </button>
      <input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        aria-label={label}
        aria-invalid={invalid || undefined}
        value={Number.isNaN(num) ? '' : num}
        onChange={(e) => {
          const digits = e.target.value.replace(/[^0-9]/g, '').slice(0, 9)
          onChange(digits === '' ? '' : Number(digits))
        }}
        onFocus={(e) => e.target.select()}
      />
      <button type="button" aria-label="Tăng 1" onClick={inc}>
        <Plus size={16} />
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Ô tìm và chọn danh mục: hiện đường dẫn đầy đủ "Lớn › Con › Chi tiết" */
/* ------------------------------------------------------------------ */
export function CategoryPicker({ id, value, onChange }) {
  const { categories, categoriesById } = useData()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const listId = useId()
  const selected = value ? categoriesById.get(value) : null

  // Dòng đầu luôn là "Chưa phân loại" để bỏ chọn
  const results = useMemo(() => {
    const terms = normalize(q).split(/\s+/).filter(Boolean)
    const list = terms.length
      ? categories.filter((c) => {
          const text = normalize(c.path)
          return terms.every((t) => text.includes(t))
        })
      : categories
    return [null, ...list]
  }, [q, categories])

  function pick(c) {
    onChange(c ? c.id : null)
    setOpen(false)
    setQ('')
  }

  if (selected) {
    return (
      <div className="kk-picked">
        <div className="kk-picked-text">
          <strong>{selected.name}</strong>
          {selected.depth > 0 && <span>{selected.path.slice(0, -(selected.name.length + 3))}</span>}
        </div>
        <button
          type="button"
          className="kk-link"
          onClick={() => {
            onChange(null)
            setOpen(true)
          }}
        >
          Đổi
        </button>
      </div>
    )
  }

  return (
    <div
      className="kk-combo"
      onBlur={(e) => {
        // Chỉ đóng khi con trỏ rời hẳn khỏi ô chọn (Tab vào menu thì vẫn mở)
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false)
      }}
    >
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && q && results[hi] !== undefined ? `${listId}-${hi}` : undefined}
        autoComplete="off"
        autoFocus={open}
        placeholder="Chưa phân loại. Bấm để chọn hoặc gõ để tìm…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
          setHi(e.target.value ? 1 : 0)
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setHi((h) => Math.min(h + 1, results.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHi((h) => Math.max(h - 1, 0))
          } else if (e.key === 'Enter' && open && q && results[hi] !== undefined) {
            e.preventDefault()
            pick(results[hi])
          } else if (e.key === 'Escape' && open) {
            e.stopPropagation()
            setOpen(false)
          }
        }}
      />
      {/* Chưa gõ gì: duyệt theo menu hai cột. Đang gõ: danh sách kết quả tìm. */}
      {open && !q && categories.length > 0 && (
        <div className="kk-combo-mega" id={listId} onMouseDown={(e) => e.preventDefault()}>
          <CategoryMega onPick={pick} rootLabel={(r) => `Chọn danh mục lớn "${r.name}"`} />
        </div>
      )}
      {open && (q || categories.length === 0) && (
        <ul className="kk-combo-list kk-cat-list" id={listId} role="listbox" tabIndex={-1}>
          {results.map((c, i) => (
            <li
              key={c ? c.id : 'none'}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === hi}
              className={i === hi ? 'is-hi' : ''}
              style={c && !q ? { paddingLeft: 10 + c.depth * 16 } : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHi(i)}
              onClick={() => pick(c)}
            >
              {c ? (
                <span className="kk-combo-main">
                  <strong className={c.depth === 0 ? '' : 'kk-cat-sub'}>{c.name}</strong>
                  {q && c.depth > 0 && <span>{c.path.slice(0, -(c.name.length + 3))}</span>}
                </span>
              ) : (
                <span className="kk-combo-main kk-cat-none">Chưa phân loại</span>
              )}
            </li>
          ))}
          {results.length === 1 && q && <li className="kk-combo-empty">Không có danh mục nào khớp. Bạn có thể thêm danh mục mới trong trang Cài đặt.</li>}
        </ul>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Ô tìm và chọn linh kiện (gợi ý khi gõ)                              */
/* ------------------------------------------------------------------ */
export function ComponentPicker({ value, onChange, invalid, autoFocus, id }) {
  const { components, componentsById, searchText } = useData()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const listId = useId()
  const selected = value ? componentsById.get(value) : null

  const results = useMemo(() => {
    const n = normalize(q)
    const list = n ? components.filter((c) => (searchText.get(c.id) ?? '').includes(n)) : components
    return list.slice(0, 8)
  }, [q, components, searchText])

  function pick(c) {
    onChange(c.id)
    setOpen(false)
    setQ('')
  }

  if (selected) {
    return (
      <div className={`kk-picked ${invalid ? 'is-invalid' : ''}`}>
        <div className="kk-picked-text">
          <strong>{selected.part_number}</strong>
          <span>{selected.name}</span>
        </div>
        <button
          type="button"
          className="kk-link"
          onClick={() => {
            onChange(null)
            setOpen(true)
          }}
        >
          Đổi
        </button>
      </div>
    )
  }

  return (
    <div className="kk-combo">
      <input
        id={id}
        data-autofocus={autoFocus ? '' : undefined}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && results[hi] ? `${listId}-${hi}` : undefined}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        placeholder="Gõ mã hoặc tên linh kiện…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
          setHi(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setHi((h) => Math.min(h + 1, results.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHi((h) => Math.max(h - 1, 0))
          } else if (e.key === 'Enter' && open && results[hi]) {
            e.preventDefault()
            pick(results[hi])
          } else if (e.key === 'Escape' && open) {
            e.stopPropagation()
            setOpen(false)
          }
        }}
      />
      {open && (
        <ul className="kk-combo-list" id={listId} role="listbox" tabIndex={-1}>
          {results.length === 0 && <li className="kk-combo-empty">Không tìm thấy linh kiện nào.</li>}
          {results.map((c, i) => (
            <li
              key={c.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === hi}
              className={i === hi ? 'is-hi' : ''}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHi(i)}
              onClick={() => pick(c)}
            >
              <span className="kk-combo-main">
                <strong>{c.part_number}</strong>
                <span>{c.name}</span>
              </span>
              <span className="kk-combo-meta">
                {c.package ? `${c.package}, ` : ''}tồn {fmtNum(c.total_quantity)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
