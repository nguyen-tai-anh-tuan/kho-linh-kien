import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { BellRing } from 'lucide-react'
import { useData } from '../data/DataContext'
import { useShell } from '../ShellContext'
import { EmptyState } from '../ui/common'
import SettingsAccount from './SettingsAccount'
import SettingsCategories from './SettingsCategories'
import SettingsLevels from './SettingsLevels'
import SettingsMembers from './SettingsMembers'

export default function SettingsPage() {
  const { loading, refreshing, error, reload } = useData()
  const { isAdmin, canEdit, profile } = useShell()

  // Mở từ "Khác › Đổi mật khẩu" (/settings#account): cuộn thẳng tới mục Tài khoản
  const { hash } = useLocation()
  useEffect(() => {
    if (hash === '#account' && !loading) document.getElementById('account')?.scrollIntoView({ block: 'start' })
  }, [hash, loading])

  if (error) {
    return (
      <EmptyState title="Chưa tải được cài đặt" text={error}>
        <button type="button" className="kk-btn kk-btn-primary" onClick={reload}>
          Thử lại
        </button>
      </EmptyState>
    )
  }

  return (
    <div className={`kk-page kk-settings ${refreshing ? 'is-refreshing' : ''}`}>
      <div className="kk-page-head">
        <div>
          <h1>Cài đặt</h1>
          <p>
            {isAdmin
              ? 'Quản lý danh mục, mức cảnh báo sắp hết hàng và thành viên.'
              : canEdit
                ? 'Thêm danh mục, xem mức cảnh báo và quản lý tài khoản của bạn. Đổi tên, chuyển, xóa danh mục và đặt mức cảnh báo là việc của admin.'
                : 'Xem danh mục, mức cảnh báo và quản lý tài khoản của bạn.'}
          </p>
        </div>
      </div>

      {isAdmin && profile.legacy && (
        <p className="kk-banner kk-banner-warn" role="status">
          <BellRing size={18} aria-hidden="true" />
          <span>
            Chưa bật phân quyền: hiện ai đăng nhập được cũng có toàn quyền. Mở Supabase, vào SQL Editor, dán nội dung file
            sql/04_roles.sql rồi bấm Run, sau đó tải lại trang.
          </span>
        </p>
      )}
      {isAdmin && !profile.legacy && <SettingsMembers />}

      <SettingsCategories />

      <SettingsLevels />

      <SettingsAccount />

    </div>
  )
}
