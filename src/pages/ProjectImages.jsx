import { useCallback, useEffect, useRef, useState } from 'react'
import { ImagePlus, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useShell } from '../ShellContext'
import { useToast } from '../ui/Toast'
import { Modal } from '../ui/Modal'
import { ConfirmDialog } from '../ui/dialogs'
import { friendlyError, isMissingSchema } from '../lib/api'
import { removeProjectImage, signedUrls, uploadProjectImage } from '../lib/images'

// Ba ô ảnh của một dự án. Ô đầu là ảnh đại diện, hiện cả trong danh sách dự án.
const SLOTS = [
  { label: 'Ảnh đại diện', hint: 'Ảnh mạch hoặc sản phẩm' },
  { label: 'Ảnh thêm 1', hint: 'Vd: sơ đồ nguyên lý' },
  { label: 'Ảnh thêm 2', hint: 'Vd: ảnh 3D' },
]

/**
 * Ảnh của mọi dự án, kèm link ảnh thu nhỏ.
 * missing = true khi database chưa chạy sql/09_project_images.sql.
 */
export function useProjectImages(version) {
  const [state, setState] = useState({ rows: [], urls: new Map(), missing: false })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let off = false
    ;(async () => {
      const { data, error } = await supabase.from('project_images').select('id,project_id,slot,path,thumb_path')
      if (off) return
      if (error) return setState({ rows: [], urls: new Map(), missing: isMissingSchema(error) })
      let urls = new Map()
      try {
        urls = await signedUrls(data.map((r) => r.thumb_path))
      } catch {
        /* không lấy được link thì các ô ảnh hiện trống, phần còn lại của trang vẫn dùng được */
      }
      if (!off) setState({ rows: data, urls, missing: false })
    })()
    return () => {
      off = true
    }
  }, [version, tick])

  const refresh = useCallback(() => setTick((n) => n + 1), [])
  return { ...state, refresh }
}

