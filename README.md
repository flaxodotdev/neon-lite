# Neon Lite

A local-first compatibility sandbox for testing apps against a tiny Neon-shaped API. It uses **PGlite**, PostgreSQL compiled to WebAssembly, for project branches, **SQLite** for Auth and control-plane metadata, local files for object storage, and lightweight in-process JavaScript handlers for function experiments.

> This is a local emulator, not a Neon replacement. It does not implement Neon compute autoscaling, pooled connections, logical replication, or full Neon API semantics. PGlite provides PostgreSQL SQL and types, but this setup is single-process and intended for development, not production or compatibility certification.

## Start without cloning

Requires Node 20+. After the package is published, create a project and start the local service in one command:

```sh
npx -y neon-lite@latest init demo
```

Or install the command globally once, then use it whenever you need:

```sh
npm install -g neon-lite
neon-lite init demo
```

`init` creates a PostgreSQL project, prints its HTTP SQL endpoint, PostgreSQL connection URL and API key, then starts the service on `http://localhost:8787`. Press Ctrl+C to stop it. Data persists under `~/.neon-lite/data` by default.

To add more projects to the same local instance, run `neon-lite create another-app`. It prints a new endpoint and key. Run `neon-lite projects` to list them, and `neon-lite start` to start the service separately. Use `--port 9090`, `--data-dir PATH`, or `--home PATH` to customize it. The API key is shown only at creation; save it somewhere safe.

For local development from this repository, Node 20+ and native build tooling for `better-sqlite3` are required:

```sh
npm install
npm run dev
```

The server's `/health` endpoint does not require authentication. Set `BETTER_AUTH_SECRET` before exposing the server beyond localhost. New local accounts can register via Better Auth's email/password API (`POST /api/auth/sign-up/email`).

## API key and app setup

Sign in and create an API key using your Better Auth session cookie:

```sh
curl -X POST http://localhost:8787/api/v2/api-keys \
  -H 'content-type: application/json' -b 'your-session-cookie' \
  -d '{"name":"my local app"}'
```

Save `api_key.key` when returned: it is shown once and only its SHA-256 digest is stored. The key can be used as a bearer token for API requests. Keys are local emulator credentials, not Neon cloud keys.

```sh
curl -X POST http://localhost:8787/api/v2/projects \
  -H "authorization: Bearer $NEON_LITE_API_KEY" \
  -H 'content-type: application/json' -d '{"project":{"name":"demo"}}'
```

Implemented control-plane subset:

- `GET/POST /api/v2/projects`
- `GET/POST /api/v2/projects/:projectId/branches` (branch creation snapshots the current `main` database)
- `GET /api/v2/projects/:projectId/endpoints`
- `GET/POST/DELETE /api/v2/api-keys`
- Better Auth endpoints at `/api/auth/*`

Project responses contain a branch ID. Send SQL to the branch endpoint:

```sh
curl -X POST "http://localhost:8787/sql/$BRANCH_ID" \
  -H "authorization: Bearer $NEON_LITE_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"query":"select 1 as ok","params":[]}'
```

The default SQL response is a JSON array of row objects, matching the common Neon serverless HTTP query result shape. Add `?neon_lite_meta=true` for `{rows,rowCount,command}`. URL-encoded GET `?query=...` is also supported. Parameter placeholders follow PostgreSQL (`$1`, `$2`). One statement per request. The endpoints API also provides `connection_uri` values for PostgreSQL wire-protocol clients such as `pg`.

## Local extras

- **Objects:** authenticated `PUT/GET/DELETE /storage/:key` stores arbitrary bytes below `data/objects`. Keys are relative paths; traversal segments are discarded.
- **Functions:** authenticated `POST /functions` with `{project_id,name,source}` registers a simple JavaScript body. Invoke with `POST /functions/:id/invoke` and JSON input; source receives `input` and may `return` a value. This uses Node's VM as a convenience boundary, **not a security sandbox**. Never run untrusted function code or expose this service to the internet.

## Compatibility and security notes

- This offers a compact subset, not drop-in equivalence. It provides PostgreSQL semantics through PGlite and a local TCP endpoint for PostgreSQL clients. It does not provide Neon serverless driver-specific transport, Neon extensions, pooling, or full control-plane semantics. The TCP endpoint has limited connection concurrency and is not meant for production loads.
- Better Auth and API-key auth are local. Set a strong secret and keep this bound to localhost. There is no rate limiting, multi-user sharing, migrations, backups, or admin console yet.
- Existing SQLite branch databases are migrated to PGlite on first access. Their original SQLite file is retained. Migration supports common tables, indexes and views, but is not guaranteed for SQLite-specific SQL features.
- Branch creation snapshots the source database, not copy-on-write Neon branching. Avoid creating a branch while writes are actively occurring.
- The local function runner is intentionally experimental; VM timeouts do not make arbitrary code safe.
