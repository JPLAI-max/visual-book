import { pgTable, serial, integer, text, doublePrecision, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { books, editions, chapters, scenes } from "./catalog";
export const jobs = pgTable("generation_jobs", {
  id: serial("id").primaryKey(),
  bookId: integer("book_id").notNull().references(() => books.id),
  editionId: integer("visual_edition_id").references(() => editions.id),
  chapterId: integer("chapter_id").references(() => chapters.id),
  sceneId: integer("scene_id").references(() => scenes.id),
  jobType: text("job_type").notNull(),
  provider: text("provider").notNull().default("openai"),
  model: text("model").notNull().default("gpt-5.4-mini"),
  status: text("status").notNull().default("queued"),
  percentage: integer("percentage").notNull().default(0),
  cost: doublePrecision("cost"),
  estimatedCost: doublePrecision("estimated_cost"),
  attempts: integer("attempts").notNull().default(0),
  error: text("error_message"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  result: jsonb("result").$type<Record<string, unknown>>(),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});
export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
}, t => [uniqueIndex("settings_key_unique").on(t.key)]);
export const auditLog = pgTable("editorial_audit", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  action: text("action").notNull(),
  targetId: integer("target_id").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});