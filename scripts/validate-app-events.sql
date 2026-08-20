-- ShareChef app_events VALIDATION BATTERY (paste whole file into Supabase SQL editor, press RUN once).
-- Uses temporary test rows, deletes them itself, and reports one results table. Zero residue.

create temp table _results(seq serial, test text, pass boolean, detail text);

do $$
declare
  uid uuid;
  a1 uuid := 'aaaaaaaa-0000-4000-8000-00000000000a'; -- test anon id
  s1 uuid := 'aaaaaaaa-0000-4000-8000-00000000000b'; -- test session id
begin
  select id into uid from auth.users order by created_at limit 1;

  -- T1: valid service-role insert succeeds
  begin
    insert into app_events (id,event,anon_id,session_id,app_version)
    values ('aaaaaaaa-0000-4000-8000-000000000001','app_opened',a1,s1,'1.6.0');
    insert into _results(test,pass,detail) values ('valid service-role insert succeeds', true, '');
  exception when others then
    insert into _results(test,pass,detail) values ('valid service-role insert succeeds', false, sqlerrm);
  end;

  -- T2: duplicate event UUID rejected
  begin
    insert into app_events (id,event,anon_id,session_id,app_version)
    values ('aaaaaaaa-0000-4000-8000-000000000001','app_opened',a1,s1,'1.6.0');
    insert into _results(test,pass,detail) values ('duplicate event UUID rejected', false, 'insert unexpectedly succeeded');
  exception when unique_violation then
    insert into _results(test,pass,detail) values ('duplicate event UUID rejected', true, 'unique_violation as expected');
  when others then
    insert into _results(test,pass,detail) values ('duplicate event UUID rejected', false, sqlerrm);
  end;

  -- T3: duplicate identity link for same anon/user pair rejected
  begin
    insert into app_events (id,event,anon_id,user_id,session_id,app_version)
    values ('aaaaaaaa-0000-4000-8000-000000000002','identity_linked',a1,uid,s1,'1.6.0');
    begin
      insert into app_events (id,event,anon_id,user_id,session_id,app_version)
      values ('aaaaaaaa-0000-4000-8000-000000000003','identity_linked',a1,uid,s1,'1.6.0');
      insert into _results(test,pass,detail) values ('duplicate identity link rejected', false, 'second link unexpectedly succeeded');
    exception when unique_violation then
      insert into _results(test,pass,detail) values ('duplicate identity link rejected', true, 'unique_violation as expected');
    end;
  exception when others then
    insert into _results(test,pass,detail) values ('duplicate identity link rejected', false, 'first link failed: '||sqlerrm);
  end;

  -- T4: duplicate Micheli-intro for same user rejected
  begin
    insert into app_events (id,event,anon_id,user_id,session_id,app_version)
    values ('aaaaaaaa-0000-4000-8000-000000000004','micheli_intro_triggered',a1,uid,s1,'1.6.0');
    begin
      insert into app_events (id,event,anon_id,user_id,session_id,app_version)
      values ('aaaaaaaa-0000-4000-8000-000000000005','micheli_intro_triggered',a1,uid,s1,'1.6.0');
      insert into _results(test,pass,detail) values ('duplicate intro per user rejected', false, 'second intro unexpectedly succeeded');
    exception when unique_violation then
      insert into _results(test,pass,detail) values ('duplicate intro per user rejected', true, 'unique_violation as expected');
    end;
  exception when others then
    insert into _results(test,pass,detail) values ('duplicate intro per user rejected', false, 'first intro failed: '||sqlerrm);
  end;

  -- T5: invalid event name rejected
  begin
    insert into app_events (id,event,anon_id,session_id,app_version)
    values ('aaaaaaaa-0000-4000-8000-000000000006','made_up_event',a1,s1,'1.6.0');
    insert into _results(test,pass,detail) values ('invalid event name rejected', false, 'insert unexpectedly succeeded');
  exception when check_violation then
    insert into _results(test,pass,detail) values ('invalid event name rejected', true, 'check_violation as expected');
  when others then
    insert into _results(test,pass,detail) values ('invalid event name rejected', false, sqlerrm);
  end;

  -- T6: invalid UUID rejected
  begin
    execute $q$ insert into app_events (id,event,anon_id,session_id,app_version)
      values ('not-a-uuid','app_opened','aaaaaaaa-0000-4000-8000-00000000000a','aaaaaaaa-0000-4000-8000-00000000000b','1.6.0') $q$;
    insert into _results(test,pass,detail) values ('invalid UUID rejected', false, 'insert unexpectedly succeeded');
  exception when invalid_text_representation then
    insert into _results(test,pass,detail) values ('invalid UUID rejected', true, 'invalid uuid syntax as expected');
  when others then
    insert into _results(test,pass,detail) values ('invalid UUID rejected', true, 'rejected: '||sqlerrm);
  end;

  -- T7: invalid app version rejected
  begin
    insert into app_events (id,event,anon_id,session_id,app_version)
    values ('aaaaaaaa-0000-4000-8000-000000000007','app_opened',a1,s1,'1.6');
    insert into _results(test,pass,detail) values ('invalid app_version rejected', false, 'insert unexpectedly succeeded');
  exception when check_violation then
    insert into _results(test,pass,detail) values ('invalid app_version rejected', true, 'check_violation as expected');
  when others then
    insert into _results(test,pass,detail) values ('invalid app_version rejected', false, sqlerrm);
  end;

  -- T8: anon role cannot read or insert
  begin
    set local role anon;
    begin
      perform count(*) from app_events;
      reset role;
      insert into _results(test,pass,detail) values ('anon cannot read', false, 'select unexpectedly allowed');
    exception when insufficient_privilege then
      reset role;
      insert into _results(test,pass,detail) values ('anon cannot read', true, 'permission denied as expected');
    end;
    set local role anon;
    begin
      insert into app_events (id,event,anon_id,session_id,app_version)
      values ('aaaaaaaa-0000-4000-8000-000000000008','app_opened',a1,s1,'1.6.0');
      reset role;
      insert into _results(test,pass,detail) values ('anon cannot insert', false, 'insert unexpectedly allowed');
    exception when insufficient_privilege then
      reset role;
      insert into _results(test,pass,detail) values ('anon cannot insert', true, 'permission denied as expected');
    end;
  exception when others then
    reset role;
    insert into _results(test,pass,detail) values ('anon role tests', false, sqlerrm);
  end;

  -- T9: authenticated role cannot read or insert
  begin
    set local role authenticated;
    begin
      perform count(*) from app_events;
      reset role;
      insert into _results(test,pass,detail) values ('authenticated cannot read', false, 'select unexpectedly allowed');
    exception when insufficient_privilege then
      reset role;
      insert into _results(test,pass,detail) values ('authenticated cannot read', true, 'permission denied as expected');
    end;
    set local role authenticated;
    begin
      insert into app_events (id,event,anon_id,session_id,app_version)
      values ('aaaaaaaa-0000-4000-8000-000000000009','app_opened',a1,s1,'1.6.0');
      reset role;
      insert into _results(test,pass,detail) values ('authenticated cannot insert', false, 'insert unexpectedly allowed');
    exception when insufficient_privilege then
      reset role;
      insert into _results(test,pass,detail) values ('authenticated cannot insert', true, 'permission denied as expected');
    end;
  exception when others then
    reset role;
    insert into _results(test,pass,detail) values ('authenticated role tests', false, sqlerrm);
  end;

  -- T10: service-path insert still works after role tests
  begin
    insert into app_events (id,event,anon_id,session_id,app_version)
    values ('aaaaaaaa-0000-4000-8000-000000000010','app_opened',a1,s1,'1.6.0');
    insert into _results(test,pass,detail) values ('privileged insert still works after role tests', true, '');
  exception when others then
    insert into _results(test,pass,detail) values ('privileged insert still works after role tests', false, sqlerrm);
  end;

  -- CLEANUP: remove every test row
  delete from app_events where anon_id = a1;

  -- FINAL STATE rows
  insert into _results(test,pass,detail)
  select 'FINAL: app_events row count must be 0', count(*)=0, 'rows='||count(*) from app_events;
  insert into _results(test,pass,detail)
  select 'FINAL: existing tables unchanged',
    (select count(*) from profiles)=5 and (select count(*) from recipes)=5 and (select count(*) from shares)=0
      and (select count(*) from cook_sessions)=4 and (select count(*) from micheli_memory)=4,
    'profiles='||(select count(*) from profiles)||' recipes='||(select count(*) from recipes)||' shares='||(select count(*) from shares)||' cook_sessions='||(select count(*) from cook_sessions)||' micheli_memory='||(select count(*) from micheli_memory);
end $$;

select seq, test, case when pass then 'PASS' else 'FAIL' end as result, detail
from _results order by seq;
