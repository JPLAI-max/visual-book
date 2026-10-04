import { createHash,randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { objectStorageClient } from "../../lib/objectStorage";
import { assertRights } from "../catalog";
import { fail } from "../access";

export type SourceInput={sourceType:string;rightsStatus:string;rightsNotes:string;text?:string;sourceUrl?:string};
const MAX_BYTES=2_000_000;
export async function downloadGutenberg(raw:string) {
  let url=new URL(raw);
  for(let i=0;i<4;i++) {
    if(url.hostname!=="www.gutenberg.org"||url.protocol!=="https:")fail(400,"Public source URLs must use HTTPS on www.gutenberg.org");
    const response=await fetch(url,{redirect:"manual",signal:AbortSignal.timeout(30000)});
    if(response.status>=300&&response.status<400) {
      const location=response.headers.get("location");if(!location)fail(502,"Source redirect has no destination");
      url=new URL(location,url);if(url.hostname==="www.gutenberg.org"&&url.protocol==="http:")url.protocol="https:";
      continue;
    }
    if(!response.ok)fail(502,`Source download failed (${response.status})`);
    if(Number(response.headers.get("content-length")??0)>MAX_BYTES)fail(413,"Source exceeds the 2 MB text limit");
    const chunks:Uint8Array[]=[];let size=0;
    for await(const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      size+=chunk.byteLength;
      if(size>MAX_BYTES)fail(413,"Source exceeds the 2 MB text limit");
      chunks.push(chunk);
    }
    const text=Buffer.concat(chunks).toString("utf8");
    if(/^\s*<!doctype html|^\s*<html/i.test(text))fail(400,"Source must be plain text, not an HTML book page");
    return text;
  }
  fail(502,"Too many source redirects");
}
export function cleanSource(raw:string) {
  const normalized=raw.replace(/\r\n?/g,"\n").replace(/^\uFEFF/,"");
  const start=normalized.match(/\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\n/i);
  const end=normalized.match(/\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK/i);
  return normalized.slice(start ? start.index!+start[0].length : 0,end?.index??normalized.length).trim();
}
export async function ingestSource(bookId:number,input:SourceInput) {
  const book=await assertRights(bookId);
  if(input.sourceType==="public_domain"&&input.rightsStatus!=="public_domain")fail(400,"Public-domain sources require public-domain rights evidence");
  if(input.sourceType==="platform_owned"&&input.rightsStatus!=="owned")fail(400,"Owned manuscripts require ownership evidence");
  if(input.sourceType==="licensed"&&(input.rightsStatus!=="licensed"||book.rights_status!=="licensed"))fail(403,"Licensed manuscripts require a documented active adaptation license on the book");
  if(input.rightsStatus==="licensed"&&book.rights_status!=="licensed")fail(403,"Configure the catalog license before ingesting licensed text");
  if(!input.text&&!input.sourceUrl)fail(400,"Provide source text or an approved public-domain source URL");
  if(input.sourceUrl&&input.sourceType!=="public_domain")fail(400,"Manuscripts must be provided as admin-entered plain text");
  const text=cleanSource(input.text??await downloadGutenberg(input.sourceUrl!));
  if(text.length<100||text.includes("\0"))fail(400,"Provide at least 100 characters of valid plain text");
  if(Buffer.byteLength(text,"utf8")>MAX_BYTES)fail(413,"Source exceeds the 2 MB limit");
  const hash=createHash("sha256").update(text).digest("hex");
  const path=`folio/sources/${bookId}/${randomUUID()}.txt`;
  const file=objectStorageClient.bucket(process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID!).file(path);
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM books WHERE id=$1 FOR UPDATE",[bookId]);
    const prior=(await client.query("SELECT * FROM book_sources WHERE book_id=$1 AND checksum=$2",[bookId,hash])).rows[0];
    if(prior){await client.query("COMMIT");return prior;}
    const version=(await client.query("SELECT COALESCE(max(source_version),0)+1 n FROM book_sources WHERE book_id=$1",[bookId])).rows[0].n;
    await file.save(text,{contentType:"text/plain; charset=utf-8",resumable:false});
    const row=(await client.query(`INSERT INTO book_sources(book_id,source_type,source_text_location,source_url,source_version,rights_status,rights_notes,checksum,char_count)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[bookId,input.sourceType,path,input.sourceUrl??"",version,input.rightsStatus,input.rightsNotes,hash,text.length])).rows[0];
    await client.query("COMMIT");return row;
  }catch(e){await client.query("ROLLBACK");await file.delete({ignoreNotFound:true}).catch(()=>{});throw e;}finally{client.release();}
}
export async function loadSource(sourceId:number) {
  const record=(await pool.query("SELECT * FROM book_sources WHERE id=$1",[sourceId])).rows[0];
  if(!record)fail(404,"Source not found");
  await assertRights(record.book_id);
  if(!["public_domain","owned","licensed"].includes(record.rights_status)||!record.rights_notes.trim())fail(403,"Source rights evidence is missing");
  const [buffer]=await objectStorageClient.bucket(process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID!).file(record.source_text_location).download();
  if(createHash("sha256").update(buffer).digest("hex")!==record.checksum)fail(409,"Source checksum mismatch. Reingest the source instead of analyzing altered content.");
  return {record,text:buffer.toString("utf8")};
}
export type DetectedChapter={chapter_number:number;chapter_title:string;start_offset:number;end_offset:number};
export function detectChapters(text:string):DetectedChapter[] {
  const regex=/^[ \t]*(?:(?:chapter|letter|book|part)[ \t]+(?:\d+|[ivxlcdm]+)(?:[ \t]*[.:—-][^\n]*)?)[ \t]*$/gim;
  let headers=[...text.matchAll(regex)].map(m=>({title:m[0].trim(),start:m.index!}));
  // Ignore table-of-contents headings; keep actual text headings with substantial
  // content before the next heading, then deduplicate repeated TOC names.
  headers=headers.filter((h,i)=>(headers[i+1]?.start??text.length)-h.start>200);
  const last=new Map(headers.map(h=>[h.title.toLowerCase(),h.start]));
  headers=headers.filter(h=>last.get(h.title.toLowerCase())===h.start);
  if(headers.length===0) {
    const sections:DetectedChapter[]=[];
    for(let start=0;start<text.length;) {
      const limit=Math.min(start+30000,text.length);
      const paragraph=text.lastIndexOf("\n\n",limit);
      const end=limit<text.length&&paragraph>start+10000?paragraph:limit;
      sections.push({chapter_number:sections.length+1,chapter_title:`Source section ${sections.length+1}`,start_offset:start,end_offset:end});
      start=end;
    }
    return sections;
  }
  const result:DetectedChapter[]=[];
  if(headers[0]!.start>200)result.push({chapter_number:1,chapter_title:"Front matter and introduction",start_offset:0,end_offset:headers[0]!.start});
  headers.forEach((h,i)=>result.push({chapter_number:result.length+1,chapter_title:h.title,start_offset:h.start,end_offset:headers[i+1]?.start??text.length}));
  // Bound individual jobs without dropping a single source character.
  return result.flatMap(c=>{
    const pieces:DetectedChapter[]=[];
    for(let start=c.start_offset;start<c.end_offset;start+=60000)pieces.push({...c,chapter_title:c.end_offset-c.start_offset>60000?`${c.chapter_title} — source segment ${pieces.length+1}`:c.chapter_title,start_offset:start,end_offset:Math.min(c.end_offset,start+60000)});
    return pieces;
  }).map((c,i)=>({...c,chapter_number:i+1}));
}