# Lattice Shared Library API Worker

This Worker is the deployable `/v1` facade used by `RemoteRepository`. It forwards the user's bearer JWT and the public Supabase anon key to PostgREST, so Supabase RLS remains the source of authorization truth.

Required environment values:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
ALLOWED_ORIGINS=https://lattice-apq.pages.dev,http://127.0.0.1:3000
# Optional R2 binding: LIBRARY_BLOBS
# Optional upload limit in bytes: MAX_UPLOAD_BYTES=104857600
# Supabase private Storage instead of R2: BLOB_BACKEND=supabase
# Supabase negotiates one whole-object part, at most MAX_UPLOAD_BYTES=20971520
```

Local smoke:

```powershell
npx wrangler dev --config workers/shared-library-api/wrangler.toml
```

Deployment is intentionally separate from the app build and requires explicit production authorization. Do not put a Supabase service-role key in the browser or in `wrangler.toml` committed to the repository.

Implemented routes:

- `GET/POST /v1/libraries`
- `GET /v1/libraries/:libraryId`
- `GET/POST /v1/libraries/:libraryId/items`
- `GET/PATCH/DELETE /v1/items/:itemId`
- `POST /v1/items/:itemId/restore`
- `GET/POST /v1/items/:itemId/children`
- `GET/POST /v1/items/:itemId/versions`
- `GET/POST /v1/items/:itemId/annotations`
- `GET/POST /v1/annotations/:annotationId/comments`
- `PATCH/DELETE /v1/comments/:commentId`
- `GET /v1/search` and `GET /v1/libraries/:libraryId/search`
- `POST /v1/libraries/:libraryId/uploads`
- `PUT /v1/libraries/:libraryId/uploads/:uploadId/parts/:partNumber`
- `POST /v1/libraries/:libraryId/uploads/:uploadId/complete|abort`
- `POST /v1/libraries/:libraryId/uploads/cleanup` (expired Supabase sessions)
- `GET /v1/libraries/:libraryId/health` (admin/owner, schema/bucket/capacity)
- `GET /v1/libraries/:libraryId/blobs/:blobId/download-url|content`
- `GET/POST /v1/libraries/:libraryId/sync/pull|push`

Choose either `BLOB_BACKEND=supabase` with the private Storage migrations,
or an enabled `LIBRARY_BLOBS` R2 binding. The default local preparation script uses
Supabase Storage without R2 and advertises an exact 20MiB limit. The API returns a
durable `partSize` equal to the whole object; clients must use it and retain it
with their outbox. Interrupted transport retries the object, and duplicate
Storage writes are accepted only after size/SHA-256 readback. This does not
provide TUS byte-offset resumption. The Worker forwards the user JWT for Storage RLS,
verifies persisted size/SHA-256, and atomically registers Supabase blob metadata.
Expired upload capacity is released only after authenticated Storage API cleanup
and database confirmation. See [deployment and limits](../../docs/operations/supabase-library-storage.md).

## Team AI

Apply `202610270001_cloud_team_ai.sql` and `202610280001_cloud_team_ai_owner_config.sql`
before enabling team AI. Configure `TEAM_AI_ENCRYPTION_KEY` as a Worker/Edge
Function secret. This is a random 32-byte AES-256 key owned by the deployment,
not a model API key. `TEAM_AI_PROVIDERS_JSON` remains an optional legacy mode;
the normal product flow lets a library owner/admin configure the team's provider,
endpoint, models, API key and limits inside Lattice.

Never use `NEXT_PUBLIC_` variables for server secrets or include encrypted values
in browser responses. A library provider key is encrypted with AES-GCM and bound
to the library/provider identity. Members receive only provider metadata.

The legacy deployment-only provider shape is retained for existing installations:

~~~json
[
  {
    "id": "team",
    "label": "Team model",
    "baseUrl": "https://approved-provider.example.com/v1",
    "apiKey": "REPLACE_WITH_WORKER_SECRET",
    "models": ["approved-model"],
    "maxOutputTokens": 1024,
    "requestBudgetUsdMicros": 10000
  }
]
~~~

Routes are GET /v1/libraries/:libraryId/ai/providers and
POST /v1/libraries/:libraryId/ai/chat. Only configured provider URLs and models
are accepted. Upstreams require HTTPS, a public DNS hostname and no credentials,
query, fragment or custom port; redirects fail closed. Clients cannot supply
URLs, headers, keys or tools. This release supports non-streaming text chat:
at most 64 messages, 65,536 total message characters, 128 KiB JSON request and
response bodies, and 8,192 output tokens, further restricted by each provider
and library. Provider descriptors contain only id, label, models and maxOutputTokens.

The normal user-configured flow creates/updates the library policy through the
owner/admin-only `/v1/libraries/:libraryId/ai/config` route. Missing or disabled
policies deny chat; regular members cannot edit the policy or read provider keys.
The service-role credential and `TEAM_AI_ENCRYPTION_KEY` remain restricted to the
trusted Worker/Edge Function. Legacy deployment-managed providers may continue
to use an explicitly provisioned policy row.

Before each paid request the Worker validates the caller through Supabase Auth,
checks active library membership, then invokes the service-role-only
cloud_reserve_ai_request RPC. The RPC rechecks membership and policy under a
library transaction lock and records one immutable request allocation. Daily
request and monthly budget periods use UTC. requestBudgetUsdMicros is a fixed
conservative allocation for each attempt, **not measured invoice cost**; set it
at least as high as the provider's worst-case cost for the allowed input/output
limits and revisit it when pricing changes. One dollar is 1,000,000 microdollars.
Allocations remain consumed after provider errors or timeouts because billing
may already have occurred. No automatic retries or refunds occur in the Worker.

Chat accepts {providerId, model, messages, maxTokens?, temperature?} and returns
{providerId, model, content, usage, reservationId}. Usage exposes only numeric
promptTokens, completionTokens and totalTokens when provided upstream. Errors
use the existing stable envelope without upstream bodies, URLs, credentials or
raw exception text. A missing budget migration/configuration fails closed.
