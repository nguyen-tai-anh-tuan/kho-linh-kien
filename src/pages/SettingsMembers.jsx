import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useShell } from '../ShellContext'
import { useToast } from '../ui/Toast'
import { ConfirmDialog } from '../ui/dialogs'
import { Skeleton } from '../ui/common'
import { friendlyError } from '../lib/api'
import { ROLES, roleLabel } from '../lib/roles'
import { fmtDate, fmtNum } from '../lib/format'

// Người chờ duyệt lên đầu, người bị khóa xuống cuối
const ORDER = { pending: 0, admin: 1, member: 2, viewer: 3, blocked: 4 }

/** Mục "Thành viên" của trang Cài đặt (chỉ admin thấy): duyệt tài khoản mới, đổi vai trò, khóa */
export default function SettingsMembers() {
  const { profile, refreshPending } = useShell()
  const toast = useToast()
  const [members, setMembers] = useState(null) // null: đang tải, { error }: lỗi, mảng: danh sách
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(null) // id tài khoản đang được đổi vai trò
  const [promote, setPromote] = useState(null) // tài khoản sắp được nâng lên admin, chờ xác nhận

  useEffect(() => {
    let off = false
    supabase
      .from('profiles')
      .select('id,email,display_name,role,created_at')
      .order('created_at')
      .then(({ data, error }) => {
        if (off) return
        setMembers(error ? { error: friendlyError(error) } : data)
      })
    return () => {
      off = true
    }
  }, [attempt])

  async function setRole(member, role) {
    setSaving(member.id)
    const { error } = await supabase.rpc('set_member_role', { target: member.id, new_role: role })
    setSaving(null)
    if (error) throw error
    setMembers((list) => (Array.isArray(list) ? list.map((m) => (m.id === member.id ? { ...m, role } : m)) : list))
    refreshPending()
    toast.push({ message: `${member.display_name || member.email}: ${roleLabel(role)}.` })
  }

  function onPick(member, role) {
    if (role === member.role) return
    if (role === 'admin') return setPromote(member)
    setRole(member, role).catch((e) => toast.push({ tone: 'error', message: friendlyError(e), duration: 9000 }))
  }

  const list = Array.isArray(members)
    ? [...members].sort((a, b) => ORDER[a.role] - ORDER[b.role] || a.created_at.localeCompare(b.created_at))
    : []
  const waiting = list.filter((m) => m.role === 'pending').length

  return (
    <section className="kk-card" aria-labelledby="set-members">
      <div className="kk-card-head">
        <div>
          <h2 id="set-members">Thành viên</h2>
          <p className="kk-card-sub">
            {waiting > 0
              ? `Có ${fmtNum(waiting)} tài khoản mới đang chờ bạn duyệt. Chọn vai trò để cho họ vào kho.`
              : 'Người mới đăng ký sẽ hiện ở đây để bạn duyệt và cấp quyền.'}
          </p>
        </div>
      </div>

      {members === null ? (
        <div className="kk-skel-list">
          <Skeleton h={48} r={10} />
          <Skeleton h={48} r={10} />
        </div>
      ) : members.error ? (
        <>
          <p className="kk-form-error kk-members-error">{members.error}</p>
          <button type="button" className="kk-btn kk-btn-outline kk-btn-sm" onClick={() => setAttempt((n) => n + 1)}>
            Thử lại
          </button>
        </>
      ) : (
        <ul className="kk-rows kk-members">
          {list.map((m) => {
            const me = m.id === profile.id
            return (
              <li key={m.id} className={m.role === 'pending' ? 'is-pending' : ''}>
                <span className="kk-avatar" aria-hidden="true">
                  {((m.display_name || m.email || '?')[0] ?? '?').toUpperCase()}
                </span>
                <span className="kk-rows-name">
                  {m.display_name || m.email}
                  {me && <em className="kk-you">Bạn</em>}
                  <small>
                    {m.email}, đăng ký {fmtDate(m.created_at)}
                  </small>
                </span>
                <select
                  aria-label={`Vai trò của ${m.display_name || m.email}`}
                  title={me ? 'Bạn không tự đổi vai trò của mình được' : ROLES[m.role]?.hint}
                  value={m.role}
                  disabled={me || saving === m.id}
                  onChange={(e) => onPick(m, e.target.value)}
                >
                  {Object.entries(ROLES).map(([key, r]) => (
                    <option key={key} value={key}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </li>
            )
          })}
        </ul>
      )}

      <ul className="kk-role-help">
        {['admin', 'member', 'viewer'].map((key) => (
          <li key={key}>
            <strong>{ROLES[key].label}:</strong> {ROLES[key].hint}
          </li>
        ))}
      </ul>

      {promote && (
        <ConfirmDialog
          title={`Cho ${promote.display_name || promote.email} làm admin?`}
          text="Admin làm được mọi thứ như bạn: xóa dữ liệu, duyệt thành viên, và đổi cả vai trò của các admin khác."
          confirmLabel="Cho làm admin"
          Icon={ShieldCheck}
          onConfirm={() => setRole(promote, 'admin')}
          onClose={() => setPromote(null)}
        />
      )}
    </section>
  )
}