/** Dải ảnh ở đầu trang chi tiết dự án: xem, thêm, đổi, xóa */
export function ProjectGallery({ project, images, urls, missing, onChanged }) {
  const { canEdit, isAdmin } = useShell()
  const toast = useToast()
  const [busy, setBusy] = useState(null) // ô đang tải lên
  const [viewing, setViewing] = useState(null) // { row, label }
  const [removing, setRemoving] = useState(null)
  const inputs = useRef([])

  const bySlot = new Map(images.map((r) => [r.slot, r]))

  if (missing) {
    if (!canEdit) return null
    return (
      <p className="kk-muted-text kk-gallery-note">
        Chưa bật ảnh dự án.
        {isAdmin
          ? ' Mở Supabase, vào SQL Editor, dán nội dung file sql/09_project_images.sql rồi bấm Run, sau đó tải lại trang.'
          : ' Hãy nhờ admin nâng cấp database.'}
      </p>
    )
  }
  // Người chỉ xem: không có ảnh thì không hiện gì
  if (!canEdit && images.length === 0) return null

  async function upload(slot, file) {
    if (!file || busy !== null) return
    setBusy(slot)
    try {
      const { size } = await uploadProjectImage(project.id, slot, file, bySlot.get(slot))
      onChanged()
      toast.push({ message: `Đã lưu ${SLOTS[slot].label.toLowerCase()} (${Math.max(1, Math.round(size / 1024))} KB sau khi nén).` })
    } catch (e) {
      toast.push({ tone: 'error', message: friendlyImageError(e), duration: 9000 })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="kk-gallery" aria-label={`Ảnh của dự án ${project.name}`}>
      {SLOTS.map((slot, i) => {
        const row = bySlot.get(i)
        const url = row ? urls.get(row.thumb_path) : null
        if (!row && !canEdit) return null
        return (
          <figure
            key={i}
            className={`kk-shot ${row ? '' : 'is-empty'}`}
            onDragOver={canEdit ? (e) => e.preventDefault() : undefined}
            onDrop={
              canEdit
                ? (e) => {
                    e.preventDefault()
                    upload(i, e.dataTransfer.files?.[0])
                  }
                : undefined
            }
          >
            {row ? (
              <button type="button" className="kk-shot-view" onClick={() => setViewing({ row, label: slot.label })} title="Bấm để xem ảnh lớn">
                {url ? <img src={url} alt={`${slot.label} của ${project.name}`} loading="lazy" /> : <span className="kk-shot-wait" />}
              </button>
            ) : (
              <button type="button" className="kk-shot-add" disabled={busy !== null} onClick={() => inputs.current[i]?.click()}>
                {busy === i ? <Loader2 size={22} className="kk-spin" /> : <ImagePlus size={22} />}
                <span>{busy === i ? 'Đang nén và tải lên…' : 'Thêm ảnh'}</span>
                <small>{slot.hint}</small>
              </button>
            )}
            <figcaption>
              <span>{slot.label}</span>
              {row && canEdit && (
                <span className="kk-shot-tools">
                  <button
                    type="button"
                    className="kk-icon-btn"
                    aria-label={`Đổi ${slot.label.toLowerCase()}`}
                    title="Đổi ảnh khác"
                    disabled={busy !== null}
                    onClick={() => inputs.current[i]?.click()}
                  >
                    {busy === i ? <Loader2 size={15} className="kk-spin" /> : <RefreshCw size={15} />}
                  </button>
                  <button
                    type="button"
                    className="kk-icon-btn"
                    aria-label={`Xóa ${slot.label.toLowerCase()}`}
                    title="Xóa ảnh"
                    disabled={busy !== null}
                    onClick={() => setRemoving({ row, label: slot.label })}
                  >
                    <Trash2 size={15} />
                  </button>
                </span>
              )}
            </figcaption>
            {canEdit && (
              <input
                ref={(el) => {
                  inputs.current[i] = el
                }}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => {
                  upload(i, e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            )}
          </figure>
        )
      })}

      {viewing && <Lightbox row={viewing.row} title={`${viewing.label}, ${project.name}`} onClose={() => setViewing(null)} />}
      {removing && (
        <ConfirmDialog
          title={`Xóa ${removing.label.toLowerCase()}?`}
          text="Ảnh sẽ bị xóa khỏi dự án. Bạn có thể tải ảnh khác lên bất cứ lúc nào."
          confirmLabel="Xóa ảnh"
          Icon={Trash2}
          onConfirm={async () => {
            await removeProjectImage(removing.row)
            onChanged()
            toast.push({ message: `Đã xóa ${removing.label.toLowerCase()}.` })
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  )
}

/** Xem ảnh lớn. Ảnh lớn chỉ được tải khi mở ra xem. */
function Lightbox({ row, title, onClose }) {
  const [state, setState] = useState({ url: null, error: '' })

  useEffect(() => {
    let off = false
    signedUrls([row.path])
      .then((urls) => {
        if (off) return
        const url = urls.get(row.path)
        setState(url ? { url, error: '' } : { url: null, error: 'Không tìm thấy file ảnh. Có thể nó đã bị xóa.' })
      })
      .catch((e) => !off && setState({ url: null, error: friendlyImageError(e) }))
    return () => {
      off = true
    }
  }, [row.path])

  return (
    <Modal title={title} size="lg" onClose={onClose}>
      {state.error ? (
        <p className="kk-form-error">{state.error}</p>
      ) : state.url ? (
        <img className="kk-lightbox-img" src={state.url} alt={title} />
      ) : (
        <div className="kk-lightbox-wait">
          <Loader2 size={26} className="kk-spin" aria-label="Đang tải ảnh" />
        </div>
      )}
    </Modal>
  )
}

function friendlyImageError(error) {
  const msg = String(error?.message ?? error ?? '')
  const low = msg.toLowerCase()
  if (low.includes('bucket not found')) return 'Chưa có kho ảnh. Hãy chạy file sql/09_project_images.sql trong Supabase rồi tải lại trang.'
  if (low.includes('exceeded the maximum allowed size') || low.includes('too large')) return 'Ảnh vẫn quá nặng sau khi nén. Hãy thử ảnh khác.'
  if (low.includes('mime type')) return 'Kho ảnh chỉ nhận file PNG, JPG hoặc WebP.'
  // Thông báo do chính web viết ra (đã là tiếng Việt) thì giữ nguyên
  if (error instanceof Error && !error.code && !error.statusCode && /[àáảãạăâđèéẻẽẹêìíỉĩịòóỏõọôơùúủũụưỳýỷỹỵ]/i.test(msg)) return msg
  return friendlyError(error)
}
