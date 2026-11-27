# BullMQ worker operations

## Runtime entry point

Run `npm run worker` on a dedicated long-lived Node.js worker host (for example, a container service). A Vercel Next.js deployment does not keep a BullMQ process alive; do not treat a successful web build as worker availability.

The repository has typed BullMQ queues in `src/lib/queues/queues.ts`, strict Zod payload contracts in `src/lib/queues/contracts.ts`, tenant-scoped idempotency in `src/lib/workers/idempotency.ts`, API ingress in `src/lib/queues/enqueue.ts`, and the worker runtime in `src/lib/workers/runtime.ts`.

`npm run worker` starts `src/workers/main.ts`. Unless an operator explicitly sets `WORKER_HANDLER_MODULE`, the runtime loads the built-in `src/workers/handlers.ts` module.

## Health probes

The worker exposes two minimal HTTP probes from `src/workers/health-server.ts`:

- `GET /live` returns 200 while the Node.js process and health server are responsive.
- `GET /ready` returns 200 only after all three BullMQ workers have connected to Redis and are running; it returns 503 during startup, when a worker is paused/stopped, or after graceful shutdown begins.

The response contains only a generic status and never includes tenant IDs, queue payloads, environment values, provider errors, or credentials. The default port is `8080`; `WORKER_HEALTH_PORT` and `WORKER_HEALTH_HOST` can override it. Bind the health listener to the container's private network and do not publish it as a public application endpoint.

The process waits for all BullMQ workers to become ready before opening the health listener. On SIGTERM/SIGINT it marks readiness false first, drains the worker runtime, and then closes the health listener.

## Worker handlers

- **Scraper:** uses the shared Tavily adapter in `src/lib/jobs/tavily.ts`, also used by the authenticated job-scan API. It searches only the selected public source group, validates provider output with Zod, normalizes public HTTP(S) result URLs, deduplicates by tenant-owned `source_url`, and inserts jobs through the user's JWT/RLS context.
- **AI processing:** loads the specified job, resume, and profile with `user_id` filters; sends bounded text to the OpenAI Chat Completions API; treats resume/job text as untrusted data; validates structured output with Zod; and stores match analysis on the user's application. `tailor_resume` currently stores truthful tailored bullet suggestions and a cover letter; it does **not** generate a PDF yet.
- **Submission:** requires an approved application. If no trusted `SUBMISSION_ADAPTER_MODULE` is configured, the handler deliberately switches to Manual Assist and does not attempt browser automation. A configured adapter must export `submitApplication({ supabase, userId, applicationId, idempotencyKey, signal })` and return `{ submitted: true, externalApplicationId? }` only after the external site confirms success. The stable idempotency key must be honored by the adapter. CAPTCHA, anti-bot blocks, expired login states, and ambiguous network outcomes stop automation and are converted to Manual Assist; no bypass or solver is allowed.
- **Ambiguous submission timeout:** a BullMQ timeout never schedules another automated submission attempt. The worker checks the tenant-owned application state: if the database already confirms `submitted`, it reconciles the worker operation as completed; otherwise it persists Manual Assist with an explicit instruction to verify the employer-side status before submitting again. A late adapter response is rejected after its AbortSignal fires and cannot overwrite the Manual Assist state. If the fallback cannot be persisted, the job is made unrecoverable and written to the dead-letter queue rather than retried. Adapters must honor the supplied AbortSignal; they must not launch detached background work.

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
- `WORKER_HEALTH_PORT` — defaults to `8080`.
- `WORKER_HEALTH_HOST` — defaults to `0.0.0.0`; restrict access at the container/network layer.

The worker host must use a narrowly scoped AWS workload identity that can read and rotate secrets only under the configured Secrets Manager prefix. It must not receive a Supabase service-role key.

### One-time local provisioning only

The operator workstation running `npm run worker:provision` additionally requires:

- `SUPABASE_SERVICE_ROLE_KEY`
- `WORKER_USER_ID`
- `TOKEN_VAULT_KMS_KEY_ID` (optional)
- the Supabase URL/publishable key and AWS settings above.

The service-role credential is used only by this local control-plane script for Auth Admin session creation, the short-lived provisioning lock, and registration/rollback of the dedicated `worker_sessions` row. It is never used by the BullMQ runtime to read or write jobs, resumes, applications, or execution logs. Do not add it to Vercel client variables or the worker host.

## Provisioning sequence

