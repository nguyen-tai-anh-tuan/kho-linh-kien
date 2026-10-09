-- =====================================================================
-- 03_pages.sql  -  Nâng cấp database cho trang "Dự án và BOM"
-- Chạy MỘT LẦN trong Supabase: SQL Editor -> New query -> dán -> Run.
-- Chạy lại nhiều lần cũng an toàn. Không xóa dữ liệu hiện có của bạn.
-- (Các trang Vị trí, Lịch sử, Cài đặt dùng bảng sẵn có, không cần gì thêm.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Bảng BOM: mỗi dòng là một linh kiện cần cho một dự án
--    quantity = số lượng cần cho MỘT bộ sản phẩm
-- ---------------------------------------------------------------------
create table if not exists public.project_bom (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  component_id uuid not null references public.components (id) on delete restrict,
  quantity     int  not null check (quantity > 0),
  note         text,
  created_at   timestamptz not null default now(),
  unique (project_id, component_id)
);

create index if not exists project_bom_component_idx
  on public.project_bom (component_id);

-- ---------------------------------------------------------------------
-- 2) Quyền truy cập: người đã đăng nhập được xem và sửa BOM
-- ---------------------------------------------------------------------
alter table public.project_bom enable row level security;

drop policy if exists "project_bom authenticated all" on public.project_bom;
create policy "project_bom authenticated all"
  on public.project_bom
  for all
  to authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on public.project_bom to authenticated;

-- ---------------------------------------------------------------------
-- 3) Báo cho Supabase nạp lại cấu trúc mới
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';
