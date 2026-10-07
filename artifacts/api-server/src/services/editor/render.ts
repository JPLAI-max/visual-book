import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pool } from "@workspace/db";
import { readAsset, saveAsset } from "../production/assets";
import { assembleVideos } from "../production/render";
import { definitionSchema, validateTimeline, type TimelineScene, type Shot } from "./types";
import { editorSource } from "./timeline";
import { logger } from "../../lib/logger";
import { combineCaptions } from "./captions";
const exec = promisify(execFile);
const ffmpeg = (args: string[]) => exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-threads", "2", ...args], { timeout: 360000, maxBuffer: 1024 * 1024 });
const codec = ["-c:v", "libvpx-vp9", "-threads", "2", "-row-mt", "1", "-cpu-used", "5", "-crf", "22", "-b:v", "0", "-pix_fmt", "yuv420p"];

async function renderShot(shot: Shot, dir: string, index: number) {
  const input = join(dir, `${index}.source`);
  const output = join(dir, `${index}.webm`);
  await writeFile(input, await readAsset(shot.assetId));
  const crop = `crop=iw*${shot.crop.width}:ih*${shot.crop.height}:iw*${shot.crop.x}:ih*${shot.crop.y},`;
  const fades = `${shot.transitionIn === "FADE" ? ",fade=t=in:st=0:d=0.25" : ""}${shot.transitionOut === "FADE" ? `,fade=t=out:st=${Math.max(0, shot.duration - .25)}:d=0.25` : ""}`;
  const args = ["-y", "-i", input];
  let filter: string;
  if (shot.motionType === "AI_VIDEO") {
    const probe = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", input]);
    if (Number(probe.stdout.trim()) + .05 < shot.duration) throw new Error("Video asset is shorter than the shot. Shorten the shot; video is not looped or stretched.");
    filter = `${crop}scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=24,setsar=1${fades}`;
  } else {
    const frames = Math.max(1, Math.ceil(shot.duration * 24));
    const z = shot.motionType === "STATIC" ? String(shot.zoomStart) : `${shot.zoomStart}+(${shot.zoomEnd}-${shot.zoomStart})*min(on/${frames},1)`;
    const direction = shot.motionType === "STATIC" ? "none" : shot.panDirection;
    const x = direction === "right" ? `(iw-iw/zoom)*on/${frames}` : direction === "left" ? `(iw-iw/zoom)*(1-on/${frames})` : "iw/2-iw/zoom/2";
    const y = direction === "down" ? `(ih-ih/zoom)*on/${frames}` : direction === "up" ? `(ih-ih/zoom)*(1-on/${frames})` : "ih/2-ih/zoom/2";
    filter = `${crop}scale=3840:2160:force_original_aspect_ratio=increase,crop=3840:2160,zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=1920x1080:fps=24,setsar=1${fades}`;
  }
  if (shot.motionType === "PARALLAX") {
    const foreground = join(dir, `${index}.foreground.png`);
    await writeFile(foreground, await readAsset(shot.foregroundAssetId!));
    args.push("-loop", "1", "-i", foreground, "-filter_complex",
      `[0:v]${filter}[bg];[1:v]scale=1920:1080:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=x='(W-w)/2+3*t/${shot.duration}':y='(H-h)/2':shortest=1`);
  } else args.push("-vf", filter);
  await ffmpeg([...args, "-t", String(shot.duration), ...codec, "-an", output]);
  return output;
}
async function renderScene(scene: TimelineScene, productionId: number) {
  const dir = await mkdtemp(join(tmpdir(), "folio-editor-"));
  try {
    const shots = [];
    for (let index = 0; index < scene.shots.length; index++) shots.push(await renderShot(scene.shots[index]!, dir, index));
    const concat = join(dir, "shots.txt");
    await writeFile(concat, shots.map(path => `file '${path}'`).join("\n"));
    const audio = join(dir, "narration.wav");
    await writeFile(audio, await readAsset(scene.audioAssetId));
    const output = join(dir, "scene.webm");
    await ffmpeg(["-y", "-f", "concat", "-safe", "0", "-i", concat, "-i", audio, "-c:v", "copy", "-c:a", "libopus", "-b:a", "128k", "-t", String(scene.duration), output]);
    const asset = await saveAsset({ productionId, kind: "timeline_scene", bytes: await readFile(output), mime: "video/webm", provider: "ffmpeg", model: "shot-timeline-v1", metadata: { sceneId: scene.id, shots: scene.shots } });
    return { sceneId: scene.id, assetId: asset.id };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
let running = false;
export function startTimelineEngine() {
  const timer = setInterval(() => void tick().catch(error => logger.error({ message: String(error) }, "Timeline render scheduler failed")), 3000);
  timer.unref();
}
async function tick() {
  if (running) return;
  running = true;
  let id: number | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    await pool.query("UPDATE timeline_renders SET status='failed',error='Render interrupted. Queue this saved revision again.' WHERE status='rendering' AND started_at < now()-interval '2 minutes'");
    const job = (await pool.query(`UPDATE timeline_renders SET status='rendering',started_at=now() WHERE id=(
      SELECT id FROM timeline_renders WHERE status='queued' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`)).rows[0];
    if (!job) return;
    id = job.id;
    heartbeat = setInterval(() => void pool.query("UPDATE timeline_renders SET started_at=now() WHERE id=$1 AND status='rendering'", [id])
      .catch(error => logger.error({ message: String(error) }, "Timeline render heartbeat failed")), 20000);
    heartbeat.unref();
    const { chapter, scenes, assets } = await editorSource(job.chapter_id);
    const definition = definitionSchema.parse(job.definition);
    validateTimeline(definition, scenes, assets);
    const sceneAssets = [];
    for (const scene of definition.scenes) sceneAssets.push(await renderScene(scene, chapter.production_id));
    const videos = [];
    for (const asset of sceneAssets) videos.push(await readAsset(asset.assetId));
    const captions = [];
    for (const scene of definition.scenes) captions.push({ text: (await readAsset(scene.captionAssetId)).toString("utf8"), duration: scene.duration });
    const captionAsset = await saveAsset({ productionId: chapter.production_id, kind: "timeline_captions", bytes: combineCaptions(captions),
      mime: "text/vtt", provider: "local", model: "timeline-caption-offsets-v1", metadata: { revision: job.revision } });
    const asset = await saveAsset({ productionId: chapter.production_id, kind: "timeline_chapter", bytes: await assembleVideos(videos),
      mime: "video/webm", provider: "ffmpeg", model: "shot-timeline-v1", metadata: { revision: job.revision, chapterId: job.chapter_id, captionAssetId: captionAsset.id } });
    await pool.query("UPDATE timeline_renders SET status='ready',asset_id=$2,scene_assets=$3 WHERE id=$1", [id, asset.id, JSON.stringify(sceneAssets)]);
  } catch (error) {
    if (id) await pool.query("UPDATE timeline_renders SET status='failed',error=$2 WHERE id=$1", [id, String((error as Error).message).slice(0, 500)]);
    else throw error;
  } finally { if (heartbeat) clearInterval(heartbeat); running = false; }
}
