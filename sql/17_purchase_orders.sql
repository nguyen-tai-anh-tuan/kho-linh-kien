-- =====================================================================
-- 17_purchase_orders.sql  -  Đơn hàng, ghi chi tiêu mua hàng, khoản chi khác
-- Chạy MỘT LẦN trong Supabase: SQL Editor -> New query -> dán -> Run.
-- Cần chạy sau file 13, 14, 15. Chạy lại nhiều lần cũng an toàn.
-- Chỉ THÊM bảng / cột / hàm mới. Không sửa, không xóa dữ liệu đang có
-- (riêng bước 6 điền giá mua cho mấy lần nhập kho "Mua về..." cũ để báo cáo chi tiêu có số liệu,
--  bước 7 chuyển món "Đã đặt hàng" kiểu cũ sang thẻ Đơn hàng).
-- Nếu có lỗi ở bất kỳ bước nào thì không có gì bị thay đổi.
--
--   purchase_orders       : mỗi dòng là một đơn hàng (DH-01, DH-02...): nơi mua, mã đơn, ngày đặt, phí ship
--   purchase_order_lines  : các món trong đơn: số đặt, số đã nhận, đơn giá
--   other_expenses        : khoản chi khác (đặt mạch in, dụng cụ, thiếc hàn...)
--   Món "Đã đặt hàng" kiểu cũ trong danh sách mua trước được gom thành một đơn (bước 7).
--   transactions          : thêm 3 cột để biết lần nhập kho nào là MUA HÀNG và giá mua bao nhiêu
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Đơn hàng
-- ---------------------------------------------------------------------
create sequence if not exists public.purchase_order_code_seq;

create table if not exists public.purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  code_no       int  not null default nextval('public.purchase_order_code_seq'),
  shop          text,
  order_ref     text,
  ordered_on    date not null default ((now() at time zone 'Asia/Ho_Chi_Minh')::date),
  shipping_fee  numeric not null default 0 check (shipping_fee >= 0),
  status        text not null default 'ordered'
                check (status in ('ordered', 'shipping', 'partial', 'received', 'cancelled')),
  received_at   timestamptz,
  note          text,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);

alter sequence public.purchase_order_code_seq owned by public.purchase_orders.code_no;
create unique index if not exists purchase_orders_code_no_key on public.purchase_orders (code_no);
grant usage on sequence public.purchase_order_code_seq to authenticated;

create table if not exists public.purchase_order_lines (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.purchase_orders (id) on delete cascade,
  -- Linh kiện trong kho; món mới thì để trống tới lúc nhận hàng (web tạo linh kiện khi nhận)
  component_id  uuid references public.components (id) on delete set null,
  part_number   text,
  name          text,
  category_id   uuid references public.categories (id) on delete set null,
  value         text,
  package       text,
  manufacturer  text,
  price_qty     int check (price_qty is null or price_qty >= 1),
  price_unit    text,
  quantity      int not null check (quantity > 0),
  received      int not null default 0 check (received >= 0),
  unit_price    numeric check (unit_price >= 0),   -- giá MỘT CÁI
  shop_url      text,
  note          text,
  project_id    uuid references public.projects (id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint purchase_order_lines_what check (
    component_id is not null
    or (coalesce(btrim(part_number), '') <> '' and coalesce(btrim(name), '') <> '')
  )
);

create index if not exists purchase_order_lines_order_idx on public.purchase_order_lines (order_id);
create index if not exists purchase_order_lines_component_idx on public.purchase_order_lines (component_id);

-- ---------------------------------------------------------------------
-- 2) Khoản chi khác (không phải linh kiện trong kho)
-- ---------------------------------------------------------------------
create table if not exists public.other_expenses (
  id          uuid primary key default gen_random_uuid(),
  spent_on    date not null default ((now() at time zone 'Asia/Ho_Chi_Minh')::date),
  title       text not null check (btrim(title) <> ''),
  kind        text,
  amount      numeric not null check (amount >= 0),
  project_id  uuid references public.projects (id) on delete set null,
  note        text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

create index if not exists other_expenses_spent_idx on public.other_expenses (spent_on);

-- ---------------------------------------------------------------------
-- 3) Giao dịch nhập kho: đánh dấu lần nào là mua hàng, giá mua, thuộc đơn nào
--    is_purchase = true  : lần nhập này là mua hàng (tính vào chi tiêu)
--    unit_cost           : giá mua MỘT CÁI (để trống = chưa biết giá)
--    order_id            : thuộc đơn hàng nào (nếu nhận theo đơn)
--    Hoàn tác một lần mua: giao dịch xuất ngược lại cũng mang is_purchase = true để trừ chi tiêu.
-- ---------------------------------------------------------------------
alter table public.transactions add column if not exists is_purchase boolean not null default false;
alter table public.transactions add column if not exists unit_cost numeric;
alter table public.transactions add column if not exists order_id uuid;

