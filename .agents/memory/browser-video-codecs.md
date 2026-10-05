---
name: Browser video codec capabilities
description: Distinguish codec support from corrupt files or range-serving failures.
---

Confirm browser codec capabilities before treating a valid local video as corrupted or an HTTP streaming failure. Prefer WebM VP9/Opus for the local-rendering baseline when proprietary codecs are unavailable; retain existing assets rather than regenerate paid imagery or narration.

**Why:** The verification Chrome 140/Linux browser returned an empty canPlayType result for H.264 and AAC, despite valid full MP4 streams that FFmpeg decoded correctly. VP9/Opus returned "probably".

**How to apply:** On a DEMUXER_ERROR_NO_SUPPORTED_STREAMS failure, compare canPlayType for both container/codec combinations with ffprobe and full local decode. Changing container/codec does not require consumer-player changes or new paid generation.