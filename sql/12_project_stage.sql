-- =====================================================================
-- 12_project_stage.sql  -  Tiến độ thực hiện của dự án
-- Chạy MỘT LẦN trong Supabase: SQL Editor -> New query -> dán -> Run.
-- Chạy lại nhiều lần cũng an toàn. Không đụng tới BOM, ảnh, kho hay lịch sử.
-- Nếu có lỗi ở bất kỳ bước nào thì không có gì bị thay đổi.
--
-- Database lưu tiến độ bằng một con số, web hiển thị thành tên bước:
--   0 Lên ý tưởng   1 Thiết kế   2 Vẽ PCB   3 In PCB
--   4 Lắp ráp và kiểm thử        5 Hoàn thành
-- Dự án đang có và dự án tạo mới đều bắt đầu ở bước 0 (Lên ý tưởng).
-- Admin và thành viên đổi được tiến độ (cùng quyền với sửa dự án).
-- =====================================================================

begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'projects' and column_name = 'stage'
  ) then
    alter table public.projects
      add column stage smallint not null default 0 check (stage between 0 and 5),
      add column stage_changed_at timestamptz not null default now();

    -- Dự án đang có: coi như đứng ở bước đầu từ ngày tạo dự án
    update public.projects set stage_changed_at = created_at where created_at is not null;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
