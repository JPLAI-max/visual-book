import { pool } from "@workspace/db";
import { objectStorageClient } from "../lib/objectStorage";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { logger } from "../lib/logger";

const root=resolve(import.meta.dirname,"../../../..");
const bookSeeds=[
  ["Frankenstein","Mary Shelley",1818,"Fiction","A scientist's ambition gives life to a creature—and opens an enduring question about responsibility, belonging, and what makes us human.","frankenstein","https://www.gutenberg.org/ebooks/84.txt.utf-8"],
  ["Pride and Prejudice","Jane Austen",1813,"Fiction","First impressions are rarely the whole story. Elizabeth Bennet navigates love, family, and the social expectations of Regency England.","pride-and-prejudice","https://www.gutenberg.org/ebooks/1342.txt.utf-8"],
  ["The Art of War","Sun Tzu",0,"Philosophy","An ancient study of strategy, leadership, preparation, and the wisdom of choosing when not to fight.","the-art-of-war","https://www.gutenberg.org/ebooks/132.txt.utf-8"],
  ["Alice in Wonderland","Lewis Carroll",1865,"Fiction","A curious girl follows a white rabbit into a world where logic slips away and imagination takes the lead.","alice-in-wonderland","https://www.gutenberg.org/ebooks/11.txt.utf-8"],
  ["The Time Machine","H. G. Wells",1895,"Science","A journey into the distant future becomes a startling reflection on class, progress, and the fate of humanity.","the-time-machine","https://www.gutenberg.org/ebooks/35.txt.utf-8"],
  ["Meditations","Marcus Aurelius",180,"Philosophy","A Roman emperor's private reflections on resilience, duty, and living well in a world beyond our control.","meditations","https://www.gutenberg.org/ebooks/2680.txt.utf-8"],
];
const narrations=[
  "At the edge of the known world, Robert Walton searches for a passage through the Arctic. His letters to his sister reveal more than ambition: he longs for a friend who understands him. Across the ice, an enormous figure passes in the distance. Then the crew rescues a exhausted stranger. This is Victor Frankenstein, and the story he tells will change the meaning of Walton's own quest.",
  "Walton wants discovery and glory. Victor recognizes the same dangerous hunger in him. Rather than celebrating his achievements, Victor offers a warning: knowledge can become destructive when ambition loses sight of responsibility. Mary Shelley frames the novel as a story inside letters, inviting us to question who is speaking, what they remember, and what they choose to leave unsaid.",
  "Victor grows up in Geneva, surrounded by affection and the beauty of the mountains. Elizabeth and Henry Clerval represent the relationships that give his life meaning. Yet Victor's imagination turns toward the hidden causes of nature. He reads old philosophers and dreams of mastering the forces of life. The contrast is already clear: a warm human world stands beside an increasingly solitary intellectual ambition.",
  "A lightning strike destroys a tree and awakens Victor's fascination with electricity. His interest moves from ancient speculation toward modern science. But his deepest desire remains unchanged: to discover what makes life possible. When his mother dies, that question becomes personal. Death is no longer a remote puzzle. It is a loss he imagines he might one day overcome.",
  "At the university in Ingolstadt, Victor finds teachers who encourage his scientific promise. Chemistry and anatomy offer methods where older books offered dreams. He throws himself into work, neglecting family, health, and friendship. The laboratory becomes his entire world. Shelley asks us to notice not only the knowledge he gains, but the care and connection he abandons to gain it.",
  "Victor discovers a way to animate lifeless matter. He works in secret, collecting materials and assembling a body on a scale larger than an ordinary human. He imagines a new being grateful to its creator. He does not imagine its needs, its vulnerability, or its place in society. The experiment is approaching completion. The question is no longer only whether he can create life, but whether he is prepared to care for it.",
];
const sceneNames=["Across the ice","A warning from the stranger","A childhood in Geneva","The spark of discovery","Ingolstadt","The promise of life"];
const illustrations=["arctic","ship","alps","storm","laboratory","laboratory"];
const chapterNames=["Letters from the Arctic","Victor's Childhood","Ingolstadt"];
const durations=narrations.map((_,i)=>Number(execFileSync("ffprobe",["-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1",resolve(root,`attached_assets/narration/scene-${i+1}.mp3`)],{encoding:"utf8"}).trim()));
const bucket=objectStorageClient.bucket(process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID!);
function time(seconds:number) {
  const ms=Math.round(seconds*1000);const h=Math.floor(ms/3600000);const m=Math.floor(ms/60000)%60;const s=Math.floor(ms/1000)%60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${String(ms%1000).padStart(3,"0")}`;
}
async function run() {
  for(let i=0;i<narrations.length;i++) {
    await bucket.file(`folio/samples/narration-${i+1}.mp3`).save(readFileSync(resolve(root,`attached_assets/narration/scene-${i+1}.mp3`)),{contentType:"audio/mpeg",resumable:false});
    const lines=narrations[i]!.match(/[^.!?]+[.!?]+/g)??[narrations[i]!];
    const caption="WEBVTT\n\n"+lines.map((line,j)=>`${j+1}\n${time(j*durations[i]!/lines.length)} --> ${time((j+1)*durations[i]!/lines.length)}\n${line.trim()}\n`).join("\n");
    await bucket.file(`folio/samples/captions-${i+1}.vtt`).save(caption,{contentType:"text/vtt",resumable:false});
  }
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(786014)");
    if((await client.query("SELECT id FROM books LIMIT 1")).rowCount){await client.query("COMMIT");logger.info("Catalog already seeded; narration objects refreshed");return;}
    for(const [title,author,year,genre,description,slug,source] of bookSeeds) {
      const b=await client.query(`INSERT INTO books(title,author,original_publication_year,genre,description,cover_image,source_url,rights_status,rights_notes)
        VALUES($1,$2,$3,$4,$5,$6,$7,'public_domain','Original work and specified historical English source edition are public domain in the United States. Review territory and translation before broader publication.') RETURNING id`,[title,author,year,genre,description,`/covers/${slug}.svg`,source]);
      const isPrimary=title==="Frankenstein";
      const edition=await client.query(`INSERT INTO visual_editions(book_id,status,published,sample,total_duration,published_at)
        VALUES($1,$2,$3,$3,$4,CASE WHEN $3 THEN now() ELSE NULL END) RETURNING id`,[b.rows[0].id,isPrimary?"published":"requested",isPrimary,isPrimary?durations.reduce((a,b)=>a+b,0):0]);
      if(!isPrimary)continue;
      const bookId=b.rows[0].id;const editionId=edition.rows[0].id;
      await client.query(`INSERT INTO characters(book_id,name,description,age,appearance,wardrobe,personality,character_prompt,consistency_notes)
        VALUES($1,'Victor Frankenstein','A young Genevan scientist whose ambition isolates him from those he loves.','Early twenties',
        '{"height":"tall","build":"slender","hair":"dark wavy hair","eyes":"gray","face":"narrow and thoughtful","posture":"slightly stooped","era":"late eighteenth century"}',
        'Dark wool coat, cream linen shirt, worn waistcoat','Brilliant, restless, obsessive',
        'Same young man with narrow thoughtful face, dark wavy hair, gray eyes, dark wool coat and cream linen shirt, late eighteenth century.',
        'Preserve facial structure, hairstyle, era and wardrobe in every scene.')`,[bookId]);
      const environment=await client.query(`INSERT INTO environments(book_id,name,description,location,time_period,visual_style,environment_prompt,details)
        VALUES($1,'Victors laboratory','A secluded room filled with scientific apparatus.','Ingolstadt','Late eighteenth century',
        'Atmospheric editorial illustration','Candlelit stone laboratory with wood workbench, glass vessels, copper instruments, deep shadows.',
        '{"architecture":"stone walls","lighting":"candlelight","weather":"rain","colorMood":"muted amber and charcoal","furniture":"wood workbench","props":"glass vessels and copper instruments"}') RETURNING id`,[bookId]);
      for(let ci=0;ci<3;ci++) {
        const chapter=await client.query(`INSERT INTO chapters(visual_edition_id,chapter_number,title,summary,duration,status,sort_order)
          VALUES($1,$2,$3,$4,$5,'published',$2) RETURNING id`,[editionId,ci+1,chapterNames[ci],["An explorer encounters a stranger whose warning mirrors his own ambition.","Victor's early life and his growing fascination with the forces of nature.","Scientific discovery brings Victor closer to creating life—and further from responsibility."][ci],durations[ci*2]!+durations[ci*2+1]!]);
        for(let si=0;si<2;si++) {
          const n=ci*2+si;
          const scene=await client.query(`INSERT INTO scenes(chapter_id,scene_number,title,purpose,narration,duration,status,environment_id,source_notes,educational_goal)
            VALUES($1,$2,$3,$4,$5,$6,'published',$7,$8,$4) RETURNING id`,[chapter.rows[0].id,si+1,sceneNames[n],"Understand ambition, belonging and responsibility through Shelley's framing narrative.",narrations[n],durations[n],ci===2?environment.rows[0].id:null,ci===0?"Frankenstein, Walton's letters":ci===1?"Frankenstein, Chapters 1–2":"Frankenstein, Chapters 3–4"]);
          const sId=scene.rows[0].id;
          const version=await client.query(`INSERT INTO scene_versions(scene_id,version_number,narration,image_asset,audio_asset,caption_asset,render_status,generation_provider,generation_model,notes)
            VALUES($1,1,$2,$3,$4,$5,'published','sample_assets','eleven_multilingual_v2','Illustrated sample with AI-generated narration; not a complete book or full video adaptation.') RETURNING id`,
            [sId,narrations[n],`/scenes/${illustrations[n]}.svg`,`/api/media/narration/${n+1}`,`/api/media/captions/${n+1}`]);
          await client.query("UPDATE scenes SET current_version_id=$2 WHERE id=$1",[sId,version.rows[0].id]);
          await client.query(`INSERT INTO assets(scene_version_id,kind,object_path) VALUES($1,'audio',$2),($1,'captions',$3)`,[version.rows[0].id,`folio/samples/narration-${n+1}.mp3`,`folio/samples/captions-${n+1}.vtt`]);
        }
      }
    }
    await client.query(`INSERT INTO settings(key,value) VALUES('providers','{"textProvider":"openai","textModel":"gpt-5.4-mini","imageProvider":"not_configured","videoProvider":"not_configured","voiceProvider":"sample_only","freePreviewSeconds":300,"subscriberCatalogAccess":true,"premiumLicensedAccess":true}') ON CONFLICT DO NOTHING`);
    await client.query("COMMIT");logger.info("Seeded public-domain catalog and three playable Frankenstein sample chapters");
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
}
await run();await pool.end();