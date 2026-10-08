import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { fetchAll, friendlyError } from '../lib/api'
import { normalize } from '../lib/format'

const DataContext = createContext(null)

export function useData() {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData phải dùng bên trong DataProvider')
  return ctx
}

const byName = (a, b) => a.name.localeCompare(b.name, 'vi')
const byPath = (a, b) => a.path.localeCompare(b.path, 'vi')

export function DataProvider({ children }) {
  const [raw, setRaw] = useState({
    components: [],
    stock: [],
    categories: [],
    locations: [],
    projects: [],
  })
  const [status, setStatus] = useState({ loading: true, refreshing: false, error: null })
  const [version, setVersion] = useState(0)
  const alive = useRef(true)

  const load = useCallback(async () => {
    setStatus((s) => ({ ...s, refreshing: true, error: null }))
    try {
      const must = (res) => {
        if (res.error) throw res.error
        return res.data
      }
      const [components, stock, categories, locations, projects] = await Promise.all([
        fetchAll(() => supabase.from('component_totals').select('*').order('id')),
        fetchAll(() =>
          supabase
            .from('stock')
            .select('component_id,location_id,quantity')
            .order('component_id')
            .order('location_id'),
        ),
        supabase.from('categories').select('id,name').order('name').then(must),
        supabase
          .from('locations_full')
          .select('id,name,parent_id,path,depth,qr_code')
          .order('path')
          .then(must),
        supabase.from('projects').select('id,name').order('name').then(must),
      ])
      if (!alive.current) return
      setRaw({ components, stock, categories, locations, projects })
      setVersion((v) => v + 1)
      setStatus({ loading: false, refreshing: false, error: null })
    } catch (error) {
      if (!alive.current) return
      setStatus({ loading: false, refreshing: false, error: friendlyError(error) })
    }
  }, [])

  useEffect(() => {
    alive.current = true
    load()
    return () => {
      alive.current = false
    }
  }, [load])

  const derived = useMemo(() => {
    const locationsById = new Map(raw.locations.map((l) => [l.id, l]))
    const componentsById = new Map(raw.components.map((c) => [c.id, c]))

    // Tồn theo từng (linh kiện, vị trí), kể cả dòng bằng 0
    const stockMap = new Map()
    // Danh sách vị trí đang có hàng của từng linh kiện
    const stockByComponent = new Map()
    for (const s of raw.stock) {
      stockMap.set(`${s.component_id}|${s.location_id}`, s.quantity)
      if (s.quantity <= 0) continue
      const loc = locationsById.get(s.location_id)
      if (!loc) continue
      const list = stockByComponent.get(s.component_id) ?? []
      list.push({ location_id: s.location_id, quantity: s.quantity, path: loc.path })
      stockByComponent.set(s.component_id, list)
    }
    for (const list of stockByComponent.values()) list.sort(byPath)

    // Mỗi loại một màu cố định (theo thứ tự tên), dùng chung cho chip và biểu đồ
    const toneByCategory = new Map(
      [...raw.categories].sort(byName).map((c, i) => [c.id, i % 6]),
    )

    const packages = [...new Set(raw.components.map((c) => c.package).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'vi'),
    )

    // Chuỗi tìm kiếm đã bỏ dấu của từng linh kiện (tính một lần cho mỗi lần tải dữ liệu)
    const searchText = new Map(
      raw.components.map((c) => [
        c.id,
        normalize([c.part_number, c.name, c.value, c.package, c.manufacturer, c.category_name].filter(Boolean).join(' ')),
      ]),
    )

    return { locationsById, componentsById, stockMap, stockByComponent, toneByCategory, packages, searchText }
  }, [raw])

  const createNamed = useCallback(
    async (table, key, name) => {
      const clean = String(name ?? '').trim()
      if (!clean) throw new Error('Tên không được để trống.')
      const existing = raw[key].find((x) => normalize(x.name) === normalize(clean))
      if (existing) return existing
      const { data, error } = await supabase.from(table).insert({ name: clean }).select('id,name').single()
      if (error) throw error
      const row = table === 'locations' ? { ...data, parent_id: null, path: data.name, depth: 0, qr_code: null } : data
      setRaw((r) => ({
        ...r,
        [key]: [...r[key], row].sort(table === 'locations' ? byPath : byName),
      }))
      return row
    },
    [raw],
  )

  const value = useMemo(
    () => ({
      ...raw,
      ...derived,
      ...status,
      version,
      reload: load,
      createCategory: (name) => createNamed('categories', 'categories', name),
      createLocation: (name) => createNamed('locations', 'locations', name),
      createProject: (name) => createNamed('projects', 'projects', name),
    }),
    [raw, derived, status, version, load, createNamed],
  )

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}
