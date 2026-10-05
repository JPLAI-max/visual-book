import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp,writeFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pool } from "@workspace/db";
import { readAsset } from "../services/production/assets";
import { paidCall } from "../services/production/config";
const exec=promisify(execFile);
async function main() {
  const id=Number(process.argv[2]??1);assert(Number.isSafeInteger(id)&&id>0);
  const p=(await pool.query("SELECT * FROM media_productions WHERE id=$1",[id])).rows[0];assert(p,"Production exists");
  assert(p.reserved_spend<=p.max_spend+.000001,"Conservative reservation budget enforced");
  const requests=(await pool.query("SELECT * FROM media_production_requests WHERE production_id=$1",[id])).rows;
  assert(Math.abs(requests.reduce((n,r)=>n+r.estimated_cost,0)-p.reserved_spend)<.000001,"Ledger and reservations reconcile");
  let providerCalled=false;
  try {
    await paidCall(id,"scene_image","openai","gpt-image-1",p.max_spend+1,{takeId:1},async()=>{providerCalled=true;throw new Error("Unreachable provider callback");});
    assert.fail("Over-budget call was not rejected");
  }catch(e){assert.equal((e as Error&{status:number}).status,402);}
  assert.equal(providerCalled,false,"Budget fails before provider invocation");
  const rows=(await pool.query(`SELECT s.scene_number,s.blueprint_scene_id,s.current_version_id,t.*
    FROM media_production_scenes s LEFT JOIN media_scene_takes t ON t.id=s.current_version_id WHERE s.production_id=$1 ORDER BY s.scene_number`,[id])).rows;
  const original=(await pool.query("SELECT count(*)::int n FROM intelligence_scenes WHERE chapter_id=$1",[p.blueprint_chapter_id])).rows[0].n;
  assert.equal(rows.length,original,"Every saved blueprint scene has a production scene");
  assert(rows.every(t=>t.status==="approved"),"All current scene takes approved");
  const render=(await pool.query("SELECT * FROM chapter_media_renders WHERE production_id=$1 ORDER BY id DESC LIMIT 1",[id])).rows[0];
  assert.deepEqual(render?.scene_versions,rows.map(t=>t.id),"Chapter render snapshot matches ordered current scene selections");
  const voices=(await pool.query(`SELECT DISTINCT a.metadata->>'voice_id' voice FROM media_production_assets a
    JOIN media_productions p ON p.id=a.production_id WHERE p.book_id=$1 AND a.kind='voice'`,[p.book_id])).rows;
  assert.equal(voices.length,1,"Narrator identity remains book-consistent");
  const dir=await mkdtemp(join(tmpdir(),"folio-production-audit-"));
  let duration=0;
  try{
    for(const take of rows){
      for(const field of ["image_asset_id","video_asset_id","audio_asset_id","caption_asset_id"])assert(take[field],`${field} exists`);
      const probe=async(assetId:number,suffix:string)=>{
        const path=join(dir,`${assetId}.${suffix}`);await writeFile(path,await readAsset(assetId));
        const {stdout}=await exec("ffprobe",["-v","error","-show_entries","format=duration:stream=codec_name,width,height","-of","json",path],{timeout:15000});
        return JSON.parse(stdout);
      };
      const video=await probe(take.video_asset_id,"mp4");const audio=await probe(take.audio_asset_id,"wav");
      assert(Math.abs(Number(audio.format.duration)-take.duration)<.1,"Declared duration follows actual narration");
      assert(Math.abs(Number(video.format.duration)-take.duration)<.15,"Camera-motion video follows narration duration");
      const stream=video.streams.find((s:{codec_name:string})=>["vp9","h264"].includes(s.codec_name));assert(stream,"Browser-compatible video stream");
      const dimensions=p.configuration.resolution==="1080p"?[1920,1080]:[1280,720];
      assert.deepEqual([stream.width,stream.height],dimensions,"Requested widescreen resolution");
      const captions=(await readAsset(take.caption_asset_id)).toString();assert(captions.startsWith("WEBVTT\n"));
      assert(captions.includes("-->"),"Standard timed caption cues");
      const spoken=captions.split("\n").filter(l=>l&&!l.includes("-->")&&!/^\d+$/.test(l)&&l!=="WEBVTT").join(" ");
      const normalize=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,"");
      assert.equal(normalize(spoken),normalize(take.narration),"Captions preserve every approved narration word");
      duration+=take.duration;
    }
    assert(Math.abs(render.duration-duration)<.000001,"Assembled chapter uses real scene durations");
    const playback=(await pool.query("SELECT * FROM chapters WHERE id=$1",[p.chapter_id])).rows[0];
    if(p.status==="published")assert(Math.abs(playback.duration-duration)<.000001,"Published player duration matches current takes");
    const sample=(await pool.query("SELECT count(*)::int chapters,(SELECT count(*)::int FROM scenes s JOIN chapters c ON c.id=s.chapter_id WHERE c.visual_edition_id=1) scenes FROM chapters WHERE visual_edition_id=1")).rows[0];
    if(p.book_id===1)assert.deepEqual(sample,{chapters:3,scenes:6},"Original Frankenstein sample preserved");
    console.log(JSON.stringify({result:"PASS",productionId:id,scenes:rows.length,durationSeconds:duration,reservationsUSD:p.reserved_spend,budgetUSD:p.max_spend,
      actualProviderCosts:requests.some(r=>r.actual_cost===null)?"Unknown; not reported":"Recorded"},null,2));
  }finally{await rm(dir,{recursive:true,force:true});}
}
main().then(()=>pool.end()).catch(async(e)=>{console.error(e);await pool.end();process.exitCode=1;});