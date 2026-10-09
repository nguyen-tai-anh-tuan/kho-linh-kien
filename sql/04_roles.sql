-- =====================================================================
-- 04_roles.sql  -  Thành viên, phân quyền và tên người thực hiện
-- Chạy MỘT LẦN trong Supabase: SQL Editor -> New query -> dán -> Run.
-- Chạy lại nhiều lần cũng an toàn. Không xóa dữ liệu kho của bạn.
--
-- File này THAY TOÀN BỘ quy tắc truy cập (RLS policy) của các bảng kho
-- bằng bộ quy tắc theo vai trò:
--   admin   : làm được mọi thứ, kể cả duyệt và phân quyền thành viên
--   member  : nhập/xuất, thêm và sửa; không được xóa, không sửa cài đặt
--   viewer  : chỉ xem
--   pending : mới đăng ký, đang chờ admin duyệt (không thấy gì)
--   blocked : bị khóa (không thấy gì)
--
-- Nếu có lỗi ở bất kỳ bước nào thì không có gì bị thay đổi.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0) Bảng BOM (giống file 03, để file này chạy được kể cả khi chưa chạy 03)
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
create index if not exists project_bom_component_idx on public.project_bom (component_id);

-- ---------------------------------------------------------------------
-- 1) Bảng profiles: mỗi tài khoản đăng nhập có một dòng (tên hiển thị + vai trò)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text,
  display_name text not null default '' check (char_length(display_name) <= 60),
  role         text not null default 'pending'
               check (role in ('admin', 'member', 'viewer', 'pending', 'blocked')),
  created_at   timestamptz not null default now()
);

-- Tự tạo profile "chờ duyệt" mỗi khi có người đăng ký.
-- Chỉ lấy TÊN từ dữ liệu người dùng gửi lên; vai trò luôn là pending.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)), 60),
    'pending'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Các tài khoản đã có từ trước: tạo profile "chờ duyệt"
insert into public.profiles (id, email, display_name, role)
select u.id, u.email, left(split_part(u.email, '@', 1), 60), 'pending'
from auth.users u
on conflict (id) do nothing;

-- Admin đầu tiên (chỉ đặt khi chưa có admin nào, để chạy lại file không ghi đè lựa chọn của bạn)
update public.profiles
set role = 'admin'
where lower(email) = lower('nguyentaianhtuan2004@gmail.com')
  and not exists (select 1 from public.profiles where role = 'admin');

do $$
begin
  if not exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'Không tìm thấy tài khoản admin. Hãy sửa email ở bước 1 của file này cho đúng email bạn dùng để đăng nhập rồi chạy lại.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2) Hàm kiểm tra vai trò, dùng trong các quy tắc truy cập
--    Đặt trong schema "private" để không gọi được trực tiếp qua API.
-- ---------------------------------------------------------------------
create schema if not exists private;

create or replace function private.my_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = (select auth.uid());
$$;

create or replace function private.can_view()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(private.my_role() in ('admin', 'member', 'viewer'), false);
$$;

create or replace function private.can_edit()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(private.my_role() in ('admin', 'member'), false);
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(private.my_role() = 'admin', false);
$$;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------------
-- 3) Quyền trên bảng profiles
--    Người dùng chỉ sửa được TÊN của chính mình (cấp quyền theo cột),
--    nên không ai tự nâng vai trò của mình được.
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

drop policy if exists "profiles select" on public.profiles;
create policy "profiles select" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select private.can_view()));

