# 8D Quality Agent

Enterprise manufacturing quality frontend for the AWS Agentic AI Hackathon / Intelligent Manufacturing track.

## Run locally

Requires Node.js 20.9 or newer and npm.

```powershell
cd 8d-quality-agent
npm install
npm run dev
```

Open http://127.0.0.1:3000. The dev server listens on 127.0.0.1 only, so it is not reachable from other machines on the network.

## Start the demo on Windows

Double-click `start-demo.bat` in the repo root, or run it from cmd:

```bat
start-demo.bat          :: SAP AI Core (default)
start-demo.bat mock     :: local agent in mock mode, no model, no network
```

It opens two cmd windows, "8D Agent" (`agent\.venv\Scripts\python -m quality_agent.app` with `AGENT_MODE` set) and "8D Web" (`npm run dev` with `NEXT_PUBLIC_AGENT_BACKEND=local` and `AGENT_URL=http://127.0.0.1:8080`), waits until http://127.0.0.1:3000 answers (up to about 90 s), then opens http://127.0.0.1:3000/workspace in the default browser. Close both windows to stop the demo.

Requirements: `npm install` done, and `agent\.venv` set up as in `agent/README.md`. Mode `sap` expects the service key at `%USERPROFILE%\sap-keys\aicore-key.json` and uses deployment `d1a82575de60e02a` with model name `gpt-5.4`; if the file is missing the script stops and suggests `start-demo.bat mock`. The script only checks that the key file exists; it never reads or prints it. It uses cmd, not PowerShell, because PowerShell on some machines blocks `npm.ps1`.

The header badge and sidebar show the mode: "SIMULATION MODE" without the agent backend; "LOCAL AGENT" until the first D4 proposal, then "LOCAL AGENT · MOCK" or "SAP AI CORE · <model>" from the agent's response. D1 to D3 and D5 to D8 stay simulated in every mode, and the workspace says so.

## Checks and production

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm start
```

## Demo walkthrough

1. Dashboard: view connected record counts, trends, and agent activity. Chart period toggles between three and six months; historical chart series are synthetic.
2. NCR Management: search and filter records, inspect details, or create a new text-based NCR. Attach a PDF, TXT, or DOCX up to 10 MB to simulate an upload. Only its filename is retained; file contents are not uploaded or parsed.
3. AI 8D Workspace: start with NCR-2026-104 at D4. Review historical cases; save your engineering findings. Record objective validation evidence when explicitly approving D4. Generate and review D5, then explicitly approve it to unlock D6. Rejecting or editing a discipline invalidates downstream approvals. Save editor changes before approving.
4. CAPA Monitoring: assign actions to engineers, filter overdue actions, and update statuses. Finish linked actions before closing D8. Escalation is a fixed rule, not AI: a CAPA whose due date is before today and that is not Completed is overdue, and the first time the app or the CAPA page sees it, a System event by "Workflow monitor (rule-based)" records the escalation to the quality lead (once per CAPA).
5. Knowledge Base: inspect synthetic historical causes, corrective actions, and evidence references. References are metadata, not attached files.
6. Audit Trail: review AI, human, and system events. Export filtered events as JSON.

Use the profile menu to reset the browser-local demo data. State persists in localStorage under `8d-quality-agent-v1`. By default all AI generation and assistant replies use deterministic synthetic suggestions with short simulated processing delays. No model, AWS service, authentication, or production backend is connected.

## Local agent (optional)

With `NEXT_PUBLIC_AGENT_BACKEND=local`, "Generate AI suggestion" on D4 calls `POST /api/agent/root-cause`, which forwards to the Python agent at `AGENT_URL` (default `http://127.0.0.1:8080`). See `agent/README.md` to run it. The agent defaults to mock mode (no model, no AWS); the draft and audit trail name the mode. Other disciplines stay simulated. After an agent proposal, the Root cause check uses the historical NCRs the agent's tools returned. The corpus is `data/synthetic-ncrs.json`; its five anchors (`data/anchor-history.json`) are the historical cases shown in the UI.

## Root cause check

`src/lib/validator.ts` enforces the agent's signature rule with pure functions. `validateRootCause(text, retrievedIds, options?)` returns `{ ok, issues: { code, message }[] }`:

