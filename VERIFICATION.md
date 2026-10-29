# Verification status

Last verified: 2026-10-28, through the phase list (automated checks below; earlier entries keep their own dates), branch `feat/validator-and-data`, Windows 11, Node.js v24.19.0, npm 11.17.0, Python 3.12.10.

## Passed (run by the agent, output observed)

- `npm install`: 427 packages added. npm reports 5 high severity advisories, all in devDependencies (`npm audit --omit=dev` reports 0). `npm audit fix --force` was not run.
- `npm run typecheck`: `tsc --noEmit`, exit 0, no errors.
- `npm run lint`: `eslint .`, exit 0, no errors or warnings.
- `npm test` (2026-10-28, Phase 0 additions): 150 tests, 150 pass, 0 fail. Adds: the D4 banner text for each combination of retrieved cases and registered current-lot evidence (no precedent retrieved plus TR-100 registered names both), the placeholder wording of the SAP timeline entry (cached sample, or a missing flag, says "Content is a placeholder, not SAP data"; only `live sandbox` with `placeholder: false` drops it) and its shape check, and the duration format (seconds, one decimal).
- `npm test` (2026-10-28): 148 tests, 148 pass, 0 fail. Adds to the 2026-10-23 suite below: evidence registration (NCR-2026-100 locked, register TR-100, a draft citing TR-100 approves, `Root cause is low spray pressure.` is still refused before and after agent retrieval, Human audit event, id validation and duplicates, an agent response with evidence-like fields adds no evidence and keeps D4 locked, the agent request carries UI-registered evidence, a reset clears it), the overdue rule and the once-only rule-based escalation, 7 shared fixture cases for Rule F, the `sap_context` timeline entries, and Request revision on D5 after D4 approval (passes).
- `npm test` (2026-10-23): 131 tests, 131 pass, 0 fail (9 workflow including the D5 draft wording, the reset-confirmation helper and agent failure and success transitions, 99 shared validator fixture cases including 12 for Rule D, 19 for Rule B negation context, 3 recorded SAP AI Core outputs and 21 for Rule E and the hypothesis wording, 7 D4, registry and approval-lock integration, 5 retrieval and dataset, 11 agent client and proxy including the mode labels and the recorded SAP D4 draft).
- `pytest` in `agent/` (2026-10-28, Phase 0 additions): 176 passed. Adds: the service calls `get_sap_quality_context` exactly once per D4 request, with the mock engine and with an engine that calls no tool; the engine receives the result as `sap_context` and the model prompt marks it "PLACEHOLDER content, not SAP data" and not evidence; the Strands agent no longer has the SAP tool (two tools). `sap_context` entries carry `placeholder`; the contract fixture was regenerated.
- `pytest` in `agent/` (2026-10-28): 173 passed. Adds: the 7 Rule F fixture cases, 11 SAP Hub adapter and tool tests with `httpx.MockTransport` and a fake key (settings, cached placeholder without HTTP, `APIKey` header and URL, OData V2 and V4 rows, HTTP 401, non-JSON, network error and unreadable key fall back to the cached sample without the key in the result, the tool adds no NCR id or evidence, sandbox context leaves NCR-2026-100 unverified, a proposal confirmed by sandbox data is rejected with SANDBOX_DATA_AS_EVIDENCE), 9 outcome classifications for `scripts/check_bedrock.py` with constructed botocore errors, and a conftest guard that fails any real httpx transport. The contract fixture `agent-response-mock-104.json` gained `sap_context` (cached sample).
- `pytest` in `agent/` (strands-agents 1.61.1, bedrock-agentcore 1.24.2, openai 2.54.0, pytest 9.1.1): 146 passed (checked 2026-10-23). Includes the same 99 validator fixture cases, 5 Rule B and Rule D service tests, the agent response contract for NCR-2026-104, 14 SAP AI Core tests with mocked HTTP and fake keys, and a guard that fails any test creating an AWS client or calling an AWS API.
- Next.js upgraded from 16.4.0 to 16.4.1 (2026-10-23, branch `chore/next-16.4.1-security`, fast-forwarded into this branch). 16.4.0 is affected by GHSA-p3m5-59mp-jv5r (CVE-2026-94482, high, Server Actions DoS), GHSA-2464-fhr4-w9xw (critical, Image Optimization RCE through `sharp` on glibc Linux) and GHSA-673q-mjm6-r5xr (critical, `use cache` RCE with typed arrays); 16.4.1 is the first patched 16.x release for all three (GitHub Advisory Database, npm bulk advisory API). The lockfile now resolves `sharp` 0.35.5. This app has no Server Actions, `use cache` or `next/image`, and runs on Windows, so it was probably not exploitable, but it ran an affected version. After the upgrade, `npm audit --omit=dev` reports 0 vulnerabilities and the npm advisory API returns none for next 16.4.1.
- `npm run typecheck`, `npm run lint` and `npm run build` (2026-10-28): exit 0, no errors. The prerendered `/workspace` HTML contains "Register current-lot evidence" and "Register evidence"; `/capa` contains "rule-based" and "not AI".
- `npm run build` (re-run 2026-10-23 after the upgrade): Next.js 16.4.1 (Turbopack), succeeded on the first attempt. On 16.4.0 the first attempt had stopped with `SecurityFatalError` (Next.js's upgrade reminder for coding agents, see the advisories above) and only a retry within five minutes continued; 7 pages prerendered as static content, `/api/agent/root-cause` dynamic. The prerendered `/workspace` HTML contains the D4 draft "Candidate precedents (historical, not validated): NCR-2025-084 ...", "Root cause check: pass" and "Registered current-lot evidence for NCR-2026-104: TR-104 (Trial report), PL-104 (Parameter log)".
- `npm run data:generate`: "seed 20261031: 200 NCRs (5 anchors), 400 evidence records, 30 eval cases held out". Running it twice produced byte-identical files (same SHA-256).
- `npm run eval:retrieval`: corpus 170 NCRs, 30 held-out cases, keyword baseline: hit@1 = 27/30 = 0.9, hit@3 = 30/30 = 1. This is a regression check on synthetic data, not a claim about impact or real-world accuracy (see below).
- Local end to end (mock mode, no AWS): `python -m quality_agent.app` served `GET /ping` -> `{"status":"Healthy",...}`. With `NEXT_PUBLIC_AGENT_BACKEND=local` and `npm run dev`, `POST /api/agent/root-cause` for NCR-2026-104 returned HTTP 200 with a body identical to `tests/fixtures/agent-response-mock-104.json` (accepted, retrieved NCR-2025-084, NCR-2023-002, NCR-2023-007). An invalid action returned HTTP 400; with the agent stopped the route returned HTTP 502 "Agent unavailable ...". The agent log contained only the startup line (mode, model id None, region, corpus size).
- SAP AI Core smoke test (2026-10-21, run by the team with the real service key; result reported to the agent, raw output not seen by the agent): `agent/scripts/smoke_sap.py` for NCR-2026-104 returned mode `sap`, model gpt-5.4, `accepted: true`, validation ok, cited NCR-2025-084 and NCR-2023-002, both in `retrieved`. One run; output is model-generated and can differ between runs.
- SAP AI Core rejection smoke test (2026-10-21, early morning, run by the team, mode sap, gpt-5.4; raw output pasted to the agent and recorded verbatim at the end of this file):
  - Case a, NCR-2026-100 without current-lot evidence: `proposal_status: unverified_hypothesis`, accepted, validation ok, five `missing_data` items, cited NCR-2024-063, NCR-2023-030 and NCR-2024-049, all in `retrieved`. Expectation met.
  - Case b, engineer note pushing "operator human error": the script printed "EXPECTATION MET", but this was a false positive. The model's `raw_proposal` rejected the generic claim ("The requested 'operator human error' cause is not supported because ..."); Rule B matched the phrase alone and rejected the proposal. Fixed the same day: Rule B now ignores generic phrases that are themselves rejected or negated (TS and Python, shared fixture including this exact text), and the script reports an OUTCOME and treats a validator false positive as NOT MET. Replaying the reported response through the updated check gives `validator_false_positive`; the same raw text passes the fixed validator as `unverified_hypothesis`.
- SAP AI Core rejection smoke test, re-run after the Rule B fix (2026-10-21, run by the team, mode sap, gpt-5.4; output pasted to the agent as a field summary and recorded verbatim at the end of this file):
  - Case a: `proposal_status: unverified_hypothesis`, accepted, validation ok, 5 `missing_data` items, cited NCR-2024-063, NCR-2023-030 and NCR-2024-049, all in `retrieved`. EXPECTATION MET.
  - Case b: `proposal_status: unverified_hypothesis`, accepted, validation ok, `raw_proposal` null, cited NCR-2025-084, NCR-2023-002 and NCR-2023-007, all in `retrieved`. OUTCOME `model_declined`, EXPECTATION MET.
  - Note: in this run the model put its rejection of "operator human error" in `missing_data`, not in `root_cause`, so the Rule B negation-context path was not exercised by this run. That path is covered by the shared fixture case built from the exact `raw_proposal` text of the earlier run.
- Mode labels in the prerendered `/workspace` HTML (2026-10-22): the default build contains "SIMULATION MODE", "Simulated intelligence." and "Demo processing uses predefined suggestions. No real AI inference."; a build with `NEXT_PUBLIC_AGENT_BACKEND=local` contains "LOCAL AGENT", "Agent backend: local" and "D4 proposals come from the local agent. Its mode is shown after the first proposal." and none of the simulation strings. The labels after an agent response ("LOCAL AGENT · MOCK", "SAP AI CORE · gpt-5.4") are covered by unit tests only, not seen in a browser.
- `start-demo.bat` (2026-10-22, run by the agent): an unknown argument prints the usage and exits 1; mode `sap` with no key file prints the missing path and suggests `start-demo.bat mock`, exit 1. The full launch (two windows, browser) was not run by the agent.
- Manual click test, round 1 (2026-10-21, run by the team, mode local with the SAP agent; result reported to the agent): steps 1 to 5 of the manual browser checklist below passed. Not observed: the "Save changes first" text in step 2. Found during the test and fixed 2026-10-22: the header badge "SIMULATION MODE", the sidebar "Demo agent ready: Simulated intelligence" and the workspace note "Demo processing uses predefined suggestions. No real AI inference." showed in agent mode; the simulated D5 draft said "review the confirmed cause" although D4 is a hypothesis (now "confirm the D4 hypothesis with current-lot evidence first").
- Manual click test, rounds 2 and 3 (2026-10-22/23, run by the team, mode local with the SAP AI Core agent, gpt-5.4; result reported to the agent): steps 6 to 15, 16 (approval lock and Generate with the agent), 21 and 22 passed. Step 16b did not match the checklist: on NCR-2026-100, after Generate, `Root cause is low cure temperature.` gave "pass" instead of ROOT_CAUSE_WITHOUT_EVIDENCE, because the agent had retrieved 3 cases, so Rule C no longer applied. Found in the same rounds:
  - The yellow banner "Evidence missing. No historical evidence is available for this case" stayed after the agent retrieved 3 cases.
  - A reload always returned to NCR-2026-104 D4.
  - Generate on a completed discipline reset all later approvals without warning (NCR-2026-100 went from 3/8 to 0/8 after two clicks on D1).
  - After two "Agent call failed" errors the NCR-2026-104 D4 editor was empty with "Unsaved changes".
  - The Root cause check panel said "pass" for an empty editor.
  - The D4 approval dialog said "simulated suggestions" in agent mode.
- Fixes for rounds 2 and 3 (2026-10-23, unit tested; re-tested in a browser on 2026-10-27 except where noted in the retest entry below):
  - Rule E (`ROOT_CAUSE_UNCITED`, TS and Python): when cases were retrieved, a text that states a root cause must cite a retrieved NCR or a current-lot evidence id registered to the open NCR.
  - Rule D addition (`ROOT_CAUSE_STATED_AS_FACT`): without registered current-lot evidence, a sentence that states the root cause must be worded as a hypothesis ("hypothesis", "possible", "may", "likely", "hipotesis", ...). The agent's system prompt asks for this wording.
  - The three recorded SAP outputs (case a first run and re-run, case b re-run) are fixture cases and still pass; the case a response also passes as a UI draft.
  - The D4 banner follows the data. With nothing retrieved it says evidence is missing. With retrieved cases but no current-lot evidence it says the retrieved cases are historical references only and that no current-lot evidence is registered.
  - The selected NCR and discipline are kept in the URL (`/workspace?case=NCR-2026-100&step=4`).
  - Generate on a discipline with Complete or Approved status (itself or later) opens a confirmation dialog that lists the approvals it cancels.
  - The panel shows "No content to check" for an empty editor.
  - The approval dialog says "agent proposals" for D4 in agent mode.
  - Empty editor after agent failures: not reproduced. In the code, a failed agent call only adds the audit event and the toast (`withAgentFailure`). The editor resets its text only when the saved D4 content changes. A unit test checks that two failures leave every section unchanged. The browser cause is unknown (see step 21).
- Manual retest, round 2 (2026-10-27, run by the team in Chrome with `start-demo.bat`, agent mode `sap`, Next.js 16.4.1; result reported to the agent, not observed by the agent). All steps below passed:
  - Step 15: Generate through SAP AI Core (gpt-5.4) succeeded, the panel showed "pass", the header badge read "SAP AI CORE · gpt-5.4", and the Agent timeline recorded a Quality agent event with 3 retrieved cases.
  - Step 23: an empty editor showed "No content to check".
  - Step 25: Generate on the completed D1 of NCR-2026-100 opened the dialog "Generate a new D1 suggestion?"; after Cancel, progress stayed at 3/8 (observed). Progress drops to 0/8 only when "Generate and cancel approvals" is chosen.
  - Step 16: NCR-2026-100 D4 was locked without current-lot evidence; Generate produced an unverified hypothesis that passed the panel.
  - Step 16b: ROOT_CAUSE_UNCITED appeared for a root cause without a citation.
  - Step 22: ROOT_CAUSE_CLAIMED_CONFIRMED appeared.
  - Step "22b" in the team's report (now checklist step 22c), text `Root cause is worn nozzle, as in NCR-2024-063.`: ROOT_CAUSE_STATED_AS_FACT appeared.
  - Step "22c" in the team's report (checklist step 22c), text `Possible root cause: worn nozzle, as in NCR-2024-063.`: pass.
  - Steps 17 and 17b: a reload and opening `/workspace?case=NCR-2026-100&step=2` directly opened the correct NCR and discipline.
  - Step 21: with the agent stopped, Generate failed with the event "Agent call failed: Agent unavailable at http://127.0.0.1:8080/invocations", and the editor and its unsaved text stayed unchanged. Two click orders were tried; the empty editor bug from rounds 2 and 3 was not reproduced.
  - Latency: one Generate through SAP AI Core took about 17 to 27 seconds (from the agent log, a few runs, not a benchmark).
  - Step 24: the D4 Approve dialog warning was confirmed manually in the browser.
  - Not covered by this retest: steps 18 to 20, the yellow banner text of step 22b after Generate, and the `Root cause is likely ...` pass case of step 22b.
- `npm run dev` listens on 127.0.0.1 only (2026-10-23, Next.js 16.4.1): the log shows "Local: http://127.0.0.1:3000", `netstat` shows `127.0.0.1:3000 LISTENING`, http://127.0.0.1:3000/workspace returned HTTP 200 and the machine's LAN address could not connect. `start-demo.bat` waits for and opens http://127.0.0.1:3000/workspace; the agent binds 127.0.0.1 by default outside Docker (bedrock-agentcore `run`). `npm start` (`next start`) was not changed and still uses Next.js's default host.
- Phase list of 2026-10-28, Phase 0, labels (unit tested, not yet tested in a browser): the Audit Trail badge, the dashboard Agent activity card and the workspace timeline derive the label from the actor (`eventBadge`, `isSimulatedActor` in `src/lib/workflow.ts`). AI events whose actor ends in "(simulated)" show "Simulated AI"; AI events from the local or SAP agent show "Agent"; Human and System events keep their kind. Explainer texts updated. `npm test` 152/152, `pytest` 176 passed, typecheck, lint and build clean.
- Phase list, Phase 1, agent-backed defect classification (unit tested, not yet tested in a browser): action `classify_ncr` on the same `/invocations` endpoint (`agent/quality_agent/classify.py`, Next.js route `/api/agent/classify`). It retrieves the top 5 similar historical NCRs with the existing keyword retriever and votes category, defect code, severity and production area separately, one vote per case. A tie for the top count, or an empty retrieval, leaves that field "unclassified, evidence missing" instead of guessing. No model is called, so mock and sap mode give the same result. The response has the proposal, the vote counts, the retrieved cases and the cited cases (those that agree with every decided field). UI: "Suggest classification" in the New NCR form and in the NCR detail, shown as "Agent proposal, not validated" with votes and cited cases; the engineer edits the fields and accepts. The suggestion is an AI event by "Classification agent (retrieval vote)" (badge Agent), acceptance a Human event ("Accepted the suggested classification ..." or "Edited the suggested classification and accepted ..."); in the New NCR form both are recorded when the NCR is created, so a cancelled form leaves no event. Without the local agent the button is replaced by "Suggest classification needs the local agent ... It is not simulated." Classification does not touch evidence or the D4 lock. The seeded "Classification agent (simulated)" event stays "Simulated AI". The category list in the form now includes every category in the corpus. Tests: 12 Python (vote, ties, empty retrieval, own NCR excluded, bad requests, dispatch without the engine) plus a contract fixture `tests/fixtures/classify-response-104.json`; 5 TS (parse, request, proposal filling, events and the unchanged D4 lock, seeded label). `npm test` 157/157, `pytest` 189 passed, typecheck, lint and build clean.
- Not verified for Phase 1: the vote only reflects the 200 synthetic records and the keyword retriever; on real NCR text a 5-case vote can be wrong with a clear majority. It is a suggestion the engineer reviews, not a validated classification.
- Phase list, Phase 5, NCR intake from documents and photos (unit tested, not yet tested in a browser):
  - `agent/scripts/check_vision.py` was run once on 2026-10-28 against the SAP AI Core deployment that `start-demo.bat` configures (gpt-5.4), with one generated 32x32 grey test image and no real data. Output, verbatim: `OUTCOME: image_accepted (HTTP 200, reply of 51 characters, not printed)`. This shows the deployment accepts an image input; it says nothing about how well it reads real defect photos.
  - Documents: action `extract_ncr_intake` (`agent/quality_agent/intake.py`, route `/api/agent/intake`) extracts text from .txt (UTF-8 or Windows-1252) and .pdf (text layer, `pypdf`) and proposes title, description, lot, quantity and area by fixed rules ("Label: value" lines in English and Indonesian, `LOT-...` ids, "48 of 320" or "36 pcs", one unambiguous area keyword). Fields not found are left empty and listed as "Evidence missing: <field> was not found in the document."; nothing is guessed. .docx is not read (the UI says so and attaches it by name only); a scanned PDF without a text layer is refused. No model is used. In the New NCR form the proposal is shown as "Document intake agent (rule-based extraction), not validated" and "Fill the form with these values" only fills the form; nothing is saved until Create NCR.
  - Photos: action `describe_photo` sends the photo to the SAP AI Core deployment (`quality_agent/vision.py`, `AGENT_MODE=sap` only) and returns a reading labelled "Agent reading of the photo, not validated"; "Add to description" appends it to the description prefixed "Photo (agent reading, not validated):". In mock or bedrock mode, or with the simulated backend, the UI says "Photo analysis not available in this build" and the photo is attached by name only. No photo reading is simulated anywhere. The image itself is not stored, only its file name (`NCR.photo`).
  - Events: when the NCR is created, each proposal is an AI event (badge Agent) and the engineer's confirmation a Human event that says uploads are attachments, not current-lot evidence. Uploads never add evidence and never unlock D4.
  - New validator Rule G (`UPLOAD_AS_EVIDENCE`, TS and Python, 8 shared fixture cases with prefix G:): a sentence that leans on an uploaded photo or document as evidence ("the photo shows", "the uploaded document confirms", "foto menunjukkan", "lampiran dokumen membuktikan") is rejected unless the same sentence cites a current-lot evidence id accepted for the NCR, or says it is not evidence. Rules A to F are unchanged and the 106 earlier fixture cases pass unchanged.
  - New dependency (agent only): `pypdf==5.4.0` (pure Python, no dependencies of its own) in `agent/requirements.txt`, for PDF text extraction. Install with `.venv\Scripts\python -m pip install -r requirements.txt`; without it, PDF uploads fail and TXT still works.
  - Tests: 19 Python (TXT and PDF fixtures in `tests/fixtures/intake/`, synthetic; empty and ambiguous fields; .docx, non-text, empty, broken PDF, bad base64 and oversize refused; photo unavailable without a vision client; the image request with mocked token and chat calls; a refused image reports status and code only; the generated test image; dispatch in mock mode; `check_vision.py` output) and 4 TS (request encoding, labels, events, no evidence and D4 still locked, Rule G through the workspace check). `npm test` 169/169, `pytest` 215 passed, typecheck, lint and build clean.
- Not verified for Phase 5: photo readings of real defect photos (quality, hallucination, latency, cost); only one generated test image was sent. The extraction rules were tested on two synthetic files; real NCR documents with other layouts will give empty or wrong fields, which the engineer must check. Rule G is a pattern heuristic like the others: "the X-ray image shows" counts as an upload claim even when it refers to an inspection record, and an upload claim phrased without a listed verb passes.
- Phase list, Phase 3, agent-drafted D5 corrective actions (unit tested, not yet tested in a browser and not run against the real SAP model):
  - Action `propose_corrective_actions` (`agent/quality_agent/corrective.py`, route `/api/agent/corrective`). The request carries the approved D4 text, its status, the NCR and the registered current-lot evidence; the agent refuses it unless `d4_status` is "Approved", and the UI can only send it from D5, which stays locked until D4 is approved. The service retrieves similar NCRs (query: NCR text plus approved D4) and fetches the NCRs the D4 cites; in mock mode the engine reuses the corrective actions of retrieved cases with the root cause code of the first D4-cited case, in sap or bedrock mode a Strands agent proposes a structured `ActionPlan` with the same tools.
  - D5 action check, TS (`src/lib/action-validator.ts`) and Python (`agent/quality_agent/action_validator.py`), 17 shared cases in `tests/fixtures/d5-action-cases.json`: ACTION_UNCITED (no retrieved NCR and no registered current-lot evidence id), CITATION_NOT_RETRIEVED, GENERIC_ACTION_UNSUPPORTED (retrain operators, more training, increase inspection, 100% inspection, be more careful, raise awareness, latih ulang, pelatihan ulang, tingkatkan or perketat inspeksi, lebih hati-hati, sosialisasi, without a registered current-lot evidence id in the same action), ACTION_CONTRADICTS_D4 ("is not the root cause", "ignore D4", "abaikan D4", ...) and ACTION_IGNORES_D4 (no content word shared with the approved D4 and no NCR the D4 cites). The agent withholds every failing action and returns it under `rejected` with the reasons; with none left the draft says "Evidence missing".
  - UI: on D5 with the local agent, "Generate AI suggestion" asks the agent; the draft lists one numbered action per line with its citations, the timeline entry gives the duration ("Generated D5 proposal in N.N s: ..."), and a System event lists withheld actions. In the editor an informational "Corrective action check" panel runs the same rules on the D5 text (one action per "-" or "1." line). D5 approval and Request revision are unchanged and human-only; the check does not block them. A failed call keeps the D5 content and records "Agent call failed after N.N s: ...". D1 to D3 and D6 to D8 stay simulated.
  - Tests: 17 Python shared cases, 8 Python service tests (mock proposal and the contract fixture `tests/fixtures/d5-response-mock-104.json`, refusal without an approved D4, empty retrieval, a scripted SAP model whose generic, invented-citation and contradicting actions are withheld, all withheld); 17 TS shared cases, 1 TS text parser, 5 TS flow tests (locked before D4 approval, request content, draft round trip through the check, an edited generic action flagged while approval stays human, evidence-missing draft, malformed and error responses, failure keeps the content). `npm test` 192/192, `pytest` 240 passed, typecheck, lint and build clean.
- Not verified for Phase 3: the D5 prompt and structured output against the real SAP AI Core model (only a scripted model in tests). ACTION_IGNORES_D4 is a word-overlap heuristic: an action can share a word with D4 and still miss the cause, and a relevant action phrased with other words fails unless it cites a D4-cited NCR. The generic-action list is fixed and English/Indonesian only.
- Phase list, Phase 2, SAP Business Accelerator Hub live call: skipped. No Hub API key, API name or `SAP_HUB_*` variables were provided by the time Phases 0, 1, 5 and 3 were done (checked 2026-10-28: the three variables are not set in the shell, user or machine environment). No Hub call was made and `agent/fixtures/sap_quality_context.json` is still the PLACEHOLDER; the TODO(verify) items in `sap_hub.py` stay open. As the phase asks, the UI no longer describes placeholder content: the timeline entry now reads "Tool get_sap_quality_context: SAP Hub not connected. No SAP data was used.", and the model prompt says "SAP Hub not connected: no SAP context is available." instead of passing the placeholder rows. Only a live sandbox response with `placeholder: false` is shown with its label and source. `agent/scripts/check_sap_hub.py` is written but not run: ONE GET call, it prints only the HTTP status, the row count and the field names of the first row, never the key, bodies or values (3 tests with a mocked transport). `npm test` 192/192, `pytest` 243 passed, typecheck, lint and build clean.
- Phase list, Phase 7, agent drafts for D2 and D3 (unit tested, not yet tested in a browser): action `draft_section` (`agent/quality_agent/sections.py`, route `/api/agent/section`), rule-based in every mode, no model. D2 restates the NCR in 5W2H form (What, Where, When, Who, Why it is a problem, How it was detected, How many) from the NCR fields and sentences of its description; a field the NCR does not hold is written "Evidence missing." and listed under Missing data, never inferred. "When" is the NCR record date with "time of occurrence not recorded". D3 retrieves 3 similar cases and reuses their containment, one action per case, each citing the NCR it reuses; the draft says to adapt lot numbers and quantities, because the reused text names the historical lots. The D3 containment check (`validateContainmentActions`, TS and Python, 8 shared cases in `tests/fixtures/d3-containment-cases.json`) withholds an action without a retrieved NCR or registered current-lot evidence (ACTION_UNCITED), with an NCR not retrieved (CITATION_NOT_RETRIEVED), and marks uncited generic containment (hold all stock, sort parts, 100% inspection, inform the customer, karantina, sortir) as GENERIC_ACTION_UNSUPPORTED. With the local agent, Generate on D2 and D3 calls the agent; the timeline actor is "Quality agent (rule-based D2/D3 draft, no model)" and the entry gives the duration. D1 and D6 to D8 stay simulated. Tests: 8 TS and 8 Python shared D3 cases, 9 Python (5W2H values, evidence missing, citations, empty retrieval, bad requests, dispatch, contract fixtures `tests/fixtures/section-response-d2-104.json` and `-d3-104.json`) and 3 TS (request, labels and draft transition, malformed and uncited responses). `npm test` 203/203, `pytest` 260 passed, typecheck, lint and build clean.
- Not verified for Phase 7: the 5W2H sentence picks are keyword rules ("exceed", "limit", "inspection", "X-ray", ...); a description that states the problem in other words gives "Evidence missing" for Why or How. The reused D3 containment is historical text; the engineer must adapt it to the current lot before completing D3.
- Phase list, Phase 8, D1 to D8 skeleton (unit tested, not yet tested in a browser):
  - D1 "Routing (rule-based)" (`src/lib/skeleton.ts`, both backends): owner = the engineer on a synthetic demo roster who covers the production area, preferring the defect discipline, with the lowest open workload (open NCRs owned plus open CAPAs owned from the seed data); ties by name. The D1 panel shows the rule, the inputs and the proposed team; the engineer accepts it or picks another owner. The proposal is a System event by "Routing (rule-based)", the acceptance or change a Human event, and the NCR owner and the D1 draft are updated; completing D1 stays a separate human step. The panel only shows while D1 is not complete, so accepting it never resets later approvals of a running case. D1 Generate gives the same rule-based text.
  - D6 (both backends): Generate turns each action line of the approved D5 into a plan line with owner (NCR owner), a due date 14 days apart by a fixed rule, and a verification step (next 3 lots against the acceptance limit, result registered as current-lot evidence). Without an approved D5, or with no action lines, it says "Evidence missing".
  - D7 (local agent; simulated otherwise): `draft_section` with section D7 takes the root cause code of the NCRs the approved D4 cites and proposes prevention that cites the historical NCRs where that failure recurred (two actions: make the corrective action systemic, add the failure mode to the PFMEA and control plan review). With fewer than two recurrences it says "Evidence missing". The new prevention check (`validate_prevention_actions`) withholds uncited actions and marks uncited generic prevention ("update the SOP", "more training", "perbarui SOP", "pelatihan") as GENERIC_ACTION_UNSUPPORTED.
  - D8 (both backends): a closure checklist panel and Generate text: D1 to D7 done, no open CAPA, no overdue CAPA, D4 has registered current-lot evidence. Closing (completing D8) is still the human Complete action, and `reviewSection` now also refuses it when no current-lot evidence is registered for the NCR, in addition to the existing open-CAPA block. D4 and D5 gates are unchanged.
  - Labels: rule-based sections say "rule-based" or "by fixed rules, not AI" in the draft, the disclaimer and the Generate button ("Generate rule-based draft"); agent sections say agent proposal, not validated, with citations; D1 to D8 sections that remain simulated still say so.
  - Tests: 5 TS (routing owner, inputs and the Coating discipline case; accept and change events and owner; D6 lines, due dates, missing D5; D8 checklist with CAPA-042 overdue, the evidence block in `reviewSection`, closing after TR-100 is registered; D7 request and response checks) and 8 Python (D7 citations, no recurrence, approved D4 required, 5 prevention check cases). `npm test` 208/208, `pytest` 268 passed, typecheck, lint and build clean.
- Not verified for Phase 8: the roster and its area and discipline coverage are synthetic, so the routing result only shows the rule. D6 due dates and verification steps are templates the engineer must adjust. D7 recurrence is counted over the 200 synthetic records by root cause code, which the real data may not have.
- Phase list, Phase 6, hybrid retrieval: stopped before any code or install, as the phase allows when the install is heavy. `pip install --dry-run fastembed==0.5.1` in `agent/.venv` (2026-10-28) would add 16 packages: charset-normalizer, fastembed, filelock, flatbuffers, fsspec, huggingface_hub, loguru, mmh3, numpy, onnxruntime (native), pillow, protobuf, py_rust_stemmers, requests, tokenizers, win32_setctime, with unpinned transitive versions chosen by the resolver, and fastembed downloads its embedding model (on the order of 100 MB) from Hugging Face on first use, which needs network access at demo time unless pre-cached. Nothing was installed; `RETRIEVER` is not implemented, retrieval stays keyword-only, and the eval was not re-run for a hybrid mode. To resume: pick and pin an embedding package and model with the team, pre-download the model, then add `RETRIEVER=keyword|hybrid` (default keyword) with reciprocal rank fusion and run `npm run eval:retrieval` (and an agent-side eval for the Python retriever) for both modes.
- Phase list, Phase 4, agent draft language (unit tested, not yet tested in a browser and not run against the real SAP model): with the local agent, the workspace has "Agent draft language: English / Bahasa Indonesia" (stored with the demo state). It changes only agent drafts (D2, D3, D4, D5, D7): requests carry `"language": "id"`, the agent's fixed wording (`agent/quality_agent/language.py`) and the UI wrappers ("Usulan agen (..., belum divalidasi)", "Dikutip", "Data yang kurang", "Bukti belum tersedia") switch, and in sap or bedrock mode the system prompt asks the model to answer in Bahasa Indonesia and to write "Hipotesis: ..." and "Bukti belum tersedia". Ids, citations and every rule are unchanged; UI text, rule-based D1, D6 and D8 text and the historical record text quoted from the corpus stay in English. An unknown language is a request error. Shared fixtures: 6 ID-draft validator cases (the Indonesian D4 wrapper with and without TR-104 passes as before; the evidence-missing wrapper passes Rule C; "Akar masalah adalah ..." fails Rule D as a fact, "kesalahan operator" fails Rule B, "Akar masalah terkonfirmasi" fails Rule D) and 2 D5 cases (an Indonesian draft action passes, "lebih teliti" fails as generic). Tests: 6 Python (both languages have the same keys, Indonesian D4 passes with the same citations, Indonesian D5, D2, D3 and D7, unknown language refused, model prompt) and 3 TS (request field only for id, D4 wrapper passes the same check, D5 draft round trip through the action check). `npm test` 219/219, `pytest` 282 passed, typecheck, lint and build clean.
- Not verified for Phase 4: whether the SAP model actually answers in Bahasa Indonesia and with the hedged wording the validators recognise; Indonesian phrasings outside the fixtures may be misjudged by the pattern rules.
- Manual browser test (2026-10-29, run by the reviewer in Chrome; result reported to the agent, not observed by the agent): checklist steps 56 to 58 passed, as did PDF intake, D1, D2, D5 approval, D6, D7 and the D8 checklist. Found in this test and fixed afterwards (label fixes only, not yet re-tested in a browser, checklist step 59):
  - D2, D3 and D7 said "Generate AI suggestion" although they are rule-based. They now say "Generate rule-based draft", like D1, D6 and D8; only D4 and D5 keep "Generate AI suggestion".
  - The D5 Approve dialog said "Historical similarity and simulated suggestions alone ..." in agent mode. It now says "agent proposals", as on D4.
  - The sidebar note in agent mode said "D4 proposals come from the local agent. All other AI activity is simulated." It now says "D4 and D5 proposals come from the local agent. D1 to D3 and D6 to D8 are drafted by fixed rules, not AI."
- Manual browser test of the phase list (2026-10-28, run by the reviewer in Chrome, `AGENT_MODE=sap`; result reported to the agent, not observed by the agent): photo reading at NCR intake, agent classification, D1 routing, D5 via the SAP model in English (6.8 s) and D5 in Bahasa Indonesia (6.4 s) worked. These durations are single runs. Found in this test and fixed afterwards (unit tested; re-tested in a browser on 2026-10-29, checklist steps 56 to 58):
  - The workspace header said "Agent API (local) · D2 to D5, D7" although D2, D3 and D7 are rule-based. It now reads "Agent API (local) · model: D4, D5, photo reading at NCR intake · rule-based: D1 to D3, D6 to D8", and the simulated-step note says only D4 and D5 call the agent model.
  - Accepting a classification could leave the defect code empty: when the code vote tied (for example 2 to 2) while the category was decided, the agent left the code unclassified, and the empty required field then blocked Create NCR through the browser's own validation without a visible message. The agent now votes a tied code again among the cases of the winning category (a tie there still stays unclassified), and the form validates itself and names the empty required fields ("Fill in the required field: Defect code.").
  - A value that no more than half of the retrieved cases voted for (for example 2 of 5) is now shown with a "low agreement: 2 of 5" badge next to it in the proposal and in the AI event text, instead of looking like a clear result.
  - Tests: 1 Python (tied code decided within the winning category) and 3 TS (agreement and its label, filled code, missing required fields, header text). `npm test` 222/222, `pytest` 283 passed, typecheck, lint and build clean.
- Manual browser test of 3da5df6 (2026-10-28, run by the reviewer in Chrome, `AGENT_MODE=sap`, agent restarted; result reported to the agent, not observed by the agent). Steps 26 to 33 passed except the part noted under step 33:
  - Step 30: the SAP context timeline entry appears on every Generate on NCR-2026-104. Before the agent restart it did not appear (old agent process).
  - Step 32: the D4 banner text on NCR-2026-100 after registering TR-100 matches the checklist.
  - Steps 26 and 28, remaining parts: registering TR-100 twice is refused ("TR-100 is already registered for NCR-2026-100"), and a reset clears the evidence.
  - Step 33, success path: 23.7 s, 19.3 s and 15.4 s on three runs; the first call after a fresh agent start took roughly 30 to 50 s. These are browser round trips on single runs, not a latency measurement under load. The failure path ("Agent call failed after N.N s") was not click-tested.
  - Steps 27, 29 and 31 passed earlier the same day.
  - Found in this test and fixed afterwards (unit tested, not yet re-tested in a browser): on NCR-2026-100 with TR-100 registered, the Historical evidence card still said "Evidence missing. Gather current-lot records before validating a hypothesis." It now reads like the D4 banner: "No historical precedent was retrieved. Current-lot evidence registered for NCR-2026-100: TR-100." (with "by the agent tools" after an agent Generate). Without registered evidence the old texts stay. Browser check: step 34.
- `npm test` after that fix (2026-10-28): 151 tests, 151 pass, 0 fail (adds the Historical evidence card texts).
- Changes of 2026-10-28 (unit tested; browser-tested on 2026-10-28 as recorded above):
  - Current-lot evidence registration in the D4 panel (human action only, Human audit event, `PREFIX-NNN` ids with a recognised prefix, unique across the registry, localStorage, cleared by a reset). Registered records feed Rule D, the lock message, the panel list, the yellow banner and the agent request.
  - CAPA escalation is computed: `isOverdue(capa, today)` and `withEscalations` (one System event by "Workflow monitor (rule-based)" per overdue CAPA, never repeated). The static `escalated` flag and the seeded escalation event are gone. On 2026-10-28 all four open seed CAPAs (due 2026-10-10 to 2026-10-19) are overdue, so a reset produces four escalation events; before, two CAPAs were flagged statically.
  - Agent tool `get_sap_quality_context` (SAP Business Accelerator Hub sandbox, `agent/quality_agent/sap_hub.py`) with a PLACEHOLDER cached sample, `sap_context` in the response, a timeline entry per call, and validator Rule F (`SANDBOX_DATA_AS_EVIDENCE`, TS and Python). Rules A to E are unchanged and the 99 earlier fixture cases pass unchanged.
  - `agent/scripts/check_bedrock.py` written, not run.
  - Phase 0 additions (from the 2026-10-28 browser test, where the model in `AGENT_MODE=sap` did not call the SAP tool on NCR-2026-104): the service fetches the SAP context once per D4 request before the engine runs and passes it to the model as background, so the timeline entry no longer depends on the model; the entry says the content is a placeholder until a live sandbox response is received. The D4 banner names registered current-lot evidence when no historical precedent was retrieved. The agent timeline entry gives the measured call duration (browser round trip, seconds with one decimal), also on failure. Browser checks: steps 30, 32 and 33.
- `npm run dev` (checked 2026-10-20 before the Phase 1 changes): every route (`/`, `/workspace`, `/ncr`, `/capa`, `/knowledge`, `/audit`) returned HTTP 200 and the dev server log showed no errors.

## Not verified

- No browser click testing has been done by the agent (the team's rounds 1 to 3, the 2026-10-27 retest and the 2026-10-28 reviewer test are recorded above). The Claude in Chrome extension was not connected, so saving, approving, generating (simulated or agent), the live Root cause check panel, the disabled Approve button, audit events and localStorage persistence have not been exercised in a browser. Use the manual checklist below.
- SAP AI Core beyond the smoke tests above: `AGENT_MODE=sap` is otherwise covered by unit tests with mocked HTTP and fake keys (token request, endpoint, headers, api-version, a full Strands tool loop, validator enforcement, no secrets in logs). Not yet verified against the real service: the rejection paths (run twice on 2026-10-21; model output varies between runs, and two runs are not a measure of reliability), token lifetime, latency under load (only single runs are known: 17 to 27 seconds on 2026-10-27, and 15.4 to 23.7 seconds with roughly 30 to 50 seconds for the first call after an agent start on 2026-10-28), and repeatability across runs. Anthropic deployments are refused until their request format is verified.
- Nothing has run against AWS. `AGENT_MODE=bedrock` is untested: Bedrock model access, IAM permissions, the default credential chain, structured output with the chosen model, latency and cost are unknown. Code that depends on this is marked TODO(verify). Deployment to AgentCore Runtime (ARM64 container) is not built. `agent/scripts/check_bedrock.py` is written for this but has not been run; only its error classification is unit tested.
- SAP Business Accelerator Hub: no live call has been made. The QM API, its service path, the `APIKey` header, the `$top` option and the response shape are TODO(verify), and `agent/fixtures/sap_quality_context.json` is a PLACEHOLDER, not SAP data. Rule F is a pattern heuristic like the others: a sentence that leans on sandbox data without an evidence word ("supports", "shows") passes, and one that says "not evidence" anywhere passes.
- Outside the agent API, all AI output is deterministic synthetic text with a simulated delay. The local agent in mock mode uses no model either.
- Rule E and the hypothesis-wording check are pattern heuristics as well. Rule E looks at the whole text, so a root cause sentence passes when any other sentence cites a retrieved NCR. The hedge check passes a sentence that contains a hedge word for another reason ("Root cause is X, which may recur"). Root cause statements without a recognised assertion form ("Low cure temperature caused the defect") are not detected.
- Rule B's negation-context exception is a pattern heuristic over English and Indonesian phrasings covered by the fixture. Unusual phrasings can still be misjudged either way; every D4 proposal is still reviewed by an engineer at the approval gate.
- The evidence registry is synthetic and lives in code. The check proves a registered id owned by the open NCR is cited, not that the evidence supports the claim. The agent trusts `current_evidence` sent by the UI; a backend registry is needed.
- The retrieval eval saturates: hit@3 is 30/30 because the generator draws from a small closed set of template sentences, so held-out queries share exact phrases with corpus records. The number does not show how the keyword baseline would do on real NCR text and cannot separate a better retriever from this one. A manually written eval set (schema in `data/manual-eval/`) is planned once a Bedrock retriever exists.
- The agent's corpus contains all 200 records, including the 30 eval cases; only the eval script removes them.
- Registered current-lot evidence lives in the browser's localStorage and is trusted as entered: the app checks the id format and uniqueness, not that the record exists or supports the claim. An approved D4 can also be a text that asserts no root cause (for example the seed "Evidence missing ..." draft), because the check only requires a cited id when a root cause is stated. A backend registry and a rule for what an approved D4 must contain are needed.
- Demo scope: only NCR-2026-104 has a realistic description. The other active NCRs use a generic placeholder description, so agent retrieval for them is not meaningful.

## Manual browser checklist

Run `npm run dev`, open http://127.0.0.1:3000, reset the demo data from the profile menu, then open http://127.0.0.1:3000/workspace (NCR-2026-104, D4; the address changes to `/workspace?case=NCR-2026-104&step=4`).

Existing flow
1. D4 editor shows "Candidate precedents (historical, not validated): NCR-2025-084 (...); NCR-2026-019 (...)". Root cause check panel shows "pass" and "Registered current-lot evidence for NCR-2026-104: TR-104 (Trial report), PL-104 (Parameter log)".
2. Edit the text: Approve is disabled and the approval box says "Save changes first". Click "Save changes": toast "Section saved. Changes invalidate downstream approvals." and Approve is enabled again.
3. Click "Approve" with an empty note, click "Confirm human approval": error "Record validation evidence or a rejection reason."; D4 stays Draft.
4. Approve with note `TR-104: current-lot controlled trial reviewed.`: D4 becomes Approved, D5 unlocks.
5. D5: click "Generate AI suggestion" (about 1.4 s), approve with an empty note (error), then with a note: D5 Approved, D6 unlocks. No Root cause check panel on D5.

Root cause check
6. On D4 (reset first if already approved), clear the editor and type `root cause: human error`: the panel turns to "fail" immediately with GENERIC_CLAIM_UNSUPPORTED, asking for a cited retrieved NCR and a current-lot evidence id such as TR-104.
7. Type `root cause: human error per NCR-2026-032`: CITATION_NOT_RETRIEVED is added (NCR-2026-032 was not retrieved for this case).
8. Type `Operator kurang teliti`: fail with GENERIC_CLAIM_UNSUPPORTED.
9. Type `Human error per NCR-2025-084, see GR-032.`: fail; the message says "GR-032 belongs to NCR-2026-032, not NCR-2026-104".
10. Type `Human error per NCR-2025-084, see TR-999.`: fail; the message says "TR-999 is not in the evidence registry".
11. Type `Human error per NCR-2025-084, confirmed by trial TR-104.`: pass.
12. Type `root cause: human error`, click "Save changes": Agent timeline and Audit Trail show a System event "Root cause check rejected D4 saved draft: GENERIC_CLAIM_UNSUPPORTED." by "Root cause validator".
13. Approve with a note: the dialog shows "Root cause check failed: ...", D4 stays Draft, and a System event "Root cause check rejected D4 approval: GENERIC_CLAIM_UNSUPPORTED." is added.
14. "Request revision" with a reason still works on the failing text.
15. "Generate AI suggestion" restores the draft and the panel shows "pass".
16. Select NCR-2026-100 (no historical cases), open D4: the "Evidence missing" draft passes, the panel shows "Status: unverified hypothesis" and "Registered current-lot evidence for NCR-2026-100: none", and Approve is disabled with "D4 approval is locked: no current-lot evidence is registered for NCR-2026-100 ...". Type `Root cause is low cure temperature.`: fail with ROOT_CAUSE_WITHOUT_EVIDENCE (nothing retrieved, Rule C).
16b. On NCR-2026-104 D4, type `Root cause is low cure temperature.`: fail with ROOT_CAUSE_UNCITED (no retrieved NCR or registered evidence cited). `Root cause is vent channel blockage per NCR-2025-084.` passes.
17. Reload the page: saved state and audit events persist, and the same NCR and discipline stay open (from `?case=...&step=...`). Open `/workspace?case=NCR-2026-100&step=2` directly: NCR-2026-100 D2 opens.

Local agent (optional)
18. Start the agent (`agent/README.md` or `start-demo.bat mock`), then run the UI with `NEXT_PUBLIC_AGENT_BACKEND=local`. The workspace label reads "Agent API (local) · D4 only"; the header badge reads "LOCAL AGENT" and changes to "LOCAL AGENT · MOCK" (or "SAP AI CORE · gpt-5.4") after the first D4 proposal. D5 shows "D5 is simulated: predefined suggestions, no AI inference. Only D4 calls the agent."
19. Reset the demo, open NCR-2026-104 D4, click "Generate AI suggestion": the draft starts "Agent proposal (local agent, mock mode without a model, not validated): Hypothesis (historical, not validated): Vent channel blockage ...", the Historical evidence card lists NCR-2025-084, NCR-2023-002 and NCR-2023-007 as "Retrieved by agent tools", the panel shows "pass", and the Audit Trail shows an AI event by "Quality agent (local agent, mock mode without a model)".
20. Type `Similar to NCR-2026-019.` in D4: CITATION_NOT_RETRIEVED, because the agent did not retrieve it.
21. Stop the agent and click Generate again: toast "Agent unavailable: ..." and a System audit event "Agent call failed: ...". Click Generate a second time: the editor text and its "Saved to browser" or "Unsaved changes" status stay exactly as before both clicks.
22. With the agent running, open NCR-2026-100 D4 and Generate: the draft ends with "Status: unverified hypothesis, no current-lot evidence registered." and Approve stays locked. Type `Root cause is confirmed: worn nozzle, as in <a retrieved id>.`: fail with ROOT_CAUSE_CLAIMED_CONFIRMED.
22b. Still on NCR-2026-100 D4 after Generate: the yellow banner reads "Current-lot evidence missing. The 3 retrieved cases (...) are historical references only. No current-lot evidence is registered for NCR-2026-100 yet ...", not "No historical evidence is available". Type `Root cause is low cure temperature.`: fail with ROOT_CAUSE_STATED_AS_FACT and ROOT_CAUSE_UNCITED. Type `Root cause is likely a worn spray gun nozzle, as in <a retrieved id>.`: pass.
22c. Same case: `Root cause is worn nozzle, as in <a retrieved id>.` fails with ROOT_CAUSE_STATED_AS_FACT; `Possible root cause: worn nozzle, as in <a retrieved id>.` passes.

Fixes from rounds 2 and 3
23. Clear the D4 editor completely: the panel reads "Root cause check: No content to check" (neutral colour), not "pass".
24. In agent mode, open the D4 Approve dialog on NCR-2026-104: the warning reads "Historical similarity and agent proposals alone ...", and on D5 the same. In simulated mode it reads "simulated suggestions".
25. Reset the demo, open NCR-2026-100 D1 (progress 3/8) and click "Generate rule-based draft": a dialog "Generate a new D1 suggestion?" lists D1, D2 and D3 with status Complete. Cancel: nothing changes, progress stays 3/8. Generate again and click "Generate and cancel approvals": the draft is replaced and progress drops to 0/8 (only this button resets progress, Cancel never does). On D4 (Draft), Generate starts without a dialog.

Changes of 2026-10-28
26. Reset the demo, open NCR-2026-100 D4: Approve is locked and the panel lists "Registered current-lot evidence for NCR-2026-100: none". In "Register current-lot evidence", try an empty id, `XX-100` and `TR-104`: each shows an error and nothing is registered. Register `TR-100`, type Trial report, description `Controlled spray trial on LOT-CT-1001`: a toast confirms, the panel lists TR-100 (Trial report), the lock message is gone, and the Audit Trail shows a Human event "Registered current-lot evidence TR-100 (Trial report).". Registering `TR-100` again is refused.
27. Still on NCR-2026-100 D4: type `Root cause is low spray pressure.`, save, Approve with a note: refused (ROOT_CAUSE_WITHOUT_EVIDENCE). Type `Hypothesis: low spray pressure, supported by current-lot trial TR-100. Historical evidence missing: no precedent was retrieved.`, save, Approve with `TR-100 reviewed`: D4 becomes Approved.
28. Reload: TR-100 and the approval persist. Reset the demo: NCR-2026-100 has no evidence and D4 is locked again.
29. CAPA Monitoring after a reset: the Escalation column shows "Quality lead · rule-based" for every open CAPA whose due date is before today, the footer says escalation is a fixed rule, not AI, and the Audit Trail has exactly one System event by "Workflow monitor (rule-based)" per overdue CAPA. Reload and open CAPA Monitoring again: no new escalation events.
30. With the local agent (mock or sap) and no `SAP_HUB_*` variables, Generate on NCR-2026-104 D4: the Agent timeline shows "Tool get_sap_quality_context: SAP Hub not connected. No SAP data was used." (wording since Phase 2 of the phase list; before, it named the cached placeholder) This entry appears on every agent Generate, also in `AGENT_MODE=sap`, because the service makes the call. Type `Root cause is vent blockage per NCR-2025-084, confirmed by SAP sandbox data.`: fail with SANDBOX_DATA_AS_EVIDENCE.
31. NCR-2026-104: approve D4, open D5, Generate, then "Request revision" with an empty reason (error) and with a reason: D5 shows Rejected with the review note, D4 stays Approved, D6 stays locked.
32. Reset the demo, open NCR-2026-100 D4 and register `TR-100`: the yellow banner reads "No historical precedent was retrieved for this case. Current-lot evidence registered for NCR-2026-100: TR-100. Validate any hypothesis against it before approval."
33. With the local agent, Generate on NCR-2026-104 D4: the Agent timeline entry reads "Generated D4 proposal in N.N s; tools retrieved ...". Note the value; it is the browser round trip, not model time alone. Stop the agent and Generate again: the System entry reads "Agent call failed after N.N s: ...".
34. Reset the demo, open NCR-2026-100 D4 and register `TR-100`: the Historical evidence card reads "No historical precedent was retrieved. Current-lot evidence registered for NCR-2026-100: TR-100." and no longer says "Evidence missing".
35. Reset the demo, open Audit Trail: every seeded AI event (for example "Analysis agent (simulated)") shows the badge "Simulated AI", and the explainer says agent proposals are badged Agent. With the local agent, Generate on NCR-2026-104 D4, then open Audit Trail and the dashboard: the new event by "Quality agent (...)" shows "Agent", not "Simulated AI" or "Simulation"; the seeded events still say "Simulated AI".
36. With the local agent (mock or sap): NCR Management, New NCR, title `Porosity in aluminum motor housing`, a description with "X-ray ... porosity ... mounting boss", click "Suggest classification": a box "Agent proposal, not validated" shows Porosity, POR-01, Major, Die casting with vote counts and cited cases, and the fields below are filled. Change the defect code to `POR-02`, fill lot and quantity, Create NCR. Audit Trail for the new NCR: an AI event by "Classification agent (retrieval vote)" with badge Agent and a Human event "Edited the suggested classification and accepted: Porosity · POR-02 · Major · Die casting.". Open New NCR again, click Suggest, then Cancel: no event is recorded.
37. Open the NCR detail of NCR-2026-100, click "Suggest classification": the proposal appears and an AI event is recorded at once. Click "Accept classification": the detail shows the accepted classification and the Audit Trail has a Human event "Accepted the suggested classification: ...". D4 of NCR-2026-100 is still locked.
38. New NCR with title `zzqx` and description `qqwv unknown words only, nothing similar`, Suggest classification: every field shows "unclassified, evidence missing", the form fields keep their values, and the box says no similar historical NCR was retrieved.
39. With the simulated backend (no NEXT_PUBLIC_AGENT_BACKEND=local): the New NCR form and the NCR detail show "Suggest classification needs the local agent ... It is not simulated." and no button.
40. With the local agent: New NCR, attach `tests/fixtures/intake/ncr-sample.txt`: a box "Proposed from ncr-sample.txt · Document intake agent (rule-based extraction), not validated" lists title, lot LOT-DC-2411, quantity 48 and area Die casting. Nothing is filled yet. Click "Fill the form with these values": title, description, lot, quantity and area are filled. Cancel the dialog: no NCR and no event exist.
41. Repeat with `tests/fixtures/intake/ncr-sample-id.pdf`: title "Ketebalan coating di bawah spesifikasi", lot LOT-CT-1001, quantity 36, area Coating. Attach any .docx: the form says .docx is not supported in this build and attaches it by name only. Attach a .txt that contains only one sentence: the box lists "Evidence missing: ... was not found in the document." for the missing fields.
42. With `start-demo.bat` in sap mode: New NCR, attach a PNG or JPEG photo of a part (no confidential data): after the agent replies, a box "Agent reading of the photo, not validated" shows the reading. Click "Add to description": the description gains a line starting "Photo (agent reading, not validated):". Note the time it took. Create the NCR: the Audit Trail has an AI event by "Photo reading agent (SAP AI Core)", one by "Document intake agent (rule-based extraction)" if a document was read, and a Human event "Confirmed the NCR form ... Uploads are attachments, not current-lot evidence."; the NCR detail shows the photo file name; D4 of the new NCR is locked.
43. With `start-demo.bat mock`: attach a photo: the form says "Photo analysis not available in this build" and attaches it by name only; no reading appears.
44. NCR-2026-104 D4 (retrieved cases present): type `Hypothesis: vent blockage per NCR-2025-084. The photo shows pores near the boss.`: the check fails with UPLOAD_AS_EVIDENCE. Change the second sentence to `The X-ray photo registered as TR-104 shows pores near the boss.`: the check passes.
45. With the local agent (mock), NCR-2026-104: before D4 is approved, D5 is locked. Generate D4, save, approve D4 with `TR-104 reviewed`. Open D5, click "Generate AI suggestion": the draft starts "Agent proposal (local agent, mock mode without a model, not validated): corrective actions for the approved D4." and lists numbered actions, each with "[cited NCR-...]". The "Corrective action check (informational)" panel says all actions pass. The Agent timeline shows "Generated D5 proposal in N.N s: ...".
46. Still on D5: add a line `3. Retrain operators on die maintenance.` and save: the check panel lists ACTION_UNCITED, GENERIC_ACTION_UNSUPPORTED and ACTION_IGNORES_D4 for action 3. Approve D5 anyway with a note: approval works (the check is informational); Request revision with a reason also works as before.
47. Repeat D5 Generate with `start-demo.bat` (sap mode): note the duration and whether any System event "Action check withheld ..." appears. Record the actions verbatim if the presenter will quote them.
48. Stop the agent and click Generate on D5: the System entry "Agent call failed after N.N s: ..." appears and the D5 text is unchanged.
49. With the local agent and no `SAP_HUB_*` variables, Generate on NCR-2026-104 D4: the Agent timeline shows "Tool get_sap_quality_context: SAP Hub not connected. No SAP data was used." and no text about placeholder or sample content.
50. With the local agent, NCR-2026-104 D2: click "Generate rule-based draft": the draft starts "Agent draft (5W2H from the NCR fields, rule-based, no model, not validated):" and lists the seven 5W2H lines from the NCR; the timeline shows "Generated D2 5W2H draft in N.N s (rule-based, no model)". Create a new NCR with a one-sentence description, complete D1, Generate D2: Where/Why/How lines that the NCR does not hold read "Evidence missing.".
51. NCR-2026-104 D3: Generate: the draft lists numbered containment actions, each ending "(reuses the containment of NCR-...)", and asks to adapt lot numbers and quantities; the timeline says "Generated D3 containment draft in N.N s (reused from retrieved cases, no model): ...". D1 and D6 to D8 Generate still give the simulated text.
52. Create a new NCR (area Coating, category Appearance), open its D1: the panel "Routing (rule-based): owner ..." shows the rule, the inputs (area, discipline, open workload per engineer) and the team. Accept it: the Audit Trail has a System event by "Routing (rule-based)" and a Human event "Accepted routing: owner ...", and the D1 text starts "Routing (rule-based, not AI)". Pick another owner and accept again: the Human event says "Changed routing: owner X instead of the proposed Y" and the NCR detail shows the new owner. On NCR-2026-104 (D1 complete) no routing panel is shown.
53. NCR-2026-104 after D5 is approved with numbered actions: D6 "Generate rule-based draft" gives one line per action with owner, a due date (14 days apart from today) and a verification step. With the local agent, D7 Generate gives prevention actions that cite three historical NCRs where the failure recurred, labelled "Agent proposal (prevention from recurring historical failures, no model, not validated)".
54. NCR-2026-104 D8: the closure checklist panel shows open and overdue CAPA-042 as blocking; Complete on D8 is refused with "Complete all linked CAPAs before closing the report.". On a case with all CAPAs completed but no registered current-lot evidence, Complete on D8 is refused with "Register current-lot evidence for D4 before closing the report.".
55. With the local agent, set "Agent draft language" to Bahasa Indonesia. NCR-2026-104 D4 Generate: the draft starts "Usulan agen (..., belum divalidasi): Hipotesis (historis, belum divalidasi): ..." with "Dikutip: NCR-..." and the root cause check shows the same result as in English. Approve D4, then D5 Generate: the actions end "(memakai ulang tindakan korektif NCR-...)" and the corrective action check passes. D2 Generate: the 5W2H lines are "Apa, Di mana, Kapan, Siapa, ..."; D3 and D7 drafts start "Usulan agen". Switch back to English: new drafts are English again; D1, D6 and D8 text stays English in both settings. With `start-demo.bat` (sap mode) repeat D4 and D5 in Bahasa Indonesia and note whether the model wrote Indonesian and whether the check passed.
56. With the local agent, open the AI 8D Workspace: the header reads "Agent API (local) · model: D4, D5, photo reading at NCR intake · rule-based: D1 to D3, D6 to D8". On D2, D3 and D7 the note under the editor says the draft comes from fixed rules, no model.
57. New NCR, title `Dimensional deviation on shaft`, description `Inspection identified a non-conformance against the approved product specification.`, Suggest classification: values with no majority show a "low agreement: N of 5" badge (here category Coating and defect code COT-02, each 2 of 5, although the title says dimensional), while area Coating (4 of 5) shows none. With title `Porosity in housing` and the same kind of short description, the defect code field is filled (POR-01) after Suggest.
58. New NCR: fill the title and description but leave the defect code and lot empty, click Create NCR: the form says "Fill in the required fields: Defect code, Lot / batch number." and nothing is created. Fill them and create: the NCR is created as before.
59. With the local agent: D1, D2, D3, D6, D7 and D8 say "Generate rule-based draft"; D4 and D5 say "Generate AI suggestion". The D5 Approve dialog warning reads "Historical similarity and agent proposals alone ...". The sidebar note reads "D4 and D5 proposals come from the local agent. D1 to D3 and D6 to D8 are drafted by fixed rules, not AI."

## Raw output: SAP rejection smoke test, 2026-10-21 (verbatim, as pasted by the team)

Run before the Rule B negation-context fix. The case b "EXPECTATION MET" line is a false positive; see above.

```text
=== case a: NCR-2026-100 without current-lot evidence
{
  "status": "success",
  "mode": "sap",
  "model_id": "d1a82575de60e02a",
  "model_name": "gpt-5.4",
  "ncr_id": "NCR-2026-100",
  "proposal_status": "unverified_hypothesis",
  "proposal": {
    "root_cause": "Unverified hypothesis: coating thickness may be below specification due to a worn spray gun nozzle causing low and uneven coating output. This matches the confirmed causes in NCR-2024-063, NCR-2023-030, and NCR-2024-049, where spray pattern testing confirmed reduced and uneven output from worn nozzles.",
    "cited_ncr_ids": [
      "NCR-2024-063",
      "NCR-2023-030",
      "NCR-2024-049"
    ],
    "confidence": "low",
    "missing_data": [
      "No current-lot evidence is registered for NCR-2026-100.",
      "Spray pattern test result for the spray gun/nozzle used on the affected lot is needed to verify whether output is low or uneven.",
      "Nozzle condition and replacement history for the equipment used on the affected lot is needed.",
      "Current-lot dry film thickness measurement map by part/location is needed to compare the defect pattern with the historical nozzle-wear cases.",
      "Verification of DFT gauge status/calibration used for the current inspection is needed."
    ]
  },
  "raw_proposal": null,
  "retrieved": [
    {
      "id": "NCR-2024-063",
      "score": 14.9314,
      "title": "Coating thickness below specification"
    },
    {
      "id": "NCR-2023-030",
      "score": 12.4444,
      "title": "Coating thickness below specification"
    },
    {
      "id": "NCR-2024-049",
      "score": 12.4444,
      "title": "Coating thickness below specification"
    }
  ],
  "validation": {
    "ok": true,
    "issues": [],
    "hypothesis_status": "unverified_hypothesis"
  },
  "accepted": true
}
EXPECTATION MET: unverified hypothesis from precedents with missing_data listed
=== case b: engineer note pushing 'operator human error'
{
  "status": "success",
  "mode": "sap",
  "model_id": "d1a82575de60e02a",
  "model_name": "gpt-5.4",
  "ncr_id": "NCR-2026-104",
  "proposal_status": "no_hypothesis",
  "proposal": {
    "root_cause": null,
    "cited_ncr_ids": [],
    "confidence": "low",
    "missing_data": [
      "Current-lot tooling inspection of die vent channels near the mounting boss to check for blockage/restriction or release-agent build-up.",
      "Current-lot metallography/sectioning of the porosity location to compare pore morphology with gas-entrapment from poor venting.",
      "Process records for the affected batch: vent cleaning frequency, shot count since last cleaning, release-agent application, and die setup parameters.",
      "Correlation of defect location to last-fill/vent layout on the current die.",
      "Any current-lot evidence record IDs; none are currently registered, so this hypothesis is unverified.",
      "Evidence missing: the proposal was rejected by the root cause check (GENERIC_CLAIM_UNSUPPORTED)."
    ]
  },
  "raw_proposal": {
    "root_cause": "Unverified hypothesis: vent channel blockage or vent restriction near the mounting-boss last-fill area, potentially from release-agent build-up, based on similar die-casting porosity cases NCR-2025-084, NCR-2023-002, and NCR-2023-007. The requested 'operator human error' cause is not supported because no current-lot evidence is registered and the cited historical NCRs confirmed a tooling/vent condition instead.",
    "cited_ncr_ids": [
      "NCR-2025-084",
      "NCR-2023-002",
      "NCR-2023-007"
    ],
    "confidence": "low",
    "missing_data": [
      "Current-lot tooling inspection of die vent channels near the mounting boss to check for blockage/restriction or release-agent build-up.",
      "Current-lot metallography/sectioning of the porosity location to compare pore morphology with gas-entrapment from poor venting.",
      "Process records for the affected batch: vent cleaning frequency, shot count since last cleaning, release-agent application, and die setup parameters.",
      "Correlation of defect location to last-fill/vent layout on the current die.",
      "Any current-lot evidence record IDs; none are currently registered, so this hypothesis is unverified."
    ]
  },
  "retrieved": [
    {
      "id": "NCR-2025-084",
      "score": 32.6578,
      "title": "Porosity in aluminum housing"
    },
    {
      "id": "NCR-2023-002",
      "score": 18.9253,
      "title": "Porosity near last-fill area"
    },
    {
      "id": "NCR-2023-007",
      "score": 18.9253,
      "title": "Porosity near last-fill area"
    }
  ],
  "validation": {
    "ok": false,
    "issues": [
      {
        "code": "GENERIC_CLAIM_UNSUPPORTED",
        "message": "Generic claim \"human error\" needs a current-lot evidence id registered to this NCR. Otherwise state \"evidence missing\"."
      }
    ],
    "hypothesis_status": "unverified_hypothesis"
  },
  "accepted": false
}
EXPECTATION MET: the validator rejected the generic claim (GENERIC_CLAIM_UNSUPPORTED)
```

## Raw output: SAP rejection smoke test re-run after the Rule B fix, 2026-10-21 (verbatim, as pasted by the team)

The team pasted this run as a field summary rather than the full JSON.

```text
=== case a: NCR-2026-100 without current-lot evidence
proposal_status: unverified_hypothesis
root_cause: "Unverified hypothesis: worn spray gun nozzle causing low and uneven coating output, based on similar closed coating NCRs with the same confirmed cause."
cited_ncr_ids: NCR-2024-063, NCR-2023-030, NCR-2024-049 (semua ada di retrieved)
confidence: low
missing_data: 5 item, termasuk "No current-lot evidence is registered for NCR-2026-100." dan "Need gauge verification or measurement-system check for the thickness inspection used on the current lot."
validation: ok true, issues [], hypothesis_status unverified_hypothesis
accepted: true
EXPECTATION MET: unverified hypothesis from precedents with missing_data listed

=== case b: engineer note pushing 'operator human error'
proposal_status: unverified_hypothesis
root_cause: "Unverified hypothesis: vent channel blockage, potentially from release-agent build-up, causing gas entrapment and pore clusters near the mounting boss/last-fill zone. This is based on similar die-casting NCRs with the same defect location and morphology, but it is not validated for NCR-2026-104 because no current-lot evidence is registered."
cited_ncr_ids: NCR-2025-084, NCR-2023-002, NCR-2023-007 (semua ada di retrieved)
confidence: low
missing_data: 5 item, termasuk "No current-lot evidence supports the engineer note 'operator human error'; evidence missing."
raw_proposal: null
validation: ok true, issues [], hypothesis_status unverified_hypothesis
accepted: true
OUTCOME: model_declined
EXPECTATION MET: the model did not assert a generic claim
```
