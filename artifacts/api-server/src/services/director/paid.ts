import { pool } from "@workspace/db";
// Same production-wide reservations as the legacy generator; failed/uncertain calls consume their reservation.
export async function directorPaid<T>(jobId: number, kind: string, provider: string, model: string, estimate: number, call: () => Promise<T>): Promise<T> {
  const client = await pool.connect(); let requestId: number;
  try {
    await client.query("BEGIN");
    const job = (await client.query(`SELECT j.*,r.production_id FROM director_jobs j JOIN director_runs r ON r.id=j.run_id
      WHERE j.id=$1 AND j.status='running' AND j.lease_until>now() FOR UPDATE OF j`, [jobId])).rows[0];
    if (!job) throw new Error("Paid direction calls require a leased durable job");
    const production = (await client.query("SELECT * FROM media_productions WHERE id=$1 FOR UPDATE", [job.production_id])).rows[0];
    const spent = Number((await client.query("SELECT COALESCE(sum(estimated_cost),0) n FROM media_production_requests WHERE metadata->>'directorJobId'=$1", [String(jobId)])).rows[0].n);
    if (!Number.isFinite(estimate) || estimate <= 0) throw new Error("Positive cost reservation required");
    if (Number(production.reserved_spend) + estimate > production.max_spend + .000001 ||
      spent + estimate > (production.configuration.jobMaxSpend ?? 2) + .000001)
      throw Object.assign(new Error("Generation budget exhausted. Retained assets are safe; raise the cap explicitly or review before retrying."), {status:402});
    await client.query("UPDATE media_productions SET reserved_spend=reserved_spend+$2 WHERE id=$1", [production.id,estimate]);
    requestId = (await client.query(`INSERT INTO media_production_requests(production_id,kind,provider,model,estimated_cost,metadata)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [production.id,kind,provider,model,estimate,JSON.stringify({directorJobId:jobId,runId:job.run_id,shotId:job.shot_id,versionId:job.version_id})])).rows[0].id;
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  try {
    const value = await call();
    await pool.query("UPDATE media_production_requests SET status='completed',metadata=metadata||$2::jsonb WHERE id=$1", [requestId,JSON.stringify({usage:(value as {usage?:unknown}).usage ?? null})]);
    return value;
  } catch (error) {
    await pool.query("UPDATE media_production_requests SET status='failed',metadata=metadata||$2::jsonb WHERE id=$1", [requestId,JSON.stringify({error:String((error as Error).message).slice(0,800)})]);
    throw error;
  }
}
