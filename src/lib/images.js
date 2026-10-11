import { supabase } from '../supabaseClient'

export const IMAGE_BUCKET = 'project-images'
const MAX_INPUT = 20 * 1024 * 1024 // file gốc tối đa 20 MB, sau khi nén chỉ còn vài trăm KB
const FULL_SIDE = 1600
const THUMB_SIDE = 480
const SIGN_SECONDS = 24 * 60 * 60
const CACHE_KEY = 'kho-image-urls'

/** Thu ảnh về cạnh dài tối đa maxSide rồi nén sang WebP (trình duyệt cũ không có WebP thì dùng JPEG) */
async function compress(bitmap, maxSide, quality) {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d')
  // Nền trắng cho ảnh có vùng trong suốt, phòng khi phải lưu JPEG
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const toBlob = (type, q) => new Promise((resolve) => canvas.toBlob(resolve, type, q))
  let blob = await toBlob('image/webp', quality)
  if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg', quality)
  if (!blob) throw new Error('Trình duyệt không nén được ảnh này.')
  return blob
}

/** Kiểm tra và nén một file ảnh thành hai bản: ảnh lớn và ảnh thu nhỏ */
export async function prepareImage(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('Hãy chọn một file ảnh (PNG, JPG hoặc WebP).')
  if (file.size > MAX_INPUT) throw new Error('Ảnh quá lớn. Hãy chọn ảnh dưới 20 MB.')
  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('Không đọc được ảnh này. Hãy thử file PNG hoặc JPG.')
  }
  try {
    let full = await compress(bitmap, FULL_SIDE, 0.82)
    // Ảnh chụp nhiều chi tiết có thể vẫn nặng: nén mạnh hơn để nằm dưới giới hạn 2 MB của kho ảnh
    if (full.size > 1.5 * 1024 * 1024) full = await compress(bitmap, FULL_SIDE, 0.6)
    const thumb = await compress(bitmap, THUMB_SIDE, 0.75)
    return { full, thumb }
  } finally {
    bitmap.close?.()
  }
}

const ext = (blob) => (blob.type === 'image/webp' ? 'webp' : 'jpg')

/** Tải ảnh lên vào một ô (slot) của dự án, thay ảnh cũ nếu có. Trả về dòng project_images mới. */
export async function uploadProjectImage(projectId, slot, file, previous) {
  const { full, thumb } = await prepareImage(file)
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const path = `${projectId}/${slot}-${stamp}.${ext(full)}`
  const thumbPath = `${projectId}/${slot}-${stamp}-nho.${ext(thumb)}`
  const store = supabase.storage.from(IMAGE_BUCKET)
  // Tên file không bao giờ lặp lại nên cho trình duyệt giữ ảnh thật lâu
  const options = (blob) => ({ contentType: blob.type, cacheControl: '31536000', upsert: false })

  const up1 = await store.upload(path, full, options(full))
  if (up1.error) throw up1.error
  const up2 = await store.upload(thumbPath, thumb, options(thumb))
  if (up2.error) {
    await store.remove([path])
    throw up2.error
  }

  const { data, error } = await supabase
    .from('project_images')
    .upsert({ project_id: projectId, slot, path, thumb_path: thumbPath }, { onConflict: 'project_id,slot' })
    .select('id,project_id,slot,path,thumb_path')
    .single()
  if (error) {
    await store.remove([path, thumbPath])
    throw error
  }
  // Dọn file của ảnh cũ để không chiếm chỗ
  if (previous) await store.remove([previous.path, previous.thumb_path])
  return { row: data, size: full.size + thumb.size }
}

export async function removeProjectImage(row) {
  const { data, error } = await supabase.from('project_images').delete().eq('id', row.id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('NO_ROWS_CHANGED')
  await supabase.storage.from(IMAGE_BUCKET).remove([row.path, row.thumb_path])
}

/** Xóa mọi file ảnh của một dự án (gọi trước khi xóa dự án; các dòng trong bảng tự mất theo dự án) */
export async function removeProjectFiles(projectId) {
  const { data, error } = await supabase.from('project_images').select('path,thumb_path').eq('project_id', projectId)
  if (error || !data || data.length === 0) return
  await supabase.storage.from(IMAGE_BUCKET).remove(data.flatMap((r) => [r.path, r.thumb_path]))
}

function readCache() {
  try {
    return JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

/**
 * Đổi đường dẫn file thành link xem được (kho ảnh là riêng tư nên cần link có chữ ký).
 * Link được dùng lại trong suốt phiên làm việc, nhờ đó trình duyệt không phải tải lại ảnh.
 */
export async function signedUrls(paths) {
  const cache = readCache()
  const now = Date.now()
  const out = new Map()
  const missing = []
  for (const p of new Set(paths)) {
    const hit = cache[p]
    if (hit && hit.until - now > 60 * 60 * 1000) out.set(p, hit.url)
    else missing.push(p)
  }
  if (missing.length > 0) {
    const { data, error } = await supabase.storage.from(IMAGE_BUCKET).createSignedUrls(missing, SIGN_SECONDS)
    if (error) throw error
    for (const item of data) {
      if (!item.signedUrl) continue
      out.set(item.path, item.signedUrl)
      cache[item.path] = { url: item.signedUrl, until: now + SIGN_SECONDS * 1000 }
    }
    // Bỏ các link đã hết hạn để bộ nhớ đệm không phình ra
    for (const key of Object.keys(cache)) if (cache[key].until <= now) delete cache[key]
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache))
    } catch {
      /* bỏ qua nếu trình duyệt chặn lưu */
    }
  }
  return out
}
