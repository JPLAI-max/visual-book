import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import { intelligenceState } from "../services/intelligence/queue";
import { loadSource } from "../services/intelligence/source";
import { bookDetail } from "../services/catalog";
import { stageSchemas,chapterSchema,characterSchema,environmentSchema,sceneSchema } from "../services/intelligence/schemas";
import { logger } from "../lib/logger";

// Read-only integrity audit of the primary full-book acceptance fixture.
const state=await intelligenceState(1);
const analysis=state.activeAnalysis;
assert.ok(analysis,"Frankenstein analysis must exist");
assert.ok(["completed","needs_review"].includes(analysis.status),"Full blueprint must finish successfully");
const source=await loadSource(analysis.source_id);
assert.equal(source.text.length,source.record.char_count);
let cursor=0;
for(const c of state.chapters) {
  assert.equal(c.start_offset,cursor,"Source coverage must be contiguous");
  cursor=c.end_offset;
  const parsed=chapterSchema.parse(c.data);
  assert.equal(parsed.chapter_number,c.chapter_number);
  assert.equal(parsed.chapter_title,c.chapter_title);
}
assert.equal(cursor,source.text.length,"Every ingested source character must be analyzed");
assert.equal(state.chapters.filter(c=>/^Chapter \d+$/.test(c.chapter_title)).length,24);
assert.equal(state.chapters.filter(c=>/^Letter \d+$/.test(c.chapter_title)).length,4);
for(const section of ["overview","themes","structure","visual_style","narration_style"] as const)stageSchemas[section].parse(state.sections[section]);
for(const c of state.characters)characterSchema.parse(c.data);
for(const e of state.environments)environmentSchema.parse(e.data);
assert.ok(state.characters.length>0);
assert.ok(state.environments.length>0);
const chars=new Set(state.characters.map(c=>c.id));
const envs=new Set(state.environments.map(e=>e.id));
for(const c of state.chapters) {
  const scenes=state.scenes.filter(s=>s.chapter_id===c.id).sort((a,b)=>a.scene_number-b.scene_number);
  assert.ok(scenes.length>0,`Section ${c.chapter_title} must have a scene plan`);
  scenes.forEach((s,i)=>{
    const parsed=sceneSchema.parse(s.data);
    assert.equal(s.scene_number,i+1);
    assert.equal(parsed.chapter_id,c.id);
    for(const id of parsed.characters_present)assert.ok(chars.has(id),"No scene may reference an invented character ID");
    if(parsed.environment_id!==null)assert.ok(envs.has(parsed.environment_id),"No scene may reference an invented environment ID");
  });
}
for(const job of state.jobs) {
  assert.equal(job.status,"completed");
  assert.ok(job.provider&&job.model&&job.prompt_version&&job.created_at);
  assert.ok(job.result,"Every completed stage must retain its validated output");
  if(job.stage!=="chapter_detection")stageSchemas[job.stage as keyof typeof stageSchemas].parse(job.result);
}
const edition=(await pool.query("SELECT published FROM visual_editions WHERE id=$1",[analysis.visual_edition_id])).rows[0];
assert.equal(edition.published,false,"A blueprint must never publish itself");
const media=(await pool.query(`SELECT count(*)::int n FROM assets a JOIN scene_versions v ON v.id=a.scene_version_id
 JOIN scenes s ON s.id=v.scene_id JOIN chapters c ON c.id=s.chapter_id WHERE c.visual_edition_id=$1`,[analysis.visual_edition_id])).rows[0].n;
assert.equal(media,0,"The blueprint edition must have no generated media");
const sample=await bookDetail(1,null);
assert.equal(sample.book.editionId,1);
assert.equal(sample.book.sample,true);
assert.equal(sample.book.status,"published");
assert.equal(sample.chapters.length,3);
assert.equal(sample.chapters.reduce((n,c)=>n+c.scenes.length,0),6);
const runtime=state.scenes.reduce((n,s)=>n+Number(s.data.estimated_duration),0);
logger.info({analysisId:analysis.id,sourceCharacters:source.text.length,chapters:state.chapters.length,characters:chars.size,environments:envs.size,scenes:state.scenes.length,jobs:state.jobs.length,plannedRuntimeSeconds:runtime,samplePreserved:true,blueprintMediaAssets:media},"Full-book blueprint integrity audit passed");
await pool.end();