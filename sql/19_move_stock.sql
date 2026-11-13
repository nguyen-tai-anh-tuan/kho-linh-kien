-- =====================================================================
-- 19_move_stock.sql  -  Chuyển vị trí linh kiện + chỗ cất mặc định
-- Chạy MỘT LẦN trong Supabase: SQL Editor -> New query -> dán -> Run.
-- Cần chạy sau file 04_roles.sql. Chạy lại nhiều lần cũng an toàn.
-- Chỉ THÊM bảng, cột, hàm và view mới. Không sửa, không xóa dữ liệu đang có.
-- Nếu có lỗi ở bất kỳ bước nào thì không có gì bị thay đổi.
--
-- 1) stock_moves     : sổ ghi mỗi lần chuyển hàng từ ngăn này sang ngăn khác.
--                      Tách riêng khỏi bảng transactions nên trang Báo cáo, biểu đồ
--                      nhập / xuất, chi tiêu... KHÔNG bị ảnh hưởng (chuyển chỗ không phải
--                      nhập hay xuất, tổng tồn kho giữ nguyên).
-- 2) move_stock(...) : chuyển một hoặc nhiều dòng trong MỘT bước: bớt ở ngăn cũ, cộng vào
--                      ngăn mới, ghi sổ. Lỗi ở dòng nào thì cả lần chuyển bị hủy.
-- 3) components.home_location_id : chỗ cất mặc định của linh kiện (kể cả khi chưa có hàng),
--                      để biết hàng về thì cất ở đâu. Xóa vị trí thì cột này tự để trống.
-- 4) history_feed    : lịch sử gộp (nhập / xuất / kiểm kê + chuyển vị trí) cho trang Lịch sử.
--
-- Lưu ý: nếu sau này chạy lại file 04_roles.sql (nó xóa view transactions_feed kèm "cascade")
-- thì hãy chạy lại file này để tạo lại history_feed.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Sổ chuyển vị trí
-- ---------------------------------------------------------------------
create table if not exists public.stock_moves (
  id               uuid primary key default gen_random_uuid(),
  component_id     uuid not null references public.components (id) on delete cascade,
  from_location_id uuid references public.locations (id) on delete set null,
  to_location_id   uuid references public.locations (id) on delete set null,
  quantity         int  not null check (quantity > 0),
  note             text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now()
);

create index if not exists stock_moves_created_idx   on public.stock_moves (created_at desc);
create index if not exists stock_moves_component_idx on public.stock_moves (component_id, created_at desc);

alter table public.stock_moves enable row level security;

revoke all on public.stock_moves from anon, authenticated;
grant select, insert on public.stock_moves to authenticated;

-- Ai xem được kho thì xem được sổ chuyển. Chỉ ghi thêm dưới tên chính mình, không sửa / xóa.
drop policy if exists "stock_moves view" on public.stock_moves;
drop policy if exists "stock_moves add"  on public.stock_moves;
create policy "stock_moves view" on public.stock_moves for select to authenticated using ((select private.can_view()));
create policy "stock_moves add"  on public.stock_moves for insert to authenticated
  with check ((select private.can_edit()) and created_by = (select auth.uid()));

-- ---------------------------------------------------------------------
-- 2) Hàm chuyển vị trí
-- p_moves: [{ "component_id": ..., "from_location_id": ..., "to_location_id": ..., "quantity": 5 }, ...]
-- Trả về số dòng đã chuyển.
-- ---------------------------------------------------------------------
create or replace function public.move_stock(p_moves jsonb, p_note text default null)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item   jsonb;
  v_comp uuid;
  v_from uuid;
  v_to   uuid;
  v_qty  int;
  cur    int;
  n      int := 0;
begin
  if not private.can_edit() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_moves is null or jsonb_typeof(p_moves) <> 'array' or jsonb_array_length(p_moves) = 0 then
    raise exception 'NOTHING_SELECTED';
  end if;

  for item in select value from jsonb_array_elements(p_moves) loop
    v_comp := nullif(item ->> 'component_id', '')::uuid;
    v_from := nullif(item ->> 'from_location_id', '')::uuid;
    v_to   := nullif(item ->> 'to_location_id', '')::uuid;
    v_qty  := nullif(item ->> 'quantity', '')::int;

    if v_comp is null or v_from is null or v_to is null or v_qty is null or v_qty <= 0 then
      raise exception 'MOVE_INVALID';
    end if;
    if v_from = v_to then
      raise exception 'MOVE_SAME';
    end if;

    -- Khóa dòng tồn ở ngăn cũ để hai người chuyển cùng lúc không làm sai số
    select s.quantity into cur
    from public.stock s
    where s.component_id = v_comp and s.location_id = v_from
    for update;
    cur := coalesce(cur, 0);

    if cur < v_qty then
      raise exception 'INSUFFICIENT_STOCK'
        using errcode = 'P0001',
              detail = format('có %s, cần chuyển %s', cur, v_qty);
    end if;

    update public.stock
    set quantity = cur - v_qty
    where component_id = v_comp and location_id = v_from;

    insert into public.stock (component_id, location_id, quantity)
    values (v_comp, v_to, v_qty)
    on conflict (component_id, location_id)
    do update set quantity = public.stock.quantity + excluded.quantity;

    insert into public.stock_moves (component_id, from_location_id, to_location_id, quantity, note)
    values (v_comp, v_from, v_to, v_qty, nullif(btrim(coalesce(p_note, '')), ''));

    n := n + 1;
  end loop;

  return n;
end;
$$;

revoke execute on function public.move_stock(jsonb, text) from public, anon;
grant execute on function public.move_stock(jsonb, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3) Chỗ cất mặc định của linh kiện
-- (quyền sửa đi theo bảng components như cũ: admin và thành viên)
-- ---------------------------------------------------------------------
alter table public.components
  add column if not exists home_location_id uuid references public.locations (id) on delete set null;

-- ---------------------------------------------------------------------
-- 4) Lịch sử gộp: nhập / xuất / kiểm kê (từ transactions_feed) + chuyển vị trí
-- id và type đổi sang chữ để hai phần ghép được với nhau.
-- Dòng chuyển: type = 'move', location = ngăn cũ, to_location = ngăn mới, delta = 0.
-- ---------------------------------------------------------------------
drop view if exists public.history_feed;
create view public.history_feed
with (security_invoker = true) as
select
  f.id::text        as id,
  f.created_at,
  f.type::text      as type,
  f.quantity,
  f.delta,
  f.note,
  f.component_id,
  f.part_number,
  f.component_name,
  f.location_id,
  f.location_path,
  f.project_id,
  f.project_name,
  f.created_by,
  f.actor_name,
  null::uuid        as to_location_id,
  null::text        as to_location_path
from public.transactions_feed f
union all
select
  m.id::text,
  m.created_at,
  'move',
  m.quantity,
  0,
  m.note,
  m.component_id,
  c.part_number,
  c.name,
  m.from_location_id,
  lf.path,
  null::uuid,
  null::text,
  m.created_by,
  u.display_name,
  m.to_location_id,
  lt.path
from public.stock_moves m
join public.components c on c.id = m.component_id
left join public.locations_full lf on lf.id = m.from_location_id
left join public.locations_full lt on lt.id = m.to_location_id
left join public.profiles u on u.id = m.created_by;

revoke all on public.history_feed from anon;
grant select on public.history_feed to authenticated;

notify pgrst, 'reload schema';

commit;
