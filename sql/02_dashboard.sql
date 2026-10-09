-- =====================================================================
-- 02_dashboard.sql  -  Nâng cấp database cho Dashboard v0.2
-- Chạy MỘT LẦN trong Supabase: SQL Editor -> New query -> dán -> Run.
-- Chạy lại nhiều lần cũng an toàn (các lệnh đều có drop/if not exists).
-- Không xóa dữ liệu hiện có của bạn.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Bảng transactions: hỗ trợ "Điều chỉnh" (kiểm kê) và ghi lại chênh lệch
-- ---------------------------------------------------------------------

-- Bỏ ràng buộc cũ "quantity > 0" (vì khi kiểm kê có thể đếm được 0 cái)
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.transactions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%quantity%'
  loop
    execute format('alter table public.transactions drop constraint %I', c.conname);
  end loop;
end $$;

-- Nhập/Xuất: số lượng > 0.  Điều chỉnh: số lượng thực đếm được (>= 0).
alter table public.transactions
  add constraint transactions_quantity_check
  check (
    (type = 'adjust' and quantity >= 0)
    or (type in ('in', 'out') and quantity > 0)
  );

-- Cột delta: lượng thay đổi thực tế (+ hoặc -) của mỗi giao dịch
alter table public.transactions add column if not exists delta int;

-- Tự gán người thực hiện
alter table public.transactions alter column created_by set default auth.uid();

create index if not exists transactions_created_idx
  on public.transactions (created_at desc);
create index if not exists transactions_component_idx
  on public.transactions (component_id, created_at desc);

-- ---------------------------------------------------------------------
-- 2) Trigger cập nhật tồn kho (thay bản cũ)
--    in     : cộng thêm
--    out    : trừ đi, báo lỗi nếu không đủ hàng
--    adjust : đặt tồn tại vị trí đó đúng bằng số đếm được
-- ---------------------------------------------------------------------
drop trigger if exists trg_apply_transaction on public.transactions;

create or replace function public.apply_transaction()
returns trigger
language plpgsql
as $$
declare
  cur int;
  d   int;
begin
  select quantity into cur
  from public.stock
  where component_id = new.component_id
    and location_id  = new.location_id
  for update;

  cur := coalesce(cur, 0);

  if new.type = 'in' then
    d := new.quantity;
  elsif new.type = 'out' then
    d := -new.quantity;
  else
    d := new.quantity - cur;
  end if;

  if cur + d < 0 then
    raise exception 'INSUFFICIENT_STOCK'
      using errcode = 'P0001',
            detail = format('có %s, cần xuất %s', cur, -d);
  end if;

  insert into public.stock (component_id, location_id, quantity)
  values (new.component_id, new.location_id, d)
  on conflict (component_id, location_id)
  do update set quantity = public.stock.quantity + d;

  new.delta := d;
  return new;
end;
$$;

create trigger trg_apply_transaction
before insert on public.transactions
for each row execute function public.apply_transaction();

-- ---------------------------------------------------------------------
-- 3) Views
-- ---------------------------------------------------------------------

-- Cây vị trí kèm đường dẫn đầy đủ: "Tủ A › Ngăn 1"
drop view if exists public.locations_full cascade;
create view public.locations_full
with (security_invoker = true) as
with recursive tree as (
  select id, name, parent_id, qr_code, name::text as path, 0 as depth
  from public.locations
  where parent_id is null
  union all
  select l.id, l.name, l.parent_id, l.qr_code, t.path || ' › ' || l.name, t.depth + 1
  from public.locations l
  join tree t on l.parent_id = t.id
)
select id, name, parent_id, qr_code, path, depth from tree;

-- Linh kiện kèm tổng tồn, giá trị, trạng thái
drop view if exists public.component_totals cascade;
create view public.component_totals
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
  greatest(c.min_stock - coalesce(s.total, 0), 0)::int as shortage
from public.components c
left join public.categories cat on cat.id = c.category_id
left join (
  select component_id, sum(quantity) as total
  from public.stock
  group by component_id
) s on s.component_id = c.id;

-- Lịch sử giao dịch đã ghép tên linh kiện, vị trí, dự án
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
  p.name as project_name
from public.transactions t
join public.components c on c.id = t.component_id
left join public.locations_full l on l.id = t.location_id
left join public.projects p on p.id = t.project_id;

-- ---------------------------------------------------------------------
-- 4) Hàm thống kê nhập/xuất theo ngày (giờ Việt Nam) cho biểu đồ
-- ---------------------------------------------------------------------
create or replace function public.daily_flow(days int default 30)
returns table (day date, qty_in bigint, qty_out bigint)
language sql
stable
security invoker
as $$
  with d as (
    select generate_series(
      (now() at time zone 'Asia/Ho_Chi_Minh')::date - (days - 1),
      (now() at time zone 'Asia/Ho_Chi_Minh')::date,
      interval '1 day'
    )::date as day
  )
  select
    d.day,
    coalesce(sum(t.quantity) filter (where t.type = 'in'), 0)::bigint,
    coalesce(sum(t.quantity) filter (where t.type = 'out'), 0)::bigint
  from d
  left join public.transactions t
    on (t.created_at at time zone 'Asia/Ho_Chi_Minh')::date = d.day
  group by d.day
  order by d.day;
$$;

-- ---------------------------------------------------------------------
-- 5) Báo cho Supabase nạp lại cấu trúc mới
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';
