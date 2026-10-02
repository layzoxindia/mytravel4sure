-- MyTravel4Sure production persistence for Vercel/Supabase.
-- Run once in the Supabase SQL editor, then run: node seed-supabase.mjs
create table if not exists public.packages (
  slug text primary key,
  payload jsonb not null,
  published boolean not null default true,
  updated_at timestamptz not null default now()
);
create table if not exists public.leads (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new','contacted','qualified','quoted','booked','closed')),
  name text not null,
  phone text not null,
  email text,
  destination text,
  travel_month text,
  travellers text,
  trip_type text,
  budget text,
  notes text,
  source text
);
create table if not exists public.newsletter (
  email text primary key,
  created_at timestamptz not null default now(),
  source text
);
create index if not exists leads_created_at_idx on public.leads(created_at desc);
create index if not exists leads_status_idx on public.leads(status);

alter table public.packages enable row level security;
alter table public.leads enable row level security;
alter table public.newsletter enable row level security;
-- No public policies are intentionally created. The bundled Vercel API uses the
-- server-only Supabase service-role key. Never expose that key to browser code.
