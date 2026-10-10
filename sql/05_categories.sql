-- =====================================================================
-- 05_categories.sql  -  Danh mục ba tầng: lớn -> con -> chi tiết
-- Chạy MỘT LẦN trong Supabase: SQL Editor -> New query -> dán -> Run.
-- Cần chạy sau file 04_roles.sql. Chạy lại nhiều lần cũng an toàn.
-- Không xóa linh kiện hay danh mục đang có của bạn.
-- Nếu có lỗi ở bất kỳ bước nào thì không có gì bị thay đổi.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Bảng categories: thêm danh mục cha và thứ tự hiển thị
-- ---------------------------------------------------------------------
alter table public.categories
  add column if not exists parent_id uuid references public.categories (id) on delete restrict,
  add column if not exists sort_order int not null default 0;

create index if not exists categories_parent_idx on public.categories (parent_id);

-- Trước đây tên phải khác nhau trên toàn bảng. Giờ chỉ cần khác nhau trong cùng một danh mục cha.
alter table public.categories drop constraint if exists categories_name_key;
create unique index if not exists categories_parent_name_key
  on public.categories (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

-- ---------------------------------------------------------------------
-- 2) Chặn cây sâu quá ba tầng và chặn vòng lặp (A nằm trong B, B lại nằm trong A)
-- ---------------------------------------------------------------------
create or replace function public.check_category_tree()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  cur    uuid := new.parent_id;
  depth  int  := 0;  -- số tầng phía trên danh mục này
  height int  := 0;  -- số tầng phía dưới danh mục này
begin
  while cur is not null loop
    if cur = new.id then
      raise exception 'CATEGORY_CYCLE';
    end if;
    depth := depth + 1;
    if depth > 2 then
      raise exception 'CATEGORY_TOO_DEEP';
    end if;
    select c.parent_id into cur from public.categories c where c.id = cur;
  end loop;

  if exists (select 1 from public.categories c where c.parent_id = new.id) then
    height := 1;
    if exists (
      select 1
      from public.categories c
      join public.categories g on g.parent_id = c.id
      where c.parent_id = new.id
    ) then
      height := 2;
    end if;
  end if;

  if depth + height > 2 then
    raise exception 'CATEGORY_TOO_DEEP';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_check_category_tree on public.categories;
create trigger trg_check_category_tree
before insert or update of parent_id on public.categories
for each row execute function public.check_category_tree();

-- ---------------------------------------------------------------------
-- 3) Cây danh mục kèm đường dẫn đầy đủ: "IC - Mạch tích hợp › IC Nhớ › EEPROM"
-- ---------------------------------------------------------------------
drop view if exists public.categories_full;
create view public.categories_full
with (security_invoker = true) as
with recursive tree as (
  select id, name, parent_id, sort_order, name::text as path, 0 as depth, id as root_id
  from public.categories
  where parent_id is null
  union all
  select c.id, c.name, c.parent_id, c.sort_order, t.path || ' › ' || c.name, t.depth + 1, t.root_id
  from public.categories c
  join tree t on c.parent_id = t.id
)
select id, name, parent_id, sort_order, path, depth, root_id from tree;

revoke all on public.categories_full from anon;
grant select on public.categories_full to authenticated;

-- ---------------------------------------------------------------------
-- 4) Quyền: thành viên được THÊM danh mục; đổi tên, chuyển và xóa thì chỉ admin
--    (quy tắc sửa/xóa "chỉ admin" đã có từ file 04_roles.sql)
-- ---------------------------------------------------------------------
drop policy if exists "categories add" on public.categories;
create policy "categories add" on public.categories
  for insert to authenticated
  with check ((select private.can_edit()));

