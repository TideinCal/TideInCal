# SSMF baseline raw export

`GET /api/admin/ssmf-baseline` emits neutral, aggregate-only Tide application evidence. It does not claim that the export is approved by Joe or accepted by Tidy.

Before the installed Tidy evidence validator can accept an export, a Tidy-side deterministic wrapper must inject the separately recorded Joe approval metadata and collection provenance. The wrapper must bind that metadata to the raw export's `source`, `window`, and `export_context.campaign_id`; it must not accept approval identity from the CalendarWaves request or raw export.

This repository intentionally does not implement that wrapper or any downstream submission.
