import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeftRight,
  Boxes,
  Cpu,
  FolderKanban,
  History,
  KeyRound,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  Sun,
} from 'lucide-react'
import { supabase } from './supabaseClient'
import useTheme from './useTheme'
import { APP_VERSION } from './version'
import { DataProvider, useData } from './data/DataContext'
import { ToastProvider } from './ui/Toast'
import { TxProvider, useTx } from './TxContext'
import { ShellContext } from './ShellContext'
import Overview from './pages/Overview'
import ComponentsPage from './pages/Components'
import LocationsPage from './pages/Locations'
import ProjectsPage from './pages/Projects'
import HistoryPage from './pages/History'
import SettingsPage from './pages/Settings'
import { Modal } from './ui/Modal'
import ComponentDrawer from './ComponentDrawer'
import ComponentForm from './ComponentForm'
import ImportCsvModal from './ImportCsvModal'
import './auth.css'
import './dashboard.css'

const COLLAPSE_KEY = 'kho_sidebar_collapsed'

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

const MORE_PAGES = [
  { to: '/locations', label: 'Vị trí', Icon: MapPin },
  { to: '/projects', label: 'Dự án và BOM', Icon: FolderKanban },
  { to: '/history', label: 'Lịch sử', Icon: History },
  { to: '/settings', label: 'Cài đặt', Icon: Settings },
]
// Trên điện thoại thanh tab chỉ đủ chỗ cho một trang nữa, các trang còn lại nằm trong mục "Khác"
const TAB_PAGE = MORE_PAGES[0]
const SHEET_PAGES = MORE_PAGES.slice(1)

export default function Dashboard({ session }) {
  return (
    <ToastProvider>
      <DataProvider>
        <TxProvider>
          <Shell session={session} />
        </TxProvider>
      </DataProvider>
    </ToastProvider>
  )
}

