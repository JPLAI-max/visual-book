import { z } from "zod/v4";
export const shotSchema = z.object({
  id: z.string().min(1).max(100), assetId: z.number().int().positive(),
  start: z.number().min(0), duration: z.number().min(.5).max(300),
  motionType: z.enum(["STATIC", "PAN_ZOOM", "PARALLAX", "AI_VIDEO"]),
  preset: z.enum(["Slow Push In", "Slow Pull Out", "Pan Left", "Pan Right", "Pan Up", "Pan Down", "Static", "Parallax"]),
  crop: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(.2).max(1), height: z.number().min(.2).max(1) }),
  zoomStart: z.number().min(1).max(1.15), zoomEnd: z.number().min(1).max(1.15),
  panDirection: z.enum(["left", "right", "up", "down", "none"]),
  transitionIn: z.enum(["CUT", "FADE"]), transitionOut: z.enum(["CUT", "FADE"]),
  foregroundAssetId: z.number().int().positive().optional(),
});
export const sceneSchema = z.object({
  id: z.number().int().positive(), title: z.string().max(300), narration: z.string().max(15000),
  duration: z.number().positive().max(600), audioAssetId: z.number().int().positive(), captionAssetId: z.number().int().positive(),
  shots: z.array(shotSchema).min(1).max(30),
});
export const definitionSchema = z.object({ scenes: z.array(sceneSchema).min(1).max(30) });
export type Shot = z.infer<typeof shotSchema>;
export type TimelineScene = z.infer<typeof sceneSchema>;
export type Definition = z.infer<typeof definitionSchema>;
export type Asset = { id: number; kind: "image" | "video" | "audio" | "captions"; mime: string; url: string; name: string; foregroundApproved: boolean };
export function validateTimeline(definition: Definition, original: TimelineScene[], assets: Asset[]) {
  if (definition.scenes.length !== original.length) throw new Error("Keep all source scenes; reorder shots within each scene instead.");
  const ids = new Set<string>();
  definition.scenes.forEach((scene, index) => {
    const source = original[index]!;
    if (scene.id !== source.id || scene.narration !== source.narration || scene.audioAssetId !== source.audioAssetId ||
      scene.captionAssetId !== source.captionAssetId || Math.abs(scene.duration - source.duration) > .001)
      throw new Error("Narration, source scene order and scene duration must remain unchanged.");
    let end = 0;
    for (const shot of scene.shots) {
      if (ids.has(shot.id)) throw new Error("Every shot must have a unique identifier.");
      ids.add(shot.id);
      if (Math.abs(shot.start - end) > .025) throw new Error("Shots must be consecutive, with no timing gaps or overlaps.");
      end += shot.duration;
      if (shot.crop.x + shot.crop.width > 1.001 || shot.crop.y + shot.crop.height > 1.001) throw new Error("Crop must stay inside the source image.");
      const asset = assets.find(a => a.id === shot.assetId);
      if (!asset || (shot.motionType === "AI_VIDEO" ? asset.kind !== "video" : asset.kind !== "image")) throw new Error("Choose an approved asset matching this shot's visual mode.");
      if (shot.motionType === "PARALLAX" && !assets.some(a => a.id === shot.foregroundAssetId && a.foregroundApproved))
        throw new Error("Parallax requires a real approved transparent foreground layer.");
    }
    if (Math.abs(end - scene.duration) > .05) throw new Error("Shot durations must exactly cover the existing narration duration.");
  });
}
