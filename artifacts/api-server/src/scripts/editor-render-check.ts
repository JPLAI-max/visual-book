import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pool } from "@workspace/db";
import { readAsset } from "../services/production/assets";
import { publishTimeline } from "../services/editor/publish";
const exec = promisify(execFile);
async function main() {
  const timeout = Date.now() + 600000;
  let render;
  while (Date.now() < timeout) {
    render = (await pool.query("SELECT * FROM timeline_renders WHERE chapter_id=4 ORDER BY id DESC LIMIT 1")).rows[0];
    if (render?.status === "ready") break;
    if (render?.status === "failed") throw new Error(render.error);
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
  assert.equal(render?.status, "ready", "Local chapter render must finish");
  const asset = (await pool.query("SELECT * FROM media_production_assets WHERE id=$1", [render.asset_id])).rows[0];
  assert.ok(asset.metadata.captionAssetId);
  const captions = (await readAsset(asset.metadata.captionAssetId)).toString("utf8");
  assert.ok(captions.startsWith("WEBVTT"));
  assert.ok(captions.includes("00:01:49.500"));
  const dir = await mkdtemp(join(tmpdir(), "folio-render-check-"));
  try {
    const path = join(dir, "chapter.webm");
    await writeFile(path, await readAsset(asset.id));
    const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_name,width,height", "-of", "json", path]);
    const media = JSON.parse(stdout);
    assert.ok(Math.abs(Number(media.format.duration) - 109.5) < .2);
    assert.ok(media.streams.some((s: { codec_name: string; width: number; height: number }) => s.codec_name === "vp9" && s.width === 1920 && s.height === 1080));
    assert.ok(media.streams.some((s: { codec_name: string }) => s.codec_name === "opus"));
  } finally { await rm(dir, { recursive: true, force: true }); }
  const before = (await pool.query("SELECT id,current_version_id FROM scenes WHERE chapter_id=4 ORDER BY id")).rows;
  await publishTimeline(4, render.revision, render.id, true);
  const after = (await pool.query("SELECT id,current_version_id FROM scenes WHERE chapter_id=4 ORDER BY id")).rows;
  assert.deepEqual(before, after, "Publication dry-run must leave live scene versions unchanged");
  assert.equal((await pool.query("SELECT status FROM timeline_renders WHERE id=$1", [render.id])).rows[0].status, "ready");
  console.log(`RENDER_COMPLETE: render ${render.id}, 1080p VP9/Opus, 109.5s, combined timed captions, publication transaction dry-run passed, live chapter unchanged.`);
}
main().finally(() => pool.end()).catch(error => { console.error(`RENDER_FAILED: ${error.message}`); process.exitCode = 1; });
