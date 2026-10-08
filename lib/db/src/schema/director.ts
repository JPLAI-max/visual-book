import { pgTable, serial, integer, text, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { chapters } from "./catalog";
import { mediaProductions, mediaProductionScenes } from "./production";
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const json = (name: string) => jsonb(name).$type<Record<string, unknown>>().notNull().default({});
export const directorRuns = pgTable("director_runs", {
  id: serial("id").primaryKey(), chapterId: integer("chapter_id").notNull().references(() => chapters.id),
  productionId: integer("production_id").notNull().references(() => mediaProductions.id),
  status: text("status").notNull().default("planning"), pacing: json("pacing"),
  baseline: json("baseline"), definition: json("definition"), directedRevision: integer("directed_revision"), createdAt: created(),
});
export const directorScenes = pgTable("director_scenes", {
  id: serial("id").primaryKey(), runId: integer("run_id").notNull().references(() => directorRuns.id),
  sceneId: integer("scene_id").notNull(), productionSceneId: integer("production_scene_id").notNull().references(() => mediaProductionScenes.id),
  number: integer("scene_number").notNull(), title: text("title").notNull(), continuity: json("continuity"), createdAt: created(),
});
export const directorShots = pgTable("director_shots", {
  id: serial("id").primaryKey(), scenePlanId: integer("scene_plan_id").notNull().references(() => directorScenes.id),
  blueprint: json("blueprint"), currentVersionId: integer("current_version_id"), createdAt: created(),
});
export const directorShotVersions = pgTable("director_shot_versions", {
  id: serial("id").primaryKey(), shotId: integer("shot_id").notNull().references(() => directorShots.id),
  spec: json("spec"), status: text("status").notNull().default("proposed"), imageAssetId: integer("image_asset_id"),
  videoAssetId: integer("video_asset_id"), quality: json("quality"), parentVersionId: integer("parent_version_id"), createdAt: created(),
});
export const directorJobs = pgTable("director_jobs", {
  id: serial("id").primaryKey(), runId: integer("run_id").notNull().references(() => directorRuns.id),
  kind: text("kind").notNull(), shotId: integer("shot_id"), versionId: integer("version_id"),
  input: json("input"), status: text("status").notNull().default("queued"), result: json("result"), error: text("error"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }), createdAt: created(),
}, t=>[uniqueIndex("director_active_shot_job").on(t.versionId,t.kind).where(sql`${t.status} IN ('queued','running') AND ${t.versionId} IS NOT NULL`)]);
export const directorReviews = pgTable("director_reviews", {
  id: serial("id").primaryKey(), runId: integer("run_id").notNull().references(() => directorRuns.id),
  definitionHash: text("definition_hash").notNull(), status: text("status").notNull().default("completed"),
  result: json("result"), createdAt: created(),
});
