import { pgTable, serial, integer, text, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";
import { chapters, books } from "./catalog";
export const chapterTimelines = pgTable("chapter_timelines", {
  chapterId: integer("chapter_id").primaryKey().references(() => chapters.id),
  revision: integer("revision").notNull().default(1),
  definition: jsonb("definition").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export const timelineRenders = pgTable("timeline_renders", {
  id: serial("id").primaryKey(), chapterId: integer("chapter_id").notNull().references(() => chapters.id),
  revision: integer("revision").notNull(), definition: jsonb("definition").$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull().default("queued"), assetId: integer("asset_id"),
  sceneAssets: jsonb("scene_assets").$type<Record<string, unknown>[]>().notNull().default([]),
  error: text("error"), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
});
export const questionSessions = pgTable("question_sessions", {
  id: text("id").primaryKey(), actorKey: text("actor_key").notNull(),
  bookId: integer("book_id").notNull().references(() => books.id),
  chapterId: integer("chapter_id").notNull().references(() => chapters.id), sceneId: integer("scene_id").notNull(),
  contextVersion: integer("context_version").notNull(), turns: jsonb("turns").$type<Record<string, unknown>[]>().notNull().default([]),
  busy: boolean("busy").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const questionEvents = pgTable("question_events", {
  id: serial("id").primaryKey(), actorKey: text("actor_key").notNull(), quotaKey: text("quota_key").notNull(),
  bookId: integer("book_id").notNull(), chapterId: integer("chapter_id").notNull(), sceneId: integer("scene_id").notNull(),
  position: integer("timestamp_cluster").notNull(), topic: text("common_question_topic").notNull().default("pending"),
  status: text("status").notNull().default("pending"),
  usage: jsonb("usage").$type<Record<string, unknown>>(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const savedQuestions = pgTable("saved_questions", {
  id: serial("id").primaryKey(), actorKey: text("actor_key").notNull(),
  bookId: integer("book_id").notNull(), chapterId: integer("chapter_id").notNull(), sceneId: integer("scene_id").notNull(),
  position: integer("timestamp").notNull(), question: text("question").notNull(), answer: text("answer").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
