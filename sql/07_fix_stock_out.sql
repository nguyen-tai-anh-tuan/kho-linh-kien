-- =====================================================================
-- 07_fix_stock_out.sql  -  Sửa lỗi không xuất kho / điều chỉnh giảm được
-- Chạy MỘT LẦN trong Supabase: SQL Editor -> New query -> dán -> Run.
-- Chạy lại nhiều lần cũng an toàn. Không đụng tới dữ liệu đang có.
--
-- Lỗi cũ: khi xuất kho, hàm ghi thử một dòng tồn kho với số ÂM (ví dụ -1)
-- rồi mới cộng dồn vào dòng đang có. Database kiểm tra "tồn kho >= 0"
-- ngay trên dòng ghi thử đó nên từ chối, dù tồn kho thật vẫn đủ.
-- Bản sửa: ghi thẳng số tồn mới (tồn hiện tại cộng/trừ thay đổi).
-- =====================================================================

begin;

create or replace function public.apply_transaction()
returns trigger
language plpgsql
set search_path = ''
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

  -- Ghi số tồn mới (luôn >= 0), không ghi phần thay đổi
  insert into public.stock (component_id, location_id, quantity)
  values (new.component_id, new.location_id, cur + d)
  on conflict (component_id, location_id)
  do update set quantity = excluded.quantity;

  new.delta := d;
  return new;
end;
$$;

commit;
