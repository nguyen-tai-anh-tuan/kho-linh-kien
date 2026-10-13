import { useData } from '../data/DataContext'
import { useShell } from '../ShellContext'
import { EmptyState } from '../ui/common'
import { fmtNum } from '../lib/format'
import SettingsCategories from './SettingsCategories'

/** Trang "Danh mục": cây danh mục ba tầng, bấm vào một danh mục để xem các linh kiện trong đó */
export default function CategoriesPage() {
  const { categories, loading, refreshing, error, reload } = useData()
  const { isAdmin, canEdit } = useShell()

  if (error) {
    return (
      <EmptyState title="Chưa tải được danh mục" text={error}>
        <button type="button" className="kk-btn kk-btn-primary" onClick={reload}>
          Thử lại
        </button>
      </EmptyState>
    )
  }

  return (
    <div className={`kk-page ${refreshing ? 'is-refreshing' : ''}`}>
      <div className="kk-page-head">
        <div>
          <h1>Danh mục</h1>
          <p>
            {loading ? 'Đang tải…' : `${fmtNum(categories.length)} danh mục. `}
            {!loading &&
              (isAdmin
                ? 'Bấm vào tên một danh mục để xem linh kiện trong đó.'
                : canEdit
                  ? 'Bấm vào tên một danh mục để xem linh kiện trong đó. Bạn thêm được danh mục; đổi tên, chuyển và xóa là việc của admin.'
                  : 'Bấm vào tên một danh mục để xem linh kiện trong đó.')}
          </p>
        </div>
      </div>
      <SettingsCategories />
    </div>
  )
}
