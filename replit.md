# Folio — Visual Books

Folio makes visual books as simple as search → book → chapters → play → stop → resume.

## Product scope and standing requirements

- Keep the reader experience quiet and Kindle-simple. Exact search placeholder: **What book do you want to see?**
- No social feed, autoplay banners, noisy carousels, gaming aesthetics, or futuristic gradients.
- Start with public-domain Frankenstein and clearly labeled sample media, not expensive full-book generation.
- Editions are generated once and reused. Searching or requesting a title must never start paid generation.
- Generation requires documented public-domain, owned, or explicitly licensed rights plus an editorial action.
- Preserve scene versions. Replacements and rollback are manual editorial decisions, never automatic.
- Future licensing is prepared through metadata. Author/publisher portals, royalty payments, mobile apps and complicated billing are out of scope.

## Run and operate

- Frontend: `pnpm --filter @workspace/folio run dev`.
- Backend: `pnpm --filter @workspace/api-server run dev`.
- Full typecheck: `pnpm run typecheck`.
- API regeneration: `pnpm --filter @workspace/api-spec run codegen`.
- Development schema changes: `pnpm --filter @workspace/db run push`.
- Initial sample seed: `pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/scripts/seed.ts`. Requires the six narration files under `attached_assets/narration` and configured App Storage. Does not overwrite an existing catalog.
- Authentication uses Replit-managed Clerk. **There is no first-signup-admin shortcut.** An administrator must have `publicMetadata.role: "admin"` in Clerk, or a user ID explicitly included in the server's `ADMIN_USER_IDS` environment variable.

## Stack and source of truth

- React/Vite frontend under `artifacts/folio`.
- Express 5 backend under `artifacts/api-server`; PostgreSQL/Drizzle schema under `lib/db`.
- API contracts in `lib/api-spec/openapi.yaml`, with generated clients and Zod validation.
- Narration and captions live in App Storage; the database stores asset references, not media bytes.

## Current limitations

- Frankenstein has three short sample chapters: editorial illustrations with original explanatory narration, not a finished film or complete adaptation.
- Text planning is a durable server-side queue that analyzes a limited Gutenberg excerpt. It is explicitly **not** a full-book analysis. Only the seeded source URLs are currently configured.
- Runtime image, video and voice adapters are not connected. The provider interfaces are prepared, but the app cannot generate a full visual book yet.
- Planning token usage is recorded. Actual provider billing remains unknown unless explicitly reported; do not present token-based estimates as actual charges.
- Subscription metadata and settings are prepared; billing and subscriber access enforcement are not connected.
- AI planning consumes credits only after an administrator queues it. Pause cannot undo a provider request already underway; completed results are retained for resume.