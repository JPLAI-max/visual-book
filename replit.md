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
- Preserve the existing consumer frontend, player, navigation, styling, layout, and experience exactly. Do not redesign or add social features. New production review controls belong in the admin interface only.
- The media-production phase uses the saved Book Intelligence scene plan. Generate one Frankenstein chapter first, not the whole book. Use canonical references, a book-consistent narrator, reviewed scene versions, and separately stored compiled chapter renders. Keep individual scene assets and previous versions when replacing a scene.
- The initial Frankenstein production test used 1080p widescreen video and a USD 10 chapter generation cap. The builder explicitly approved raising the TOTAL cap to USD 20 for a separate directed comparison, including existing reservations, new references, shot images and reviews—not USD 20 additional.
- V1 uses controlled pans/zooms over approved illustrations. AI_VIDEO is optional, never a dependency for completing the chapter. Do not fake character animation or add unnatural movement merely to make an image move. PARALLAX requires real, approved separate layers.
- V1 should feel like a premium cinematic illustrated book/documentary. Use multiple shots/images within a scene when necessary, with restrained push-ins, pull-outs, pans, and reveals. Future AI video upgrades must replace only the selected scene's motion asset, preserving narration, captions, surrounding scenes, and the player/chapter structure.
- The chapter editor is admin-only and non-destructive. Shot decisions are metadata revisions; narration/caption assets and total scene narration duration stay fixed while adjacent shot boundaries can move. Local renders retain the source scene/shot structure, stay private until explicitly published, and never regenerate source images. MUSIC/SFX are future tracks; AI video needs approved real clips and parallax needs approved real foreground layers.
- Visual Director belongs inside the existing chapter editor; do not redesign the consumer frontend/player or change Ask AI. Directed proposals and image versions retain prior cuts. Narration, captions, total timing and surrounding shots are preserved during individual replacements; initial assembly must not overwrite a changed saved timeline. Chapter visual review must match the exact timeline being published.
- V1 cinematic motion is restrained camera movement over independent approved shots. Never fake character animation or assume a video provider. AI_VIDEO_RECOMMENDED is a recommendation, not an asset mode; unavailable video/parallax recommendations fall back to honest PAN_ZOOM until a real approved clip/foreground exists. Provider adapters must remain replaceable and upgrades per shot must not regenerate narration or surrounding scenes.
- Ask AI is a compact player interaction, not a separate chat experience. It pauses playback, freezes book/edition/chapter/scene/time context, uses approved chapter/source facts and objective answers, supports short follow-ups, and resumes at the frozen position. Guests can ask with bounded usage. Raw question history is opt-in; short-lived conversation context expires after 30 minutes. Aggregate topic/time clusters feed editorial improvement recommendations, not automatic regeneration.
- Local motion and assembled chapters use VP9/Opus WebM for compatibility with browsers that lack proprietary H.264/AAC codecs. Existing MP4 versions are retained. The player continues to consume standard video URLs without UI changes.
- Generation limits enforce configured conservative per-call reservations, including failed/uncertain calls. Distinguish these estimates from actual billing; retain unknown actual costs as NULL rather than implying a zero charge.

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

- Frankenstein retains its original three sample chapters and now has a separately published, reviewed 1080p production chapter: four scenes totaling 109.5 seconds. This is not a full-book adaptation.
- Book Intelligence ingests versioned full plain-text sources into private App Storage and checks SHA-256 integrity. Public-domain, platform-owned, licensed, and admin-entered sources require documented rights. Remote URLs are limited to HTTPS Gutenberg text; manuscripts are entered as plain text.
- Full-source analysis is split into validated overview, chapter detection, per-chapter analysis, character/environment bibles, themes, story/learning structure, per-chapter scene plans, visual style and narration bibles. Jobs persist separately from media-generation jobs and retry failed output with bounded backoff. No source characters are dropped; large chapters become clearly labeled source segments.
- Character extraction first saves a merged identity roster, then validates each detailed canonical character in its own job. Dependent structure/style/scene jobs wait for every character description. Runtime fields store seconds; provider rate limits use slower backoff instead of immediate repeated requests.
- Each blueprint gets a separate unpublished visual edition. It never edits the published sample chapters, media, progress, or library. Canonical characters and environments retain stable IDs referenced by planned scenes. Previous stage outputs stay in job history.
- The admin review page is `/admin/intelligence?bookId=1`. Targeted chapter, character, environment, and scene-plan revision avoids full-book reanalysis. Chapter revision also updates that chapter's scenes and flags unchanged edition-wide sections for manual review.
- Image, narration, and image-quality adapters are connected. Local controlled camera motion and chapter assembly use ffmpeg. AI_VIDEO remains optional and unconnected; full-book generation has not been attempted.
- Planning token usage is recorded. Actual provider billing remains unknown unless explicitly reported; do not present token-based estimates as actual charges.
- Subscription metadata and settings are prepared; billing and subscriber access enforcement are not connected.
- AI analysis consumes credits only after an explicit admin action (or the opt-in `intelligence-check.ts --full-book` verification script). The intelligence engine never invokes image, voice or video providers.