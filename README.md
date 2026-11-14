# AI Job Hunter — Preview build

A Hebrew, RTL-first Next.js preview for reviewing the product experience. The current UI includes:
- sign-in and sign-up screens (Supabase Auth when configured);
- a demo entry path so the interface can be explored before backend credentials are connected;
- dashboard, job list/search, applications, resume upload placeholder, profile, and settings;
- demo data stored in the browser only.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. Without Supabase environment values, use "כניסה למצב הדגמה ללא חשבון". Demo jobs and the selected resume filename are stored in localStorage/sessionStorage and are not uploaded or shared.

## Deploy preview to Vercel

1. Import `haimwaiss-ui/ai-job-hanter` from GitHub in Vercel.
2. Framework preset: Next.js; build command: `npm run build`; output: default.
3. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` after a Supabase project has been configured.
4. Deploy. Do not add a service-role key to client environment variables.

## Supabase setup

Apply migrations in order:
1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_security_foundation.sql`

Then configure Supabase Auth redirect URLs for the deployed domain and local development. Generate authoritative database types from the live project:

```bash
npx supabase gen types typescript --project-id "$PROJECT_REF" --schema public > src/lib/supabase/database.types.ts
```

## Important preview limitations

- Demo mode is not real authentication and must not be used for storing real personal data.
- Resume selection currently stores only the filename locally; no PDF upload occurs until Supabase Storage is configured.
- Job records are sample data; scraping and AI matching are not connected.
- Application status and profile editing are preview interactions, not persisted backend features.
- Submission automation, queues, and status synchronization are not enabled.
- The database migrations have been authored but have not yet been applied to a live Supabase project.
- Build/deployment status must be confirmed from the hosting provider before treating the site as live.

## Security

Never expose a Supabase service-role key in browser code or `NEXT_PUBLIC_*` variables. Preserve user-scoped JWT and RLS boundaries for all worker operations. CAPTCHA and anti-bot blocks must enter Manual Assist Mode rather than being bypassed.
