import { pgTable, serial, integer, text, timestamp, jsonb, doublePrecision, uniqueIndex } from "drizzle-orm/pg-core";
import { books, editions } from "./catalog";

export const bookSources=pgTable("book_sources",{
  id:serial("id").primaryKey(),
  bookId:integer("book_id").notNull().references(()=>books.id),
  sourceType:text("source_type").notNull(),
  textLocation:text("source_text_location").notNull(),
  sourceUrl:text("source_url").notNull().default(""),
  version:integer("source_version").notNull(),
  rightsStatus:text("rights_status").notNull(),
  rightsNotes:text("rights_notes").notNull(),
  checksum:text("checksum").notNull(),
  charCount:integer("char_count").notNull(),
  ingestedAt:timestamp("ingested_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex("source_book_version_unique").on(t.bookId,t.version),uniqueIndex("source_book_checksum_unique").on(t.bookId,t.checksum)]);
export const bookAnalyses=pgTable("book_analyses",{
  id:serial("id").primaryKey(),
  bookId:integer("book_id").notNull().references(()=>books.id),
  sourceId:integer("source_id").notNull().references(()=>bookSources.id),
  editionId:integer("visual_edition_id").notNull().references(()=>editions.id),
  version:integer("analysis_version").notNull(),
  status:text("status").notNull().default("queued"),
  sections:jsonb("sections").$type<Record<string,unknown>>().notNull().default({}),
  staleSections:jsonb("stale_sections").$type<string[]>().notNull().default([]),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
  completedAt:timestamp("completed_at",{withTimezone:true}),
},t=>[uniqueIndex("analysis_book_version_unique").on(t.bookId,t.version)]);
export const intelligenceChapters=pgTable("intelligence_chapters",{
  id:serial("id").primaryKey(),
  analysisId:integer("analysis_id").notNull().references(()=>bookAnalyses.id),
  number:integer("chapter_number").notNull(),
  title:text("chapter_title").notNull(),
  start:integer("start_offset").notNull(),
  end:integer("end_offset").notNull(),
  data:jsonb("data").$type<Record<string,unknown>>().notNull().default({}),
},t=>[uniqueIndex("intelligence_chapter_unique").on(t.analysisId,t.number)]);
export const intelligenceCharacters=pgTable("intelligence_characters",{
  id:serial("id").primaryKey(),
  analysisId:integer("analysis_id").notNull().references(()=>bookAnalyses.id),
  name:text("name").notNull(),
  data:jsonb("data").$type<Record<string,unknown>>().notNull(),
},t=>[uniqueIndex("intelligence_character_unique").on(t.analysisId,t.name)]);
export const intelligenceEnvironments=pgTable("intelligence_environments",{
  id:serial("id").primaryKey(),
  analysisId:integer("analysis_id").notNull().references(()=>bookAnalyses.id),
  name:text("name").notNull(),
  data:jsonb("data").$type<Record<string,unknown>>().notNull(),
},t=>[uniqueIndex("intelligence_environment_unique").on(t.analysisId,t.name)]);
export const intelligenceScenes=pgTable("intelligence_scenes",{
  id:serial("id").primaryKey(),
  analysisId:integer("analysis_id").notNull().references(()=>bookAnalyses.id),
  chapterId:integer("chapter_id").notNull().references(()=>intelligenceChapters.id),
  number:integer("scene_number").notNull(),
  environmentId:integer("environment_id").references(()=>intelligenceEnvironments.id),
  characters:jsonb("characters_present").$type<number[]>().notNull().default([]),
  data:jsonb("data").$type<Record<string,unknown>>().notNull(),
},t=>[uniqueIndex("intelligence_scene_unique").on(t.chapterId,t.number)]);
export const intelligenceJobs=pgTable("intelligence_jobs",{
  id:serial("id").primaryKey(),
  analysisId:integer("analysis_id").notNull().references(()=>bookAnalyses.id),
  stage:text("stage").notNull(),
  targetId:integer("target_id"),
  dependencies:jsonb("dependencies").$type<number[]>().notNull().default([]),
  status:text("status").notNull().default("queued"),
  attempts:integer("attempts").notNull().default(0),
  provider:text("provider").notNull().default("openai"),
  model:text("model").notNull().default("gpt-5.4-mini"),
  promptVersion:text("prompt_version").notNull().default("intelligence-1"),
  inputTokens:integer("input_tokens"),
  outputTokens:integer("output_tokens"),
  cost:doublePrecision("cost"),
  result:jsonb("result").$type<Record<string,unknown>>(),
  failureLog:jsonb("failure_log").$type<Record<string,unknown>[]>().notNull().default([]),
  error:text("error"),
  leaseUntil:timestamp("lease_until",{withTimezone:true}),
  retryAt:timestamp("retry_at",{withTimezone:true}),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
  completedAt:timestamp("completed_at",{withTimezone:true}),
});