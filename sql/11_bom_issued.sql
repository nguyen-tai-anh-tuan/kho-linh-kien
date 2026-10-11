-- =====================================================================
-- 11_bom_issued.sql  -  Ghi nhớ mỗi dòng BOM đã xuất kho bao nhiêu
-- Chạy MỘT LẦN trong Supabase: SQL Editor -> New query -> dán -> Run.
-- Cần chạy sau file 03_pages.sql. Chạy lại nhiều lần cũng an toàn.
-- Không đụng tới tồn kho hay lịch sử. Nếu có lỗi thì không có gì bị thay đổi.
--
-- Nhờ cột "issued", nút "Xuất kho theo BOM" chỉ xuất phần còn thiếu:
-- linh kiện đã xuất đủ ở lần trước sẽ không bị xuất lại.
--
-- LẦN CHẠY ĐẦU TIÊN: số đã xuất của các dòng BOM đang có được tính sẵn
-- từ lịch sử (tổng các lần xuất kho có gắn đúng dự án đó).
-- Lần xuất đã bấm "Hoàn tác" trước đây vẫn bị tính, vì lịch sử không ghi
-- lần hoàn tác thuộc dự án nào. Nếu số nào sai, bấm "Bắt đầu đợt mới"
-- trong trang dự án để đưa về 0.
-- =====================================================================

begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project_bom' and column_name = 'issued'
  ) then
    alter table public.project_bom
      add column issued int not null default 0 check (issued >= 0);

    update public.project_bom b
    set issued = t.total
    from (
      select project_id, component_id, sum(quantity)::int as total
      from public.transactions
      where type = 'out' and project_id is not null
      group by project_id, component_id
    ) t
    where t.project_id = b.project_id and t.component_id = b.component_id;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