-- Xóa một danh mục: linh kiện bên trong chuyển lên danh mục cha
-- (hoặc về "Chưa phân loại" nếu đó là danh mục lớn). Không xóa được khi còn danh mục con.
create or replace function public.delete_category(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent uuid;
begin
  if not private.is_admin() then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
  if exists (select 1 from public.categories where parent_id = target) then
    raise exception 'CATEGORY_HAS_CHILDREN';
  end if;

  select parent_id into parent from public.categories where id = target;
  if not found then
    raise exception 'NO_ROWS_CHANGED';
  end if;

  update public.components set category_id = parent where category_id = target;
  delete from public.categories where id = target;
end;
$$;

revoke execute on function public.delete_category(uuid) from public, anon;
grant execute on function public.delete_category(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5) Nạp sẵn cây danh mục. Danh mục đã có (trùng tên, cùng cha) được dùng lại, không tạo trùng.
-- ---------------------------------------------------------------------
create or replace function pg_temp.cat(p_parent uuid, p_name text, p_position int)
returns uuid
language plpgsql
as $$
declare
  found_id uuid;
begin
  select id into found_id
  from public.categories
  where parent_id is not distinct from p_parent and lower(name) = lower(p_name);

  if found_id is null then
    insert into public.categories (name, parent_id, sort_order)
    values (p_name, p_parent, p_position)
    returning id into found_id;
  else
    update public.categories set sort_order = p_position where id = found_id;
  end if;
  return found_id;
end;
$$;

-- Danh mục lớn có từ trước mà không nằm trong danh sách dưới đây sẽ xếp sau cùng
update public.categories set sort_order = 100 where parent_id is null and sort_order = 0;

do $$
declare
  l1 uuid;  -- danh mục lớn
  l2 uuid;  -- danh mục con
begin
  l1 := pg_temp.cat(null, 'IC - Mạch tích hợp', 1);
    l2 := pg_temp.cat(l1, 'IC Vi Điều Khiển MCU, Vi Xử Lý MPU', 1);
      perform pg_temp.cat(l2, 'IC Vi Điều Khiển', 1);
    l2 := pg_temp.cat(l1, 'IC Nhớ', 2);
      perform pg_temp.cat(l2, 'Bộ Nhớ Flash', 1);
      perform pg_temp.cat(l2, 'EEPROM', 2);
      perform pg_temp.cat(l2, 'EPROMS', 3);
      perform pg_temp.cat(l2, 'RAM', 4);
    l2 := pg_temp.cat(l1, 'IC Nguồn', 3);
      perform pg_temp.cat(l2, 'IC Ổn Áp', 1);
      perform pg_temp.cat(l2, 'IC Chuyển Đổi Điện Áp DC-DC', 2);
      perform pg_temp.cat(l2, 'IC Chuyển Đổi Điện Áp AC-DC', 3);
      perform pg_temp.cat(l2, 'IC Điều Khiển Điện Áp', 4);
      perform pg_temp.cat(l2, 'IC Điều Khiển Động Cơ', 5);

  l1 := pg_temp.cat(null, 'Mạch Điện, Module, Thiết Bị Nạp', 2);
    l2 := pg_temp.cat(l1, 'Mạch Chức Năng, Mạch Phát Triển, Module Shield', 1);
      perform pg_temp.cat(l2, 'Mạch Cảm Biến', 1);
      perform pg_temp.cat(l2, 'Mạch LCD', 2);
    l2 := pg_temp.cat(l1, 'Mạch RF, WiFi, Bluetooth, RFID', 2);
      perform pg_temp.cat(l2, 'Mạch WiFi', 1);
      perform pg_temp.cat(l2, 'Mạch Zigbee', 2);

  l1 := pg_temp.cat(null, 'Linh Kiện Điện Tử Thụ Động', 3);
    l2 := pg_temp.cat(l1, 'Điện Trở', 1);
      perform pg_temp.cat(l2, 'Điện Trở Xuyên Lỗ', 1);
      perform pg_temp.cat(l2, 'Điện Trở Dán SMD', 2);
    l2 := pg_temp.cat(l1, 'Tụ Điện', 2);
      perform pg_temp.cat(l2, 'Tụ Hóa Nhôm', 1);
      perform pg_temp.cat(l2, 'Tụ Gốm Dán SMD', 2);

  perform pg_temp.cat(null, 'Diode, Transistor, IGBT, FET, XTAL', 4);
  perform pg_temp.cat(null, 'LCD, LED, Tấm Cảm Ứng', 5);
  perform pg_temp.cat(null, 'Cổng Kết Nối, Đầu Nối, Jack Nối', 6);
  perform pg_temp.cat(null, 'Dây Điện, Cáp Điện, Dây Tín Hiệu', 7);
  perform pg_temp.cat(null, 'Cảm Biến', 8);
  perform pg_temp.cat(null, 'Bộ Nguồn Điện, Pin, Biến Áp', 9);
  perform pg_temp.cat(null, 'Cơ Điện Tử, Công Tắc, Nút Nhấn', 10);
  perform pg_temp.cat(null, 'Điện Công Nghiệp, Tự Động Hóa', 11);
  perform pg_temp.cat(null, 'Thiết Bị Đo Kiểm, Đầu Dò', 12);
  perform pg_temp.cat(null, 'Khí Nén, Thủy Lực, Truyền Động', 13);
  perform pg_temp.cat(null, 'Dụng Cụ, Kim Khí, Tools', 14);
  perform pg_temp.cat(null, 'Phụ Kiện Máy Tính, Điện Dân Dụng', 15);
  perform pg_temp.cat(null, 'An Toàn, An Ninh, Phòng Sạch', 16);
end $$;

-- ---------------------------------------------------------------------
-- 6) Báo cho Supabase nạp lại cấu trúc mới
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';

commit;
