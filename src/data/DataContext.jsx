import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { fetchAll, friendlyError, isMissingSchema } from '../lib/api'
import { normalize } from '../lib/format'
import { buildTree, byOrderThenName, flattenTree } from '../lib/tree'

const DataContext = createContext(null)

export function useData() {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData phải dùng bên trong DataProvider')
  return ctx
}

const byName = (a, b) => a.name.localeCompare(b.name, 'vi')
const byPath = (a, b) => a.path.localeCompare(b.path, 'vi')

/** Cây danh mục kèm đường dẫn. Nếu chưa chạy sql/05_categories.sql thì dùng danh sách phẳng như trước. */
async function loadCategories() {
  const full = await supabase.from('categories_full').select('id,name,parent_id,sort_order,path,depth,root_id')
  if (!full.error) return { tree: true, rows: full.data }
  if (!isMissingSchema(full.error)) throw full.error
  const flat = await supabase.from('categories').select('id,name').order('name')
  if (flat.error) throw flat.error
  return {
    tree: false,
    rows: flat.data.map((c) => ({ ...c, parent_id: null, sort_order: 0, path: c.name, depth: 0, root_id: c.id })),
  }
}

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
  const [categoryTree, setCategoryTree] = useState(true) // false: database chưa có danh mục nhiều tầng
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
        loadCategories(),
        supabase
          .from('locations_full')
          .select('id,name,parent_id,path,depth,qr_code')
          .order('path')
          .then(must),
        supabase.from('projects').select('id,name,description').order('name').then(must),
      ])
      if (!alive.current) return
      setCategoryTree(categories.tree)
      setRaw({ components, stock, categories: categories.rows, locations, projects })
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

    // Cây danh mục: lớn -> con -> chi tiết. "categories" được xếp lại theo đúng thứ tự của cây.
    const categoryChildren = buildTree(raw.categories, byOrderThenName)
    const categories = flattenTree(categoryChildren)
    const categoriesById = new Map(categories.map((c) => [c.id, c]))

    // Mỗi danh mục lớn một màu cố định, các danh mục bên trong dùng chung màu của nó (chip và biểu đồ)
    const rootTone = new Map((categoryChildren.get(null) ?? []).map((c, i) => [c.id, i % 6]))
    const toneByCategory = new Map(categories.map((c) => [c.id, rootTone.get(c.root_id) ?? 0]))

    // Linh kiện ngừng dùng bị ẩn khỏi danh sách, thống kê và các ô chọn, nhưng lịch sử vẫn tra được qua componentsById
    const components = raw.components.filter((c) => !c.archived_at)
    const archivedComponents = raw.components.filter((c) => c.archived_at)

    const packages = [...new Set(components.map((c) => c.package).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'vi'),
    )

    // Chuỗi tìm kiếm đã bỏ dấu của từng linh kiện (tính một lần cho mỗi lần tải dữ liệu)
    const searchText = new Map(
      raw.components.map((c) => [
        c.id,
        normalize(
          [c.part_number, c.name, c.value, c.package, c.manufacturer, categoriesById.get(c.category_id)?.path ?? c.category_name]
            .filter(Boolean)
            .join(' '),
        ),
      ]),
    )

    return {
      components,
      archivedComponents,
      allComponents: raw.components,
      locationsById,
      componentsById,
      stockMap,
      stockByComponent,
      categories,
      categoriesById,
      categoryChildren,
      toneByCategory,
      packages,
      searchText,
    }
  }, [raw])

  /** Thêm danh mục (chỉ admin). parentId = null là danh mục lớn. Xếp sau cùng trong các danh mục cùng cha. */
  const createCategory = useCallback(
    async (name, parentId = null) => {
      const clean = String(name ?? '').trim()
      if (!clean) throw new Error('Tên không được để trống.')
      const siblings = derived.categoryChildren.get(parentId) ?? []
      const payload = categoryTree
        ? { name: clean, parent_id: parentId, sort_order: Math.max(0, ...siblings.map((c) => c.sort_order ?? 0)) + 1 }
        : { name: clean }
      const { data, error } = await supabase.from('categories').insert(payload).select('id').single()
      if (error) throw error
      await load()
      return data
    },
    [derived, categoryTree, load],
  )

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
      categoryTree,
      reload: load,
      createCategory,
      createLocation: (name) => createNamed('locations', 'locations', name),
      createProject: (name) => createNamed('projects', 'projects', name),
    }),
    [raw, derived, status, version, categoryTree, load, createNamed, createCategory],
  )

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}