alter table public.transactions drop constraint if exists transactions_unit_cost_check;
alter table public.transactions add constraint transactions_unit_cost_check check (unit_cost is null or unit_cost >= 0);

alter table public.transactions drop constraint if exists transactions_order_id_fkey;
alter table public.transactions
  add constraint transactions_order_id_fkey foreign key (order_id) references public.purchase_orders (id) on delete set null;

create index if not exists transactions_order_idx on public.transactions (order_id) where order_id is not null;

-- ---------------------------------------------------------------------
-- 4) Quyền: giống danh sách mua trước (admin + thành viên được sửa, người xem chỉ xem)
-- ---------------------------------------------------------------------
alter table public.purchase_orders      enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.other_expenses       enable row level security;

revoke all on public.purchase_orders, public.purchase_order_lines, public.other_expenses from anon, authenticated;
grant select, insert, update, delete on public.purchase_orders, public.purchase_order_lines, public.other_expenses to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['purchase_orders', 'purchase_order_lines', 'other_expenses'] loop
    execute format('drop policy if exists "%s view"   on public.%I', t, t);
    execute format('drop policy if exists "%s add"    on public.%I', t, t);
    execute format('drop policy if exists "%s edit"   on public.%I', t, t);
    execute format('drop policy if exists "%s delete" on public.%I', t, t);
    execute format('create policy "%s view"   on public.%I for select to authenticated using ((select private.can_view()))', t, t);
    execute format('create policy "%s add"    on public.%I for insert to authenticated with check ((select private.can_edit()))', t, t);
    execute format('create policy "%s edit"   on public.%I for update to authenticated using ((select private.can_edit())) with check ((select private.can_edit()))', t, t);
    execute format('create policy "%s delete" on public.%I for delete to authenticated using ((select private.can_edit()))', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5) Các hàm (chạy với quyền của người bấm, nên vẫn theo đúng quyền ở trên)
-- ---------------------------------------------------------------------

-- Dùng chung (schema private, web không gọi thẳng được):
-- chuyển các món trong danh sách mua trước vào một đơn (món rời khỏi danh sách)
create or replace function private.move_items_to_order(p_order uuid, p_items uuid[])
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n int;
begin
  insert into public.purchase_order_lines (
    order_id, component_id, part_number, name, category_id, value, package, manufacturer,
    price_qty, price_unit, quantity, unit_price, shop_url, note, project_id
  )
  select
    p_order, i.component_id, i.part_number, i.name, i.category_id, i.value, i.package, i.manufacturer,
    i.price_qty, i.price_unit, i.quantity,
    -- Món trong kho chưa ghi giá riêng thì lấy đơn giá kho lúc đặt
    coalesce(i.unit_price, nullif(c.unit_price, 0)),
    i.shop_url, i.note, i.project_id
  from public.purchase_items i
  left join public.components c on c.id = i.component_id
  where i.id = any (p_items)
  order by i.created_at;

  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'NO_ROWS_CHANGED';
  end if;

  delete from public.purchase_items where id = any (p_items);
  return n;
end;
$$;

