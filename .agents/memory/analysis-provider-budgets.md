---
name: Analysis provider budgets
description: Non-obvious model-budget and unit failures encountered during full-book analysis.
---

Completion budgets can include reasoning tokens, not just visible JSON. Keep canonical identity discovery separate from detailed per-entity analysis, rather than increasing limits for a large character-bible response.

**Why:** A full-book character extraction exhausted the completion budget before producing valid JSON. Immediate retries then hit provider rate limits, despite prior chapter analyses being valid.

**How to apply:** When changing models or expanding structured fields, keep jobs independently bounded and retain successful results. Rate-limit cooldowns must also pause other queued calls sharing that provider: per-job waits alone let independent stages exhaust their own retry budgets on the same limit. Never restart the whole book to repair one failed stage.

Runtime fields must explicitly identify their unit in both the schema and the prompt.

**Why:** Some chapter responses interpreted estimated runtime as minutes while validation expected seconds, repeatedly failing a numeric minimum.

**How to apply:** Preserve seconds as the stored unit, describe it explicitly, and feed validation errors into retries rather than weakening validation.