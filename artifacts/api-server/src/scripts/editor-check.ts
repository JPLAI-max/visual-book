import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import { editorSource, timelineState, saveTimeline } from "../services/editor/timeline";
import { definitionSchema, validateTimeline } from "../services/editor/types";
import { questionContext } from "../services/questions/context";
import { combineCaptions } from "../services/editor/captions";
import { questionInsights } from "../services/questions/ask";
import { sceneAnalytics } from "../services/improvement";

async function main() {
  const source = await editorSource(4);
  const first = await timelineState(4), second = await timelineState(4);
  assert.deepEqual(first.scenes, second.scenes, "Polling must not manufacture new shot identifiers");
  assert.equal(source.scenes.length, 4);
  assert.equal(source.scenes.reduce((sum, scene) => sum + scene.shots.length, 0), 10);
  assert.ok(source.assets.some(asset => asset.kind === "audio"));
  assert.ok(source.assets.some(asset => asset.kind === "captions"));
  const original = definitionSchema.parse({ scenes: source.scenes });
  validateTimeline(original, source.scenes, source.assets);
  const changed = structuredClone(original);
  changed.scenes[0]!.shots[0]!.crop = { x: .1, y: .1, width: .8, height: .8 };
  changed.scenes[0]!.shots[0]!.panDirection = "right";
  validateTimeline(changed, source.scenes, source.assets);
  const gap = structuredClone(original); gap.scenes[0]!.shots[1]!.start += 1;
  assert.throws(() => validateTimeline(gap, source.scenes, source.assets), /gaps/);
  const duration = structuredClone(original); duration.scenes[0]!.shots[1]!.duration += 1;
  assert.throws(() => validateTimeline(duration, source.scenes, source.assets), /durations/);
  const crop = structuredClone(original); crop.scenes[0]!.shots[0]!.crop.x = .5;
  assert.throws(() => validateTimeline(crop, source.scenes, source.assets), /Crop/);
  const foreign = structuredClone(original); foreign.scenes[0]!.shots[0]!.assetId = 999999;
  assert.throws(() => validateTimeline(foreign, source.scenes, source.assets), /approved asset/);
  const parallax = structuredClone(original); parallax.scenes[0]!.shots[0]!.motionType = "PARALLAX";
  assert.throws(() => validateTimeline(parallax, source.scenes, source.assets), /foreground/);
  const context = await questionContext(1, 4, source.scenes[0]!.id, 0);
  assert.ok(context.facts.some(fact => fact.id.startsWith("source:")));
  await assert.rejects(questionContext(1, 4, source.scenes[0]!.id, 100), /position/);
  const caption = "WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\nExample caption.\n";
  const merged = combineCaptions([{ text: caption, duration: 2 }, { text: caption, duration: 2 }]).toString();
  assert.ok(merged.includes("00:00:02.000 --> 00:00:03.000"));
  assert.throws(() => combineCaptions([{ text: "", duration: 2 }]), /missing/);
  const fixture = `editor-check-${Date.now()}`;
  const sceneId = source.scenes[0]!.id;
  try {
    for (let i = 0; i < 6; i++) await pool.query(`INSERT INTO question_events(actor_key,quota_key,book_id,chapter_id,scene_id,timestamp_cluster,common_question_topic,status)
      VALUES($1,$2,1,4,$3,0,'scene_importance','answered')`, [`${fixture}-${i % 3}`, fixture, sceneId]);
    assert.ok((await questionInsights()).some(row => row.scene_id === sceneId && row.flagged));
    assert.ok((await sceneAnalytics()).find(row => row.id === sceneId)?.revisionRecommended);
  } finally { await pool.query("DELETE FROM question_events WHERE quota_key=$1", [fixture]); }
  if (first.revision === 0) {
    const before = (await pool.query("SELECT checksum FROM book_sources WHERE id=1")).rows[0].checksum;
    const saved = await saveTimeline(4, 0, null, true);
    assert.equal(saved.revision, 1);
    await assert.rejects(saveTimeline(4, 0, original), /Another editor/);
    assert.equal((await pool.query("SELECT checksum FROM book_sources WHERE id=1")).rows[0].checksum, before);
  }
  console.log("PASS: approved assets, stable shots, crop/pan metadata, immutable narration, timing/crop/asset/parallax rejection, source-bound question context and optimistic save.");
}
main().finally(() => pool.end()).catch(error => { console.error(error.message); process.exitCode = 1; });
