begin;

create schema if not exists private;
create sequence private.shipment_code_seq start 1001;

create table public.shipments (
  id uuid primary key,
  shipment_code text not null unique,
  customer_name text not null check (length(customer_name) between 1 and 160),
  company_name text,
  contact_person text,
  phone text,
  email text,
  booking_number text,
  shipment_type text check (shipment_type in ('FCL', 'LCL', 'Air', 'Other')),
  origin text,
  destination text,
  vessel_name text,
  container_number text,
  etd date,
  eta date,
  remarks text check (length(remarks) <= 4000),
  completed_steps smallint not null default 1 check (completed_steps between 1 and 10),
  created_at timestamptz not null,
  created_by uuid not null,
  created_by_email text not null,
  delivered_at timestamptz,
  check ((completed_steps = 10) = (delivered_at is not null))
);

create index shipments_newest_idx on public.shipments (created_at desc, id);

create table public.shipment_steps (
  shipment_id uuid not null references public.shipments (id),
  step_number smallint not null check (step_number between 1 and 10),
  activated_at timestamptz,
  completed_at timestamptz,
  completed_by uuid,
  completed_by_email text,
  check (completed_at is null or (activated_at is not null and completed_at >= activated_at)),
  primary key (shipment_id, step_number)
);

create table public.shipment_history (
  id bigint generated always as identity primary key,
  shipment_id uuid not null references public.shipments (id),
  kind text not null check (kind in (
    'booking_created', 'step_activated', 'step_completed', 'shipment_completed',
    'reminder_scheduled', 'reminder_sent', 'reminder_failed', 'reminder_skipped',
    'reminder_not_configured', 'reminders_stopped'
  )),
  step_number smallint check (step_number between 1 and 10),
  actor_email text,
  occurred_at timestamptz not null default clock_timestamp(),
  detail text
);

create index shipment_history_timeline_idx on public.shipment_history (shipment_id, id);

create table public.shipment_reminders (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null,
  step_number smallint not null check (step_number between 2 and 10),
  local_date date not null,
  slot_hour smallint not null check (slot_hour in (12, 16)),
  due_at timestamptz not null,
  status text not null default 'processing' check (status in ('processing', 'sent', 'failed', 'not_configured')),
  claimed_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  detail text,
  foreign key (shipment_id, step_number) references public.shipment_steps (shipment_id, step_number),
  unique (shipment_id, step_number, local_date, slot_hour)
);

create index shipment_reminders_processing_idx on public.shipment_reminders (claimed_at) where status = 'processing';

alter table public.shipments enable row level security;
alter table public.shipment_steps enable row level security;
alter table public.shipment_history enable row level security;
alter table public.shipment_reminders enable row level security;

revoke all on public.shipments, public.shipment_steps, public.shipment_history, public.shipment_reminders from anon, authenticated;
grant select on public.shipments, public.shipment_steps, public.shipment_history to authenticated;
create policy staff_read_shipments on public.shipments for select to authenticated using ((select auth.jwt() ->> 'email') is not null);
create policy staff_read_steps on public.shipment_steps for select to authenticated using ((select auth.jwt() ->> 'email') is not null);
create policy staff_read_history on public.shipment_history for select to authenticated using ((select auth.jwt() ->> 'email') is not null);

create function public.create_shipment(p_id uuid, p_booking jsonb)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_email text := auth.jwt() ->> 'email';
  v_now timestamptz := clock_timestamp();
  v_customer text := nullif(trim(p_booking ->> 'customer_name'), '');
  v_code text;
