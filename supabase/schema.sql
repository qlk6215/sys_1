-- 팀플 캘린더 DB 스키마
-- Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여 넣고 Run.
-- 여러 번 실행해도 안전하다. (이미 있는 데이터는 그대로 두고 바뀐 부분만 반영)
--
-- 보안 구조: 테이블은 RLS로 완전히 막아 두고(정책 없음), 브라우저는 아래 함수(RPC)로만 접근한다.
-- 각 팀원은 참여할 때 받은 token을 브라우저에 보관하고, 수정/탈퇴/투표 시 token이 맞아야 한다.

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

-- 일정: 수업(class) 또는 개인 일정(personal). on_date 가 비어 있으면 매주 반복, 있으면 그날만.
create table if not exists public.slots (
  id         bigint generated always as identity primary key,
  member_id  bigint not null references public.members(id) on delete cascade,
  name       text not null,
  day        text not null check (day in ('MON','TUE','WED','THU','FRI','SAT','SUN')),
  start_time text not null,
  end_time   text not null,
  location   text
);
alter table public.slots add column if not exists kind text not null default 'class';
alter table public.slots add column if not exists on_date date;
create index if not exists slots_member_id_idx on public.slots(member_id);

-- 모임 후보 시간과 투표
create table if not exists public.meeting_options (
  id          bigint generated always as identity primary key,
  team_id     bigint not null references public.teams(id) on delete cascade,
  on_date     date not null,
  start_time  text not null,
  end_time    text not null,
  proposed_by bigint references public.members(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists meeting_options_team_id_idx on public.meeting_options(team_id);

create table if not exists public.meeting_votes (
  option_id bigint not null references public.meeting_options(id) on delete cascade,
  member_id bigint not null references public.members(id) on delete cascade,
  vote      text not null check (vote in ('yes', 'no')),
  primary key (option_id, member_id)
);

alter table public.teams add column if not exists confirmed_option_id bigint
  references public.meeting_options(id) on delete set null;

alter table public.teams           enable row level security;
alter table public.members         enable row level security;
alter table public.slots           enable row level security;
alter table public.meeting_options enable row level security;
alter table public.meeting_votes   enable row level security;
revoke all on public.teams, public.members, public.slots, public.meeting_options, public.meeting_votes
  from anon, authenticated;


-- 내부용: 멤버 토큰 확인 → team_id
create or replace function public._member_team(p_member_id bigint, p_token text)
returns bigint
language plpgsql stable security definer set search_path = public
as $$
declare v_team_id bigint;
begin
  select team_id into v_team_id from members where id = p_member_id and token = p_token;
  if v_team_id is null then
    raise exception '팀원 확인에 실패했습니다. 다시 참여하거나 ''다른 기기에서 열기'' 링크로 들어와 주세요.';
  end if;
  return v_team_id;
end;
$$;

-- 한국 날짜 기준 '오늘'
create or replace function public._today_kst()
returns date
language sql stable
as $$ select (now() at time zone 'Asia/Seoul')::date $$;


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


-- 팀 조회 (토큰은 절대 내보내지 않음) → 없으면 null
-- { code, name, confirmed_option_id,
--   members: [{ id, name, slots: [{ name, day, start, end, location, kind, date }] }],
--   options: [{ id, date, start, end, proposed_by, votes: [{ member_id, vote }] }] }   (오늘 이후 후보만)
create or replace function public.get_team(p_code text)
returns json
language sql stable security definer set search_path = public
as $$
  select json_build_object(
    'code', t.code,
    'name', t.name,
    'confirmed_option_id', t.confirmed_option_id,
    'members', coalesce((
      select json_agg(json_build_object(
        'id', m.id,
        'name', m.name,
        'slots', coalesce((
          select json_agg(json_build_object(
            'name', s.name, 'day', s.day, 'start', s.start_time, 'end', s.end_time, 'location', s.location,
            'kind', s.kind, 'date', s.on_date
          ) order by s.on_date nulls first, s.day, s.start_time)
          from slots s where s.member_id = m.id
        ), '[]'::json)
      ) order by m.id)
      from members m where m.team_id = t.id
    ), '[]'::json),
    'options', coalesce((
      select json_agg(json_build_object(
        'id', o.id, 'date', o.on_date, 'start', o.start_time, 'end', o.end_time, 'proposed_by', o.proposed_by,
        'votes', coalesce((
          select json_agg(json_build_object('member_id', v.member_id, 'vote', v.vote))
          from meeting_votes v where v.option_id = o.id
        ), '[]'::json)
      ) order by o.on_date, o.start_time)
      from meeting_options o where o.team_id = t.id and o.on_date >= _today_kst()
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


-- 내 일정 저장 (전체 교체).
-- p_slots: [{ name, day, start: "HH:MM", end: "HH:MM", location, kind: "class"|"personal", date: "YYYY-MM-DD"|null }]
create or replace function public.save_slots(p_member_id bigint, p_token text, p_slots jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform _member_team(p_member_id, p_token);
  if jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) > 100 then
    raise exception '일정은 100개까지 저장할 수 있습니다.';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_slots)
      as x(name text, day text, "start" text, "end" text, location text, kind text, date text)
    where char_length(btrim(coalesce(x.name, ''))) not between 1 and 50
       or coalesce(x.day, '') not in ('MON','TUE','WED','THU','FRI','SAT','SUN')
       or coalesce(x."start", '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(x."end", '')   !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$'
       or x."end" <= x."start"
       or char_length(coalesce(x.location, '')) > 50
       or coalesce(x.kind, 'class') not in ('class', 'personal')
       or (x.date is not null and x.date !~ '^\d{4}-\d{2}-\d{2}$')
       -- 날짜가 있으면 요일이 그 날짜의 요일과 같아야 함
       or (case when x.date ~ '^\d{4}-\d{2}-\d{2}$'
                then (array['MON','TUE','WED','THU','FRI','SAT','SUN'])[extract(isodow from x.date::date)::int] <> x.day
           end)
  ) then
    raise exception '일정 형식이 올바르지 않습니다. (이름 1~50자, 끝나는 시각이 시작보다 늦어야 함)';
  end if;

  delete from slots where member_id = p_member_id;
  insert into slots (member_id, name, day, start_time, end_time, location, kind, on_date)
  select p_member_id, btrim(x.name), x.day, x."start", x."end", nullif(btrim(x.location), ''),
         coalesce(x.kind, 'class'), x.date::date
  from jsonb_to_recordset(p_slots)
    as x(name text, day text, "start" text, "end" text, location text, kind text, date text);
end;
$$;


-- 팀 나가기 (내 일정과 투표도 함께 삭제)
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


-- 모임 후보 올리기 → { id }  (같은 시간 후보가 이미 있으면 그걸 돌려줌). 올린 사람은 자동으로 '가능'
create or replace function public.propose_option(p_member_id bigint, p_token text, p_date text, p_start text, p_end text)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_team_id bigint := _member_team(p_member_id, p_token);
  v_id bigint;
begin
  if coalesce(p_date, '') !~ '^\d{4}-\d{2}-\d{2}$'
     or coalesce(p_start, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or coalesce(p_end, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$'
     or p_end <= p_start then
    raise exception '후보 시간 형식이 올바르지 않습니다.';
  end if;
  if p_date::date < _today_kst() then
    raise exception '지난 날짜는 후보로 올릴 수 없습니다.';
  end if;
  select id into v_id from meeting_options
   where team_id = v_team_id and on_date = p_date::date and start_time = p_start and end_time = p_end;
  if v_id is null then
    if (select count(*) from meeting_options where team_id = v_team_id and on_date >= _today_kst()) >= 20 then
      raise exception '후보는 20개까지 올릴 수 있습니다. 필요 없는 후보를 지워 주세요.';
    end if;
    insert into meeting_options (team_id, on_date, start_time, end_time, proposed_by)
    values (v_team_id, p_date::date, p_start, p_end, p_member_id) returning id into v_id;
  end if;
  insert into meeting_votes (option_id, member_id, vote) values (v_id, p_member_id, 'yes')
  on conflict (option_id, member_id) do update set vote = 'yes';
  return json_build_object('id', v_id);
end;
$$;


-- 투표. p_vote: 'yes' | 'no' | null(투표 취소)
create or replace function public.vote_option(p_member_id bigint, p_token text, p_option_id bigint, p_vote text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_team_id bigint := _member_team(p_member_id, p_token);
begin
  if not exists (select 1 from meeting_options where id = p_option_id and team_id = v_team_id) then
    raise exception '후보를 찾을 수 없습니다.';
  end if;
  if p_vote is null then
    delete from meeting_votes where option_id = p_option_id and member_id = p_member_id;
  elsif p_vote in ('yes', 'no') then
    insert into meeting_votes (option_id, member_id, vote) values (p_option_id, p_member_id, p_vote)
    on conflict (option_id, member_id) do update set vote = excluded.vote;
  else
    raise exception '투표 값이 올바르지 않습니다.';
  end if;
end;
$$;


-- 모임 확정. p_option_id 가 null 이면 확정 취소
create or replace function public.confirm_option(p_member_id bigint, p_token text, p_option_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_team_id bigint := _member_team(p_member_id, p_token);
begin
  if p_option_id is not null
     and not exists (select 1 from meeting_options where id = p_option_id and team_id = v_team_id) then
    raise exception '후보를 찾을 수 없습니다.';
  end if;
  update teams set confirmed_option_id = p_option_id where id = v_team_id;
end;
$$;


-- 후보 지우기 (팀원 누구나)
create or replace function public.delete_option(p_member_id bigint, p_token text, p_option_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_team_id bigint := _member_team(p_member_id, p_token);
begin
  delete from meeting_options where id = p_option_id and team_id = v_team_id;
end;
$$;


revoke execute on function public._member_team(bigint, text), public._today_kst() from public, anon, authenticated;
revoke execute on function public.create_team(text), public.get_team(text), public.join_team(text, text),
  public.save_slots(bigint, text, jsonb), public.leave_team(bigint, text),
  public.propose_option(bigint, text, text, text, text), public.vote_option(bigint, text, bigint, text),
  public.confirm_option(bigint, text, bigint), public.delete_option(bigint, text, bigint) from public;
grant execute on function public.create_team(text), public.get_team(text), public.join_team(text, text),
  public.save_slots(bigint, text, jsonb), public.leave_team(bigint, text),
  public.propose_option(bigint, text, text, text, text), public.vote_option(bigint, text, bigint, text),
  public.confirm_option(bigint, text, bigint), public.delete_option(bigint, text, bigint) to anon, authenticated;
