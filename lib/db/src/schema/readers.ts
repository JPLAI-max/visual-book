import { pgTable, text, serial, integer, doublePrecision, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { books, editions, chapters, scenes } from "./catalog";
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull().default("Reader"),
  subscription: text("subscription_status").notNull().default("free"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const progress = pgTable("user_book_progress", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  editionId: integer("visual_edition_id").notNull().references(() => editions.id),
  chapterId: integer("chapter_id").notNull().references(() => chapters.id),
  position: doublePrecision("playback_position").notNull().default(0),
  percentage: doublePrecision("percentage_complete").notNull().default(0),
  completedChapters: jsonb("completed_chapters").$type<number[]>().notNull().default([]),
  lastWatchedAt: timestamp("last_watched_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("progress_user_edition_unique").on(t.userId, t.editionId)]);
export const library = pgTable("user_library", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  bookId: integer("book_id").notNull().references(() => books.id),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("library_user_book_unique").on(t.userId, t.bookId)]);
export const bookRequests = pgTable("book_requests", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  normalizedTitle: text("normalized_title").notNull(),
  author: text("author").notNull().default(""),
  bookId: integer("matched_book_id").references(() => books.id),
  status: text("status").notNull().default("requested"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("request_user_title_unique").on(t.userId, t.normalizedTitle)]);
export const feedback = pgTable("feedback", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  bookId: integer("book_id").notNull().references(() => books.id),
  chapterId: integer("chapter_id").references(() => chapters.id),
  sceneId: integer("scene_id").references(() => scenes.id),
  feedbackType: text("feedback_type").notNull().default("other"),
  rating: integer("rating").notNull(),
  comment: text("comment").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const viewEvents = pgTable("view_events", {
  id: serial("id").primaryKey(),
  userId: text("user_id").references(() => users.id),
  bookId: integer("book_id").notNull().references(() => books.id),
  chapterId: integer("chapter_id").notNull().references(() => chapters.id),
  sceneId: integer("scene_id").references(() => scenes.id),
  versionId: integer("scene_version_id"),
  eventType: text("event_type").notNull(),
  position: doublePrecision("playback_position").notNull(),
  watchSeconds: doublePrecision("watch_seconds").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});