- **Rule A, citation integrity** (`CITATION_NOT_RETRIEVED`): every NCR id in the text (`/NCR-\d{4}-\d{3}/`, case-insensitive) must be one of the retrieved historical NCRs. The id of the case under investigation is not counted as a citation.
- **Rule B, generic claims** (`GENERIC_CLAIM_UNSUPPORTED`): generic root-cause phrases in English or Indonesian (for example "human error", "operator error", "needs training", "lack of training", "carelessness", "kurang teliti", "kelalaian operator", "perlu training"; full list in `GENERIC_PHRASES`) are rejected unless BOTH hold: at least one retrieved NCR is cited, AND the text references objective current-lot evidence, defined as an evidence record id `PREFIX-NNN` with a prefix from `EVIDENCE_PREFIXES` (TR, GR, TI, TD, VT, PL, FV, FP, LAB) that is listed in the evidence registry (`evidenceRegistry` in `src/lib/data.ts`) as owned by the NCR being investigated. For NCR-2026-104, TR-104 counts; GR-032 (owned by NCR-2026-032) and TR-999 (not registered) do not. A generic phrase that is itself rejected or negated is not a claim when the marker is attached to it ("X is not supported", "X was ruled out", "ruled out X", "the cause is not X", "X bukan penyebab", "X tidak didukung"); a sentence that also asserts it as the cause ("root cause is X", "caused by X") or keeps it open ("X was not ruled out", "belum dikesampingkan") still counts.
- **Rule C, no evidence** (`ROOT_CAUSE_WITHOUT_EVIDENCE`): when nothing was retrieved, the text must state that evidence is missing and must not assert a root cause.
- **Rule E, uncited root cause** (`ROOT_CAUSE_UNCITED`): when cases were retrieved, a text that states a root cause must cite at least one retrieved NCR or one current-lot evidence id registered to the open NCR. "Root cause is low cure temperature." fails on any NCR.
- **Rule D, unverified hypothesis** (`ROOT_CAUSE_CLAIMED_CONFIRMED`, `ROOT_CAUSE_STATED_AS_FACT`, `MISSING_DATA_REQUIRED`): when no current-lot evidence is registered to the open NCR, a hypothesis from precedents is still allowed, but its status is `unverified_hypothesis`, the text must not state the root cause as confirmed, verified or validated (negations such as "not yet confirmed" are fine), a sentence that states the root cause must be worded as a hypothesis ("Hypothesis: ...", "may", "likely", "hipotesis"), and an agent proposal must list missing data. D4 approval stays locked until current-lot evidence is registered for that NCR. Agent responses carry `proposal_status` (`unverified_hypothesis`, `hypothesis_with_current_evidence` or `no_hypothesis`).
- **Rule F, sandbox data as evidence** (`SANDBOX_DATA_AS_EVIDENCE`): a sentence that mentions SAP sandbox or cached sample data (the agent tool `get_sap_quality_context`) and uses it as evidence, proof or confirmation is rejected, unless the sentence says it is not evidence. "Root cause is vent blockage per NCR-2025-084, confirmed by SAP sandbox data." fails; "SAP sandbox sample data (not current-lot evidence) shows similar lots." passes. Sandbox data never counts as current-lot evidence and never unlocks D4.

Evidence ownership is checked against a synthetic, in-code registry (`src/lib/data.ts`) plus the current-lot evidence engineers register in the D4 panel. In production the registry must come from the system of record, and the check only proves that a registered id is cited, not that the evidence supports the claim; the engineer still reviews it at the approval gate. Without a registry, `validateRootCause` falls back to the id syntax alone.

In the app, D4 approval is refused while the check fails (`reviewSection` throws `RootCauseRejectedError`). Generated or saved D4 drafts that fail, and blocked approvals, are logged as System audit events. The D4 editor shows a live Root cause check panel with the evidence registered to the open NCR. Approve is disabled while the editor has unsaved changes.

- **Rule G, upload as evidence** (`UPLOAD_AS_EVIDENCE`): a sentence that leans on an uploaded photo or document as evidence ("The photo shows pores near the boss.", "Foto menunjukkan porositas.") is rejected unless the same sentence cites a current-lot evidence id registered to the NCR ("The X-ray photo registered as TR-104 shows pores near the boss." passes) or says it is not evidence. Uploads are attachments; they never unlock D4.

### D5 corrective action check

