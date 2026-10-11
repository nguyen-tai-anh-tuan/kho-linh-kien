-- =====================================================================
-- 10_project_codes.sql  -  Mã dự án tự động: PRJ-01, PRJ-02, PRJ-03...
-- Chạy MỘT LẦN trong Supabase: SQL Editor -> New query -> dán -> Run.
-- Chạy lại nhiều lần cũng an toàn. Không đụng tới BOM, ảnh hay lịch sử.
-- Nếu có lỗi ở bất kỳ bước nào thì không có gì bị thay đổi.
--
-- Database chỉ lưu con số (1, 2, 3...). Web hiển thị thành PRJ-01, PRJ-02...
-- Dự án đang có được đánh số theo thứ tự tạo, cũ nhất là số 1.
-- Số của dự án đã xóa không được cấp lại.
-- =====================================================================

begin;

create sequence if not exists public.project_code_seq;

alter table public.projects
  add column if not exists code_no int;

-- Đánh số cho các dự án chưa có mã, theo thứ tự tạo
do $$
declare
  r record;
begin
  for r in
    select id from public.projects where code_no is null order by created_at, name, id
  loop
    update public.projects set code_no = nextval('public.project_code_seq') where id = r.id;
  end loop;
end $$;

-- Dự án tạo mới tự nhận số kế tiếp
alter table public.projects
  alter column code_no set default nextval('public.project_code_seq'),
  alter column code_no set not null;

alter sequence public.project_code_seq owned by public.projects.code_no;

create unique index if not exists projects_code_no_key on public.projects (code_no);

-- Tài khoản đăng nhập cần quyền lấy số kế tiếp khi tạo dự án
grant usage on sequence public.project_code_seq to authenticated;

notify pgrst, 'reload schema';

commit;
