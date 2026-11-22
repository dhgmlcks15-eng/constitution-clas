begin;
create schema classroom;
revoke all on schema classroom from public, anon, authenticated;
create table classroom.teachers (account uuid primary key references auth.users on delete cascade);
create table classroom.classes (
 code text primary key check(code ~ '^[0-9]{6}$'),
 label text not null check(length(trim(label)) between 1 and 80),
 teacher uuid not null references classroom.teachers on delete cascade
);
create table classroom.students (
 account uuid primary key references auth.users on delete cascade,
 klass text not null references classroom.classes on delete cascade,
 sid text not null check(sid ~ '^[0-9]{5}$'),
 name text not null check(length(trim(name)) between 1 and 80),
 unique(klass,sid)
);
create table classroom.submissions (
 account uuid primary key references classroom.students on delete cascade,
 payload jsonb not null,
 submitted_at timestamptz not null
);
create function public.classroom_profile() returns jsonb language sql stable security definer set search_path='' as $$
 select case when exists(select from classroom.teachers where account=auth.uid()) then '{"role":"teacher"}'::jsonb
 else (select jsonb_build_object('role','student','klass',klass,'sid',sid,'name',name) from classroom.students where account=auth.uid()) end
$$;
create function public.classroom_add(code text,label text) returns void language sql security definer set search_path='' as $$
 insert into classroom.classes values(code,label,auth.uid())
$$;
create function public.classroom_enroll(room text, entries jsonb) returns void language plpgsql security definer set search_path='' as $$
declare r record; student_account uuid;
begin
 if not exists(select from classroom.classes where code=room and teacher=auth.uid()) then raise exception '학급 권한을 확인하세요.'; end if;
 for r in select * from jsonb_to_recordset(entries) as x(sid text,name text,email text) loop
   select id into student_account from auth.users where lower(email)=lower(trim(r.email)) and email_confirmed_at is not null;
   if student_account is null then raise exception '먼저 학생 인증 계정을 등록하고 이메일을 확인하세요. 학번 %',r.sid; end if;
   insert into classroom.students values(student_account,room,r.sid,r.name)
   on conflict(account) do update set name=excluded.name where classroom.students.klass=room and classroom.students.sid=excluded.sid;
   if not found then raise exception '이미 다른 학급 또는 학번으로 등록된 계정입니다.'; end if;
 end loop;
end $$;
create function public.classroom_submit(activity jsonb) returns timestamptz language plpgsql security definer set search_path='' as $$
declare s classroom.students; stamp timestamptz := now();
begin
 select * into strict s from classroom.students where account=auth.uid();
 if jsonb_typeof(activity) is distinct from 'object' or coalesce(activity->>'area','') !~ '^([1-9]|10)$' or octet_length(activity::text)>500000 then raise exception '제출 자료를 확인하세요.'; end if;
 insert into classroom.submissions values(s.account,activity || jsonb_build_object('sid',s.sid,'klass',s.klass,'name',s.name,'at',stamp),stamp)
 on conflict(account) do update set payload=excluded.payload,submitted_at=excluded.submitted_at;
 return stamp;
end $$;
create function public.classroom_dashboard() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('code',c.code,'label',c.label,'students',
 (select coalesce(jsonb_agg(jsonb_build_object('sid',s.sid,'name',s.name,'submission',p.payload) order by s.sid),'[]'::jsonb)
 from classroom.students s left join classroom.submissions p using(account) where s.klass=c.code)) order by c.code),'[]'::jsonb)
 from classroom.classes c where teacher=auth.uid()
$$;
revoke all on function public.classroom_profile(), public.classroom_add(text,text), public.classroom_enroll(text,jsonb), public.classroom_submit(jsonb), public.classroom_dashboard() from public, anon;
grant execute on function public.classroom_profile(), public.classroom_add(text,text), public.classroom_enroll(text,jsonb), public.classroom_submit(jsonb), public.classroom_dashboard() to authenticated;
commit;
