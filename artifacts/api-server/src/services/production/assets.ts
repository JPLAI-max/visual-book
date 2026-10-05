import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { objectStorageClient } from "../../lib/objectStorage";
export async function saveAsset(input: {
  productionId: number; takeId?: number; referenceId?: number; kind: string; bytes: Buffer;
  mime: string; provider: string; model: string; metadata?: Record<string, unknown>;
}) {
  const extension = input.mime === "image/png" ? "png" : input.mime === "audio/wav" ? "wav" : input.mime === "text/vtt" ? "vtt" : input.mime==="video/webm"?"webm":"mp4";
  const objectPath = `folio/production/${input.productionId}/${randomUUID()}.${extension}`;
  const file = objectStorageClient.bucket(process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID!).file(objectPath);
  await file.save(input.bytes, {resumable:false,metadata:{contentType:input.mime}});
  return (await pool.query(`INSERT INTO media_production_assets(production_id,take_id,reference_id,kind,object_path,mime_type,provider,model,cost,metadata)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [input.productionId,input.takeId ?? null,input.referenceId ?? null,input.kind,objectPath,input.mime,input.provider,input.model,
      ["ffmpeg","local"].includes(input.provider) ? 0 : null,JSON.stringify(input.metadata ?? {})])).rows[0];
}
export async function readAsset(id: number): Promise<Buffer> {
  const asset = (await pool.query("SELECT object_path FROM media_production_assets WHERE id=$1", [id])).rows[0];
  if (!asset) throw new Error("Production asset not found");
  const [bytes] = await objectStorageClient.bucket(process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID!).file(asset.object_path).download();
  return bytes;
}
export const assetUrl = (id: number | null) => id ? `/api/production/media/${id}` : "";