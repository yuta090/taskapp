-- pg_cron の代役（使い捨てクラスタ専用）。本物は Supabase が入れる拡張で、ローカルの PostgreSQL には無い。
-- cron.job の形と、名前付きの schedule / unschedule のふるまいを pg_cron 1.6 に合わせる:
--   cron.schedule(名前, 周期, 中身)  同じ（名前, 登録ロール）があれば置き換え、無ければ追加する
--   cron.unschedule(名前)           登録ロールの同名 job を消す。無ければエラー
-- migration は「pg_extension に pg_cron があるか」で登録するかを決めるので、その行も入れる。

create schema if not exists cron;

create table if not exists cron.job (
  jobid bigserial primary key,
  schedule text not null,
  command text not null,
  database text not null default current_database(),
  username text not null default current_user,
  active boolean not null default true,
  jobname text,
  constraint jobname_username_uniq unique (jobname, username)
);

create or replace function cron.schedule(job_name text, schedule text, command text)
returns bigint
language plpgsql
as $$
declare
  v_jobid bigint;
begin
  -- 本物は周期の書式を検査して、崩れていれば登録しない（5項目の cron 式か 'N seconds'）
  if array_length(regexp_split_to_array(btrim($2), '\s+'), 1) <> 5 and $2 !~ '^\d+ seconds$' then
    raise exception 'invalid schedule: %', $2;
  end if;
  insert into cron.job (jobname, schedule, command)
  values ($1, $2, $3)
  on conflict on constraint jobname_username_uniq
  do update set schedule = excluded.schedule, command = excluded.command
  returning jobid into v_jobid;
  return v_jobid;
end;
$$;

create or replace function cron.unschedule(job_name text)
returns boolean
language plpgsql
as $$
begin
  delete from cron.job where jobname = $1 and username = current_user;
  if not found then
    raise exception 'could not find valid entry for job ''%''', $1;
  end if;
  return true;
end;
$$;

create or replace function cron.unschedule(job_id bigint)
returns boolean
language plpgsql
as $$
begin
  delete from cron.job where jobid = $1;
  if not found then
    raise exception 'could not find valid entry for job %', $1;
  end if;
  return true;
end;
$$;

-- 拡張として入っているように見せる（使い捨てクラスタでだけ行う）
set allow_system_table_mods = on;
insert into pg_extension (oid, extname, extowner, extnamespace, extrelocatable, extversion, extconfig, extcondition)
select (select coalesce(max(oid::int8), 16384) + 1 from pg_extension)::oid,
       'pg_cron', 'postgres'::regrole, 'cron'::regnamespace, false, '1.6', null, null
where not exists (select 1 from pg_extension where extname = 'pg_cron');
reset allow_system_table_mods;
