import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useData } from '../data/DataContext'
import { useToast } from '../ui/Toast'
import { friendlyError, mustChange } from '../lib/api'
import { fmtDate } from '../lib/format'

/** Các bước thực hiện một dự án, theo đúng thứ tự. Database lưu vị trí của bước (0, 1, 2...). */
export const STAGES = ['Lên ý tưởng', 'Thiết kế', 'Vẽ PCB', 'In PCB', 'Lắp ráp và kiểm thử', 'Hoàn thành']
/** Tên ngắn cho nhãn và nút lọc, chỗ hẹp */
export const STAGE_SHORT = ['Ý tưởng', 'Thiết kế', 'Vẽ PCB', 'In PCB', 'Lắp ráp', 'Hoàn thành']
const LAST = STAGES.length - 1

/**
 * Màu của từng bước, giống web quản trị: ý tưởng xám xanh → thiết kế xanh ngọc → vẽ PCB xanh dương
 * → in PCB tím → lắp ráp vàng → hoàn thành xanh lá. Mã màu nằm ở biến --kk-stage-0..5 (dashboard.css).
 */
export const stageColor = (n) => `var(--kk-stage-${Math.min(Math.max(n ?? 0, 0), LAST)})`
export const isDoneStage = (project) => hasStage(project) && project.stage >= LAST

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
  const i = Math.min(Math.max(project.stage, 0), LAST)
  return (
    <span className="kk-stage-tag" style={{ '--stage': stageColor(i) }} title={`Bước ${i + 1}/${STAGES.length}: ${STAGES[i]}`}>
      <span className="kk-stage-tag-dot" aria-hidden="true" />
      {STAGE_SHORT[i]}
    </span>
  )
}

/**
 * Tổng quan + lọc theo tiến độ: thanh chia 6 đoạn màu (dài theo số dự án ở mỗi bước)
 * và hàng nút lọc. Bấm lại nút đang chọn để bỏ lọc. value: '' = mọi tiến độ, hoặc số bước.
 */
export function StageFilter({ projects, value, onChange }) {
  const counts = STAGES.map((_, i) => projects.filter((p) => p.stage === i).length)
  const total = counts.reduce((a, b) => a + b, 0)
  const picked = value === '' ? null : Number(value)

  return (
    <section className="kk-stage-filter" aria-label="Lọc theo tiến độ">
      <div className="kk-stage-dist" aria-hidden="true">
        {counts.map((n, i) =>
          n ? (
            <span
              key={STAGES[i]}
              style={{ '--stage': stageColor(i), flexGrow: n }}
              className={picked !== null && picked !== i ? 'is-dim' : undefined}
            />
          ) : null,
        )}
        {total === 0 && <span className="is-empty" />}
      </div>
      <div className="kk-stage-chips" role="group" aria-label="Chọn bước tiến độ để lọc">
        <button
          type="button"
          className={`kk-stage-chip is-all ${picked === null ? 'is-on' : ''}`}
          aria-pressed={picked === null}
          onClick={() => onChange('')}
        >
          Tất cả <span className="kk-stage-chip-n">{projects.length}</span>
        </button>
        {STAGES.map((name, i) => (
          <button
            key={name}
            type="button"
            className={`kk-stage-chip ${picked === i ? 'is-on' : ''}`}
            style={{ '--stage': stageColor(i) }}
            aria-pressed={picked === i}
            title={`${name}: ${counts[i]} dự án`}
            onClick={() => onChange(picked === i ? '' : String(i))}
          >
            <span className="kk-stage-tag-dot" aria-hidden="true" />
            {STAGE_SHORT[i]} <span className="kk-stage-chip-n">{counts[i]}</span>
          </button>
        ))}
      </div>
    </section>
  )
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
    <div className="kk-stage" style={{ '--stage': stageColor(current) }}>
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
