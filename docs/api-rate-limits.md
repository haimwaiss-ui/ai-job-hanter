# Authenticated API rate limits

The job discovery and Gmail import endpoints use the
`public.consume_user_api_rate_limit(text)` RPC before calling external providers.

| Bucket | Limit | Window |
| --- | ---: | ---: |
| `job_scan` | 3 requests | 60 seconds |
| `gmail_scan` | 2 requests | 60 seconds |

These are fixed-window quotas. The quota and window are constants inside the
database function. The caller supplies only a whitelisted bucket name; it
cannot submit a user ID, increase a quota, or shorten a window. The function
derives the tenant from `auth.uid()` and performs an atomic upsert into
`private.user_api_rate_limits`. The stored request count saturates at
`limit + 1`, so repeated rejected requests do not grow the counter indefinitely.

The counter table has RLS enabled and no browser or service-role table grants.
Only authenticated users can execute the RPC. The API routes fail closed with
HTTP 503 if the RPC errors or returns an invalid response, and return HTTP 429
with a `Retry-After` header when the per-user quota is exhausted.

## Unit and static SQL verification

Run:

```bash
npm run typecheck
npm run test:unit
```

The unit tests validate the RPC response parser. Static SQL tests assert
`auth.uid()` tenant binding, fixed quotas, a pinned `SECURITY DEFINER`
search path, restricted table grants, and the bounded counter.

## Two-tenant concurrency integration test

Run this only against a disposable Supabase project with two dedicated test
users that are not used by the live app. Configure:

- `SUPABASE_URL` and `SUPABASE_ANON_KEY` (or the corresponding
  `NEXT_PUBLIC_*` values) for the disposable project.
- `SUPABASE_TEST_PROJECT_ID`, which must exactly match the project ref in
  the URL.
- `TEST_USER_A_ACCESS_TOKEN` and `TEST_USER_B_ACCESS_TOKEN`, two distinct
  authenticated user access tokens from that disposable project.

Then run:

```bash
npm run test:integration
```

The integration suite refuses to run when the configured project ref is the
connected Production project. It verifies that concurrent requests cannot
exceed the per-user quota, that a second tenant has an independent counter,
that the Gmail bucket has its own quota, and that anonymous RPC execution is
denied. It waits for an existing fixed window to expire when necessary, so use
dedicated test accounts and allow up to 75 seconds per concurrency test.

These controls are per authenticated user. They do not replace an edge/CDN
IP-level abuse limit, bot detection, provider budget alerts, or global spend
controls. Add those before broad public launch.
