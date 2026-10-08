import { createContext, useContext } from 'react'

/** Các hành động dùng chung giữa các trang: mở chi tiết, mở form linh kiện, mở nhập CSV */
export const ShellContext = createContext(null)

export function useShell() {
  const ctx = useContext(ShellContext)
  if (!ctx) throw new Error('useShell phải dùng bên trong Dashboard')
  return ctx
}
