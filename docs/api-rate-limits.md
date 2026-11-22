# Authenticated API rate limits

The job discovery and Gmail import endpoints use the
`public.consume_user_api_rate_limit(text)` RPC before calling external providers.

| Bucket | Limit | Window |
| --- | ---: | ---: |
| `job_scan` | 3 requests | 60 seconds |
| `gmail_scan` | 2 requests | 60 seconds |

The quota and window are constants inside the database function. The caller supplies
only a whitelisted bucket name; it cannot submit a user ID, increase a quota, or
shorten a window. The function derives the tenant from `auth.uid()` and performs
an atomic upsert into `private.user_api_rate_limits`.

The counter table has RLS enabled and no browser or service-role table grants.
Only authenticated users can execute the RPC. The API routes fail closed with
HTTP 503 if the RPC errors or returns an invalid response, and return HTTP 429
with a `Retry-After` header when the per-user quota is exhausted.

## Verification

- `npm run typecheck`
- `npm run test:unit`
- Apply the migration to a disposable Supabase project, then call the RPC with
  two different authenticated test users. Verify that each user has an
  independent counter, the configured limit is enforced under concurrent
  requests, anonymous execution is denied, and direct table access is denied.

These controls are per authenticated user. They do not replace an edge/CDN
IP-level abuse limit, bot detection, provider budget alerts, or global spend
controls. Add those before broad public launch.
