import { z } from "zod/v4";
import { createHash } from "node:crypto";
export const shotTypes = ["ESTABLISHING","WIDE","MEDIUM","CLOSE_UP","EXTREME_CLOSE_UP","OVER_SHOULDER","POV","REACTION","DETAIL","INSERT","ENVIRONMENT","ACTION","TRANSITION"] as const;
export const movements = ["Slow Push In","Slow Pull Out","Pan Left","Pan Right","Pan Up","Pan Down","Static","Parallax"] as const;
export const motions = ["STATIC","PAN_ZOOM","PARALLAX","AI_VIDEO_RECOMMENDED","AI_VIDEO"] as const;
const text = z.string().min(1).max(1800);
export const directorShotSchema = z.object({
  shot_number: z.number().int().positive(), shot_type: z.enum(shotTypes), start_time: z.number().min(0),
  duration: z.number().min(.5).max(300), visual_subject: text, characters: z.array(z.number().int()).max(8),
  environment: z.number().int(), reference_ids: z.array(z.number().int().positive()).min(1).max(8),
  composition: text, camera_angle: text, camera_distance: text, camera_movement: z.enum(movements),
  action: text, emotion: text, lighting: text, continuity_notes: text, generation_prompt: text,
  narration_beat: z.string().min(3).max(300), motion_recommendation: z.enum(motions),
});
export type DirectedShot = z.infer<typeof directorShotSchema>;
export const pacingSchema = z.object({
  shortSeconds: z.number().min(5).max(30).default(12), mediumSeconds: z.number().min(15).max(90).default(30),
  shortMax: z.number().int().min(1).max(4).default(2), mediumMax: z.number().int().min(2).max(6).default(4),
  longMax: z.number().int().min(4).max(10).default(8),
}).refine(p => p.mediumSeconds > p.shortSeconds, "Medium duration must exceed short duration");
export const actionSchema = z.object({
  action: z.enum(["direct","re_direct_scene","generate","approve","edit","regenerate","upgrade_video","assemble","review","retry","compare"]),
  runId: z.number().int().positive().optional(), sceneId: z.number().int().positive().optional(),
  shotId: z.number().int().positive().optional(), versionId: z.number().int().positive().optional(),
  jobId: z.number().int().positive().optional(), revision: z.number().int().min(0).optional(),
  pacing: pacingSchema.optional(),
  changes: directorShotSchema.pick({shot_type:true,composition:true,camera_angle:true,camera_distance:true,camera_movement:true,motion_recommendation:true}).partial().optional(),
});
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k,sorted(v)]));
  return value;
}
export const definitionHash = (value: unknown) => createHash("sha256").update(JSON.stringify(sorted(value))).digest("hex");