1. The connected Supabase project reports this repair as already applied under migration version `20261122141617` (`repair_worker_context_rpc_private_helper`). The repository migration filename is aligned to that exact version. Do not apply a second copy to the connected Production project. For a different environment, apply this migration once and verify `worker_current_context()` and `claim_worker_operation()` under an authenticated worker JWT.
2. Configure Supabase Authentication → Hooks → Custom Access Token Hook to call `public.custom_access_token_hook`.
3. Put provisioning-only secrets in an untracked local `.env.local`.
4. Run `npm run worker:provision`. The script creates a separate Auth session, binds its exact `session_id` to the database row and Secrets Manager record, refreshes to receive the worker claim, sets `provisioned_at`, and verifies the tenant context.
5. Start the worker host with Redis and the restricted AWS workload identity.

## Security and operations

- Queue payloads contain only tenant IDs, operation IDs, an opaque vault reference, and task-specific identifiers. Raw access/refresh tokens and service-role credentials never enter Redis, logs, traces, or metrics.
- Every queue payload is revalidated at the worker boundary. The worker verifies Supabase Auth identity and `worker_current_context()` before claiming an operation.
- All database writes use the short-lived user JWT and RLS. The worker never uses service-role for tenant data.
- Retries are bounded with exponential backoff and jitter. Workers have per-queue concurrency/rate limits, timeouts, stalled-job handling, graceful shutdown, and dead-letter recording. Handler Supabase HTTP requests inherit the per-attempt timeout AbortSignal; run the dedicated worker on Node.js 20.3 or newer.
- Resume files remain in the private `resumes` bucket. Manual Assist stores the tenant-owned PDF object path and direct application URL. The authenticated `POST /api/applications/:id/manual-assist-resume` endpoint issues a 60-second signed download URL after ownership verification.
- External job-site content is treated as untrusted data. The AI prompt explicitly forbids following instructions embedded in job descriptions or resumes.

## Verification

Run:

```bash
npm run typecheck
npm run test:unit
npm run build
```

Run database integration tests only against an isolated Supabase project with two test users and the Custom Access Token Hook enabled. This code branch does not apply changes to Production; the worker RPC repair is already recorded in the connected Production Supabase migration history as version `20261122141617`. Redis/AWS/AI provider end-to-end processing still requires separately provisioned infrastructure and credentials.

### Tenant RLS integration test

`tests/integration/worker-rls.integration.test.ts` requires an isolated Supabase test project, an explicit matching `SUPABASE_TEST_PROJECT_ID`, and two distinct valid user access tokens in `TEST_USER_A_ACCESS_TOKEN` and `TEST_USER_B_ACCESS_TOKEN`. It refuses to run against the connected Production project ref. It uploads a temporary PDF under user A, confirms user B cannot read, update, delete, or download the resume row/object, and cleans up through the owner's JWT. The live database's composite application/job and application/resume foreign keys were separately verified to include `user_id`. The integration test is intentionally excluded from the default unit-test command and must never be pointed at Production.


## Authenticated queue ingress API

`POST /api/worker-queues` accepts one strict Zod-discriminated request for `scraper-queue`, `ai-processing-queue`, or `submission-queue`. It returns HTTP 202 with a queue name, BullMQ job ID, and operation ID after Redis accepts the job.

Example request bodies:

```json
{ "queue": "scraper-queue", "source": "alljobs", "searchProfileVersion": 1, "runKey": "manual-run-2026-11" }
{ "queue": "ai-processing-queue", "jobId": "20000000-0000-4000-8000-000000000002", "resumeId": "30000000-0000-4000-8000-000000000003", "mode": "match" }
{ "queue": "submission-queue", "applicationId": "40000000-0000-4000-8000-000000000004" }
```

The route derives `userId` from the verified Supabase session. It rejects caller-supplied `userId`, operation IDs, idempotency keys, token-vault references, access/refresh tokens, and unknown fields. Enqueue helpers repeat strict payload parsing, require a non-revoked and provisioned worker session, and verify that AI job/resume or submission application records belong to the authenticated user before adding a job.

A missing or incomplete worker session returns HTTP 409. Redis/configuration failures return a generic HTTP 503 without exposing provider or connection details. The route enforces same-origin JSON requests and a streamed 32 KiB body limit. The existing `POST /api/jobs/scan` route remains synchronous; this new endpoint is the explicit BullMQ ingress and should be used by an async UI flow only after Redis and a dedicated worker host are configured.
