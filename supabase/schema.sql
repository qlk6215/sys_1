-- 팀플 캘린더 DB 스키마
-- Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여 넣고 Run.
-- 여러 번 실행해도 안전하다.
--
-- 보안 구조: 테이블은 RLS로 완전히 막아 두고(정책 없음), 브라우저는 아래 함수(RPC)로만 접근한다.
-- 각 팀원은 참여할 때 받은 token을 브라우저에 보관하고, 수정/탈퇴 시 token이 맞아야 한다.

create table if not exists public.teams (
  id         bigint generated always as identity primary key,
  code       text unique not null,
  name       text not null check (char_length(name) between 1 and 50),
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  id         bigint generated always as identity primary key,
  team_id    bigint not null references public.teams(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 30),
  token      text not null,
  created_at timestamptz not null default now()
);
create index if not exists members_team_id_idx on public.members(team_id);

create table if not exists public.slots (
  id         bigint generated always as identity primary key,
  member_id  bigint not null references public.members(id) on delete cascade,
  name       text not null,
  day        text not null check (day in ('MON','TUE','WED','THU','FRI','SAT','SUN')),
  start_time text not null,
  end_time   text not null,
  location   text
);
create index if not exists slots_member_id_idx on public.slots(member_id);

alter table public.teams   enable row level security;
alter table public.members enable row level security;
alter table public.slots   enable row level security;
revoke all on public.teams, public.members, public.slots from anon, authenticated;


-- 팀 만들기 → { code, name }
create or replace function public.create_team(p_name text)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- 0/O, 1/I 제외
  v_code text;
begin
  p_name := btrim(coalesce(p_name, ''));
  if char_length(p_name) not between 1 and 50 then
    raise exception '팀 이름은 1~50자로 입력해 주세요.';
  end if;
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * 32)::int, 1);
    end loop;
    exit when not exists (select 1 from teams where code = v_code);
  end loop;
  insert into teams (code, name) values (v_code, p_name);
  return json_build_object('code', v_code, 'name', p_name);
end;
$$;


-- 팀 조회 (토큰은 절대 내보내지 않음) → { code, name, members: [{ id, name, slots: [...] }] } 또는 null
create or replace function public.get_team(p_code text)
returns json
language sql stable security definer set search_path = public
as $$
  select json_build_object(
    'code', t.code,
    'name', t.name,
    'members', coalesce((
      select json_agg(json_build_object(
        'id', m.id,
        'name', m.name,
        'slots', coalesce((
          select json_agg(json_build_object(
            'name', s.name, 'day', s.day, 'start', s.start_time, 'end', s.end_time, 'location', s.location
          ) order by s.day, s.start_time)
          from slots s where s.member_id = m.id
        ), '[]'::json)
      ) order by m.id)
      from members m where m.team_id = t.id
    ), '[]'::json)
  )
  from teams t
  where t.code = upper(btrim(p_code));
$$;


-- 팀 참여 → { id, name, token }  (token은 이 응답에서 딱 한 번만 나간다)
create or replace function public.join_team(p_code text, p_name text)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_team_id bigint;
  v_token   text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_id      bigint;
begin
  p_name := btrim(coalesce(p_name, ''));
  if char_length(p_name) not between 1 and 30 then
    raise exception '이름은 1~30자로 입력해 주세요.';
  end if;
  select id into v_team_id from teams where code = upper(btrim(p_code));
  if v_team_id is null then
    raise exception '팀을 찾을 수 없습니다. 초대 코드를 확인해 주세요.';
  end if;
  if (select count(*) from members where team_id = v_team_id) >= 30 then
    raise exception '한 팀에는 30명까지 참여할 수 있습니다.';
  end if;
  insert into members (team_id, name, token) values (v_team_id, p_name, v_token) returning id into v_id;
  return json_build_object('id', v_id, 'name', p_name, 'token', v_token);
end;
$$;


-- 내 시간표 저장 (전체 교체). p_slots: [{ name, day, start: "HH:MM", end: "HH:MM", location }]
create or replace function public.save_slots(p_member_id bigint, p_token text, p_slots jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from members where id = p_member_id and token = p_token) then
    raise exception '본인 시간표만 수정할 수 있습니다.';
  end if;
  if jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) > 60 then
    raise exception '수업은 60개까지 저장할 수 있습니다.';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_slots) as x(name text, day text, "start" text, "end" text, location text)
    where char_length(btrim(coalesce(x.name, ''))) not between 1 and 50
       or coalesce(x.day, '') not in ('MON','TUE','WED','THU','FRI','SAT','SUN')
       or coalesce(x."start", '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(x."end", '')   !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$'
       or x."end" <= x."start"
       or char_length(coalesce(x.location, '')) > 50
  ) then
    raise exception '시간표 형식이 올바르지 않습니다. (과목명 1~50자, 끝나는 시각이 시작보다 늦어야 함)';
  end if;

  delete from slots where member_id = p_member_id;
  insert into slots (member_id, name, day, start_time, end_time, location)
  select p_member_id, btrim(x.name), x.day, x."start", x."end", nullif(btrim(x.location), '')
  from jsonb_to_recordset(p_slots) as x(name text, day text, "start" text, "end" text, location text);
end;
$$;


-- 팀 나가기 (내 시간표도 함께 삭제)
create or replace function public.leave_team(p_member_id bigint, p_token text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from members where id = p_member_id and token = p_token;
  if not found then
    raise exception '본인만 팀에서 나갈 수 있습니다.';
  end if;
end;
$$;


revoke execute on function public.create_team(text), public.get_team(text), public.join_team(text, text),
  public.save_slots(bigint, text, jsonb), public.leave_team(bigint, text) from public;
grant execute on function public.create_team(text), public.get_team(text), public.join_team(text, text),
  public.save_slots(bigint, text, jsonb), public.leave_team(bigint, text) to anon, authenticated;
