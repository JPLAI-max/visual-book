import { getAuth, clerkClient } from "@clerk/express";
import type { Request, RequestHandler } from "express";
import { pool } from "@workspace/db";
import { assertRights } from "./catalog";

export function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}
export function readerId(req: Request): string | null { return getAuth(req).userId; }
export const signedIn: RequestHandler = async (req, res, next) => {
  const id = readerId(req);
  if (!id) { res.status(401).json({ error: "Sign in to save your progress, library, requests, and feedback." }); return; }
  await pool.query("INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING", [id]);
  next();
};
export async function isAdmin(req: Request): Promise<boolean> {
  const id = readerId(req);
  if (!id) return false;
  const configured = (process.env.ADMIN_USER_IDS ?? "").split(",").map(v => v.trim()).filter(Boolean);
  if (configured.includes(id)) return true;
  const user = await clerkClient.users.getUser(id);
  return user.publicMetadata.role === "admin";
}
export const adminOnly: RequestHandler = async (req, res, next) => {
  if (!await isAdmin(req)) { res.status(403).json({ error: "Editorial access requires an administrator account." }); return; }
  next();
};
export function parseId(raw: unknown): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) fail(400, "Invalid identifier");
  return id;
}
export async function validateContext(bookId: number, chapterId?: number, sceneId?: number) {
  const { rows } = await pool.query(`SELECT b.id, e.id edition_id, c.id chapter_id, c.duration, c.sort_order,
    s.id scene_id, s.current_version_id FROM books b
    LEFT JOIN visual_editions e ON e.book_id=b.id AND e.published=true
    LEFT JOIN chapters c ON c.visual_edition_id=e.id AND ($2::int IS NULL OR c.id=$2)
    LEFT JOIN scenes s ON s.chapter_id=c.id AND ($3::int IS NULL OR s.id=$3)
    WHERE b.id=$1 AND ($2::int IS NULL OR c.id IS NOT NULL) AND ($3::int IS NULL OR s.id IS NOT NULL)`, [bookId, chapterId ?? null, sceneId ?? null]);
  if (!rows.length) fail(404, "Book not found");
  if (chapterId && !rows[0].chapter_id) fail(400, "Chapter does not belong to this published edition");
  if (sceneId && !rows[0].scene_id) fail(400, "Scene does not belong to this chapter");
  if (chapterId) await assertRights(bookId);
  if (!sceneId) rows[0].current_version_id=null;
  return rows[0];
}