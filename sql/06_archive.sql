-- =====================================================================
-- 06_archive.sql  -  Ngừng dùng linh kiện, và admin xóa hẳn kèm lịch sử
-- Chạy MỘT LẦN trong Supabase: SQL Editor -> New query -> dán -> Run.
-- Cần chạy sau file 04_roles.sql. Chạy lại nhiều lần cũng an toàn.
-- Không xóa linh kiện, tồn kho hay lịch sử nào của bạn.
-- Nếu có lỗi ở bất kỳ bước nào thì không có gì bị thay đổi.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Linh kiện ngừng dùng: ghi lại thời điểm ngừng. Để trống = đang dùng.
-- ---------------------------------------------------------------------
alter table public.components
  add column if not exists archived_at timestamptz;

-- ---------------------------------------------------------------------
-- 2) Danh sách linh kiện kèm tổng tồn: thêm cột archived_at ở cuối
-- ---------------------------------------------------------------------
create or replace view public.component_totals
with (security_invoker = true) as
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
  c.min_stock,
  c.unit_price,
  c.notes,
  c.created_at,
  coalesce(s.total, 0)::int as total_quantity,
  (coalesce(s.total, 0) * coalesce(c.unit_price, 0))::numeric as stock_value,
  case
    when coalesce(s.total, 0) = 0 then 'out'
    when coalesce(s.total, 0) < c.min_stock then 'low'
    else 'ok'
  end as status,
  (c.min_stock > 0 and coalesce(s.total, 0) < c.min_stock) as is_low,
  greatest(c.min_stock - coalesce(s.total, 0), 0)::int as shortage,
  c.archived_at
from public.components c
left join public.categories cat on cat.id = c.category_id
left join (
  select component_id, sum(quantity) as total
  from public.stock
  group by component_id
) s on s.component_id = c.id;

-- ---------------------------------------------------------------------
-- 3) Admin xóa hẳn một linh kiện: xóa luôn lịch sử nhập/xuất, tồn kho
--    và các dòng BOM của nó. KHÔNG hoàn tác được.
-- ---------------------------------------------------------------------
create or replace function public.delete_component(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
  if not exists (select 1 from public.components where id = target) then
    raise exception 'NO_ROWS_CHANGED';
  end if;

  delete from public.transactions where component_id = target;
  delete from public.project_bom  where component_id = target;
  delete from public.stock        where component_id = target;
  delete from public.components   where id = target;
end;
$$;

revoke execute on function public.delete_component(uuid) from public, anon;
grant execute on function public.delete_component(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4) Báo cho Supabase nạp lại cấu trúc mới
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';

commit;
