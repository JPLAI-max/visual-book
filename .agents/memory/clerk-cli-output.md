---
name: Clerk CLI output
description: Structured output from development Clerk SDK scripts can include an unsolicited telemetry notice.
---
Development Clerk SDK commands may print an “Attention” telemetry notice before the script's JSON output.

**Why:** Parsing the entire stdout as JSON failed even though the SDK operation succeeded.

**How to apply:** When chaining SDK CLI results into another operation, extract the designated structured JSON line instead of parsing all stdout. Keep temporary authentication tickets inside the private operation; do not print them for inspection.
