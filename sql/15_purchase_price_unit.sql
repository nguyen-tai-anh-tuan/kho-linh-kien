-- =====================================================================
-- 15_purchase_price_unit.sql  -  Đơn giá theo hộp / bộ cho "Linh kiện mới" trong danh sách mua trước
-- Chạy MỘT LẦN trong Supabase: SQL Editor -> New query -> dán -> Run.
-- Cần chạy sau file 13_purchase_list.sql và 14_price_unit.sql. Chạy lại nhiều lần cũng an toàn.
-- Không đụng tới dữ liệu đang có. Nếu có lỗi thì không có gì bị thay đổi.
--
-- Giống cột cùng tên của bảng components (sql/14):
--   price_unit : đơn vị tính giá ('hộp', 'bộ', 'combo'...); để trống = tính theo cái
--   price_qty  : số cái trong một đơn vị đó (vd 840)
-- Cột unit_price vẫn là giá MỘT CÁI. Chỉ dùng cho món chưa có trong kho; món có trong kho
-- thì theo cách tính giá của linh kiện. Bấm "Đã mua" thì linh kiện mới mang theo hai cột này.
-- =====================================================================

begin;

alter table public.purchase_items add column if not exists price_qty int;
alter table public.purchase_items add column if not exists price_unit text;

alter table public.purchase_items drop constraint if exists purchase_items_price_qty_check;
alter table public.purchase_items add constraint purchase_items_price_qty_check check (price_qty is null or price_qty >= 1);

notify pgrst, 'reload schema';

commit;
