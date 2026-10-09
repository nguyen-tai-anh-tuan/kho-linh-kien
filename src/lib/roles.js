/** Các vai trò, khớp với cột profiles.role trong database (xem sql/04_roles.sql) */
export const ROLES = {
  admin: { label: 'Admin', hint: 'Làm được mọi thứ, kể cả duyệt và phân quyền thành viên' },
  member: { label: 'Thành viên', hint: 'Nhập/xuất kho, thêm và sửa; không được xóa' },
  viewer: { label: 'Chỉ xem', hint: 'Xem mọi trang, không thay đổi được gì' },
  pending: { label: 'Chờ duyệt', hint: 'Mới đăng ký, chưa xem được kho' },
  blocked: { label: 'Bị khóa', hint: 'Không vào được kho' },
}

export const roleLabel = (role) => ROLES[role]?.label ?? role
export const canEnter = (role) => ['admin', 'member', 'viewer'].includes(role)
export const canEdit = (role) => role === 'admin' || role === 'member'
export const isAdmin = (role) => role === 'admin'