begin
  if v_actor is null or v_email is null then
    raise exception 'Sign in to create a booking.';
  end if;
  if v_customer is null then
    raise exception 'Enter a customer name.';
  end if;

  insert into public.shipments (
    id, shipment_code, customer_name, company_name, contact_person, phone, email,
    booking_number, shipment_type, origin, destination, vessel_name, container_number,
    etd, eta, remarks, created_at, created_by, created_by_email
  ) values (
    p_id, 'SHP-' || to_char(v_now at time zone 'UTC', 'YYYY') || '-' || nextval('private.shipment_code_seq'::regclass),
    v_customer, nullif(trim(p_booking ->> 'company_name'), ''), nullif(trim(p_booking ->> 'contact_person'), ''),
    nullif(trim(p_booking ->> 'phone'), ''), nullif(trim(p_booking ->> 'email'), ''),
    nullif(trim(p_booking ->> 'booking_number'), ''), nullif(trim(p_booking ->> 'shipment_type'), ''),
    nullif(trim(p_booking ->> 'origin'), ''), nullif(trim(p_booking ->> 'destination'), ''),
    nullif(trim(p_booking ->> 'vessel_name'), ''), nullif(trim(p_booking ->> 'container_number'), ''),
    nullif(p_booking ->> 'etd', '')::date, nullif(p_booking ->> 'eta', '')::date,
    nullif(trim(p_booking ->> 'remarks'), ''), v_now, v_actor, v_email
  ) on conflict (id) do nothing returning shipment_code into v_code;

  if v_code is null then
    select shipment_code into v_code from public.shipments where id = p_id and created_by = v_actor;
    if v_code is null then
      raise exception 'This booking request could not be saved.';
    end if;
    return v_code;
  end if;

  insert into public.shipment_steps (shipment_id, step_number, activated_at, completed_at, completed_by, completed_by_email)
  select p_id, step, case when step <= 2 then v_now end, case when step = 1 then v_now end,
    case when step = 1 then v_actor end, case when step = 1 then v_email end
  from generate_series(1, 10) as step;

  insert into public.shipment_history (shipment_id, kind, step_number, actor_email, occurred_at, detail) values
    (p_id, 'booking_created', null, v_email, v_now, null),
    (p_id, 'step_completed', 1, v_email, v_now, null),
    (p_id, 'step_activated', 2, null, v_now, null),
    (p_id, 'reminder_scheduled', 2, null, v_now, 'Daily at 12:00 PM and 4:00 PM while this step is pending.');

  return v_code;
end;
$$;

create function public.complete_shipment_step(p_id uuid, p_step integer)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_email text := auth.jwt() ->> 'email';
  v_now timestamptz;
  v_progress integer;
begin
  if v_actor is null or v_email is null then
    raise exception 'Sign in to complete a shipment step.';
  end if;

  select completed_steps into v_progress from public.shipments where id = p_id for update;
  if not found then
    raise exception 'Shipment could not be found.';
  end if;
  if p_step is null or p_step < 2 or p_step > 10 or p_step <> v_progress + 1 then
    raise exception 'Only the current pending step can be completed.';
  end if;
  v_now := clock_timestamp();

  update public.shipment_steps set completed_at = v_now, completed_by = v_actor, completed_by_email = v_email
    where shipment_id = p_id and step_number = p_step;
  update public.shipments set completed_steps = p_step, delivered_at = case when p_step = 10 then v_now end where id = p_id;

  insert into public.shipment_history (shipment_id, kind, step_number, actor_email, occurred_at, detail) values
    (p_id, 'step_completed', p_step, v_email, v_now, null),
    (p_id, 'reminder_skipped', p_step, null, v_now, 'Future reminders skipped because this step was completed.');

  if p_step = 10 then
    insert into public.shipment_history (shipment_id, kind, actor_email, occurred_at) values
      (p_id, 'shipment_completed', v_email, v_now), (p_id, 'reminders_stopped', null, v_now);
  else
    update public.shipment_steps set activated_at = v_now where shipment_id = p_id and step_number = p_step + 1;
    insert into public.shipment_history (shipment_id, kind, step_number, occurred_at, detail) values
      (p_id, 'step_activated', p_step + 1, v_now, null),
      (p_id, 'reminder_scheduled', p_step + 1, v_now, 'Daily at 12:00 PM and 4:00 PM while this step is pending.');
  end if;

  return p_step;
end;
$$;

