import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

const emptyForm = { part_number: '', name: '', package: '', min_stock: 0 }

export default function Dashboard({ session }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(emptyForm)

  async function loadItems() {
    setLoading(true)
    const { data, error } = await supabase
      .from('component_totals')
      .select('*')
      .order('part_number')
    if (error) alert(error.message)
    else setItems(data)
    setLoading(false)
  }

  useEffect(() => {
    loadItems()
  }, [])

  async function addComponent(e) {
    e.preventDefault()
    const { error } = await supabase.from('components').insert({
      part_number: form.part_number,
      name: form.name,
      package: form.package || null,
      min_stock: Number(form.min_stock),
    })
    if (error) return alert(error.message)
    setForm(emptyForm)
    loadItems()
  }

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  return (
    <div className="container">
      <header>
        <h1>Kho linh kiện</h1>
        <div>
          <span>{session.user.email}</span>
          <button onClick={() => supabase.auth.signOut()}>Đăng xuất</button>
        </div>
      </header>

      <form className="add-form" onSubmit={addComponent}>
        <input name="part_number" placeholder="Mã linh kiện" value={form.part_number} onChange={handleChange} required />
        <input name="name" placeholder="Tên" value={form.name} onChange={handleChange} required />
        <input name="package" placeholder="Package" value={form.package} onChange={handleChange} />
        <input name="min_stock" type="number" min="0" placeholder="Tồn tối thiểu" value={form.min_stock} onChange={handleChange} />
        <button>Thêm</button>
      </form>

      {loading ? (
        <p>Đang tải...</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Mã</th>
              <th>Tên</th>
              <th>Package</th>
              <th>Tồn kho</th>
              <th>Tối thiểu</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id} className={c.is_low ? 'low' : ''}>
                <td>{c.part_number}</td>
                <td>{c.name}</td>
                <td>{c.package}</td>
                <td>{c.total_quantity}</td>
                <td>{c.min_stock}</td>
                <td>{c.is_low ? 'Sắp hết' : 'Ổn'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}