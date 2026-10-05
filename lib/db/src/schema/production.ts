import { pgTable, serial, integer, text, jsonb, doublePrecision, timestamp, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { books, chapters, editions } from "./catalog";
import { bookAnalyses, intelligenceChapters, intelligenceScenes } from "./intelligence";
const created = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
export const mediaProductions = pgTable("media_productions", {
  id: serial("id").primaryKey(), bookId: integer("book_id").notNull().references(() => books.id),
  analysisId: integer("analysis_id").notNull().references(() => bookAnalyses.id),
  blueprintChapterId: integer("blueprint_chapter_id").notNull().references(() => intelligenceChapters.id),
  editionId: integer("edition_id").notNull().references(() => editions.id),
  chapterId: integer("chapter_id").notNull().references(() => chapters.id),
  status: text("status").notNull().default("references"), maxSpend: doublePrecision("max_spend").notNull().default(10),
  reservedSpend: doublePrecision("reserved_spend").notNull().default(0),
  configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: created(),
}, t => [uniqueIndex("production_blueprint_chapter_unique").on(t.blueprintChapterId)]);
export const mediaReferences = pgTable("media_references", {
  id: serial("id").primaryKey(), productionId: integer("production_id").notNull().references(() => mediaProductions.id),
  kind: text("kind").notNull(), canonicalId: integer("canonical_id").notNull(), name: text("name").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}), status: text("status").notNull().default("queued"),
  currentAssetId: integer("current_asset_id"), qualityScore: doublePrecision("quality_score"),
  createdAt: created(),
}, t => [uniqueIndex("production_reference_unique").on(t.productionId, t.kind, t.canonicalId)]);
export const mediaProductionScenes = pgTable("media_production_scenes", {
  id: serial("id").primaryKey(), productionId: integer("production_id").notNull().references(() => mediaProductions.id),
  blueprintSceneId: integer("blueprint_scene_id").notNull().references(() => intelligenceScenes.id),
  playbackSceneId: integer("playback_scene_id").notNull(),
  number: integer("scene_number").notNull(), data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  currentVersionId: integer("current_version_id"), createdAt: created(),
});
export const mediaSceneTakes = pgTable("media_scene_takes", {
  id: serial("id").primaryKey(), sceneId: integer("scene_id").notNull().references(() => mediaProductionScenes.id),
  number: integer("version_number").notNull(), status: text("status").notNull().default("generating"),
  motionType: text("motion_type").notNull().default("PAN_ZOOM"), prompt: text("prompt").notNull().default(""),
  negativePrompt: text("negative_prompt").notNull().default(""), narration: text("narration").notNull(),
  imageAssetId: integer("image_asset_id"), audioAssetId: integer("audio_asset_id"), videoAssetId: integer("video_asset_id"),
  captionAssetId: integer("caption_asset_id"), imageApproved: boolean("image_approved").notNull().default(false),
  qualityScore: doublePrecision("quality_score"), quality: jsonb("quality").$type<Record<string, unknown>>().notNull().default({}),
  duration: doublePrecision("duration").notNull().default(0),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}), createdAt: created(),
}, t => [uniqueIndex("scene_take_number_unique").on(t.sceneId, t.number)]);
export const mediaProductionAssets = pgTable("media_production_assets", {
  id: serial("id").primaryKey(), productionId: integer("production_id").notNull().references(() => mediaProductions.id),
  takeId: integer("take_id").references(() => mediaSceneTakes.id), referenceId: integer("reference_id").references(() => mediaReferences.id),
  kind: text("kind").notNull(), objectPath: text("object_path").notNull(), mimeType: text("mime_type").notNull(),
  provider: text("provider").notNull(), model: text("model").notNull(),
  cost: doublePrecision("cost"), metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: created(),
});
export const mediaProductionRequests = pgTable("media_production_requests", {
  id: serial("id").primaryKey(), productionId: integer("production_id").notNull().references(() => mediaProductions.id),
  takeId: integer("take_id"), referenceId: integer("reference_id"), kind: text("kind").notNull(),
  provider: text("provider").notNull(), model: text("model").notNull(), estimatedCost: doublePrecision("estimated_cost").notNull(),
  actualCost: doublePrecision("actual_cost"), status: text("status").notNull().default("reserved"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}), createdAt: created(),
});
export const mediaProductionJobs = pgTable("media_production_jobs", {
  id: serial("id").primaryKey(), productionId: integer("production_id").notNull().references(() => mediaProductions.id),
  stage: text("stage").notNull(), targetId: integer("target_id"), status: text("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0), dependencies: jsonb("dependencies").$type<number[]>().notNull().default([]),
  error: text("error"), leaseUntil: timestamp("lease_until", { withTimezone: true }), retryAt: timestamp("retry_at", { withTimezone: true }),
  result: jsonb("result").$type<Record<string, unknown>>(), createdAt: created(),
});
export const chapterMediaRenders = pgTable("chapter_media_renders", {
  id: serial("id").primaryKey(), productionId: integer("production_id").notNull().references(() => mediaProductions.id),
  assetId: integer("asset_id").notNull().references(() => mediaProductionAssets.id),
  sceneVersions: jsonb("scene_versions").$type<number[]>().notNull(), duration: doublePrecision("duration").notNull(),
  status: text("status").notNull().default("review"), createdAt: created(),
});