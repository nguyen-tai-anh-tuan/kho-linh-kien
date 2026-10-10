const collator = new Intl.Collator('vi', { numeric: true })

/** So sánh tên theo kiểu tự nhiên: "Ngăn 2" đứng trước "Ngăn 10" */
export const byNameNatural = (a, b) => collator.compare(a.name, b.name)

/** Danh mục xếp theo thứ tự đã đặt (sort_order), cùng thứ tự thì theo tên */
export const byOrderThenName = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || byNameNatural(a, b)

/** Dựng cây (vị trí hoặc danh mục). Trả về Map: id cha (null = gốc) -> danh sách con đã sắp xếp */
export function buildTree(items, compare = byNameNatural) {
  const ids = new Set(items.map((l) => l.id))
  const childrenOf = new Map()
  for (const l of items) {
    const key = l.parent_id && ids.has(l.parent_id) ? l.parent_id : null
    const list = childrenOf.get(key) ?? []
    list.push(l)
    childrenOf.set(key, list)
  }
  for (const list of childrenOf.values()) list.sort(compare)
  return childrenOf
}

/** Trải cây thành danh sách theo thứ tự từ trên xuống (cha rồi tới các con) */
export function flattenTree(childrenOf) {
  const out = []
  const walk = (parentId) => {
    for (const item of childrenOf.get(parentId) ?? []) {
      out.push(item)
      walk(item.id)
    }
  }
  walk(null)
  return out
}

/** Tên thụt vào theo tầng, dùng cho các ô chọn dạng danh sách thả xuống */
export const indentLabel = (item) => `${'   '.repeat(item.depth ?? 0)}${item.name}`

/** Id của một mục và mọi mục nằm bên trong nó */
export function subtreeIds(childrenOf, id) {
  const out = [id]
  for (let i = 0; i < out.length; i++) {
    for (const child of childrenOf.get(out[i]) ?? []) out.push(child.id)
  }
  return out
}