-- Dùng chung: đưa phần CHƯA NHẬN của các món trong đơn về lại danh sách mua trước ("Cần mua").
-- p_line = null: mọi món của đơn; có p_line: chỉ món đó.
create or replace function private.return_lines_to_list(p_order uuid, p_line uuid default null)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n int;
begin
  insert into public.purchase_items (
    component_id, part_number, name, category_id, value, package, manufacturer,
    quantity, unit_price, shop_url, note, project_id, price_qty, price_unit, status
  )
  select
    l.component_id,
    case when l.component_id is null then l.part_number end,
    case when l.component_id is null then l.name end,
    case when l.component_id is null then l.category_id end,
    case when l.component_id is null then l.value end,
    case when l.component_id is null then l.package end,
    case when l.component_id is null then l.manufacturer end,
    l.quantity - l.received,
    -- Món trong kho đi theo đơn giá kho, món mới giữ giá đã ghi
    case when l.component_id is null then l.unit_price end,
    l.shop_url, l.note, l.project_id,
    case when l.component_id is null then l.price_qty end,
    case when l.component_id is null then l.price_unit end,
    'todo'
  from public.purchase_order_lines l
  where l.order_id = p_order
    and (p_line is null or l.id = p_line)
    and l.received < l.quantity
  order by l.created_at;

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function private.move_items_to_order(uuid, uuid[]) from public, anon;
revoke execute on function private.return_lines_to_list(uuid, uuid) from public, anon;
grant execute on function private.move_items_to_order(uuid, uuid[]) to authenticated;
grant execute on function private.return_lines_to_list(uuid, uuid) to authenticated;

