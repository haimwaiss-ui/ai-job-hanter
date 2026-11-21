# BullMQ worker operations

## Runtime entry point

Run `npm run worker` on a dedicated long-lived Node.js worker host (for example, a container service). A Vercel Next.js deployment does not keep a BullMQ process alive; do not treat a successful web build as worker availability.

The repository has typed BullMQ queues in `src/lib/queues/queues.ts`, strict Zod payload contracts in `src/lib/queues/contracts.ts`, tenant-scoped idempotency in `src/lib/workers/idempotency.ts`, API ingress in `src/lib/queues/enqueue.ts`, and the worker runtime in `src/lib/workers/runtime.ts`.

`npm run worker` starts `src/workers/main.ts`. Unless an operator explicitly sets `WORKER_HANDLER_MODULE`, the runtime loads the built-in `src/workers/handlers.ts` module.

## Worker handlers

- **Scraper:** uses the shared Tavily adapter in `src/lib/jobs/tavily.ts`, also used by the authenticated job-scan API. It searches only the selected public source group, validates provider output with Zod, normalizes public HTTP(S) result URLs, deduplicates by tenant-owned `source_url`, and inserts jobs through the user's JWT/RLS context.
- **AI processing:** loads the specified job, resume, and profile with `user_id` filters; sends bounded text to the OpenAI Chat Completions API; treats resume/job text as untrusted data; validates structured output with Zod; and stores match analysis on the user's application. `tailor_resume` currently stores truthful tailored bullet suggestions and a cover letter; it does **not** generate a PDF yet.
- **Submission:** requires an approved application. If no trusted `SUBMISSION_ADAPTER_MODULE` is configured, the handler deliberately switches to Manual Assist and does not attempt browser automation. A configured adapter must export `submitApplication({ supabase, userId, applicationId, idempotencyKey, signal })` and return `{ submitted: true, externalApplicationId? }` only after the external site confirms success. The stable idempotency key must be honored by the adapter. CAPTCHA, anti-bot blocks, expired login states, and ambiguous network outcomes stop automation and are converted to Manual Assist; no bypass or solver is allowed.

## Required environment

### Dedicated worker host only

- `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`)
- `SUPABASE_ANON_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
- `REDIS_URL`
- `AWS_REGION`
- `TOKEN_VAULT_SECRET_PREFIX`
- `TAVILY_API_KEY`
- `OPENAI_API_KEY` and optionally `OPENAI_MODEL`

Optional trusted operator settings:

- `WORKER_HANDLER_MODULE` — defaults to `src/workers/handlers.ts`.
- `SUBMISSION_ADAPTER_MODULE` — absolute path to an operator-reviewed adapter. Leave unset to force Manual Assist.

The worker host must use a narrowly scoped AWS workload identity that can read and rotate secrets only under the configured Secrets Manager prefix. It must not receive a Supabase service-role key.

### One-time local provisioning only

The operator workstation running `npm run worker:provision` additionally requires:

- `SUPABASE_SERVICE_ROLE_KEY`
- `WORKER_USER_ID`
- `TOKEN_VAULT_KMS_KEY_ID` (optional)
- the Supabase URL/publishable key and AWS settings above.

The service-role credential is used only by this local control-plane script for Auth Admin session creation, the short-lived provisioning lock, and registration/rollback of the dedicated `worker_sessions` row. It is never used by the BullMQ runtime to read or write jobs, resumes, applications, or execution logs. Do not add it to Vercel client variables or the worker host.

## Provisioning sequence

1. Apply and verify `supabase/migrations/20261121162000_repair_worker_context_rpc_private_helper.sql` after reviewing the live migration history.
2. Configure Supabase Authentication → Hooks → Custom Access Token Hook to call `public.custom_access_token_hook`.
3. Put provisioning-only secrets in an untracked local `.env.local`.
4. Run `npm run worker:provision`. The script creates a separate Auth session, binds its exact `session_id` to the database row and Secrets Manager record, refreshes to receive the worker claim, sets `provisioned_at`, and verifies the tenant context.
5. Start the worker host with Redis and the restricted AWS workload identity.

## Security and operations

- Queue payloads contain only tenant IDs, operation IDs, an opaque vault reference, and task-specific identifiers. Raw access/refresh tokens and service-role credentials never enter Redis, logs, traces, or metrics.
- Every queue payload is revalidated at the worker boundary. The worker verifies Supabase Auth identity and `worker_current_context()` before claiming an operation.
- All database writes use the short-lived user JWT and RLS. The worker never uses service-role for tenant data.
- Retries are bounded with exponential backoff and jitter. Workers have per-queue concurrency/rate limits, timeouts, stalled-job handling, graceful shutdown, and dead-letter recording.
- Resume files remain in the private `resumes` bucket. Manual Assist stores the tenant-owned PDF object path and direct application URL. The authenticated `POST /api/applications/:id/manual-assist-resume` endpoint issues a 60-second signed download URL after ownership verification.
- External job-site content is treated as untrusted data. The AI prompt explicitly forbids following instructions embedded in job descriptions or resumes.

## Verification

Run:

```bash
npm run typecheck
npm run test:unit
npm run build
```

Run database integration tests only against an isolated Supabase project with two test users and the Custom Access Token Hook enabled. The live Production database was not changed by this code branch. Redis/AWS/AI provider end-to-end processing still requires separately provisioned infrastructure and credentials.

### Tenant RLS integration test

`tests/integration/worker-rls.integration.test.ts` requires an isolated Supabase test project, an explicit matching `SUPABASE_TEST_PROJECT_ID`, and two distinct valid user access tokens in `TEST_USER_A_ACCESS_TOKEN` and `TEST_USER_B_ACCESS_TOKEN`. It refuses to run against the connected Production project ref. It creates one temporary activity event under user A, confirms user B cannot read, update, or delete it, and cleans up through the owner's JWT. The live database's composite application/job and application/resume foreign keys were separately verified to include `user_id`. The integration test is intentionally excluded from the default unit-test command and must never be pointed at Production.
