-- =====================================================================
-- 14_price_unit.sql  -  Đơn giá theo hộp / bộ / combo
-- Chạy MỘT LẦN trong Supabase: SQL Editor -> New query -> dán -> Run.
-- Cần chạy sau file 08_warning_levels.sql. Chạy lại nhiều lần cũng an toàn.
-- Không đụng tới dữ liệu đang có. Nếu có lỗi thì không có gì bị thay đổi.
--
-- Có món không bán lẻ từng cái mà bán theo hộp, bộ, combo...
-- (vd bộ dây cắm 840 sợi giá 108.300 đ / hộp).
--   price_unit : đơn vị tính giá ('hộp', 'bộ', 'combo'...); để trống = tính theo cái
--   price_qty  : số cái trong một đơn vị đó (vd 840)
-- Cột unit_price vẫn là giá MỘT CÁI (web tự chia: 108.300 / 840), nên giá trị kho,
-- danh sách cần mua và BOM vẫn tính đúng như cũ.
-- =====================================================================

begin;

alter table public.components add column if not exists price_qty int;
alter table public.components add column if not exists price_unit text;

alter table public.components drop constraint if exists components_price_qty_check;
alter table public.components add constraint components_price_qty_check check (price_qty is null or price_qty >= 1);

-- Danh sách linh kiện: thêm hai cột mới ở cuối (giữ nguyên mọi cột cũ)
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
  e.min_category_id,
  e.price_qty,
  e.price_unit
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
    c.price_qty,
    c.price_unit,
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

notify pgrst, 'reload schema';

commit;
