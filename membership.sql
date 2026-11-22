create table classroom.owner_config (singleton boolean primary key default true check(singleton), email text not null, salt uuid not null default gen_random_uuid(), invite_hash bytea);
create table classroom.invite_attempts(account uuid primary key references auth.users on delete cascade, attempts int not null, since timestamptz not null);
alter table classroom.students add column stage smallint check(stage between 0 and 10), add column active_at timestamptz;
create function classroom.is_owner() returns boolean language sql stable set search_path='' as $$
 select exists(select from auth.users u join classroom.owner_config c on c.email=lower(u.email) where u.id=auth.uid() and u.email_confirmed_at is not null)
$$;
create or replace function public.classroom_profile() returns jsonb language sql stable security definer set search_path='' as $$
 select case when classroom.is_owner() then '{"role":"admin"}'::jsonb when exists(select from classroom.teachers where account=auth.uid()) then '{"role":"teacher"}'::jsonb
 else (select jsonb_build_object('role','student','klass',klass,'sid',sid,'name',name) from classroom.students where account=auth.uid()) end
$$;
create function public.classroom_join_teacher(invite text) returns boolean language plpgsql security definer set search_path='' as $$
declare tries int;
begin
 if not classroom.is_owner() then
   if not exists(select from auth.identities where user_id=auth.uid() and provider='google') then return false; end if;
   insert into classroom.invite_attempts as a values(auth.uid(),1,now()) on conflict(account) do update set
     attempts=case when a.since < now()-interval '1 hour' then 1 else least(11,a.attempts+1) end,
     since=case when a.since < now()-interval '1 hour' then now() else a.since end returning attempts into tries;
   if tries>10 or not exists(select from classroom.owner_config where invite_hash=sha256(convert_to(salt::text||invite,'UTF8'))) then return false; end if;
 end if;
 insert into classroom.teachers values(auth.uid()) on conflict do nothing;
 return true;
end $$;
create function public.classroom_join_student(room text, number text, display_name text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select from auth.users where id=auth.uid() and email_confirmed_at is not null)
 or not exists(select from classroom.classes where code=room) or public.classroom_profile() is not null then raise exception '가입 정보 또는 학급 코드를 확인하세요.'; end if;
 insert into classroom.students(account,klass,sid,name) values(auth.uid(),room,number,trim(display_name));
exception when unique_violation then raise exception '이미 등록된 학번 또는 계정입니다.';
end $$;
create function public.classroom_progress(current_stage int) returns void language plpgsql security definer set search_path='' as $$
begin
 update classroom.students set stage=current_stage,active_at=now() where account=auth.uid() and current_stage between 0 and 10;
 if not found then raise exception '등록된 학생과 활동 단계를 확인하세요.'; end if;
end $$;
create or replace function public.classroom_dashboard() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('code',c.code,'label',c.label,'students',
 (select coalesce(jsonb_agg(jsonb_build_object('sid',s.sid,'name',s.name,'stage',s.stage,'active_at',s.active_at,'submission',p.payload) order by s.sid),'[]'::jsonb)
 from classroom.students s left join classroom.submissions p using(account) where s.klass=c.code)) order by c.code),'[]'::jsonb)
 from classroom.classes c where teacher=auth.uid() or classroom.is_owner()
$$;
revoke all on function public.classroom_join_teacher(text), public.classroom_join_student(text,text,text), public.classroom_progress(int) from public,anon;
grant execute on function public.classroom_join_teacher(text), public.classroom_join_student(text,text,text), public.classroom_progress(int) to authenticated;
create function public.classroom_open_room(room text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select from classroom.classes where code=room and room ~ '^[0-9]{6}$')
$$;
revoke all on function public.classroom_open_room(text) from public;
grant execute on function public.classroom_open_room(text) to anon,authenticated;
