import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  Boxes,
  CheckCircle2,
  Download,
  Layers,
  PackageCheck,
  Printer,
  SlidersHorizontal,
  Wallet,
} from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useData } from '../data/DataContext'
import { useShell } from '../ShellContext'
import { EmptyState, QtyStepper, Skeleton } from '../ui/common'
import { friendlyError } from '../lib/api'
import { fetchBomLines } from '../lib/bom'
import { useXlsxExport } from '../ui/useXlsxExport'
import { packOf, packPrice } from '../lib/price'
import { fmtDateTime, fmtMoneyFull, fmtNum, fmtPrice, normalize } from '../lib/format'
import { ProjectGallery, useProjectImages } from './ProjectImages'
import { StageBar } from './ProjectStage'

const HISTORY_MAX = 50
const TYPE_LABEL = { in: 'Trả về kho', out: 'Xuất kho', adjust: 'Điều chỉnh' }

/**
 * Trang xem chi tiết một dự án (chỉ để đọc): ảnh, số liệu tóm tắt, toàn bộ BOM gom theo danh mục lớn,
 * và lịch sử xuất / trả kho của dự án. Việc sửa BOM và xuất kho làm ở trang Dự án và BOM.
 */
export default function ProjectViewPage() {
  const { id } = useParams()
  const { projectsById, componentsById, categoriesById, stockByComponent, loading, error, reload, version } = useData()
  const { openComponent } = useShell()
  const images = useProjectImages(version)
  const [bom, setBom] = useState(null) // null: đang tải, { error }: lỗi, { rows, tracked }: xong
  const [history, setHistory] = useState(null)
  const [builds, setBuilds] = useState(1)
  const project = projectsById.get(id)

  useEffect(() => {
    let off = false
    fetchBomLines()
      .then((res) => !off && setBom({ rows: res.rows.filter((l) => l.project_id === id), tracked: res.tracked }))
      .catch((e) => !off && setBom({ error: friendlyError(e) }))
    supabase
      .from('transactions_feed')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: false })
      .limit(HISTORY_MAX)
      .then(({ data, error: err }) => !off && setHistory(err ? { error: friendlyError(err) } : data))
    return () => {
      off = true
    }
  }, [id, version])

  const n = Number(builds) >= 1 ? Number(builds) : 1
  const tracked = Boolean(bom?.tracked)

  // Mỗi dòng BOM ghép với tồn kho, rồi gom theo danh mục lớn
  const { rows, groups, totals } = useMemo(() => {
    const rows = (bom?.rows ?? [])
      .map((line) => {
        const comp = componentsById.get(line.component_id)
        if (!comp) return null
        const per = Number(line.quantity) || 0
        const total = per * n
        const issued = Number(line.issued) || 0
        const left = Math.max(0, total - issued)
        const have = comp.total_quantity ?? 0
        const price = Number(comp.unit_price) > 0 ? Number(comp.unit_price) : null
        return {
          line,
          comp,
          per,
          total,
          issued,
          left,
          have,
          short: Math.max(0, left - have),
          price,
          where: (stockByComponent.get(comp.id) ?? []).map((s) => `${s.path} (${fmtNum(s.quantity)})`).join(', '),
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.comp.part_number.localeCompare(b.comp.part_number, 'vi', { numeric: true }))

    const byRoot = new Map()
    for (const r of rows) {
      const cat = categoriesById.get(r.comp.category_id)
      const root = cat ? categoriesById.get(cat.root_id) : null
      const key = root?.id ?? 'none'
      const group = byRoot.get(key) ?? { key, name: root?.name ?? 'Chưa phân loại', order: root ? (root.sort_order ?? 0) : 1e9, rows: [] }
      group.rows.push(r)
      byRoot.set(key, group)
    }
    const groups = [...byRoot.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'vi'))

    const sum = (pick) => rows.reduce((acc, r) => acc + pick(r), 0)
    const priced = rows.filter((r) => r.price !== null)
    const totals = {
      need: sum((r) => r.total),
      issued: sum((r) => Math.min(r.issued, r.total)),
      left: sum((r) => r.left),
      shortCodes: rows.filter((r) => r.short > 0).length,
      cost: priced.reduce((acc, r) => acc + r.total * r.price, 0),
      unpriced: rows.length - priced.length,
    }
    return { rows, groups, totals }
  }, [bom, n, componentsById, categoriesById, stockByComponent])

  const percent = totals.need > 0 ? Math.round((totals.issued / totals.need) * 100) : 0

  const xlsx = useXlsxExport()
  function exportXlsx() {
    const slug = normalize(`${project.code} ${project.name}`).replace(/[^a-z0-9]+/g, '-')
    xlsx.run({
      filename: `bom-${slug}.xlsx`,
      title: `BOM: ${project.code ? `${project.code} · ` : ''}${project.name}`,
      subtitle: `Tính cho ${fmtNum(n)} bộ`,
      sheet: 'BOM',
      rows: groups.flatMap((g) => [{ group: `${g.name} (${fmtNum(g.rows.length)} mã)` }, ...g.rows]),
      columns: [
        { header: 'Mã linh kiện', value: (r) => r.comp.part_number, width: 26, wrap: true },
        { header: 'Tên', value: (r) => r.comp.name, width: 32, wrap: true },
        { header: 'Package', value: (r) => r.comp.package, width: 13 },
        { header: 'Vị trí trong kho', value: (r) => r.where, width: 28, wrap: true },
        { header: 'Mỗi bộ', value: (r) => r.per, type: 'int', width: 9 },
        { header: 'Tổng cần', value: (r) => r.total, type: 'int', width: 10, total: true },
        ...(tracked
          ? [
              { header: 'Đã xuất', value: (r) => r.issued, type: 'int', width: 10, total: true },
              { header: 'Còn phải xuất', value: (r) => r.left, type: 'int', width: 12, total: true },
            ]
          : []),
        { header: 'Tồn kho', value: (r) => r.have, type: 'int', width: 10 },
        { header: 'Kho thiếu', value: (r) => r.short || null, type: 'int', tone: (r) => (r.short > 0 ? 'danger' : undefined), width: 10, total: true },
        { header: 'Đơn giá', value: (r) => packPrice(r.price, packOf(r.comp)), type: 'money', width: 14 },
        { header: 'Tính theo', value: (r) => (packOf(r.comp) ? `${packOf(r.comp).unit} (${fmtNum(packOf(r.comp).qty)} cái)` : 'cái'), width: 15 },
        { header: 'Thành tiền', value: (r) => (r.price !== null ? r.total * r.price : null), type: 'money', width: 16, total: true },
      ],
    })
  }

  if (error) {
    return (
      <EmptyState title="Chưa tải được dự án" text={error}>
        <button type="button" className="kk-btn kk-btn-primary" onClick={reload}>
          Thử lại
        </button>
      </EmptyState>
    )
  }
  if (loading || bom === null) {
    return (
      <div className="kk-page">
        <div className="kk-skel-list">
          <Skeleton h={90} r={20} />
          <Skeleton h={120} r={20} />
          <Skeleton h={320} r={20} />
        </div>
      </div>
    )
  }
  if (!project) {
    return (
      <EmptyState title="Không tìm thấy dự án này" text="Có thể dự án đã bị xóa.">
        <Link className="kk-btn kk-btn-primary" to="/projects">
          Về danh sách dự án
        </Link>
      </EmptyState>
    )
  }

  return (
    <div className="kk-page kk-pv">
      <Link className="kk-link kk-pv-back" to={`/projects?p=${project.id}`}>
        <ArrowLeft size={16} />
        Quay lại trang làm việc của dự án
      </Link>

      <div className="kk-page-head">
        <div>
          <h1>
            {project.code && <span className="kk-prj kk-prj-lg">{project.code}</span>}
            {project.name}
          </h1>
          {project.description && <p>{project.description}</p>}
        </div>
        <div className="kk-quick kk-no-print">
          <div className="kk-bom-builds">
            <label htmlFor="pv-builds">Tính cho số bộ</label>
            <QtyStepper id="pv-builds" value={builds} min={1} label="Tính cho số bộ" onChange={setBuilds} />
          </div>
          <button type="button" className="kk-btn kk-btn-outline" onClick={exportXlsx} disabled={rows.length === 0 || xlsx.busy}>
            <Download size={18} />
            {xlsx.busy ? 'Đang xuất…' : 'Tải BOM (Excel)'}
          </button>
          <button type="button" className="kk-btn kk-btn-outline" onClick={() => window.print()}>
            <Printer size={18} />
            In / lưu PDF
          </button>
        </div>
      </div>

      <StageBar project={project} />

      <ProjectGallery
        readOnly
        project={project}
        images={images.rows.filter((r) => r.project_id === project.id)}
        urls={images.urls}
        missing={false}
        onChanged={images.refresh}
      />

      {bom.error ? (
        <div className="kk-card">
          <EmptyState title="Chưa tải được BOM" text={bom.error} />
        </div>
      ) : rows.length === 0 ? (
        <div className="kk-card">
          <EmptyState title="BOM còn trống" text="Dự án này chưa có linh kiện nào. Thêm linh kiện ở trang làm việc của dự án.">
            <Link className="kk-btn kk-btn-primary" to={`/projects?p=${project.id}`}>
              Mở trang làm việc
            </Link>
          </EmptyState>
        </div>
      ) : (
        <>
          <section className="kk-stats kk-pv-stats" aria-label="Tóm tắt dự án">
            <Tile Icon={Layers} label="Mã linh kiện trong BOM" value={fmtNum(rows.length)} note={`${fmtNum(groups.length)} nhóm danh mục`} />
            <Tile Icon={Boxes} label={`Tổng linh kiện cần cho ${fmtNum(n)} bộ`} value={fmtNum(totals.need)} note={`Mỗi bộ ${fmtNum(totals.need / n)} cái`} />
            {tracked && (
              <Tile Icon={PackageCheck} label="Đã xuất kho" value={`${fmtNum(totals.issued)} / ${fmtNum(totals.need)}`} note={`${percent}%, còn phải xuất ${fmtNum(totals.left)}`}>
                <Progress value={totals.issued} max={totals.need} />
              </Tile>
            )}
            <Tile
              Icon={totals.shortCodes > 0 ? AlertTriangle : CheckCircle2}
              tone={totals.shortCodes > 0 ? 'warn' : undefined}
              label="Kho còn thiếu"
              value={totals.shortCodes > 0 ? `${fmtNum(totals.shortCodes)} mã` : 'Đủ hàng'}
              note={totals.shortCodes > 0 ? 'Xem các dòng báo Thiếu bên dưới' : tracked ? 'Đủ để xuất phần còn lại' : 'Đủ để xuất cả BOM'}
            />
            <Tile
              Icon={Wallet}
              label={`Ước tính chi phí ${fmtNum(n)} bộ`}
              value={totals.unpriced === rows.length ? 'Chưa có giá' : fmtMoneyFull(totals.cost)}
              note={
                totals.unpriced === 0
                  ? 'Đã tính đủ mọi mã'
                  : totals.unpriced === rows.length
                    ? 'Nhập đơn giá cho linh kiện để ước tính'
                    : `Chưa tính ${fmtNum(totals.unpriced)} mã chưa có đơn giá`
              }
            />
          </section>

          <section className="kk-card kk-table-card" aria-label="Toàn bộ linh kiện của dự án">
            <div className="kk-pane-head">
              <div className="kk-pane-titles">
                <h2>Linh kiện của dự án</h2>
                <p className="kk-card-sub">Gom theo danh mục lớn. Bấm vào mã linh kiện để xem chi tiết.</p>
              </div>
            </div>
            <div className="kk-table-scroll">
              <table className="kk-table kk-table-plain kk-table-static kk-pv-table">
                <thead>
                  <tr>
                    <th>Linh kiện</th>
                    <th className="kk-col-pkg">Package</th>
                    <th>Vị trí trong kho</th>
                    <th className="is-num">Mỗi bộ</th>
                    <th className="is-num">Tổng cần</th>
                    {tracked && <th>Đã xuất</th>}
                    <th className="is-num">Tồn kho</th>
                    <th className="is-num">Thành tiền</th>
                    <th>Tình trạng</th>
                  </tr>
                </thead>
                {groups.map((g) => (
                  <tbody key={g.key}>
                    <tr className="kk-pv-group">
                      <th colSpan={tracked ? 9 : 8} scope="colgroup">
                        {g.name}
                        <span>
                          {fmtNum(g.rows.length)} mã, {fmtNum(g.rows.reduce((acc, r) => acc + r.total, 0))} cái
                        </span>
                      </th>
                    </tr>
                    {g.rows.map((r) => (
                      <tr key={r.line.id}>
                        <td data-label="Linh kiện" className="kk-cell-main">
                          <button type="button" className="kk-row-link" onClick={() => openComponent(r.comp.id)}>
                            {r.comp.part_number}
                          </button>
                          <span className="kk-cell-name">{r.comp.name}</span>
                        </td>
                        <td data-label="Package" className="kk-col-pkg">
                          {r.comp.package || '—'}
                        </td>
                        <td data-label="Vị trí trong kho">{r.where || '—'}</td>
                        <td data-label="Mỗi bộ" className="is-num">
                          {fmtNum(r.per)}
                        </td>
                        <td data-label="Tổng cần" className="is-num kk-strong-num">
                          {fmtNum(r.total)}
                        </td>
                        {tracked && (
                          <td data-label="Đã xuất">
                            <span className="kk-pv-issued">
                              {fmtNum(r.issued)} / {fmtNum(r.total)}
                              <Progress value={r.issued} max={r.total} />
                            </span>
                          </td>
                        )}
                        <td data-label="Tồn kho" className="is-num">
                          {fmtNum(r.have)}
                        </td>
                        <td data-label="Thành tiền" className="is-num" title={r.price !== null ? `Đơn giá ${fmtPrice(r.price)}` : undefined}>
                          {r.price !== null ? fmtMoneyFull(r.total * r.price) : '—'}
                        </td>
                        <td data-label="Tình trạng">
                          {tracked && r.per > 0 && r.left === 0 ? (
                            <span className="kk-status kk-status-ok">
                              <CheckCircle2 size={14} aria-hidden="true" />
                              Đã xuất đủ
                            </span>
                          ) : r.short > 0 ? (
                            <span className="kk-status kk-status-low">
                              <AlertTriangle size={14} aria-hidden="true" />
                              Thiếu {fmtNum(r.short)}
                            </span>
                          ) : (
                            <span className="kk-status kk-status-ok">
                              <CheckCircle2 size={14} aria-hidden="true" />
                              Đủ hàng
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          </section>
        </>
      )}

      <section className="kk-card" aria-labelledby="pv-history">
        <div className="kk-card-head">
          <div>
            <h2 id="pv-history">Lịch sử xuất và trả kho của dự án</h2>
            <p className="kk-card-sub">Các giao dịch có gắn dự án này, mới nhất ở trên.</p>
          </div>
          <Link className="kk-link kk-no-print" to={`/history?proj=${project.id}`}>
            Mở trong trang Lịch sử
          </Link>
        </div>
        {history === null ? (
          <div className="kk-skel-list">
            <Skeleton h={36} r={10} />
            <Skeleton h={36} r={10} />
          </div>
        ) : history.error ? (
          <p className="kk-form-error">{history.error}</p>
        ) : history.length === 0 ? (
          <p className="kk-muted-text">Chưa có lần xuất kho nào cho dự án này.</p>
        ) : (
          <>
            <ul className="kk-history kk-list-scroll kk-pv-history" tabIndex={0} aria-label="Lịch sử của dự án, cuộn để xem thêm">
              {history.map((t) => (
                <li key={t.id}>
                  <span className={`kk-list-ico ${t.type === 'in' ? 'kk-ico-in' : t.type === 'out' ? 'kk-ico-out' : 'kk-ico-adj'}`}>
                    {t.type === 'in' ? <ArrowDownToLine size={16} /> : t.type === 'out' ? <ArrowUpFromLine size={16} /> : <SlidersHorizontal size={16} />}
                  </span>
                  <span className="kk-list-main">
                    <span>
                      {TYPE_LABEL[t.type] ?? t.type} {fmtNum(t.quantity)} × {t.part_number}
                      {t.location_path ? `, ${t.location_path}` : ''}
                    </span>
                    <small>
                      {fmtDateTime(t.created_at)}
                      {t.actor_name ? `, bởi ${t.actor_name}` : ''}
                      {t.note ? `, ${t.note}` : ''}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
            {history.length >= HISTORY_MAX && (
              <p className="kk-muted-text kk-bulk-note">Đang hiện {fmtNum(HISTORY_MAX)} giao dịch mới nhất. Xem đầy đủ trong trang Lịch sử.</p>
            )}
          </>
        )}
      </section>
    </div>
  )
}

function Tile({ Icon, label, value, note, tone, children }) {
  return (
    <div className="kk-stat">
      <span className={`kk-stat-ico ${tone === 'warn' ? 'kk-stat-ico-warn' : ''}`}>
        <Icon size={20} />
      </span>
      <span className="kk-stat-label">{label}</span>
      <strong className="kk-stat-value kk-pv-value">{value}</strong>
      {children}
      {note && <span className="kk-pv-note">{note}</span>}
    </div>
  )
}

function Progress({ value, max }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <span className="kk-pv-bar" role="img" aria-label={`${pct}%`}>
      <i className={pct >= 100 ? 'is-full' : ''} style={{ width: `${pct}%` }} />
    </span>
  )
}
