import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import { detectChapters,cleanSource,ingestSource } from "../services/intelligence/source";
import { analyzeBook } from "../services/intelligence/queue";
import { logger } from "../lib/logger";
import { sceneSchema,characterSchema } from "../services/intelligence/schemas";

const simple=cleanSource("Chapter 1\n\n"+"Owned manuscript test paragraph. ".repeat(20)+"\n\nChapter 2\n\n"+"Second chapter material. ".repeat(20));
const detected=detectChapters(simple);
assert.equal(detected.length,2);
assert.equal(detected.reduce((n,c)=>n+c.end_offset-c.start_offset,0),simple.length);
assert.equal(detected[0]?.start_offset,0);
assert.equal(detected.at(-1)?.end_offset,simple.length);
const unstructured="A manuscript without headings. ".repeat(2500);
const sections=detectChapters(unstructured);
assert.equal(sections.reduce((n,c)=>n+c.end_offset-c.start_offset,0),unstructured.length);
assert.ok(!sceneSchema.safeParse({scene_title:"malformed"}).success);
assert.ok(!characterSchema.safeParse({name:"Malformed"}).success);
await assert.rejects(()=>ingestSource(1,{sourceType:"licensed",rightsStatus:"licensed",rightsNotes:"Not an active licensed source",text:simple}),/documented active adaptation license/);
logger.info("Chapter coverage, unstructured manuscripts, JSON validation and licensed-source denial checks passed");
if(process.argv.includes("--full-book")) {
  const existing=(await pool.query("SELECT id FROM book_analyses WHERE book_id=1 ORDER BY analysis_version DESC LIMIT 1")).rows[0];
  const id=existing?.id??await analyzeBook(1);
  logger.info({analysisId:id},"Frankenstein full-source test analysis queued; background worker creates a blueprint only");
}
await pool.end();