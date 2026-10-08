import type { TAsset, TimelineScene } from '../timeline/types';
export interface Quality { score?: number; checks?: Record<string, unknown> | unknown[]; notes?: string | string[] }
export interface Version { id: number; status: string; image_asset_id?: number | null; video_asset_id?: number | null; image_url?: string | null; video_url?: string | null; quality?: Quality | null; estimatedCost?: number; actualCost?: number | null; spec?: Record<string, unknown> }
export interface Blueprint {
  shot_number: number; shot_type: string; start_time: number; duration: number; visual_subject?: string; characters?: number[]; environment?: number;
  composition?: string; camera_angle?: string; camera_distance?: string; camera_movement?: string; action?: string; emotion?: string; lighting?: string;
  continuity_notes?: string; generation_prompt?: string; motion_recommendation?: string; narration_beat?: string; rationale?: string;
}
export interface DShot { id: number; blueprint: Blueprint; versions: Version[]; current_version_id?: number | null }
export interface DScene { id: number; scene_id: number; scene_number: number; title: string; continuity?: string | {continuity_notes?: string;[key:string]:unknown}; shots: DShot[] }
export interface Run { id: number; status: string; created_at: string; pacing?: Record<string, number>; baseline?: { scenes: TimelineScene[] }; definition?: {scenes?:TimelineScene[]}; directed_revision?: number | null; scenes: DScene[] }
export interface DJob { id: number; run_id: number; shot_id?: number | null; kind: string; status: string; error?: string | null }
export interface Review { id: number; run_id: number; status: string; result?: { checks?: unknown; recommendations?: unknown }; definition_hash?: string }
export interface Cost { maxSpend?: number; reservedSpend?: number; actualCost: number | null; actualCostComplete?: boolean; imageCount?: number; videoShotCount?: number; estimatedVideoUpgradeCost?: number; notice?: string }
export interface DirectorDoc {
  chapter?: { id: number; book_title: string; title: string }; runs: Run[]; jobs: DJob[]; reviews: Review[]; cost?: Cost;
  video?: { available: boolean; provider: string; reservation: number };
  comparison?: { current?: { scenes: TimelineScene[] } | null; directed?: { scenes: TimelineScene[] } | null } | null;
  assets: TAsset[];
}
export const SHOT_TYPES = ['ESTABLISHING', 'WIDE', 'MEDIUM', 'CLOSE_UP', 'EXTREME_CLOSE_UP', 'OVER_SHOULDER', 'POV', 'REACTION', 'DETAIL', 'INSERT', 'ENVIRONMENT', 'ACTION', 'TRANSITION'];
export const ANGLES = ['eye level', 'low angle', 'high angle', 'overhead', 'dutch'];
export const DISTANCES = ['extreme wide', 'wide', 'medium', 'close', 'extreme close'];
export const MOVES = ['Slow Push In', 'Slow Pull Out', 'Pan Left', 'Pan Right', 'Pan Up', 'Pan Down', 'Static', 'Parallax'];
export const MOTIONS = ['STATIC', 'PAN_ZOOM', 'PARALLAX', 'AI_VIDEO_RECOMMENDED', 'AI_VIDEO'];
export const money = (n?: number | null) => (n == null ? 'unknown' : `$${n.toFixed(2)}`);
export const qcPass = (v?: Version) => {
  const q = v?.quality; if (!v || !v.image_asset_id || !q || typeof q.score !== 'number' || q.score < 80) return false;
  const c = q.checks; const vals = Array.isArray(c) ? c : c && typeof c === 'object' ? Object.values(c) : [];
  return vals.length > 0 && vals.every((x) => x === true);
};
