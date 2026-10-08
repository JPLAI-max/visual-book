export interface ShotVideoProvider {
  generateVideoFromImage(input: { image: Buffer; duration: number; motion: string; action: string; prompt: string; resolution: "1080p" | "720p" }): Promise<{ bytes: Buffer; mime: "video/mp4" | "video/webm"; usage?: unknown }>;
}
const providers = new Map<string, ShotVideoProvider>();
// Provider integrations register adapters here; callers never depend on a provider-specific SDK.
export function registerShotVideoProvider(name: string, adapter: ShotVideoProvider) { providers.set(name, adapter); }
export function shotVideoProvider(name: string) {
  const provider = providers.get(name);
  if (!provider) throw Object.assign(new Error("No image-to-video provider is configured. Recommended shots keep restrained camera motion."), { status: 409 });
  return provider;
}
export const hasShotVideoProvider = (name: string) => providers.has(name);
