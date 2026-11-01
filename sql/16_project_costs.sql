-- =====================================================================
-- 16_project_costs.sql  -  Tiền công của dự án
-- Chạy MỘT LẦN trong Supabase: SQL Editor -> New query -> dán -> Run.
-- Cần chạy sau file 04_roles.sql. Chạy lại nhiều lần cũng an toàn.
-- Không đụng tới dữ liệu đang có. Nếu có lỗi thì không có gì bị thay đổi.
--
-- Mỗi dòng là một khoản tiền công của dự án (tên khoản + số tiền, tính bằng đồng).
-- Đây là số cố định cho cả dự án, không nhân theo số bộ.
-- Tiền linh kiện không lưu ở đây: web tự tính từ BOM và đơn giá.
-- CHỈ ADMIN được xem, thêm, sửa, xóa. Khách và trang công khai không đọc được bảng này.
-- =====================================================================

begin;

create table if not exists public.project_costs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  amount      numeric(14, 0) not null check (amount >= 0),
  created_at  timestamptz not null default now()
);

create index if not exists project_costs_project_idx on public.project_costs (project_id);

alter table public.project_costs enable row level security;

revoke all on public.project_costs from anon, authenticated;
grant select, insert, update, delete on public.project_costs to authenticated;

drop policy if exists "project_costs view"   on public.project_costs;
drop policy if exists "project_costs add"    on public.project_costs;
drop policy if exists "project_costs edit"   on public.project_costs;
drop policy if exists "project_costs delete" on public.project_costs;
create policy "project_costs view"   on public.project_costs for select to authenticated using ((select private.is_admin()));
create policy "project_costs add"    on public.project_costs for insert to authenticated with check ((select private.is_admin()));
create policy "project_costs edit"   on public.project_costs for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "project_costs delete" on public.project_costs for delete to authenticated using ((select private.is_admin()));

notify pgrst, 'reload schema';

commit;
