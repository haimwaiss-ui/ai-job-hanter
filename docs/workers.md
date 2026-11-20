# BullMQ worker operations

## Existing architecture

The repository already defines the typed queues in `src/lib/queues/queues.ts`, strict Zod payload contracts in `src/lib/queues/contracts.ts`, tenant-scoped idempotency in `src/lib/workers/idempotency.ts`, queue ingress in `src/lib/queues/enqueue.ts`, and the BullMQ runtime in `src/lib/workers/runtime.ts`.

The runtime re-validates every payload, resolves a short-lived user JWT from AWS Secrets Manager, verifies Supabase Auth identity and `worker_current_context()`, claims a tenant-scoped operation, and writes `execution_logs` through that same user-scoped client. Redis must contain only opaque identifiers and job metadata, never access tokens, refresh tokens, service-role credentials, or vault secrets.

## One-time user worker-session provisioning

1. In Supabase Dashboard, configure **Authentication → Hooks → Custom Access Token Hook** to invoke `public.custom_access_token_hook`.
2. On a trusted operator workstation, authenticate the AWS SDK with an IAM identity scoped to the configured Secrets Manager prefix.
3. Put these values in a local, untracked `.env.local`:
   - `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_ANON_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (one-time provisioning control plane only)
   - `WORKER_USER_ID` (the verified user's UUID)
   - `AWS_REGION`
   - `TOKEN_VAULT_SECRET_PREFIX`
   - optionally `TOKEN_VAULT_KMS_KEY_ID`
4. Run `npm run worker:provision`.
5. The script uses an expiring per-user provisioning lease, creates a separate Auth session through Supabase Admin `generateLink` and `verifyOtp`, registers the exact Auth `session_id`, refreshes to obtain the worker claim, writes the complete vault record, sets `provisioned_at`, and verifies the user ID and database worker context. It is idempotent for a valid existing registration and attempts rollback/secret cleanup on failure.

**Service-role boundary:** the service-role key is used only by this local, operator-controlled provisioning script for the provisioning lock, Auth Admin operation, and `worker_sessions` registration/rollback. It is not imported by `src/lib/workers/**`, is not placed on the worker host, and must never be used to access user job/resume/application data. All queue execution continues through the user's short-lived JWT and RLS.

## Worker host configuration

The dedicated worker host needs:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `REDIS_URL`
- `AWS_REGION`
- `TOKEN_VAULT_SECRET_PREFIX`
- `WORKER_HANDLER_MODULE` pointing to a trusted module exporting `createWorkerHandlers()`

Its AWS workload identity should have only the Secrets Manager read/refresh permissions required for the configured prefix. It must not receive `SUPABASE_SERVICE_ROLE_KEY`. The runtime also expects a real handler module; do not start it with placeholder or untrusted adapters.

## Queue behavior

- Queues: `scraper-queue`, `ai-processing-queue`, `submission-queue`, plus the internal `dead-letter-queue`.
- Payload schemas are strict and reject unexpected credential fields.
- Job IDs and operation claims are tenant-scoped and deterministic.
- Retries are bounded with exponential backoff and jitter; worker concurrency, provider rate limits, lock durations, stalled-job recovery, and graceful shutdown are configured in `src/lib/workers/runtime.ts`.
- Terminal failures are written to the dead-letter queue and tenant-scoped `execution_logs`.
- CAPTCHA, anti-bot/site blocks, and expired authentication stop automated submission and switch the application to Manual Assist Mode. No CAPTCHA-solving or bypass adapter is permitted.
- Manual Assist retains the direct application URL and private PDF Storage path. Generate a signed PDF download URL only after a user-scoped ownership check.

## Verification

Run:

```bash
npm run db:types
npm run typecheck
npm run test:unit
npm run build
```

Database integration tests require an isolated Supabase project with two test users and the custom token hook enabled. Do not use Production for tests that create or mutate worker sessions. A concrete `createWorkerHandlers()` implementation and a separately configured Redis/AWS worker host are still required before end-to-end queue processing can be verified.
