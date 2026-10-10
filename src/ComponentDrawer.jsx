import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  EyeOff,
  ExternalLink,
  FileText,
  Loader2,
  Pencil,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import { supabase } from './supabaseClient'
import { useData } from './data/DataContext'
import { useTx } from './TxContext'
import { useShell } from './ShellContext'
import { useToast } from './ui/Toast'
import { Modal } from './ui/Modal'
import { CategoryChip, Skeleton, StatusChip, StockBar } from './ui/common'
import { friendlyError, isMissingSchema, mustChange } from './lib/api'
import { fmtMoneyFull, fmtNum, fmtPrice, safeUrl, timeAgo } from './lib/format'

const TYPE_LABEL = { in: 'Nhập', out: 'Xuất', adjust: 'Điều chỉnh' }

export default function ComponentDrawer({ id, onClose }) {
  const { componentsById, stockByComponent, categoriesById, toneByCategory, loading, version, reload } = useData()
  const { openTx } = useTx()
  const { openForm, canEdit, isAdmin } = useShell()
  const toast = useToast()
  const c = componentsById.get(id)

  const [history, setHistory] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [imgFailed, setImgFailed] = useState(false)

  useEffect(() => {
    let off = false
    supabase
      .from('transactions_feed')
      .select('*')
      .eq('component_id', id)
      .order('created_at', { ascending: false })
      .limit(15)
      .then(({ data, error }) => {
        if (off) return
        setHistory(error ? { error: friendlyError(error) } : data)
      })
    return () => {
      off = true
    }
  }, [id, version])

  // Ngừng dùng / dùng lại: chỉ ẩn linh kiện, không đụng tới tồn kho và lịch sử
  async function setArchived(on) {
    setArchiving(true)
    try {
      mustChange(
        await supabase
          .from('components')
          .update({ archived_at: on ? new Date().toISOString() : null })
          .eq('id', id)
          .select('id'),
      )
      await reload()
      toast.push({
        message: on
          ? `Đã ngừng dùng ${c?.part_number ?? ''}. Bật "Xem linh kiện ngừng dùng" ở trang Linh kiện để tìm lại.`
          : `Đã dùng lại ${c?.part_number ?? ''}.`,
      })
    } catch (e) {
      toast.push({ tone: 'error', message: friendlyError(e), duration: 9000 })
    } finally {
      setArchiving(false)
    }
  }

  // Xóa hẳn (chỉ admin): xóa luôn lịch sử nhập/xuất, tồn kho và các dòng BOM của linh kiện
  async function remove() {
    setDeleting(true)
    let { error } = await supabase.rpc('delete_component', { target: id })
    // Database chưa chạy sql/06_archive.sql: xóa kiểu cũ, chỉ được với linh kiện chưa có lịch sử
    if (error && isMissingSchema(error)) {
      const plain = await supabase.from('components').delete().eq('id', id)
      error = plain.error
        ? plain.error.code === '23503'
          ? new Error('Could not find the function delete_component')
          : plain.error
        : null
    }
    if (error) {
      setDeleting(false)
      setConfirmDelete(false)
      return toast.push({ tone: 'error', message: friendlyError(error), duration: 9000 })
    }
    await reload()
    toast.push({ message: `Đã xóa linh kiện ${c?.part_number ?? ''}.` })
    onClose()
  }

  if (!c) {
    return (
      <Modal variant="drawer" title="Chi tiết linh kiện" onClose={onClose}>
        {loading ? (
          <div className="kk-skel-list">
            <Skeleton h={28} />
            <Skeleton h={120} r={14} />
            <Skeleton h={80} r={14} />
          </div>
        ) : (
          <p className="kk-muted-text">Không tìm thấy linh kiện này. Có thể nó đã bị xóa.</p>
        )}
      </Modal>
    )
  }

  const archived = Boolean(c.archived_at)
  const where = stockByComponent.get(id) ?? []
  const datasheet = safeUrl(c.datasheet_url)
  const image = !imgFailed ? safeUrl(c.image_url) : null

  return (
    <Modal
      variant="drawer"
      size="md"
      title={c.part_number}
      subtitle={c.name}
      headerExtra={<StatusChip status={c.status} />}
      onClose={onClose}
      footer={
        !canEdit ? null : confirmDelete ? (
          <>
            <span className="kk-foot-note kk-foot-warn">
              Xóa hẳn {c.part_number}? Toàn bộ lịch sử nhập/xuất, tồn kho và dòng BOM của nó cũng bị xóa. Không thể hoàn tác.
            </span>
            <button type="button" className="kk-btn kk-btn-ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              Giữ lại
            </button>
            <button type="button" className="kk-btn kk-btn-danger" onClick={remove} disabled={deleting}>
              {deleting ? <Loader2 size={18} className="kk-spin" /> : <Trash2 size={18} />}
              Xóa hẳn
            </button>
          </>
        ) : archived ? (
          <>
            <button type="button" className="kk-btn kk-btn-primary" onClick={() => setArchived(false)} disabled={archiving}>
              {archiving ? <Loader2 size={18} className="kk-spin" /> : <RotateCcw size={18} />}
              Dùng lại
            </button>
            <button type="button" className="kk-btn kk-btn-outline" onClick={() => openForm(c)}>
              <Pencil size={18} />
              Sửa
            </button>
            {isAdmin && (
              <button type="button" className="kk-btn kk-btn-ghost kk-push-right" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={18} />
                Xóa hẳn
              </button>
            )}
          </>
        ) : (
          <>
            <button type="button" className="kk-btn kk-btn-primary" onClick={() => openTx({ type: 'in', componentId: id })}>
              <ArrowDownToLine size={18} />
              Nhập
            </button>
            <button
              type="button"
              className="kk-btn kk-btn-outline"
              onClick={() => openTx({ type: 'out', componentId: id })}
              disabled={c.total_quantity === 0}
              title={c.total_quantity === 0 ? 'Linh kiện này đang hết hàng' : undefined}
            >
              <ArrowUpFromLine size={18} />
              Xuất
            </button>
            <button type="button" className="kk-btn kk-btn-outline" onClick={() => openForm(c)}>
              <Pencil size={18} />
              Sửa
            </button>
            <button
              type="button"
              className="kk-btn kk-btn-ghost kk-push-right"
              title="Ẩn khỏi danh sách và các ô chọn. Lịch sử vẫn giữ nguyên, sau này bật lại được."
              onClick={() => setArchived(true)}
              disabled={archiving}
            >
              {archiving ? <Loader2 size={18} className="kk-spin" /> : <EyeOff size={18} />}
              Ngừng dùng
            </button>
            {isAdmin && (
              <button type="button" className="kk-btn kk-btn-ghost" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={18} />
                Xóa hẳn
              </button>
            )}
          </>
        )
      }
    >
      <div className="kk-detail">
        {archived && (
          <p className="kk-banner kk-banner-warn kk-detail-banner" role="status">
            <EyeOff size={18} aria-hidden="true" />
            <span>
              Linh kiện này đang ngừng dùng nên không hiện trong danh sách, thống kê và các ô chọn.
              {c.total_quantity > 0 && ` Trong kho vẫn còn ${fmtNum(c.total_quantity)} cái.`}
            </span>
          </p>
        )}
        <div className="kk-detail-top">
          {image && (
            <img
              className="kk-detail-img"
              src={image}
              alt={`Ảnh ${c.name}`}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
            />
          )}
          <div className="kk-detail-stock">
            <span className="kk-detail-big">{fmtNum(c.total_quantity)}</span>
            <span className="kk-muted-text">cái trong kho</span>
            <StockBar qty={c.total_quantity} min={c.min_stock} status={c.status} />
          </div>
        </div>

        <dl className="kk-dl">
          <div>
            <dt>Loại</dt>
            <dd>
              {categoriesById.get(c.category_id)?.depth > 0 ? (
                categoriesById.get(c.category_id).path
              ) : (
                <CategoryChip name={c.category_name} tone={toneByCategory.get(c.category_id)} />
              )}
            </dd>
          </div>
          <div>
            <dt>Giá trị</dt>
            <dd>{c.value || '—'}</dd>
          </div>
          <div>
            <dt>Package</dt>
            <dd>{c.package || '—'}</dd>
          </div>
          <div>
            <dt>Hãng</dt>
            <dd>{c.manufacturer || '—'}</dd>
          </div>
          <div>
            <dt>Tồn tối thiểu</dt>
            <dd>{fmtNum(c.min_stock)}</dd>
          </div>
          <div>
            <dt>Đơn giá</dt>
            <dd>{fmtPrice(c.unit_price)}</dd>
          </div>
          <div>
            <dt>Giá trị tồn</dt>
            <dd>{Number(c.unit_price) > 0 ? fmtMoneyFull(c.stock_value) : '—'}</dd>
          </div>
          <div>
            <dt>Datasheet</dt>
            <dd>
              {datasheet ? (
                <a className="kk-link" href={datasheet} target="_blank" rel="noopener noreferrer">
                  <FileText size={14} />
                  Mở datasheet
                  <ExternalLink size={13} />
                </a>
              ) : (
                '—'
              )}
            </dd>
          </div>
        </dl>

        {c.notes && (
          <div className="kk-note-box">
            <h3>Ghi chú</h3>
            <p>{c.notes}</p>
          </div>
        )}

        <h3 className="kk-sub">Tồn theo vị trí</h3>
        {where.length === 0 ? (
          <p className="kk-muted-text">{canEdit ? 'Chưa có hàng ở vị trí nào. Bấm Nhập để thêm.' : 'Chưa có hàng ở vị trí nào.'}</p>
        ) : (
          <table className="kk-mini-table">
            <thead>
              <tr>
                <th>Vị trí</th>
                <th className="is-num">Số lượng</th>
              </tr>
            </thead>
            <tbody>
              {where.map((w) => (
                <tr key={w.location_id}>
                  <td>{w.path}</td>
                  <td className="is-num">{fmtNum(w.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h3 className="kk-sub">Lịch sử gần đây</h3>
        {history === null ? (
          <div className="kk-skel-list">
            <Skeleton h={36} r={10} />
            <Skeleton h={36} r={10} />
          </div>
        ) : history.error ? (
          <p className="kk-form-error">{history.error}</p>
        ) : history.length === 0 ? (
          <p className="kk-muted-text">Chưa có giao dịch nào với linh kiện này.</p>
        ) : (
          <ul className="kk-history">
            {history.map((t) => (
              <li key={t.id}>
                <span className={`kk-list-ico ${t.type === 'in' ? 'kk-ico-in' : t.type === 'out' ? 'kk-ico-out' : 'kk-ico-adj'}`}>
                  {t.type === 'in' ? <ArrowDownToLine size={16} /> : t.type === 'out' ? <ArrowUpFromLine size={16} /> : <SlidersHorizontal size={16} />}
                </span>
                <span className="kk-list-main">
                  <span>
                    {TYPE_LABEL[t.type]} {t.type === 'adjust' ? `còn ${fmtNum(t.quantity)}` : fmtNum(t.quantity)}
                    {t.location_path ? `, ${t.location_path}` : ''}
                    {t.project_name ? `, dự án ${t.project_name}` : ''}
                  </span>
                  <small>
                    {timeAgo(t.created_at)}
                    {t.actor_name ? `, bởi ${t.actor_name}` : ''}
                    {t.note ? `, ${t.note}` : ''}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        )}
        {Array.isArray(history) && history.length > 0 && (
          <Link className="kk-link kk-history-more" to={`/history?comp=${id}`}>
            Xem toàn bộ lịch sử của linh kiện này
          </Link>
        )}
      </div>
    </Modal>
  )
}