With the local agent, D5 Generate (after D4 is approved) asks the agent for corrective actions. Each action must cite a retrieved NCR whose corrective action it reuses or a current-lot evidence id registered to the NCR; generic actions ("retrain operators", "increase inspection", "be more careful", "latih ulang operator", "tingkatkan inspeksi", "lebih hati-hati") need a registered evidence id; actions that contradict or ignore the approved D4 are withheld (`src/lib/action-validator.ts`, shared cases in `tests/fixtures/d5-action-cases.json`). In the editor the same check is shown for information only; D5 approval stays a human decision.

### Register current-lot evidence

D4 approval stays locked while no current-lot evidence is registered for the open NCR (Rule D). An engineer lifts the lock in the D4 panel under "Register current-lot evidence": enter an id, pick a type (Trial report, Parameter log, Inspection record, Measurement), add a short description and click "Register evidence". Only this human action adds evidence; agent responses never do. The id must use a prefix the root cause check recognises (`TR`, `GR`, `TI`, `TD`, `VT`, `PL`, `FV`, `FP`, `LAB`), a hyphen and at least three digits, for example `TR-100`, and must not be registered already (to any NCR). Each registration is a Human audit event with the id and type. Records persist in localStorage; a demo reset removes them.

The D4 text must still pass the check. Example on NCR-2026-100: register `TR-100`, change the D4 text to `Hypothesis: low spray pressure, supported by current-lot trial TR-100. Historical evidence missing: no precedent was retrieved.` (nothing is retrieved for this NCR without the agent, so Rule C still asks for "evidence missing" and no root cause assertion), save, then approve with a note. A text such as `Root cause is low spray pressure.` is still refused.

## Synthetic data and retrieval eval

```powershell
npm run data:generate                 # writes data/synthetic-ncrs.json, data/evidence-registry.json, data/eval-set.json
npm run eval:retrieval                # prints hit@1 and hit@3; add -- --verbose for per-case results
```

- `scripts/generate-synthetic-ncrs.ts` (seed 20261031, deterministic): 200 closed NCRs (NCR-2023-001 to NCR-2024-100) across die casting, CNC machining, assembly and coating, in 16 root cause families (`rootCauseCode`). Wording mixes English and Indonesian shop-floor abbreviations (NG, pcs, tdk, utk, dgn, mc). Some titles and symptoms are generic so only the cue sentence points to the cause; one family has a deliberate "new operator" red herring.
- `data/evidence-registry.json`: two evidence records per NCR (id, owner ncrId, kind, summary, date), ids `PREFIX-YYNNN`.
- `data/eval-set.json`: 30 held-out cases (one per family, the rest seeded random) with the D4 query text and the known root cause. `synthetic-ncrs.json` keeps all 200; the eval script removes held-out cases from the corpus.
- `scripts/eval-retrieval.ts`: keyword baseline (`KeywordRetriever` in `src/lib/retrieval.ts`, IDF-weighted term overlap over title, description, confirmed cause and action). A hit means one of the top 3 results shares the held-out case's root cause family. The `Retriever` interface is where a Bedrock Knowledge Base retriever plugs in.

Current result and its limit are recorded in VERIFICATION.md.

## Structure

- `src/app`: six Next.js App Router pages and shared styling.
- `src/components`: layout, shared tables, provider, and shadcn-style Button and Radix Dialog primitives.
- `src/lib/types.ts`: domain contracts.
- `src/lib/data.ts`: connected synthetic cases and draft generation.
- `src/lib/workflow.ts`: approval gates and business validation.
- `src/lib/validator.ts`: root cause check (rules A, B, C).
- `tests/workflow.test.ts`: approval and entity-integrity checks.
- `src/lib/retrieval.ts`: retriever interface, keyword baseline, hit@k.
- `src/lib/agent-client.ts`, `src/lib/agent-proxy.ts`, `src/app/api/agent/root-cause/route.ts`: typed agent client and server-side proxy.
- `agent/`: Python Strands agent, tools, validator port, AgentCore HTTP entry point, pytest suite.
- `tests/fixtures/`: validator cases and the agent response contract, shared by the TypeScript and Python suites.
- `scripts/`, `data/`: synthetic data generator, generated data, retrieval eval.
- `tests/validator.test.ts`: validator rules, evidence registry and D4 approval integration.
- `tests/retrieval.test.ts`: retriever, metric and synthetic dataset consistency.

For API integration, replace provider mutations with an API-backed repository while retaining domain types and workflow validation. Human approvals must eventually be enforced by a backend with authenticated identities, immutable audit storage, and objective evidence records.

Overdue labels compare action due dates with today's date. The seed dataset represents an October 2026 demo snapshot.
