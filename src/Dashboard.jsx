import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeftRight,
  Boxes,
  Cpu,
  ExternalLink,
  FolderKanban,
  FolderTree,
  History,
  KeyRound,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PencilRuler,
  Plus,
  Search,
  Settings,
  ShoppingCart,
  Sun,
} from 'lucide-react'
import { signOutHere, supabase } from './supabaseClient'
import useTheme from './useTheme'
import { APP_VERSION } from './version'
import { DataProvider, useData } from './data/DataContext'
import { useBuyList } from './data/useBuyList'
import { usePurchaseItems } from './pages/PurchasePlan'
import { ToastProvider } from './ui/Toast'
import { TxProvider, useTx } from './TxContext'
import { ShellContext } from './ShellContext'
import { canEdit, isAdmin, roleLabel } from './lib/roles'
import Overview from './pages/Overview'
import ComponentsPage from './pages/Components'
import ShoppingPage from './pages/Shopping'
import LocationsPage from './pages/Locations'
import CategoriesPage from './pages/Categories'
import ProjectsPage from './pages/Projects'
import ProjectViewPage from './pages/ProjectView'
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

// Địa chỉ web Electronics Lab: chưa đặt thì không hiện mục này
const LAB_URL = import.meta.env.VITE_LAB_URL

const MORE_PAGES = [
  { to: '/locations', label: 'Vị trí', Icon: MapPin },
  { to: '/categories', label: 'Danh mục', Icon: FolderTree },
  { to: '/projects', label: 'Dự án và BOM', Icon: FolderKanban },
  { to: '/history', label: 'Lịch sử', Icon: History },
  { to: '/settings', label: 'Cài đặt', Icon: Settings },
]
// Trên điện thoại thanh tab chỉ đủ chỗ cho một trang nữa, các trang còn lại nằm trong mục "Khác"
const TAB_PAGE = MORE_PAGES[0]
const SHEET_PAGES = [{ to: '/buy', label: 'Cần mua', Icon: ShoppingCart }, ...MORE_PAGES.slice(1)]

export default function Dashboard({ session, profile, reloadProfile }) {
  return (
    <ToastProvider>
      <DataProvider>
        <TxProvider>
          <Shell session={session} profile={profile} reloadProfile={reloadProfile} />
        </TxProvider>
      </DataProvider>
    </ToastProvider>
  )
}