drop policy if exists "profiles update own name" on public.profiles;
create policy "profiles update own name" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Admin đổi vai trò của thành viên qua hàm này
create or replace function public.set_member_role(target uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
  if new_role not in ('admin', 'member', 'viewer', 'pending', 'blocked') then
    raise exception 'BAD_ROLE';
  end if;
  -- Luôn phải còn ít nhất một admin
  if new_role <> 'admin'
     and exists (select 1 from public.profiles where id = target and role = 'admin')
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'LAST_ADMIN';
  end if;

  update public.profiles set role = new_role where id = target;
  if not found then
    raise exception 'NO_ROWS_CHANGED';
  end if;
end;
$$;

revoke execute on function public.set_member_role(uuid, text) from public, anon;
grant execute on function public.set_member_role(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4) Quy tắc truy cập cho các bảng kho: xóa hết quy tắc cũ rồi tạo lại
-- ---------------------------------------------------------------------
do $$
declare
  p record;
begin
  for p in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('components', 'categories', 'locations', 'stock', 'transactions', 'projects', 'project_bom')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

alter table public.components   enable row level security;
alter table public.categories   enable row level security;
alter table public.locations    enable row level security;
alter table public.stock        enable row level security;
alter table public.transactions enable row level security;
alter table public.projects     enable row level security;
alter table public.project_bom  enable row level security;

-- Người chưa đăng nhập không được đụng vào bảng nào
revoke all on public.components, public.categories, public.locations, public.stock,
              public.transactions, public.projects, public.project_bom from anon;
grant select, insert, update, delete on public.components, public.categories, public.locations, public.stock,
              public.transactions, public.projects, public.project_bom to authenticated;

-- Linh kiện: thành viên thêm và sửa, chỉ admin xóa
create policy "components view"   on public.components for select to authenticated using ((select private.can_view()));
create policy "components add"    on public.components for insert to authenticated with check ((select private.can_edit()));
create policy "components edit"   on public.components for update to authenticated using ((select private.can_edit())) with check ((select private.can_edit()));
create policy "components delete" on public.components for delete to authenticated using ((select private.is_admin()));

-- Danh mục: thành viên được thêm (khi tạo linh kiện, nhập CSV), chỉ admin đổi tên và xóa
create policy "categories view"   on public.categories for select to authenticated using ((select private.can_view()));
create policy "categories add"    on public.categories for insert to authenticated with check ((select private.can_edit()));
create policy "categories edit"   on public.categories for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "categories delete" on public.categories for delete to authenticated using ((select private.is_admin()));

-- Vị trí
create policy "locations view"   on public.locations for select to authenticated using ((select private.can_view()));
create policy "locations add"    on public.locations for insert to authenticated with check ((select private.can_edit()));
create policy "locations edit"   on public.locations for update to authenticated using ((select private.can_edit())) with check ((select private.can_edit()));
create policy "locations delete" on public.locations for delete to authenticated using ((select private.is_admin()));

-- Dự án
create policy "projects view"   on public.projects for select to authenticated using ((select private.can_view()));
create policy "projects add"    on public.projects for insert to authenticated with check ((select private.can_edit()));
create policy "projects edit"   on public.projects for update to authenticated using ((select private.can_edit())) with check ((select private.can_edit()));
create policy "projects delete" on public.projects for delete to authenticated using ((select private.is_admin()));

-- BOM: bỏ một dòng khỏi BOM là một phần của việc sửa BOM nên thành viên cũng làm được
create policy "project_bom view"   on public.project_bom for select to authenticated using ((select private.can_view()));
create policy "project_bom add"    on public.project_bom for insert to authenticated with check ((select private.can_edit()));
create policy "project_bom edit"   on public.project_bom for update to authenticated using ((select private.can_edit())) with check ((select private.can_edit()));
create policy "project_bom delete" on public.project_bom for delete to authenticated using ((select private.can_edit()));

-- Tồn kho: được cập nhật tự động bởi trigger khi ghi giao dịch
create policy "stock view" on public.stock for select to authenticated using ((select private.can_view()));
create policy "stock add"  on public.stock for insert to authenticated with check ((select private.can_edit()));
create policy "stock edit" on public.stock for update to authenticated using ((select private.can_edit())) with check ((select private.can_edit()));

-- Giao dịch: chỉ được ghi thêm dưới tên chính mình; không ai sửa hay xóa lịch sử
alter table public.transactions alter column created_by set default auth.uid();
create policy "transactions view" on public.transactions for select to authenticated using ((select private.can_view()));
create policy "transactions add"  on public.transactions for insert to authenticated
  with check ((select private.can_edit()) and created_by = (select auth.uid()));

-- ---------------------------------------------------------------------
-- 5) Lịch sử giao dịch kèm tên người thực hiện
-- ---------------------------------------------------------------------
drop view if exists public.transactions_feed cascade;
create view public.transactions_feed
with (security_invoker = true) as
select
  t.id,
  t.created_at,
  t.type,
  t.quantity,
  t.delta,
  t.note,
  t.component_id,
  c.part_number,
  c.name as component_name,
  t.location_id,
  l.path as location_path,
  t.project_id,
  p.name as project_name,
  t.created_by,
  u.display_name as actor_name
from public.transactions t
join public.components c on c.id = t.component_id
left join public.locations_full l on l.id = t.location_id
left join public.projects p on p.id = t.project_id
left join public.profiles u on u.id = t.created_by;

revoke all on public.transactions_feed from anon;
grant select on public.transactions_feed to authenticated;

-- ---------------------------------------------------------------------
-- 6) Báo cho Supabase nạp lại cấu trúc mới
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';

commit;