-- Tạo đơn từ các món trong danh sách mua trước. Các món được chuyển vào đơn (rời khỏi danh sách).
create or replace function public.create_purchase_order(
  p_items      uuid[],
  p_shop       text    default null,
  p_ref        text    default null,
  p_ordered_on date    default null,
  p_shipping   numeric default 0,
  p_note       text    default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.can_edit() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if coalesce(array_length(p_items, 1), 0) = 0 then
    raise exception 'NOTHING_SELECTED';
  end if;

  insert into public.purchase_orders (shop, order_ref, ordered_on, shipping_fee, note)
  values (
    nullif(btrim(p_shop), ''),
    nullif(btrim(p_ref), ''),
    coalesce(p_ordered_on, (now() at time zone 'Asia/Ho_Chi_Minh')::date),
    coalesce(p_shipping, 0),
    nullif(btrim(p_note), '')
  )
  returning id into v_id;

  perform private.move_items_to_order(v_id, p_items);
  return v_id;
end;
$$;

-- Thêm món từ danh sách mua trước vào một đơn đang chờ về
create or replace function public.add_to_purchase_order(p_order uuid, p_items uuid[])
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  o public.purchase_orders%rowtype;
begin
  if not private.can_edit() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if coalesce(array_length(p_items, 1), 0) = 0 then
    raise exception 'NOTHING_SELECTED';
  end if;

  select * into o from public.purchase_orders where id = p_order for update;
  if not found then
    raise exception 'NO_ROWS_CHANGED';
  end if;
  if o.status not in ('ordered', 'shipping', 'partial') then
    raise exception 'ORDER_CLOSED';
  end if;

  return private.move_items_to_order(p_order, p_items);
end;
$$;

-- Bỏ một món (chưa nhận cái nào) khỏi đơn: món về lại danh sách mua trước ("Cần mua").
-- Đơn không còn món nào thì xóa luôn đơn. Trả về true nếu đơn bị xóa.
create or replace function public.remove_order_line(p_line uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  l public.purchase_order_lines%rowtype;
  o public.purchase_orders%rowtype;
begin
  if not private.can_edit() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select * into l from public.purchase_order_lines where id = p_line for update;
  if not found then
    raise exception 'NO_ROWS_CHANGED';
  end if;
  select * into o from public.purchase_orders where id = l.order_id for update;
  if o.status not in ('ordered', 'shipping', 'partial') then
    raise exception 'ORDER_CLOSED';
  end if;
  if l.received > 0 then
    raise exception 'LINE_RECEIVED';
  end if;

  perform private.return_lines_to_list(l.order_id, l.id);
  delete from public.purchase_order_lines where id = l.id;

  if not exists (select 1 from public.purchase_order_lines x where x.order_id = l.order_id) then
    delete from public.purchase_orders where id = l.order_id;
    return true;
  end if;

  -- Bỏ món còn thiếu cuối cùng của đơn đã nhận một phần: đơn coi như đã nhận xong
  update public.purchase_orders
  set status = 'received'
  where id = l.order_id
    and status = 'partial'
    and not exists (select 1 from public.purchase_order_lines x where x.order_id = l.order_id and x.received < x.quantity);
  return false;
end;
$$;

-- Nhận hàng (một phần hoặc cả đơn).
-- p_lines: [{ "line_id": ..., "qty": 10, "location_id": ..., "unit_price": 1200 }]
-- Món mới thì tạo linh kiện; ghi nhập kho (có giá mua); mua cho dự án thì thêm vào BOM nếu BOM chưa có.
-- p_update_price = true: ghi đơn giá thực tế vào linh kiện trong kho.
create or replace function public.receive_purchase_order(
  p_order        uuid,
  p_lines        jsonb,
  p_update_price boolean default true
)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  o       public.purchase_orders%rowtype;
  l       public.purchase_order_lines%rowtype;
  item    jsonb;
  v_qty   int;
  v_loc   uuid;
  v_price numeric;
  v_comp  uuid;
  v_label text;
  n       int := 0;
begin
  if not private.can_edit() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select * into o from public.purchase_orders where id = p_order for update;
  if not found then
    raise exception 'NO_ROWS_CHANGED';
  end if;
  if o.status = 'cancelled' then
    raise exception 'ORDER_CLOSED';
  end if;

  v_label := 'Nhận đơn DH-' || lpad(o.code_no::text, 2, '0')
             || coalesce(' (' || nullif(btrim(o.shop), '') || ')', '');

  for item in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_qty := nullif(item ->> 'qty', '')::int;
    if v_qty is null or v_qty <= 0 then
      continue;
    end if;
    v_loc := nullif(item ->> 'location_id', '')::uuid;
    if v_loc is null then
      raise exception 'NO_LOCATION';
    end if;
    v_price := nullif(item ->> 'unit_price', '')::numeric;
    if v_price is not null and v_price < 0 then
      raise exception 'Giá không hợp lệ' using errcode = '23514';
    end if;

    select * into l
    from public.purchase_order_lines
    where id = nullif(item ->> 'line_id', '')::uuid and order_id = p_order
    for update;
    if not found then
      raise exception 'NO_ROWS_CHANGED';
    end if;

    v_price := coalesce(v_price, l.unit_price);
    v_comp := l.component_id;

    -- Món mới: trùng mã với linh kiện đã có thì nhập vào linh kiện đó, không thì tạo mới
    if v_comp is null then
      select c.id into v_comp
      from public.components c
      where lower(btrim(c.part_number)) = lower(btrim(l.part_number))
      order by c.archived_at nulls first, c.created_at
      limit 1;
    end if;

    if v_comp is null then
      insert into public.components (
        part_number, name, category_id, value, package, manufacturer,
        unit_price, price_unit, price_qty, notes, min_stock
      )
      values (
        btrim(l.part_number), btrim(l.name), l.category_id, l.value, l.package, l.manufacturer,
        v_price, nullif(btrim(l.price_unit), ''),
        case when nullif(btrim(l.price_unit), '') is null then null else l.price_qty end,
        l.note, null
      )
      returning id into v_comp;
    elsif v_price is not null and v_price > 0 then
      if p_update_price then
        update public.components set unit_price = v_price where id = v_comp;
      else
        -- Không cập nhật giá, nhưng linh kiện chưa có giá thì vẫn lấy giá vừa mua
        update public.components set unit_price = v_price
        where id = v_comp and coalesce(unit_price, 0) = 0;
      end if;
    end if;

    insert into public.transactions (component_id, location_id, type, quantity, note, is_purchase, unit_cost, order_id)
    values (v_comp, v_loc, 'in', v_qty, v_label, true, v_price, p_order);

    update public.purchase_order_lines
    set received = received + v_qty,
        unit_price = v_price,
        component_id = v_comp
    where id = l.id;

    if l.project_id is not null
       and not exists (select 1 from public.project_bom b where b.project_id = l.project_id and b.component_id = v_comp) then
      insert into public.project_bom (project_id, component_id, quantity) values (l.project_id, v_comp, l.quantity);
    end if;

    n := n + 1;
  end loop;

  if n = 0 then
    raise exception 'NOTHING_TO_RECEIVE';
  end if;

  update public.purchase_orders
  set received_at = coalesce(received_at, now()),
      status = case
        when exists (select 1 from public.purchase_order_lines x where x.order_id = p_order and x.received < x.quantity)
          then 'partial'
        else 'received'
      end
  where id = p_order;

  return n;
end;
$$;

-- Hủy đơn hoặc đóng đơn (không chờ nữa).
-- Chưa nhận món nào -> các món về lại danh sách mua trước ("Cần mua") và đơn bị XÓA hẳn. Trả về 'deleted'.
-- Đã nhận một phần -> đơn chuyển sang "Đã nhận" với số đã nhận. Trả về 'received'.
--   p_back_to_list = true: phần chưa nhận về lại danh sách mua trước.
create or replace function public.close_purchase_order(p_order uuid, p_back_to_list boolean default true)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  o public.purchase_orders%rowtype;
begin
  if not private.can_edit() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select * into o from public.purchase_orders where id = p_order for update;
  if not found then
    raise exception 'NO_ROWS_CHANGED';
  end if;
  if o.status in ('received', 'cancelled') then
    raise exception 'ORDER_CLOSED';
  end if;

  if not exists (select 1 from public.purchase_order_lines x where x.order_id = p_order and x.received > 0) then
    perform private.return_lines_to_list(p_order);
    delete from public.purchase_orders where id = p_order;
    return 'deleted';
  end if;

  if p_back_to_list then
    perform private.return_lines_to_list(p_order);
  end if;
  update public.purchase_orders set status = 'received' where id = p_order;
  return 'received';
end;
$$;

revoke execute on function public.create_purchase_order(uuid[], text, text, date, numeric, text) from public, anon;
revoke execute on function public.add_to_purchase_order(uuid, uuid[]) from public, anon;
revoke execute on function public.remove_order_line(uuid) from public, anon;
revoke execute on function public.receive_purchase_order(uuid, jsonb, boolean) from public, anon;
revoke execute on function public.close_purchase_order(uuid, boolean) from public, anon;
grant execute on function public.create_purchase_order(uuid[], text, text, date, numeric, text) to authenticated;
grant execute on function public.add_to_purchase_order(uuid, uuid[]) to authenticated;
grant execute on function public.remove_order_line(uuid) to authenticated;
grant execute on function public.receive_purchase_order(uuid, jsonb, boolean) to authenticated;
grant execute on function public.close_purchase_order(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 6) Dữ liệu cũ: các lần nhập kho "Mua về..." (nút Đã mua trước đây) là mua hàng.
--    Giá mua lấy theo đơn giá đang lưu trong kho. "Tồn ban đầu", "Trả lại kho", nhập không ghi chú: không tính.
--    Chỉ đánh dấu những dòng chưa được đánh dấu, nên chạy lại cũng không sao.
-- ---------------------------------------------------------------------
update public.transactions t
set is_purchase = true,
    unit_cost = nullif(c.unit_price, 0)
from public.components c
where c.id = t.component_id
  and t.type = 'in'
  and t.is_purchase = false
  and t.note like 'Mua về%';

-- ---------------------------------------------------------------------
-- 7) Món đang ở trạng thái "Đã đặt hàng" kiểu cũ trong danh sách mua trước:
--    gom thành một đơn hàng (từ giờ "Đã đặt hàng" nghĩa là nằm trong thẻ Đơn hàng).
--    Chạy lại cũng không sao: lần sau không còn món nào ở trạng thái cũ.
-- ---------------------------------------------------------------------
do $$
declare
  v_id    uuid;
  v_items uuid[];
  v_day   date;
begin
  select array_agg(id order by created_at), min((created_at at time zone 'Asia/Ho_Chi_Minh')::date)
  into v_items, v_day
  from public.purchase_items
  where status = 'ordered';

  if coalesce(array_length(v_items, 1), 0) = 0 then
    return;
  end if;

  insert into public.purchase_orders (ordered_on, note)
  values (v_day, 'Chuyển từ trạng thái "Đã đặt hàng" của danh sách mua trước')
  returning id into v_id;

  perform private.move_items_to_order(v_id, v_items);
end $$;

notify pgrst, 'reload schema';

commit;
