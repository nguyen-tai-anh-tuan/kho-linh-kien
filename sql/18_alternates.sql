-- =====================================================================
-- 18_alternates.sql  -  Linh kiện tương đương (thay thế được cho nhau)
-- Chạy MỘT LẦN trong Supabase: SQL Editor -> New query -> dán -> Run.
-- Cần chạy sau file 04_roles.sql. Chạy lại nhiều lần cũng an toàn.
-- Chỉ THÊM bảng và hàm mới, không đụng tới dữ liệu đang có.
--
-- Tương đương theo NHÓM: các linh kiện chung một group_id thay được cho nhau (hai chiều).
-- Ghép A với B: nếu A hoặc B đã có nhóm thì món kia vào nhóm đó; cả hai đều có nhóm thì gộp hai nhóm.
-- note: ghi chú riêng của từng món trong nhóm (vd "dòng chịu được thấp hơn, 800mA").
-- =====================================================================

begin;

create table if not exists public.component_alternates (
  component_id uuid primary key references public.components (id) on delete cascade,
  group_id     uuid not null,
  note         text,
  created_at   timestamptz not null default now()
);

create index if not exists component_alternates_group_idx on public.component_alternates (group_id);

alter table public.component_alternates enable row level security;

revoke all on public.component_alternates from anon, authenticated;
grant select, insert, update, delete on public.component_alternates to authenticated;

drop policy if exists "component_alternates view"   on public.component_alternates;
drop policy if exists "component_alternates add"    on public.component_alternates;
drop policy if exists "component_alternates edit"   on public.component_alternates;
drop policy if exists "component_alternates delete" on public.component_alternates;
create policy "component_alternates view"   on public.component_alternates for select to authenticated using ((select private.can_view()));
create policy "component_alternates add"    on public.component_alternates for insert to authenticated with check ((select private.can_edit()));
create policy "component_alternates edit"   on public.component_alternates for update to authenticated using ((select private.can_edit())) with check ((select private.can_edit()));
create policy "component_alternates delete" on public.component_alternates for delete to authenticated using ((select private.can_edit()));

-- Ghép hai linh kiện vào chung một nhóm tương đương
create or replace function public.link_alternate(p_a uuid, p_b uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ga uuid;
  gb uuid;
begin
  if not private.can_edit() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_a is null or p_b is null or p_a = p_b then
    raise exception 'ALT_SAME';
  end if;

  select group_id into ga from public.component_alternates where component_id = p_a;
  select group_id into gb from public.component_alternates where component_id = p_b;

  if ga is null and gb is null then
    ga := gen_random_uuid();
    insert into public.component_alternates (component_id, group_id) values (p_a, ga), (p_b, ga);
  elsif ga is null then
    insert into public.component_alternates (component_id, group_id) values (p_a, gb);
    ga := gb;
  elsif gb is null then
    insert into public.component_alternates (component_id, group_id) values (p_b, ga);
  elsif ga <> gb then
    update public.component_alternates set group_id = ga where group_id = gb;
  end if;

  return ga;
end;
$$;

-- Gỡ một linh kiện khỏi nhóm. Nhóm chỉ còn một món thì bỏ luôn nhóm đó.
create or replace function public.unlink_alternate(p_component uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  g uuid;
begin
  if not private.can_edit() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  delete from public.component_alternates where component_id = p_component returning group_id into g;
  if g is null then
    raise exception 'NO_ROWS_CHANGED';
  end if;

  if (select count(*) from public.component_alternates where group_id = g) < 2 then
    delete from public.component_alternates where group_id = g;
  end if;
end;
$$;

revoke execute on function public.link_alternate(uuid, uuid) from public, anon;
revoke execute on function public.unlink_alternate(uuid) from public, anon;
grant execute on function public.link_alternate(uuid, uuid) to authenticated;
grant execute on function public.unlink_alternate(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
