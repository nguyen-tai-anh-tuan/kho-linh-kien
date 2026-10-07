import { Cpu, Boxes, MapPin, Bell, Sun, Moon } from 'lucide-react'
import useTheme from './useTheme'
import './auth.css'

const APP_VERSION = 'v0.1'

// Các đường mạch trang trí (viewBox 600 x 800)
const TRACES = [
  'M-10 120H140L200 180H380L440 120H610',
  'M-10 300H90L150 360V520L210 580H300',
  'M80 810V700L140 640H300L360 580V460L420 400H610',
  'M610 220H500L440 280V340',
  'M300 810V740L360 680H610',
  'M-10 640H40L80 600V560',
]
// Các điểm hàn (pad/via)
const PADS = [
  [200, 180], [380, 180], [150, 360], [150, 520], [300, 580],
  [300, 640], [420, 400], [440, 340], [80, 560], [500, 220], [360, 680],
]

function PcbArt() {
  return (
    <svg className="pcb" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g className="pcb-base">
        {TRACES.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      <g className="pcb-pulse">
        {TRACES.map((d, i) => (
          <path
            key={i}
            d={d}
            pathLength="100"
            style={{ animationDuration: `${5 + i * 0.9}s`, animationDelay: `${i * 0.6}s` }}
          />
        ))}
      </g>
      <g className="pcb-pads">
        {PADS.map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r="9" />
            <circle cx={x} cy={y} r="3.5" className="hole" />
          </g>
        ))}
      </g>
    </svg>
  )
}

export default function AuthLayout({ children }) {
  const [theme, toggleTheme] = useTheme()

  return (
    <div className="auth">
      <aside className="auth-brand">
        <PcbArt />
        <div className="brand-content">
          <div className="brand-logo">
            <span className="logo-tile"><Cpu size={26} /></span>
            <span className="logo-text">Kho Linh Kiện</span>
          </div>
          <h1>Chào mừng bạn đến với nơi lưu trữ linh kiện lớn nhất Việt Nam</h1>
          <ul className="brand-chips">
            <li><Boxes size={18} /> Quản lý linh kiện</li>
            <li><MapPin size={18} /> Vị trí tủ / ngăn</li>
            <li><Bell size={18} /> Cảnh báo tồn kho</li>
          </ul>
        </div>
      </aside>

      <main className="auth-main">
        <button
          type="button"
          className="theme-btn"
          onClick={toggleTheme}
          aria-label="Đổi giao diện sáng/tối"
        >
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </button>

        <div className="auth-card">
          <div className="mobile-brand">
            <span className="logo-tile"><Cpu size={22} /></span>
            <span>Kho Linh Kiện</span>
          </div>
          {children}
        </div>

        <span className="version">{APP_VERSION}</span>
      </main>
    </div>
  )
}