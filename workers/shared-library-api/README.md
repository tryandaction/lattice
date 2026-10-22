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
