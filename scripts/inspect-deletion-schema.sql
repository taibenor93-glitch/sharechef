-- ShareChef DELETION SCHEMA INSPECTION (read-only metadata; no user records touched).
-- Paste whole file into Supabase SQL editor, press RUN once. Temp table only; zero residue.

create temp table _meta(seq serial, section text, detail text);

-- All foreign keys in public schema: table.column -> target ON DELETE rule [constraint name]
insert into _meta(section, detail)
select 'FK',
  tc.table_name || '.' || kcu.column_name || ' -> ' ||
  ccu.table_schema || '.' || ccu.table_name || '.' || ccu.column_name ||
  ' ON DELETE ' || rc.delete_rule || ' [' || tc.constraint_name || ']'
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
join information_schema.referential_constraints rc
  on rc.constraint_name = tc.constraint_name and rc.constraint_schema = tc.table_schema
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name and ccu.constraint_schema = tc.table_schema
where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
order by tc.table_name;

-- shares table: full column definitions
insert into _meta(section, detail)
select 'SHARES_COL',
  column_name || ' ' || data_type ||
  case when is_nullable = 'NO' then ' NOT NULL' else '' end ||
  coalesce(' DEFAULT ' || column_default, '')
from information_schema.columns
where table_schema = 'public' and table_name = 'shares'
order by ordinal_position;

-- shares: all constraints (PK, FK, unique, check)
insert into _meta(section, detail)
select 'SHARES_CONSTRAINT', tc.constraint_type || ' [' || tc.constraint_name || ']'
from information_schema.table_constraints tc
where tc.table_schema = 'public' and tc.table_name = 'shares';

-- pg_cron: available on this instance?
insert into _meta(section, detail)
select 'PG_CRON_AVAILABLE', name || ' (default version ' || default_version || ')'
from pg_available_extensions where name = 'pg_cron';
insert into _meta(section, detail)
select 'PG_CRON_AVAILABLE', 'NOT AVAILABLE on this instance'
where not exists (select 1 from pg_available_extensions where name = 'pg_cron');

-- pg_cron: currently enabled?
insert into _meta(section, detail)
select 'PG_CRON_ENABLED', 'YES — installed version ' || extversion
from pg_extension where extname = 'pg_cron';
insert into _meta(section, detail)
select 'PG_CRON_ENABLED', 'NO — extension not installed'
where not exists (select 1 from pg_extension where extname = 'pg_cron');

-- existing cron jobs (names + schedules only) — tolerant if cron schema absent
do $$
begin
  begin
    insert into _meta(section, detail)
    select 'CRON_JOB', jobname || ' @ ' || schedule from cron.job;
    insert into _meta(section, detail)
    select 'CRON_JOB', '(no jobs defined)'
    where not exists (select 1 from cron.job);
  exception when others then
    insert into _meta(section, detail) values ('CRON_JOB', 'cron schema not accessible: ' || sqlerrm);
  end;
end $$;

select seq, section, detail from _meta order by seq;
