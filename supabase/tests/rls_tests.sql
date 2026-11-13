-- LUMEN row-level-security self-test.  >>> NOT RUN in the authoring environment (no Postgres available). <<<
-- Run in the Supabase SQL Editor AFTER applying 001_create_inquiries.sql.
-- Everything happens in one transaction that is ROLLED BACK at the end, so no data is kept.
-- Success = the final NOTICE "ALL RLS TESTS PASSED". Any failure raises an exception.

begin;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'admin-test@example.invalid'),
  ('22222222-2222-2222-2222-222222222222', 'plain-test@example.invalid');
insert into public.admin_users (user_id) values ('11111111-1111-1111-1111-111111111111');
insert into public.inquiries (id, name, email, project_type, message)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Test', 'test@example.invalid', 'other', 'hello');

create or replace function pg_temp.expect_error(stmt text, expected_state text, label text)
returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (statement succeeded but should have failed)', label;
exception when others then
  if sqlstate = 'P0001' and sqlerrm like 'FAIL:%' then raise; end if;
  if sqlstate <> expected_state then
    raise exception 'FAIL: % (got % %, expected %)', label, sqlstate, sqlerrm, expected_state;
  end if;
end $$;

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- ---------------- anon: no access at all (42501 = insufficient_privilege)
set local role anon;
select pg_temp.expect_error('select * from public.inquiries', '42501', 'anon cannot read inquiries');
select pg_temp.expect_error($$insert into public.inquiries (name,email,project_type,message) values ('x','x@y.zz','other','m')$$, '42501', 'anon cannot insert inquiries');
select pg_temp.expect_error($$update public.inquiries set status='archived'$$, '42501', 'anon cannot update inquiries');
select pg_temp.expect_error('delete from public.inquiries', '42501', 'anon cannot delete inquiries');
select pg_temp.expect_error('select * from public.admin_users', '42501', 'anon cannot read admin_users');
reset role;

-- ---------------- authenticated NON-admin: sees nothing, changes nothing
set local role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
do $$ begin
  if (select count(*) from public.inquiries) <> 0 then raise exception 'FAIL: non-admin can see inquiries'; end if;
  update public.inquiries set status = 'archived';
  if found then raise exception 'FAIL: non-admin updated an inquiry'; end if;
end $$;
select pg_temp.expect_error($$insert into public.inquiries (name,email,project_type,message) values ('x','x@y.zz','other','m')$$, '42501', 'non-admin cannot insert inquiries');
select pg_temp.expect_error('delete from public.inquiries', '42501', 'non-admin cannot delete inquiries');
select pg_temp.expect_error($$insert into public.admin_users (user_id) values ('22222222-2222-2222-2222-222222222222')$$, '42501', 'user cannot self-assign admin');
select pg_temp.expect_error($$update public.admin_users set role='admin'$$, '42501', 'user cannot update admin_users');
do $$ begin
  if (select count(*) from public.admin_users) <> 0 then raise exception 'FAIL: non-admin can see admin_users rows'; end if;
end $$;
reset role;

-- ---------------- authenticated ADMIN: may read and change status only
set local role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
do $$ begin
  if (select count(*) from public.inquiries) <> 1 then raise exception 'FAIL: admin cannot see inquiries'; end if;
  update public.inquiries set status = 'in_progress' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  if not found then raise exception 'FAIL: admin could not update status'; end if;
end $$;
select pg_temp.expect_error($$update public.inquiries set status = 'bogus'$$, '23514', 'invalid status rejected by CHECK');
select pg_temp.expect_error($$update public.inquiries set message = 'tampered'$$, '42501', 'admin cannot edit message (column privilege)');
select pg_temp.expect_error('delete from public.inquiries', '42501', 'admin cannot delete via API');
select pg_temp.expect_error($$insert into public.admin_users (user_id) values ('22222222-2222-2222-2222-222222222222')$$, '42501', 'admin cannot add admins via API');
reset role;

-- ---------------- constraints (privileged role)
select pg_temp.expect_error($$insert into public.inquiries (name,email,project_type,message) values ('x','not-an-email','other','m')$$, '23514', 'email format enforced');
select pg_temp.expect_error($$insert into public.inquiries (name,email,project_type,message) values ('x','a@b.cc','spaceship','m')$$, '23514', 'project_type enforced');
select pg_temp.expect_error($$insert into public.inquiries (name,email,project_type,message) values ('   ','a@b.cc','other','m')$$, '23514', 'blank name rejected');

do $$ begin
  if (select updated_at from public.inquiries where id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') <= (select created_at from public.inquiries where id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') then
    raise exception 'FAIL: updated_at trigger did not advance the timestamp';
  end if;
  raise notice 'ALL RLS TESTS PASSED';
end $$;

rollback;
