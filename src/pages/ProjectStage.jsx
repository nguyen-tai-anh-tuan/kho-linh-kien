import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useData } from '../data/DataContext'
import { useToast } from '../ui/Toast'
import { friendlyError, mustChange } from '../lib/api'
import { fmtDate } from '../lib/format'

/** Các bước thực hiện một dự án, theo đúng thứ tự. Database lưu vị trí của bước (0, 1, 2...). */
export const STAGES = ['Lên ý tưởng', 'Thiết kế', 'Vẽ PCB', 'In PCB', 'Lắp ráp và kiểm thử', 'Hoàn thành']
const LAST = STAGES.length - 1

/** Database đã có cột tiến độ hay chưa (đã chạy sql/12_project_stage.sql) */
export const hasStage = (project) => typeof project?.stage === 'number'
export const stageName = (project) => STAGES[Math.min(Math.max(project?.stage ?? 0, 0), LAST)]

function sinceText(iso) {
  if (!iso) return ''
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  const ago = days <= 0 ? 'hôm nay' : days === 1 ? 'hôm qua' : `${days} ngày trước`
  return `Ở bước này từ ${fmtDate(iso)} (${ago}).`
}

/** Nhãn nhỏ ghi bước hiện tại, dùng trong danh sách dự án */
export function StageTag({ project }) {
  if (!hasStage(project)) return null
  return <span className={`kk-stage-tag ${project.stage >= LAST ? 'is-done' : ''}`}>{stageName(project)}</span>
}

/**
 * Thanh tiến độ của một dự án. editable = bấm vào một bước để chuyển dự án sang bước đó
 * (tiến hay lùi đều được, do người dùng chọn theo tình hình thực tế).
 */
export function StageBar({ project, editable = false }) {
  const { reload } = useData()
  const toast = useToast()
  const [saving, setSaving] = useState(null) // bước đang được lưu

  if (!hasStage(project)) return null
  const current = Math.min(Math.max(project.stage, 0), LAST)

  async function choose(step) {
    if (saving !== null || step === current) return
    setSaving(step)
    try {
      mustChange(
        await supabase
          .from('projects')
          .update({ stage: step, stage_changed_at: new Date().toISOString() })
          .eq('id', project.id)
          .select('id'),
      )
      await reload()
      toast.push({ message: `${project.code || project.name}: chuyển sang bước "${STAGES[step]}".` })
    } catch (e) {
      toast.push({ tone: 'error', message: friendlyError(e), duration: 9000 })
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="kk-stage">
      <ol className="kk-stage-steps" aria-label={`Tiến độ dự án: đang ở bước ${stageName(project)}`}>
        {STAGES.map((name, i) => {
          const state = i < current ? 'is-past' : i === current ? 'is-now' : 'is-next'
          const dot = (
            <span className="kk-stage-dot" aria-hidden="true">
              {saving === i ? <Loader2 size={14} className="kk-spin" /> : i < current || current === LAST ? <Check size={14} /> : i + 1}
            </span>
          )
          return (
            <li key={name} className={`kk-stage-step ${state}`} aria-current={i === current ? 'step' : undefined}>
              {editable ? (
                <button
                  type="button"
                  disabled={saving !== null}
                  title={i === current ? 'Dự án đang ở bước này' : `Chuyển dự án sang bước "${name}"`}
                  onClick={() => choose(i)}
                >
                  {dot}
                  <span className="kk-stage-name">{name}</span>
                </button>
              ) : (
                <span className="kk-stage-static">
                  {dot}
                  <span className="kk-stage-name">{name}</span>
                </span>
              )}
            </li>
          )
        })}
      </ol>
      <p className="kk-stage-note">
        {sinceText(project.stage_changed_at)}
        {editable && ' Bấm vào một bước để đổi tiến độ.'}
      </p>
    </div>
  )
}
