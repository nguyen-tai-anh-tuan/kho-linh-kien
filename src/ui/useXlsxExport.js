import { useState } from 'react'
import { useToast } from './Toast'
import { friendlyError } from '../lib/api'
import { downloadXlsx } from '../lib/xlsx'

/**
 * Xuất Excel kèm trạng thái "đang xuất" và thông báo lỗi.
 * run(opts) nhận đúng tham số của downloadXlsx, hoặc một hàm async trả về tham số đó
 * (dùng khi phải tải thêm dữ liệu trước khi xuất, vd toàn bộ lịch sử).
 */
export function useXlsxExport() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function run(opts) {
    if (busy) return
    setBusy(true)
    try {
      await downloadXlsx(typeof opts === 'function' ? await opts() : opts)
    } catch (e) {
      toast.push({ tone: 'error', message: `Chưa xuất được file Excel. ${friendlyError(e)}`, duration: 9000 })
    } finally {
      setBusy(false)
    }
  }

  return { run, busy }
}
