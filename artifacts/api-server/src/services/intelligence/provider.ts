import { z } from "zod/v4";
import { pool } from "@workspace/db";
import { stageSchemas,type Stage } from "./schemas";
import { loadSource } from "./source";
import { providerRegistry } from "../providers";

export type Job={id:number;analysis_id:number;stage:Stage;target_id:number|null;attempts:number;provider:string;model:string;result:Record<string,unknown>|null;error?:string|null};
const sourceCache=new Map<number,string>();
export async function sourceText(sourceId:number) {
  if(!sourceCache.has(sourceId)) {
    const loaded=await loadSource(sourceId);
    if(sourceCache.size>=3)sourceCache.delete(sourceCache.keys().next().value!);
    sourceCache.set(sourceId,loaded.text);
  }
  return sourceCache.get(sourceId)!;
}
export async function stageContext(job:Job) {
  const analysis=(await pool.query("SELECT a.*,b.title,b.author,b.genre FROM book_analyses a JOIN books b ON b.id=a.book_id WHERE a.id=$1",[job.analysis_id])).rows[0];
  const chapters=(await pool.query("SELECT * FROM intelligence_chapters WHERE analysis_id=$1 ORDER BY chapter_number",[job.analysis_id])).rows;
  const chars=(await pool.query("SELECT * FROM intelligence_characters WHERE analysis_id=$1 ORDER BY id",[job.analysis_id])).rows;
  const envs=(await pool.query("SELECT * FROM intelligence_environments WHERE analysis_id=$1 ORDER BY id",[job.analysis_id])).rows;
  const book={book_id:analysis.book_id,title:analysis.title,author:analysis.author,genre:analysis.genre,analysis_version:analysis.analysis_version};
  const summaries=chapters.map(c=>({id:c.id,...c.data}));
  let context:Record<string,unknown>={book,chapters:summaries};
  let instruction="";
  if(job.stage==="chapter_analysis") {
    const chapter=chapters.find(c=>c.id===job.target_id);
    if(!chapter)throw new Error("Chapter analysis target not found");
    const source=await sourceText(analysis.source_id);
    context={book,chapter_number:chapter.chapter_number,chapter_title:chapter.chapter_title,source_reference:{start_offset:chapter.start_offset,end_offset:chapter.end_offset},source_text:source.slice(chapter.start_offset,chapter.end_offset)};
    instruction="Analyze ALL supplied chapter text. Preserve chapter_number and chapter_title exactly. estimated_visual_runtime is a NUMBER OF SECONDS, never minutes: minimum 20, maximum 7200 (e.g. a 3-minute chapter is 180). Give concise, source-grounded summaries, events, emotional beats and evidence. Character evidence should include only source-supported physical/personality/relationship detail and aliases, not invented details. Location evidence must distinguish reusable places. For nonfiction, focus on arguments, examples, diagrams and teaching moments. Front matter and introductions are contextual, not fictional narrative events.";
  }else if(job.stage==="overview" && chapters.every(c=>Object.keys(c.data).length===0)) {
    const source=await sourceText(analysis.source_id);
    context={book,source_scope:"Initial provisional overview from representative passages across every detected chapter; refined after full chapter analysis",passages:chapters.map(c=>({title:c.chapter_title,excerpt:source.slice(c.start_offset,c.start_offset+1200)}))};
    instruction="Create an initial high-level overview from these representative passages and metadata. Do not claim passages are the full source. Preserve book_id/title/author/analysis_version.";
  }else if(job.stage==="overview") {
    context={book,chapters:summaries,themes:analysis.sections.themes,structure:analysis.sections.structure};
    instruction="Refine the final book overview using the complete chapter analyses, not just the opening of the novel. Preserve book_id/title/author/analysis_version. target_runtime is total proposed visual seconds for the whole edition.";
  }else if(job.stage==="character_roster") {
    const evidence=chapters.flatMap(c=>(c.data.character_evidence??[]) as {name:string;aliases:string[];role:string}[]);
    const unique=new Map<string,{name:string;aliases:string[];role:string}>();
    for(const item of evidence) {
      const key=item.name.toLowerCase().trim();
      const previous=unique.get(key);
      unique.set(key,{name:item.name,aliases:[...new Set([...(previous?.aliases??[]),...item.aliases])],role:item.role});
    }
    context={book,source_identities:[...unique.values()]};
    instruction="Create ONLY the canonical identity roster for major recurring characters appearing in these complete chapter evidence records. Merge aliases into a single person. Do not include generic crowds, one-off literary references or nonexistent companion creations. Preserve aliases needed to match evidence. Return at most 20 substantive recurring characters with name,aliases,role only. Individual character descriptions are created in separate jobs.";
  }else if(job.stage==="characters") {
    const target=job.target_id?chars.find(c=>c.id===job.target_id):null;
    if(job.target_id&&!target)throw new Error("Canonical character target not found");
    const aliases=new Set([target?.name,...((target?.data.aliases??[]) as string[])].filter(Boolean).map(n=>String(n).toLowerCase().trim()));
    const evidence=chapters.map(c=>({chapter_number:c.chapter_number,characters:(c.data.character_evidence as {name:string;aliases:string[]}[]??[]).filter(person=>!target||[person.name,...person.aliases].some(n=>aliases.has(n.toLowerCase().trim()))),summary:c.data.summary}));
    const matching=evidence.filter(c=>c.characters.length>0);
    context={book,chapter_evidence:target&&matching.length?matching:evidence,...(target?{target:{id:target.id,...target.data}}:{})};
    instruction=target?`Return exactly one character, preserving the exact canonical name "${target.name}". Revise ONLY that character using evidence. Do not invent a different identity.`:"Build a canonical bible of major recurring characters from ALL chapters. Merge aliases to a single identity. Canonical names must align with chapter evidence. Include no generic crowd placeholders.";
    instruction+=" When physical details are absent, explicitly mark them unspecified in the source; any proposed production choice must be marked as such, not claimed as book fact. Do not infer skin tone; use null unless explicitly supported. reference_image_url must be empty because no media is generated.";
  }else if(job.stage==="environments") {
    const target=job.target_id?envs.find(e=>e.id===job.target_id):null;
    if(job.target_id&&!target)throw new Error("Canonical environment target not found");
    context={book,chapter_evidence:chapters.map(c=>({chapter_number:c.chapter_number,environments:c.data.environment_evidence,summary:c.data.summary})),...(target?{target:{id:target.id,...target.data}}:{})};
    instruction=target?`Return exactly one environment, preserving canonical name "${target.name}". Revise ONLY this environment.`:"Build the reusable environment bible spanning all important recurring locations. Merge aliases for the same place; prefer at most 15 major locations. For nonfiction include diagram/teaching environments where relevant.";
    instruction+=" Mark unspecified source details and proposed visual choices honestly. reference_image_url must be empty; no media generation.";
  }else if(job.stage==="scene_plan") {
    const chapter=chapters.find(c=>c.id===job.target_id);
    if(!chapter)throw new Error("Scene plan chapter not found");
    context={book,chapter:{id:chapter.id,...chapter.data},
      characters:chars.map(c=>({id:c.id,name:c.name,aliases:c.data.aliases,role:c.data.role,canonical_visual_description:c.data.canonical_visual_description,consistency_notes:c.data.consistency_notes})),
      environments:envs.map(e=>({id:e.id,name:e.name,location:e.data.location,canonical_generation_prompt:e.data.canonical_generation_prompt,consistency_notes:e.data.consistency_notes})),
      visual_style:analysis.sections.visual_style,narration_style:analysis.sections.narration_style};
    instruction=`Create 3-5 visual scenes covering all meaningful chapter events/concepts, in order. For a short letter/front matter 1-3 scenes are enough. chapter_id MUST be ${chapter.id}. scene_number must be contiguous starting at 1. characters_present contains ONLY canonical IDs provided. environment_id must use a provided canonical ID, or null for diagrams/abstract scenes. Never invent IDs or redefine character/environment appearance. Refer to their canonical records. Narration is original, source-faithful summary, about 40-90 words per scene. No long verbatim quotes. source_reference should cite this chapter and the relevant event/passage. No media URLs or generated assets. For nonfiction plan diagrams, examples, arguments and teaching moments.`;
  }else if(job.stage==="themes") {
    instruction="Identify themes, major concepts, context and content warnings using every completed chapter analysis.";
  }else if(job.stage==="structure") {
    context={...context,characters:chars.map(c=>({id:c.id,name:c.name,relationships:c.data.relationships}))};
    instruction="Build the complete narrative/learning arc, chronology, relationship map and concept hierarchy. Include one chapter role per analyzed chapter. For nonfiction favor teaching progression and arguments; for fiction emotional/narrative progression.";
  }else if(job.stage==="visual_style") {
    context={book,overview:analysis.sections.overview,environments:envs.map(e=>({name:e.name,...e.data})),characters:chars.map(c=>({name:c.name,era:c.data.era,consistency_notes:c.data.consistency_notes}))};
    instruction="Define one coherent production-wide Visual Style Bible for this edition, honoring era and canonical identity. Describe plans only. No asset generation.";
  }else if(job.stage==="narration_style") {
    context={book,overview:analysis.sections.overview,themes:analysis.sections.themes};
    instruction="Define one edition-wide Narration Bible, clear original summaries with faithful source attribution. Reference pronunciation of actual names, educational clarity, quotation limits and dialogue treatment. No voice synthesis.";
  }
  return {analysis,chapters,chars,envs,book,context,instruction};
}
export async function generateStage(job:Job,context:Record<string,unknown>,instruction:string) {
  if(job.stage==="chapter_detection")throw new Error("Chapter detection is deterministic, not an AI stage");
  const schema=stageSchemas[job.stage];
  if(job.result)return {output:schema.parse(job.result),usage:null};
  const result=await providerRegistry.text(job.provider).generateText({
    model:job.model,schema:z.toJSONSchema(schema),instruction,context,priorError:job.error,
  });
  const input=result.inputTokens;const output=result.outputTokens;
  // Provider usage is retained even when validation fails. Unknown monetary
  // costs remain NULL, never guessed from token counts.
  await pool.query(`UPDATE intelligence_jobs SET
    input_tokens=CASE WHEN $2::int IS NULL THEN input_tokens ELSE COALESCE(input_tokens,0)+$2 END,
    output_tokens=CASE WHEN $3::int IS NULL THEN output_tokens ELSE COALESCE(output_tokens,0)+$3 END WHERE id=$1`,[job.id,input,output]);
  if(result.finishReason==="length")throw new Error("Provider output was truncated; no malformed output was saved");
  const text=result.text;
  if(!text)throw new Error("Provider returned an empty analysis");
  let parsed:unknown;
  try {parsed=JSON.parse(text);}catch {throw new Error("Provider returned invalid JSON; source content is omitted from failure logs");}
  return {output:schema.parse(parsed),usage:{input_tokens:input,output_tokens:output}};
}