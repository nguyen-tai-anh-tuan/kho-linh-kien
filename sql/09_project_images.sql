-- =====================================================================
-- 09_project_images.sql  -  Ảnh của dự án (tối đa 3 ảnh mỗi dự án)
-- Chạy MỘT LẦN trong Supabase: SQL Editor -> New query -> dán -> Run.
-- Cần chạy sau file 04_roles.sql. Chạy lại nhiều lần cũng an toàn.
-- Không đụng tới dữ liệu kho. Nếu có lỗi thì không có gì bị thay đổi.
--
-- Ảnh nằm trong Supabase Storage (kho "project-images", riêng tư):
-- chỉ tài khoản đã được duyệt mới xem được; admin và thành viên được tải lên.
-- Web tự nén ảnh trước khi tải lên nên mỗi ảnh chỉ khoảng 150-300 KB.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Bảng ghi ảnh nào thuộc dự án nào
--    slot 0 = ảnh đại diện, slot 1 và 2 = hai ảnh thêm (sơ đồ, ảnh 3D...)
-- ---------------------------------------------------------------------
create table if not exists public.project_images (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  slot        smallint not null check (slot between 0 and 2),
  path        text not null,   -- ảnh lớn
  thumb_path  text not null,   -- ảnh thu nhỏ
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (project_id, slot)
);

alter table public.project_images enable row level security;

revoke all on public.project_images from anon, authenticated;
grant select, insert, update, delete on public.project_images to authenticated;

drop policy if exists "project_images view"   on public.project_images;
drop policy if exists "project_images add"    on public.project_images;
drop policy if exists "project_images edit"   on public.project_images;
drop policy if exists "project_images delete" on public.project_images;
create policy "project_images view"   on public.project_images for select to authenticated using ((select private.can_view()));
create policy "project_images add"    on public.project_images for insert to authenticated with check ((select private.can_edit()));
create policy "project_images edit"   on public.project_images for update to authenticated using ((select private.can_edit())) with check ((select private.can_edit()));
create policy "project_images delete" on public.project_images for delete to authenticated using ((select private.can_edit()));

-- ---------------------------------------------------------------------
-- 2) Kho chứa file ảnh: riêng tư, mỗi file tối đa 2 MB, chỉ nhận ảnh
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-images', 'project-images', false, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "project images read"   on storage.objects;
drop policy if exists "project images upload" on storage.objects;
drop policy if exists "project images change" on storage.objects;
drop policy if exists "project images remove" on storage.objects;
create policy "project images read" on storage.objects
  for select to authenticated
  using (bucket_id = 'project-images' and (select private.can_view()));
create policy "project images upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-images' and (select private.can_edit()));
create policy "project images change" on storage.objects
  for update to authenticated
  using (bucket_id = 'project-images' and (select private.can_edit()))
  with check (bucket_id = 'project-images' and (select private.can_edit()));
create policy "project images remove" on storage.objects
  for delete to authenticated
  using (bucket_id = 'project-images' and (select private.can_edit()));

-- ---------------------------------------------------------------------
-- 3) Báo cho Supabase nạp lại cấu trúc mới
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';

commit;
