# Manual retrieval eval set

The synthetic eval set saturates (see VERIFICATION.md). This folder is for queries written by people, independently of the generator. No cases have been written yet.

## Adding a case

1. Create `data/manual-eval/cases.json` if it does not exist, as a JSON array. Each entry must match `schema.json`.
2. Pick a root cause family (`knownRootCauseCode`) from the enum in `schema.json`. The corpus in `data/synthetic-ncrs.json` has 12 or 13 records per family.
3. Write `query` as an engineer would at D4: title and description, symptoms, quantities, what was noticed. Do not name the root cause, and do not copy sentences from `scripts/generate-synthetic-ncrs.ts` or the corpus.
4. Vary language (`en`, `id`, `mixed`) and wording across cases. Include some cases where the cue is weak or misleading.
5. Have a second person check the label and fill `reviewedBy`.
6. Number ids `EVAL-M-001`, `EVAL-M-002`, ... without gaps.

Run: `npm run eval:retrieval -- --set data/manual-eval/cases.json`
