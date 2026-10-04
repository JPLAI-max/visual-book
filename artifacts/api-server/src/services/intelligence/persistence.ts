import { pool } from "@workspace/db";
import type { Job } from "./provider";
import { stageSchemas } from "./schemas";
import { assertRights } from "../catalog";
import type { DetectedChapter } from "./source";

export async function saveStage(job:Job,raw:unknown) {
  const output=job.stage==="chapter_detection"?raw:stageSchemas[job.stage].parse(raw);
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const analysis=(await client.query("SELECT * FROM book_analyses WHERE id=$1 FOR UPDATE",[job.analysis_id])).rows[0];
    await assertRights(analysis.book_id);
    if(job.stage==="chapter_detection") {
      const detection=output as {chapters:DetectedChapter[];source_characters:number;covered_characters:number;scope:string};
      if(detection.source_characters!==detection.covered_characters)throw new Error("Chapter coverage validation failed");
      await client.query("UPDATE book_analyses SET sections=sections||$2::jsonb WHERE id=$1",[job.analysis_id,JSON.stringify({chapter_detection:detection})]);
    }else if(job.stage==="chapter_analysis") {
      const data=output as Record<string,unknown>;
      const c=(await client.query("SELECT * FROM intelligence_chapters WHERE id=$1 AND analysis_id=$2",[job.target_id,job.analysis_id])).rows[0];
      if(!c||data.chapter_number!==c.chapter_number||data.chapter_title!==c.chapter_title)throw new Error("Chapter identity does not match the source segment");
      await client.query("UPDATE intelligence_chapters SET data=$2 WHERE id=$1",[job.target_id,JSON.stringify(data)]);
    }else if(job.stage==="character_roster") {
      const items=(output as {characters:{name:string;aliases:string[];role:string}[]}).characters;
      if(new Set(items.map(c=>c.name.toLowerCase())).size!==items.length)throw new Error("Canonical roster contains duplicate identities");
      const dependencies:number[]=[];
      for(const item of items) {
        const character=(await client.query(`INSERT INTO intelligence_characters(analysis_id,name,data) VALUES($1,$2,$3)
          ON CONFLICT(analysis_id,name)DO UPDATE SET data=EXCLUDED.data RETURNING id`,[job.analysis_id,item.name,JSON.stringify(item)])).rows[0];
        const existing=(await client.query("SELECT id FROM intelligence_jobs WHERE analysis_id=$1 AND stage='characters' AND target_id=$2",[job.analysis_id,character.id])).rows[0];
        const child=existing??(await client.query("INSERT INTO intelligence_jobs(analysis_id,stage,target_id,dependencies)VALUES($1,'characters',$2,$3)RETURNING id",[job.analysis_id,character.id,JSON.stringify([job.id])])).rows[0];
        dependencies.push(child.id);
      }
      // All stages that depended on extraction also wait for each validated
      // canonical record; scene plans can never use incomplete roster rows.
      await client.query(`UPDATE intelligence_jobs SET dependencies=dependencies||$2::jsonb
        WHERE analysis_id=$1 AND id<>$3 AND dependencies @> $4::jsonb AND NOT(stage='characters' AND target_id IS NOT NULL)`,
        [job.analysis_id,JSON.stringify(dependencies),job.id,JSON.stringify([job.id])]);
    }else if(job.stage==="characters"||job.stage==="environments") {
      const table=job.stage==="characters"?"intelligence_characters":"intelligence_environments";
      const items=(output as Record<string,Record<string,unknown>[]>)[job.stage]!;
      const names=items.map(i=>String(i.name).trim());
      if(new Set(names.map(n=>n.toLowerCase())).size!==names.length)throw new Error("Canonical identities contain duplicate names; retry with merged aliases");
      if(job.target_id) {
        const target=(await client.query(`SELECT name FROM ${table} WHERE id=$1 AND analysis_id=$2`,[job.target_id,job.analysis_id])).rows[0];
        if(items.length!==1||items[0]?.name!==target?.name)throw new Error("Targeted revision must preserve the canonical identity and name");
        await client.query(`UPDATE ${table} SET data=$2 WHERE id=$1`,[job.target_id,JSON.stringify(items[0])]);
      }else for(const item of items) {
        await client.query(`INSERT INTO ${table}(analysis_id,name,data)VALUES($1,$2,$3) ON CONFLICT(analysis_id,name)DO UPDATE SET data=EXCLUDED.data`,[job.analysis_id,item.name,JSON.stringify(item)]);
      }
    }else if(job.stage==="scene_plan") {
      const scenes=(output as {scenes:Record<string,any>[]}).scenes;
      const characterIds=new Set((await client.query("SELECT id FROM intelligence_characters WHERE analysis_id=$1",[job.analysis_id])).rows.map(c=>c.id));
      const environmentIds=new Set((await client.query("SELECT id FROM intelligence_environments WHERE analysis_id=$1",[job.analysis_id])).rows.map(e=>e.id));
      scenes.forEach((s,i)=>{
        if(s.chapter_id!==job.target_id||s.scene_number!==i+1)throw new Error("Scene numbering or chapter ownership is invalid");
        if(s.characters_present.some((id:number)=>!characterIds.has(id)))throw new Error("Scene references an unknown canonical character");
        if(s.environment_id!==null&&!environmentIds.has(s.environment_id))throw new Error("Scene references an unknown canonical environment");
      });
      const numbers=scenes.map(s=>s.scene_number);
      // The previous plan remains in immutable job.result history; current rows
      // are updated atomically. Nothing touches published playback scenes.
      await client.query("DELETE FROM intelligence_scenes WHERE chapter_id=$1 AND NOT(scene_number=ANY($2::int[]))",[job.target_id,numbers]);
      for(const scene of scenes) {
        await client.query(`INSERT INTO intelligence_scenes(analysis_id,chapter_id,scene_number,environment_id,characters_present,data)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(chapter_id,scene_number) DO UPDATE SET environment_id=EXCLUDED.environment_id,characters_present=EXCLUDED.characters_present,data=EXCLUDED.data`,
          [job.analysis_id,job.target_id,scene.scene_number,scene.environment_id,JSON.stringify(scene.characters_present),JSON.stringify(scene)]);
      }
    }else {
      const data=output as Record<string,unknown>;
      if(job.stage==="overview"&&(data.book_id!==analysis.book_id||data.analysis_version!==analysis.analysis_version))throw new Error("Overview belongs to a different book or analysis version");
      if(job.stage==="structure") {
        const chapters=(await client.query("SELECT chapter_number FROM intelligence_chapters WHERE analysis_id=$1",[job.analysis_id])).rows;
        const roles=(data.chapter_roles as {chapter_number:number}[]).map(c=>c.chapter_number);
        if(roles.length!==chapters.length||new Set(roles).size!==chapters.length||chapters.some(c=>!roles.includes(c.chapter_number)))throw new Error("Story structure must cover every chapter exactly once");
      }
      await client.query("UPDATE book_analyses SET sections=sections||$2::jsonb WHERE id=$1",[job.analysis_id,JSON.stringify({[job.stage]:output})]);
    }
    await client.query("UPDATE intelligence_jobs SET status='completed',result=$2,error=NULL,lease_until=NULL,retry_at=NULL,completed_at=now() WHERE id=$1",[job.id,JSON.stringify(output)]);
    await client.query("COMMIT");
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
}
export async function finalizeAnalysis(analysisId:number) {
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const analysis=(await client.query("SELECT * FROM book_analyses WHERE id=$1 FOR UPDATE",[analysisId])).rows[0];
    const states=(await client.query("SELECT status FROM intelligence_jobs WHERE analysis_id=$1",[analysisId])).rows;
    if(states.some(j=>j.status==="failed"||j.status==="blocked")) {
      await client.query("UPDATE book_analyses SET status='failed' WHERE id=$1",[analysisId]);
    }else if(states.length && states.every(j=>j.status==="completed")) {
      const total=(await client.query("SELECT count(*)::int n FROM intelligence_chapters WHERE analysis_id=$1",[analysisId])).rows[0].n;
      const planned=(await client.query("SELECT count(DISTINCT chapter_id)::int n FROM intelligence_scenes WHERE analysis_id=$1",[analysisId])).rows[0].n;
      const required=["overview","chapter_detection","themes","structure","visual_style","narration_style"];
      if(total!==planned||required.some(key=>!analysis.sections[key]))throw new Error("Blueprint integrity check failed: missing chapter scenes or style sections");
      await assertRights(analysis.book_id);
      const status=analysis.stale_sections.length?"needs_review":"completed";
      await client.query("UPDATE book_analyses SET status=$2,completed_at=now() WHERE id=$1",[analysisId,status]);
      const duration=(await client.query("SELECT COALESCE(sum((data->>'estimated_duration')::float),0)::float n FROM intelligence_scenes WHERE analysis_id=$1",[analysisId])).rows[0].n;
      // Attach only the blueprint pointer to its separate, unpublished edition.
      // Existing published chapters/media/progress are never modified.
      await client.query("UPDATE visual_editions SET status='review',analysis=$2,total_duration=$3 WHERE id=$1 AND published=false",[analysis.visual_edition_id,JSON.stringify({intelligenceAnalysisId:analysisId,scope:"full source blueprint",mediaGenerated:false}),duration]);
    }
    await client.query("COMMIT");
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
}