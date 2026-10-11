-- =====================================================================
-- 08_warning_levels.sql  -  Mức cảnh báo sắp hết: chung -> danh mục -> riêng
-- Chạy MỘT LẦN trong Supabase: SQL Editor -> New query -> dán -> Run.
-- Cần chạy sau các file 04, 05 và 06. Chạy lại nhiều lần cũng an toàn.
-- Nếu có lỗi ở bất kỳ bước nào thì không có gì bị thay đổi.
--
-- Mức cảnh báo của một linh kiện được lấy theo thứ tự:
--   1. mức riêng của linh kiện (nếu có đặt)
--   2. mức của danh mục gần nhất có đặt mức (chi tiết -> con -> lớn)
--   3. mức chung của cả kho
--
-- LẦN CHẠY ĐẦU TIÊN: mọi linh kiện được đưa về "theo mặc định", tức là
-- các mức đang đặt riêng cho từng món (hiện đều là 1) sẽ bị bỏ.
-- Những lần chạy lại sau đó không đụng tới mức riêng nữa.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Linh kiện: mức riêng được phép để trống (= theo danh mục / mức chung)
-- ---------------------------------------------------------------------
alter table public.components
  add column if not exists archived_at timestamptz;

alter table public.components
  alter column min_stock drop not null,
  alter column min_stock drop default;

do $$
begin
  -- Chỉ làm ở lần chạy đầu tiên (khi bảng settings chưa có)
  if to_regclass('public.settings') is null then
    update public.components set min_stock = null;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2) Danh mục: mức cảnh báo cho mọi linh kiện bên trong (để trống = không đặt)
-- ---------------------------------------------------------------------
alter table public.categories
  add column if not exists min_stock int check (min_stock >= 0);

-- ---------------------------------------------------------------------
-- 3) Cài đặt chung của kho: đúng một dòng
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  id                boolean primary key default true check (id),
  default_min_stock int not null default 1 check (default_min_stock >= 0)
);

insert into public.settings (id) values (true) on conflict (id) do nothing;

alter table public.settings enable row level security;

revoke all on public.settings from anon, authenticated;
grant select, update on public.settings to authenticated;

drop policy if exists "settings view" on public.settings;
drop policy if exists "settings edit" on public.settings;
create policy "settings view" on public.settings
  for select to authenticated
  using ((select private.can_view()));
create policy "settings edit" on public.settings
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- ---------------------------------------------------------------------
-- 4) Danh sách linh kiện: cột min_stock giờ là mức ĐANG ÁP DỤNG.
--    Thêm ở cuối: mức riêng, nguồn của mức, và danh mục cho mức đó.
-- ---------------------------------------------------------------------
create or replace view public.component_totals
with (security_invoker = true) as
select
  e.id,
  e.part_number,
  e.name,
  e.category_id,
  e.category_name,
  e.value,
  e.package,
  e.manufacturer,
  e.datasheet_url,
  e.image_url,
  e.min_effective as min_stock,
  e.unit_price,
  e.notes,
  e.created_at,
  e.total::int as total_quantity,
  (e.total * coalesce(e.unit_price, 0))::numeric as stock_value,
  case
    when e.total = 0 then 'out'
    when e.total < e.min_effective then 'low'
    else 'ok'
  end as status,
  (e.min_effective > 0 and e.total < e.min_effective) as is_low,
  greatest(e.min_effective - e.total, 0)::int as shortage,
  e.archived_at,
  e.min_stock_own,
  e.min_source,
  e.min_category_id
from (
  select
    c.id,
    c.part_number,
    c.name,
    c.category_id,
    cat.name as category_name,
    c.value,
    c.package,
    c.manufacturer,
    c.datasheet_url,
    c.image_url,
    c.unit_price,
    c.notes,
    c.created_at,
    c.archived_at,
    coalesce(s.total, 0) as total,
    c.min_stock as min_stock_own,
    coalesce(c.min_stock, cat.min_stock, p1.min_stock, p2.min_stock, st.default_min_stock, 1)::int as min_effective,
    case
      when c.min_stock is not null then 'own'
      when coalesce(cat.min_stock, p1.min_stock, p2.min_stock) is not null then 'category'
      else 'default'
    end as min_source,
    case
      when c.min_stock is not null then null
      when cat.min_stock is not null then cat.id
      when p1.min_stock is not null then p1.id
      when p2.min_stock is not null then p2.id
    end as min_category_id
  from public.components c
  left join public.categories cat on cat.id = c.category_id
  left join public.categories p1 on p1.id = cat.parent_id
  left join public.categories p2 on p2.id = p1.parent_id
  left join public.settings st on st.id
  left join (
    select component_id, sum(quantity) as total
    from public.stock
    group by component_id
  ) s on s.component_id = c.id
) e;

-- ---------------------------------------------------------------------
-- 5) Báo cho Supabase nạp lại cấu trúc mới
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';

commit;