create function public.shipment_detail(p_code text)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'shipment', to_jsonb(s),
    'steps', (select jsonb_agg(to_jsonb(t) order by t.step_number) from public.shipment_steps t where t.shipment_id = s.id),
    'history', (select jsonb_agg(to_jsonb(h) order by h.occurred_at, h.id) from public.shipment_history h where h.shipment_id = s.id)
  ) from public.shipments s where s.shipment_code = p_code;
$$;

create function public.due_shipment_reminders(p_due_at timestamptz, p_local_date date, p_slot_hour integer)
returns table (shipment_id uuid, step_number integer)
language sql stable security definer set search_path = ''
as $$
  select s.id, s.completed_steps + 1
    from public.shipments s
    join public.shipment_steps t on t.shipment_id = s.id and t.step_number = s.completed_steps + 1
    where s.completed_steps < 10 and t.activated_at <= p_due_at and t.completed_at is null
      and not exists (
        select 1 from public.shipment_reminders r where r.shipment_id = s.id and r.step_number = t.step_number
          and r.local_date = p_local_date and r.slot_hour = p_slot_hour
      )
    order by t.activated_at, s.id limit 100;
$$;

create function public.claim_shipment_reminder(
  p_id uuid, p_step integer, p_due_at timestamptz, p_local_date date, p_slot_hour integer
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_shipment public.shipments%rowtype;
  v_reminder uuid;
begin
  select * into v_shipment from public.shipments where id = p_id for update;
  if not found or v_shipment.completed_steps >= 10 or v_shipment.completed_steps + 1 <> p_step then
    return null;
  end if;

  insert into public.shipment_reminders (shipment_id, step_number, due_at, local_date, slot_hour)
  select p_id, p_step, p_due_at, p_local_date, p_slot_hour
    from public.shipment_steps
    where shipment_id = p_id and step_number = p_step and activated_at <= p_due_at and completed_at is null
  on conflict (shipment_id, step_number, local_date, slot_hour) do nothing returning id into v_reminder;

  if v_reminder is null then
    return null;
  end if;

  return jsonb_build_object(
    'reminder_id', v_reminder, 'shipment_code', v_shipment.shipment_code, 'customer_name', v_shipment.customer_name,
    'booking_number', v_shipment.booking_number, 'step_number', p_step
  );
end;
$$;

create function public.finish_shipment_reminder(p_reminder_id uuid, p_status text, p_detail text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_status is null or p_status not in ('sent', 'failed', 'not_configured') then
    raise exception 'Invalid reminder result.';
  end if;

  with finished as (
    update public.shipment_reminders set status = p_status, detail = p_detail, finished_at = clock_timestamp()
      where id = p_reminder_id and status = 'processing'
      returning shipment_id, step_number, finished_at, slot_hour
  )
  insert into public.shipment_history (shipment_id, kind, step_number, occurred_at, detail)
    select shipment_id, 'reminder_' || p_status, step_number, finished_at,
      (case when slot_hour = 12 then '12:00 PM' else '4:00 PM' end) || ' slot · ' || p_detail
    from finished;
end;
$$;

create function public.expire_shipment_reminders()
returns void
language sql security definer set search_path = ''
as $$
  select public.finish_shipment_reminder(id, 'failed', 'Delivery could not be confirmed before the job ended.')
  from public.shipment_reminders where status = 'processing' and claimed_at < clock_timestamp() - interval '3 minutes';
$$;

revoke execute on function public.create_shipment(uuid, jsonb), public.complete_shipment_step(uuid, integer),
  public.shipment_detail(text), public.due_shipment_reminders(timestamptz, date, integer),
  public.claim_shipment_reminder(uuid, integer, timestamptz, date, integer),
  public.finish_shipment_reminder(uuid, text, text), public.expire_shipment_reminders()
  from public, anon, authenticated, service_role;

grant execute on function public.create_shipment(uuid, jsonb), public.complete_shipment_step(uuid, integer),
  public.shipment_detail(text) to authenticated;

grant execute on function public.due_shipment_reminders(timestamptz, date, integer),
  public.claim_shipment_reminder(uuid, integer, timestamptz, date, integer),
  public.finish_shipment_reminder(uuid, text, text), public.expire_shipment_reminders() to service_role;

commit;
