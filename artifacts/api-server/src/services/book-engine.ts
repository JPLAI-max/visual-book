// Compatibility entry point. All new planning uses the staged, full-source
// Book Intelligence pipeline; the excerpt-only engine has been retired.
export { startIntelligenceEngine as startBookEngine } from "./intelligence/worker";