function Shell({ session, profile, reloadProfile }) {
  const [theme, toggleTheme] = useTheme()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [form, setForm] = useState(null) // { component: dòng linh kiện | null }
  const [importing, setImporting] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { refreshing, version } = useData()
  const { openTx } = useTx()

  const openId = params.get('c')
  const onComponents = location.pathname.startsWith('/components')
  const onSheetPage = SHEET_PAGES.some((p) => location.pathname.startsWith(p.to))
  const q = params.get('q') ?? ''
  // Đếm đúng số dòng của trang Cần mua. Đổi trang thì tính lại, vì BOM có thể vừa được sửa.
  const attention = useBuyList(location.pathname).toBuy.length
  // Số món trong danh sách mua trước (thẻ thứ hai của trang Cần mua)
  const planned = usePurchaseItems(`${version}|${location.pathname}`).rows?.length ?? 0
  const buyBadges = (
    <BuyBadges auto={attention} plan={planned} />
  )
  const email = session?.user?.email ?? ''
  const displayName = profile.display_name || email
  const mayEdit = canEdit(profile.role)
  const admin = isAdmin(profile.role)

  // Số tài khoản đang chờ duyệt, để admin thấy ngay trên thanh bên
  const [pendingCount, setPendingCount] = useState(0)
  const refreshPending = useCallback(async () => {
    if (!admin || profile.legacy) return
    const { count } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'pending')
    setPendingCount(count ?? 0)
  }, [admin, profile.legacy])
  useEffect(() => {
    refreshPending()
  }, [refreshPending, version])

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
      profile,
      reloadProfile,
      canEdit: mayEdit,
      isAdmin: admin,
      pendingCount,
      refreshPending,
    }),
    [openComponent, closeComponent, email, profile, reloadProfile, mayEdit, admin, pendingCount, refreshPending],
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
      } else if (mayEdit && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault()
        openTx({ type: 'in' })
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [openTx, mayEdit])

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
            </NavLink>
            <NavLink to="/buy" title="Cần mua">
              <ShoppingCart size={20} />
              <span className="kk-side-text">Cần mua</span>
              {buyBadges}
            </NavLink>
            {mayEdit && (
              <button type="button" onClick={() => openTx({ type: 'in' })} title="Nhập / xuất kho (phím N)">
                <ArrowLeftRight size={20} />
                <span className="kk-side-text">Nhập / xuất kho</span>
              </button>
            )}

            <div className="kk-nav-sep" />
            {MORE_PAGES.map(({ to, label, Icon }) => (
              <NavLink key={to} to={to} title={label}>
                <Icon size={20} />
                <span className="kk-side-text">{label}</span>
                {to === '/settings' && pendingCount > 0 && (
                  <span className="kk-badge" aria-label={`${pendingCount} tài khoản chờ duyệt`}>
                    {pendingCount}
                  </span>
                )}
              </NavLink>
            ))}
            {LAB_URL && (
              <a href={LAB_URL} target="_blank" rel="noopener noreferrer" title="Electronics Lab (mở tab mới)">
                <ExternalLink size={20} />
                <span className="kk-side-text">Electronics Lab ↗</span>
              </a>
            )}
            {LAB_URL && (
              <a href={`${LAB_URL}/quan-tri`} target="_blank" rel="noopener noreferrer" title="Quản trị Electronics Lab (mở tab mới)">
                <PencilRuler size={20} />
                <span className="kk-side-text">Quản trị Lab ↗</span>
              </a>
            )}
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
              {mayEdit && (
                <button type="button" className="kk-btn kk-btn-primary kk-top-tx" onClick={() => openTx({ type: 'in' })}>
                  <Plus size={18} />
                  Nhập / xuất
                  <kbd aria-hidden="true">N</kbd>
                </button>
              )}
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
                  {(displayName[0] ?? '?').toUpperCase()}
                </span>
                <span className="kk-account-mail" title={`${email} (${roleLabel(profile.role)})`}>
                  {displayName}
                </span>
                <button
                  type="button"
                  className="kk-icon-btn kk-icon-btn-boxed"
                  onClick={signOutHere}
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
              <Route path="/buy" element={<ShoppingPage />} />
              <Route path="/locations" element={<LocationsPage />} />
              <Route path="/categories" element={<CategoriesPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/projects/:id" element={<ProjectViewPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>

        <nav className={`kk-tabbar ${mayEdit ? '' : 'kk-tabbar-4'}`} aria-label="Điều hướng trên điện thoại">
          <NavLink to="/" end>
            <LayoutDashboard size={22} />
            <span>Tổng quan</span>
          </NavLink>
          <NavLink to="/components">
            <Boxes size={22} />
            <span>Linh kiện</span>
          </NavLink>
          {mayEdit && (
            <button type="button" className="kk-fab" onClick={() => openTx({ type: 'in' })} aria-label="Nhập / xuất kho">
              <Plus size={28} />
            </button>
          )}
          <NavLink to={TAB_PAGE.to}>
            <TAB_PAGE.Icon size={22} />
            <span>{TAB_PAGE.label}</span>
          </NavLink>
          <button type="button" className={onSheetPage ? 'active' : ''} aria-haspopup="dialog" onClick={() => setMenuOpen(true)}>
            <Menu size={22} />
            <span>Khác</span>
            {attention + planned > 0 && <i className="kk-tab-dot" aria-label={`${attention + planned} món cần mua`} />}
          </button>
        </nav>
      </div>

      {menuOpen && (
        <Modal title="Mục khác" subtitle={`${displayName}, ${roleLabel(profile.role)}`} onClose={() => setMenuOpen(false)}>
          <nav className="kk-menu" aria-label="Các trang khác">
            {SHEET_PAGES.map(({ to, label, Icon }) => (
              <NavLink key={to} to={to} onClick={() => setMenuOpen(false)}>
                <Icon size={20} />
                {label}
                {to === '/buy' && buyBadges}
              </NavLink>
            ))}
            {LAB_URL && (
              <a href={LAB_URL} target="_blank" rel="noopener noreferrer" onClick={() => setMenuOpen(false)}>
                <ExternalLink size={20} />
                Electronics Lab ↗
              </a>
            )}
            {LAB_URL && (
              <a href={`${LAB_URL}/quan-tri`} target="_blank" rel="noopener noreferrer" onClick={() => setMenuOpen(false)}>
                <PencilRuler size={20} />
                Quản trị Lab ↗
              </a>
            )}
            <Link to="/settings#account" onClick={() => setMenuOpen(false)}>
              <KeyRound size={20} />
              Đổi mật khẩu
            </Link>
            <div className="kk-menu-sep" />
            <button type="button" onClick={toggleTheme}>
              {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
              {theme === 'light' ? 'Chuyển sang giao diện tối' : 'Chuyển sang giao diện sáng'}
            </button>
            <button type="button" onClick={signOutHere}>
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

/** Hai con số của trang Cần mua: vàng = theo tồn kho, xanh = danh sách mua trước */
export function BuyBadges({ auto, plan }) {
  if (auto <= 0 && plan <= 0) return null
  return (
    <span className="kk-badges">
      {auto > 0 && (
        <span className="kk-badge" title={`${auto} món cần mua theo tồn kho`} aria-label={`${auto} món cần mua theo tồn kho`}>
          {auto}
        </span>
      )}
      {plan > 0 && (
        <span
          className="kk-badge kk-badge-plan"
          title={`${plan} món trong danh sách mua trước`}
          aria-label={`${plan} món trong danh sách mua trước`}
        >
          {plan}
        </span>
      )}
    </span>
  )
}
