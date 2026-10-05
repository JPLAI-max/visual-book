import { pool } from "@workspace/db";
import { mediaProviders } from "./adapters";
export const MODES = ["STATIC", "PAN_ZOOM", "PARALLAX", "AI_VIDEO"] as const;
export type MotionType = typeof MODES[number];
export type ProductionConfig = {
  imageProvider: string; imageModel: string; imageQuality: "high";
  voiceProvider: string; voiceModel: string; voiceId: string; motionProvider: string;
  resolution: "720p" | "1080p"; qualityThreshold: number; maxRetries: number; jobMaxSpend: number;
  imageReservation: number; voiceReservation: number; qualityReservation: number;
  aiVideoAvailable: boolean; aiVideoProvider:string; aiVideoReservation:number; qualityModel:string; estimateNotice: string;
};
export async function productionConfig(): Promise<ProductionConfig> {
  const settings = (await pool.query("SELECT value FROM settings WHERE key='media_production'")).rows[0]?.value ?? {};
  return {
    imageProvider: process.env.FOLIO_IMAGE_PROVIDER ?? "openai",
    imageModel: process.env.FOLIO_IMAGE_MODEL ?? "gpt-image-1", imageQuality: "high",
    voiceProvider: process.env.FOLIO_VOICE_PROVIDER ?? "openai",
    voiceModel: process.env.FOLIO_VOICE_MODEL ?? "gpt-audio",
    voiceId: settings.voiceId ?? "alloy", motionProvider: process.env.FOLIO_MOTION_PROVIDER ?? "ffmpeg",
    resolution: settings.resolution ?? "1080p", qualityThreshold: settings.qualityThreshold ?? 80,
    maxRetries: settings.maxRetries ?? 1,
    jobMaxSpend: settings.jobMaxSpend ?? 2,
    imageReservation: Number(process.env.FOLIO_IMAGE_RESERVATION_USD ?? .4),
    voiceReservation: Number(process.env.FOLIO_VOICE_RESERVATION_USD ?? .35),
    qualityReservation: Number(process.env.FOLIO_QUALITY_RESERVATION_USD ?? .05),
    aiVideoProvider:process.env.FOLIO_AI_VIDEO_PROVIDER ?? "",
    aiVideoAvailable:mediaProviders.aiVideoAvailable(process.env.FOLIO_AI_VIDEO_PROVIDER ?? ""),
    aiVideoReservation:Number(process.env.FOLIO_AI_VIDEO_RESERVATION_USD ?? 2),
    qualityModel:process.env.FOLIO_QUALITY_MODEL ?? "gpt-5.4-mini",
    estimateNotice: "Budget is enforced against conservative configured per-call reservations, including failed calls. These are estimates, not a provider quote or actual invoice. Actual monetary costs remain unknown when the provider does not report them. Local camera motion and assembly incur no external generation fee.",
  };
}
export async function paidCall<T>(productionId: number, kind: string, provider: string, model: string, estimate: number,
  target: {takeId?: number; referenceId?: number}, call: () => Promise<T>): Promise<{value: T; requestId: number}> {
  if (!Number.isFinite(estimate) || estimate <= 0) throw new Error("A positive per-call cost reservation is required");
  const client = await pool.connect();
  let requestId: number;
  try {
    await client.query("BEGIN");
    const p = (await client.query("SELECT * FROM media_productions WHERE id=$1 FOR UPDATE", [productionId])).rows[0];
    if (!p || p.reserved_spend + estimate > p.max_spend + .000001)
      throw Object.assign(new Error("Generation budget exhausted. Saved assets are retained; raise the budget explicitly before retrying."), {status: 402});
    const stage=target.referenceId?"reference":kind==="voice"?"voice":kind==="ai_video"?"motion":"image";
    const job=(await client.query("SELECT id FROM media_production_jobs WHERE production_id=$1 AND stage=$2 AND target_id=$3 AND status='running' LIMIT 1",
      [productionId,stage,target.referenceId??target.takeId])).rows[0];
    if(!job)throw new Error("Paid calls require a durable running production job");
    const spent=(await client.query("SELECT COALESCE(sum(estimated_cost),0)::float n FROM media_production_requests WHERE production_id=$1 AND metadata->>'jobId'=$2",
      [productionId,String(job.id)])).rows[0].n;
    if(spent+estimate>(p.configuration.jobMaxSpend??2)+.000001)throw Object.assign(new Error("Per-job reservation limit exhausted. Explicitly adjust the job limit before retrying."),{status:402});
    await client.query("UPDATE media_productions SET reserved_spend=reserved_spend+$2 WHERE id=$1", [productionId, estimate]);
    requestId = (await client.query(`INSERT INTO media_production_requests(production_id,kind,provider,model,estimated_cost,take_id,reference_id,metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [productionId,kind,provider,model,estimate,target.takeId ?? null,target.referenceId ?? null,JSON.stringify({jobId:job.id})])).rows[0].id;
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  try {
    const value = await call();
    await pool.query("UPDATE media_production_requests SET status='completed' WHERE id=$1", [requestId]);
    return {value, requestId};
  } catch (e) {
    await pool.query("UPDATE media_production_requests SET status='failed',metadata=metadata||$2::jsonb WHERE id=$1",
      [requestId, JSON.stringify({error: e instanceof Error ? e.message.slice(0,500) : "Provider failed"})]);
    // Never refund a reservation on an uncertain transport failure: the provider may have billed it.
    if(e instanceof Error){
      const status=(e as Error&{status?:number}).status;
      Object.assign(e,{stopAutomaticRetries:status===undefined||status>=500||[400,401,403,404,422].includes(status)});
    }
    throw e;
  }
}