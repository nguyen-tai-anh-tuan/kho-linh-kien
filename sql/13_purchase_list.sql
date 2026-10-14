-- =====================================================================
-- 13_purchase_list.sql  -  Danh sách mua trước (trang Cần mua)
-- Chạy MỘT LẦN trong Supabase: SQL Editor -> New query -> dán -> Run.
-- Cần chạy sau file 04_roles.sql. Chạy lại nhiều lần cũng an toàn.
-- Không đụng tới dữ liệu đang có. Nếu có lỗi thì không có gì bị thay đổi.
--
-- Mỗi dòng là một món định mua: hoặc là linh kiện đã có trong kho (component_id),
-- hoặc là linh kiện mới (ghi mã, tên và thông tin để tạo linh kiện khi mua về).
-- Khi bấm "Đã mua", web tạo / nhập kho linh kiện rồi xóa dòng này khỏi danh sách.
-- Admin và thành viên được thêm, sửa, xóa và đánh dấu đã mua.
-- =====================================================================

begin;

create table if not exists public.purchase_items (
  id            uuid primary key default gen_random_uuid(),
  component_id  uuid references public.components (id) on delete cascade,
  part_number   text,
  name          text,
  category_id   uuid references public.categories (id) on delete set null,
  value         text,
  package       text,
  manufacturer  text,
  quantity      int not null check (quantity > 0),
  unit_price    numeric check (unit_price >= 0),
  shop_url      text,
  note          text,
  project_id    uuid references public.projects (id) on delete set null,
  status        text not null default 'todo' check (status in ('todo', 'ordered')),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  -- Linh kiện mới thì phải có mã và tên
  constraint purchase_items_what check (
    component_id is not null
    or (coalesce(btrim(part_number), '') <> '' and coalesce(btrim(name), '') <> '')
  )
);

create index if not exists purchase_items_component_idx on public.purchase_items (component_id);
create index if not exists purchase_items_project_idx on public.purchase_items (project_id);

alter table public.purchase_items enable row level security;

revoke all on public.purchase_items from anon, authenticated;
grant select, insert, update, delete on public.purchase_items to authenticated;

drop policy if exists "purchase_items view"   on public.purchase_items;
drop policy if exists "purchase_items add"    on public.purchase_items;
drop policy if exists "purchase_items edit"   on public.purchase_items;
drop policy if exists "purchase_items delete" on public.purchase_items;
create policy "purchase_items view"   on public.purchase_items for select to authenticated using ((select private.can_view()));
create policy "purchase_items add"    on public.purchase_items for insert to authenticated with check ((select private.can_edit()));
create policy "purchase_items edit"   on public.purchase_items for update to authenticated using ((select private.can_edit())) with check ((select private.can_edit()));
create policy "purchase_items delete" on public.purchase_items for delete to authenticated using ((select private.can_edit()));

notify pgrst, 'reload schema';

commit;