function Shell({ session }) {
  const [theme, toggleTheme] = useTheme()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [form, setForm] = useState(null) // { component: dòng linh kiện | null }
  const [importing, setImporting] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { components, refreshing } = useData()
  const { openTx } = useTx()

  const openId = params.get('c')
  const onComponents = location.pathname.startsWith('/components')
  const onSheetPage = SHEET_PAGES.some((p) => location.pathname.startsWith(p.to))
  const q = params.get('q') ?? ''
  const attention = useMemo(() => components.filter((c) => c.status !== 'ok').length, [components])
  const email = session?.user?.email ?? ''

  const openComponent = useCallback(
    (id) =>
      setParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set('c', id)
        return next
      }),
    [setParams],
  )
  const closeComponent = useCallback(
    () =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete('c')
          return next
        },
        { replace: true },
      ),
    [setParams],
  )

  const shell = useMemo(
    () => ({
      openComponent,
      closeComponent,
      openForm: (component) => setForm({ component: component ?? null }),
      openImport: () => setImporting(true),
      email,
    }),
    [openComponent, closeComponent, email],
  )

  function toggleCollapsed() {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1')
      } catch {
        /* bỏ qua nếu trình duyệt chặn lưu */
      }
      return !c
    })
  }

  function onSearch(value) {
    if (onComponents) {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (value) next.set('q', value)
          else next.delete('q')
          return next
        },
        { replace: true },
      )
    } else {
      navigate({ pathname: '/components', search: value ? `?q=${encodeURIComponent(value)}` : '' })
    }
  }

  // Phím tắt: "/" để tìm kiếm, "N" để nhập / xuất nhanh
  useEffect(() => {
    function onKey(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target
      const typing = t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))
      if (typing || document.querySelector('.kk-backdrop')) return
      if (e.key === '/') {
        const box = [...document.querySelectorAll('[data-global-search]')].find((el) => el.offsetParent !== null)
        if (box) {
          e.preventDefault()
          box.focus()
        }
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        openTx({ type: 'in' })
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [openTx])

  return (
    <ShellContext.Provider value={shell}>
      <div className="kk" data-collapsed={collapsed}>
        <aside className="kk-side" aria-label="Thanh bên">
          <div className="kk-side-brand">
            <span className="kk-logo">
              <Cpu size={24} />
            </span>
            <span className="kk-side-text">Kho Linh Kiện</span>
          </div>

          <nav className="kk-nav" aria-label="Điều hướng chính">
            <NavLink to="/" end title="Tổng quan">
              <LayoutDashboard size={20} />
              <span className="kk-side-text">Tổng quan</span>
            </NavLink>
            <NavLink to="/components" title="Linh kiện">
              <Boxes size={20} />
              <span className="kk-side-text">Linh kiện</span>
              {attention > 0 && (
                <span className="kk-badge" aria-label={`${attention} món sắp hết`}>
                  {attention}
                </span>
              )}
            </NavLink>
            <button type="button" onClick={() => openTx({ type: 'in' })} title="Nhập / xuất kho (phím N)">
              <ArrowLeftRight size={20} />
              <span className="kk-side-text">Nhập / xuất kho</span>
            </button>

            <div className="kk-nav-sep" />
            {MORE_PAGES.map(({ to, label, Icon }) => (
              <NavLink key={to} to={to} title={label}>
                <Icon size={20} />
                <span className="kk-side-text">{label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="kk-side-foot">
            <button
              type="button"
              className="kk-collapse"
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}
              title={collapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}
            >
              {collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
              <span className="kk-side-text">Thu gọn</span>
            </button>
            <span className="kk-version kk-side-text">{APP_VERSION}</span>
          </div>
        </aside>

        <div className="kk-main">
          <header className="kk-top">
            <span className="kk-top-brand">
              <span className="kk-logo kk-logo-sm">
                <Cpu size={20} />
              </span>
              Kho Linh Kiện
            </span>

            <div className="kk-search kk-search-top">
              <Search size={18} aria-hidden="true" />
              <input
                data-global-search
                type="search"
                value={onComponents ? q : ''}
                placeholder="Tìm linh kiện"
                aria-label="Tìm linh kiện"
                onChange={(e) => onSearch(e.target.value)}
              />
              <kbd aria-hidden="true">/</kbd>
            </div>

            <div className="kk-top-actions">
              <button type="button" className="kk-btn kk-btn-primary kk-top-tx" onClick={() => openTx({ type: 'in' })}>
                <Plus size={18} />
                Nhập / xuất
                <kbd aria-hidden="true">N</kbd>
              </button>
              <button
                type="button"
                className="kk-icon-btn kk-icon-btn-boxed"
                onClick={toggleTheme}
                aria-label="Đổi giao diện sáng/tối"
                title="Đổi giao diện sáng/tối"
              >
                {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
              </button>
              <div className="kk-account">
                <span className="kk-avatar" aria-hidden="true">
                  {(email[0] ?? '?').toUpperCase()}
                </span>
                <span className="kk-account-mail" title={email}>
                  {email}
                </span>
                <button
                  type="button"
                  className="kk-icon-btn kk-icon-btn-boxed"
                  onClick={() => supabase.auth.signOut()}
                  aria-label="Đăng xuất"
                  title="Đăng xuất"
                >
                  <LogOut size={18} />
                </button>
              </div>
            </div>
            {refreshing && <div className="kk-pulsebar" role="status" aria-label="Đang cập nhật dữ liệu" />}
          </header>

          <main className="kk-content">
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/components" element={<ComponentsPage />} />
              <Route path="/locations" element={<LocationsPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>

        <nav className="kk-tabbar" aria-label="Điều hướng trên điện thoại">
          <NavLink to="/" end>
            <LayoutDashboard size={22} />
            <span>Tổng quan</span>
          </NavLink>
          <NavLink to="/components">
            <Boxes size={22} />
            <span>Linh kiện</span>
            {attention > 0 && <i className="kk-tab-dot" aria-label={`${attention} món sắp hết`} />}
          </NavLink>
          <button type="button" className="kk-fab" onClick={() => openTx({ type: 'in' })} aria-label="Nhập / xuất kho">
            <Plus size={28} />
          </button>
          <NavLink to={TAB_PAGE.to}>
            <TAB_PAGE.Icon size={22} />
            <span>{TAB_PAGE.label}</span>
          </NavLink>
          <button type="button" className={onSheetPage ? 'active' : ''} aria-haspopup="dialog" onClick={() => setMenuOpen(true)}>
            <Menu size={22} />
            <span>Khác</span>
          </button>
        </nav>
      </div>

      {menuOpen && (
        <Modal title="Mục khác" subtitle={email} onClose={() => setMenuOpen(false)}>
          <nav className="kk-menu" aria-label="Các trang khác">
            {SHEET_PAGES.map(({ to, label, Icon }) => (
              <NavLink key={to} to={to} onClick={() => setMenuOpen(false)}>
                <Icon size={20} />
                {label}
              </NavLink>
            ))}
            <Link to="/settings#account" onClick={() => setMenuOpen(false)}>
              <KeyRound size={20} />
              Đổi mật khẩu
            </Link>
            <div className="kk-menu-sep" />
            <button type="button" onClick={toggleTheme}>
              {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
              {theme === 'light' ? 'Chuyển sang giao diện tối' : 'Chuyển sang giao diện sáng'}
            </button>
            <button type="button" onClick={() => supabase.auth.signOut()}>
              <LogOut size={20} />
              Đăng xuất
            </button>
          </nav>
        </Modal>
      )}

      {openId && <ComponentDrawer key={openId} id={openId} onClose={closeComponent} />}
      {form && (
        <ComponentForm
          initial={form.component}
          onClose={() => setForm(null)}
          onSaved={(id) => {
            if (!form.component) openComponent(id)
          }}
        />
      )}
      {importing && <ImportCsvModal onClose={() => setImporting(false)} />}
    </ShellContext.Provider>
  )
}
