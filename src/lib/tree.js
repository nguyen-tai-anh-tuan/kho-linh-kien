const collator = new Intl.Collator('vi', { numeric: true })

/** So sánh tên theo kiểu tự nhiên: "Ngăn 2" đứng trước "Ngăn 10" */
export const byNameNatural = (a, b) => collator.compare(a.name, b.name)

/** Dựng cây vị trí. Trả về Map: id cha (null = gốc) -> danh sách con đã sắp xếp */
export function buildTree(locations) {
  const ids = new Set(locations.map((l) => l.id))
  const childrenOf = new Map()
  for (const l of locations) {
    const key = l.parent_id && ids.has(l.parent_id) ? l.parent_id : null
    const list = childrenOf.get(key) ?? []
    list.push(l)
    childrenOf.set(key, list)
  }
  for (const list of childrenOf.values()) list.sort(byNameNatural)
  return childrenOf
}

/** Id của một vị trí và mọi vị trí nằm bên trong nó */
export function subtreeIds(childrenOf, id) {
  const out = [id]
  for (let i = 0; i < out.length; i++) {
    for (const child of childrenOf.get(out[i]) ?? []) out.push(child.id)
  }
  return out
}
