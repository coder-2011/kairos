create table if not exists public.kairos_records (
  collection text not null,
  id text not null,
  record jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

create index if not exists kairos_records_collection_idx
  on public.kairos_records (collection);

create index if not exists kairos_records_record_run_id_idx
  on public.kairos_records ((record ->> 'runId'));

grant select, insert, update, delete on table public.kairos_records to service_role;

alter table public.kairos_records enable row level security;

drop policy if exists "kairos_records_service_role_all" on public.kairos_records;

create policy "kairos_records_service_role_all"
  on public.kairos_records
  for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');
