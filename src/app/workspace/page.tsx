'use client';
/* eslint-disable react-hooks/set-state-in-effect -- Hydrate browser-only storage and URL parameters after mount. */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Lock, Sparkles, ShieldCheck, Save, ChevronRight, ArrowUpRight, Send, FileSearch, LoaderCircle, CheckCircle2, AlertCircle } from 'lucide-react';
import { useApp } from '@/components/app-provider';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, PageHeading } from '@/components/common';
import { disciplines } from '@/lib/types';
import { history } from '@/lib/data';
import { approvalsResetBy, canAccess, d4ApprovalLock, d4EvidenceBanner, EVIDENCE_KINDS, evidenceFor, isD4Locked, isSimulatedActor, noHistoricalEvidenceText, registryOf, todayIso, reviewSection, rootCauseCheck, rootCauseAuditAction, RootCauseRejectedError, UnverifiedHypothesisError } from '@/lib/workflow';
import { ValidationResult } from '@/lib/validator';
import { agentBackend, agentLabel, LOCAL_AGENT_SCOPE } from '@/lib/agent-client';
import { d5ActionCheck } from '@/lib/corrective-client';
import { closureChecklist, proposeRouting, ROSTER, ROUTING_ACTOR, ROUTING_RULE } from '@/lib/skeleton';
import type { ActionCheck } from '@/lib/action-validator';
// Live result of the root cause validator for the D4 editor text.
function RootCauseCheck({ result, ncrId, empty }: {
    result: ValidationResult;
    ncrId: string;
    empty: boolean;
}) {
    const { state } = useApp();
    const registered = evidenceFor(state, ncrId);
    return <section className={'root-cause-check ' + (empty ? 'neutral' : result.ok ? 'pass' : 'fail')} aria-live="polite" aria-label="Root cause check">
        <header>{empty ? <FileSearch size={16}/> : result.ok ? <CheckCircle2 size={16}/> : <AlertCircle size={16}/>}Root cause check: {empty ? 'No content to check' : result.ok ? 'pass' : 'fail'}</header>
        {empty
            ? <p>Enter or generate D4 content to run the check.</p>
            : result.ok
            ? <p>Citations are retrieved cases, no unsupported generic claims, and missing evidence is stated where needed.</p>
            : <ul>{result.issues.map((issue, i) => <li key={i}><code>{issue.code}</code> {issue.message}</li>)}</ul>}
        {result.hypothesisStatus === 'unverified_hypothesis' && <p><strong>Status: unverified hypothesis.</strong> No current-lot evidence is registered, so the text must not call the root cause confirmed and D4 approval is locked.</p>}
        <small>Registered current-lot evidence for {ncrId}: {registered.length ? registered.map(r => r.id + ' (' + r.kind + ')').join(', ') : 'none'}.</small>
        <small>Checks the editor text as you type. Approval checks the saved content.</small>
    </section>;
}
// Engineers register current-lot evidence here. Agent responses never add evidence.
function RegisterEvidence({ ncrId }: {
    ncrId: string;
}) {
    const { registerEvidence } = useApp();
    const [error, setError] = useState('');
    function submit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        const message = registerEvidence(ncrId, { id: String(f.get('id') ?? ''), kind: String(f.get('kind') ?? ''), summary: String(f.get('summary') ?? '') });
        setError(message ?? '');
        if (!message)
            form.reset();
    }
    return <form className="register-evidence stack" onSubmit={submit} aria-label="Register current-lot evidence">
        <strong>Register current-lot evidence</strong>
        <small>Record objective evidence from the current lot for {ncrId}. Cite its id in the D4 text so the root cause check can use it.</small>
        <div className="form-grid">
            <label>Evidence id<input name="id" placeholder="TR-100" autoComplete="off"/></label>
            <label>Type<select name="kind">{EVIDENCE_KINDS.map(k => <option key={k}>{k}</option>)}</select></label>
            <label>Description<input name="summary" placeholder="Controlled trial on the current lot"/></label>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="inline"><Button type="submit" variant="outline">Register evidence</Button></div>
    </form>;
}
// Informational: shows how the D5 text fares against the corrective action rules. It does not change D5 approval.
function ActionCheckPanel({ result }: { result: ActionCheck & { actions: number } }) {
    if (!result.actions)
        return <div className="callout"><AlertCircle size={17}/><span>Corrective action check: no actions found. The check reads one action per line starting with &quot;-&quot; or &quot;1.&quot;.</span></div>;
    return <div className={'callout ' + (result.ok ? 'blue-callout' : 'warning')}>{result.ok ? <CheckCircle2 size={17}/> : <AlertCircle size={17}/>}<span><strong>Corrective action check (informational): {result.ok ? 'all ' + result.actions + ' actions cite a retrieved NCR or registered evidence and address the approved D4' : result.issues.length + ' issue' + (result.issues.length === 1 ? '' : 's')}</strong>{result.issues.map((i, k) => <small key={k} className="display-block">{i.code}: {i.message}</small>)}<small className="display-block">D5 approval stays a human decision.</small></span></div>;
}
const RULE_BASED_STEPS = [0, 5, 7];
const AGENT_STEPS = [1, 2, 3, 4, 6];
// Sections drafted by fixed rules (D2, D3 and D7 by the agent's rules, no model); only D4 and D5 use the model.
const RULE_BASED_DRAFT_STEPS = [0, 1, 2, 5, 6, 7];
// D1: the rule's proposal with its inputs; the engineer accepts it or picks another owner (Human event).
function RoutingPanel({ ncrId }: { ncrId: string }) {
    const { state, acceptRouting } = useApp();
    const ncr = state.ncrs.find(n => n.id === ncrId)!;
    const p = proposeRouting(state, ncr);
    const [owner, setOwner] = useState(p.owner);
    return <div className="callout blue-callout routing-panel"><ShieldCheck size={17}/><div className="stack-tight"><strong>{ROUTING_ACTOR}: owner {p.owner}, team {p.team.join(', ')}</strong><small>{ROUTING_RULE}</small><small>Inputs: production area {p.area}, discipline {p.discipline}, open workload {Object.entries(p.workload).map(([k, v]) => k + ' ' + v).join(', ')}.</small><div className="inline"><select aria-label="Owner" value={owner} onChange={e => setOwner(e.target.value)}>{ROSTER.map(e => <option key={e.name}>{e.name}</option>)}</select><Button variant="outline" onClick={() => acceptRouting(ncrId, owner)}>{owner === p.owner ? 'Accept routing' : 'Accept with ' + owner}</Button></div></div></div>;
}
// D8: what blocks closing. Completing D8 (closing) stays a human action and is refused while a check fails.
function ClosurePanel({ ncrId }: { ncrId: string }) {
    const { state } = useApp();
    const items = closureChecklist(state, ncrId, todayIso());
    return <div className={'callout ' + (items.every(i => i.ok) ? 'blue-callout' : 'warning')}><ShieldCheck size={17}/><div className="stack-tight"><strong>Closure checklist (rule-based)</strong>{items.map(i => <small key={i.label}>{i.ok ? '✓' : '✗'} {i.label}: {i.detail}</small>)}<small>Closing is a human decision and is refused while a check fails.</small></div></div>;
}
function Editor({ id, step, content, locked, onGenerate, busy, check, actionCheck, onDirtyChange }: {
    id: string;
    step: number;
    content: string;
    locked: boolean;
    onGenerate: () => void;
    busy: boolean;
    check?: (text: string) => ValidationResult;
    actionCheck?: (text: string) => ActionCheck & { actions: number };
    onDirtyChange: (dirty: boolean) => void;
}) { const { saveSection } = useApp(); const [draft, setDraft] = useState(content); const dirty = draft !== content; return <><div className="editor-toolbar"><span><FileSearch size={16}/> D{step + 1} report content</span><span>{dirty ? 'Unsaved changes' : 'Saved to browser'}</span></div><textarea className="report-editor" aria-label={'D' + (step + 1) + ' report content'} value={draft} disabled={locked || busy} onChange={e => { setDraft(e.target.value); onDirtyChange(e.target.value !== content); }} placeholder="Generate a suggestion or enter your engineering findings here…"/>{check && <RootCauseCheck result={check(draft)} ncrId={id} empty={!draft.trim()}/>}{actionCheck && draft.trim() && <ActionCheckPanel result={actionCheck(draft)}/>}<div className="editor-actions"><Button variant="outline" disabled={locked || busy} onClick={onGenerate}>{busy ? <LoaderCircle className="spin" size={16}/> : <Sparkles size={16}/>} {busy ? 'Analyzing case…' : RULE_BASED_DRAFT_STEPS.includes(step) ? 'Generate rule-based draft' : 'Generate AI suggestion'}</Button><Button disabled={locked || busy || !dirty || !draft.trim()} onClick={() => saveSection(id, step, draft)}><Save size={16}/>Save changes</Button></div>{dirty && <p className="small muted">Save your edits before reviewing. Approval applies to the saved report content.</p>}</>; }
export default function Workspace() {
    const { state, ready, generate, generateWithAgent, generateRuleBased, review, notify, logSystem, setDraftLanguage } = useApp();
    const [id, setId] = useState('NCR-2026-104');
    const [step, setStep] = useState(3);
    const [busy, setBusy] = useState(false);
    const [approval, setApproval] = useState<'approve' | 'reject' | null>(null);
    const [note, setNote] = useState('');
    const [error, setError] = useState('');
    const [question, setQuestion] = useState('');
    const [messages, setMessages] = useState<{
        q: string;
        a: string;
    }[]>([]);
    const [replying, setReplying] = useState(false);
    // Key of the editor instance holding unsaved edits. Saving changes the key, which clears it.
    const [dirtyKey, setDirtyKey] = useState<string | null>(null);
    // Disciplines a new suggestion would reset, while the confirmation dialog is open.
    const [resetConfirm, setResetConfirm] = useState<number[] | null>(null);
    // The selected NCR and discipline live in the URL (?case=NCR-2026-100&step=4, step 1 to 8) so a reload keeps them.
    const [urlRead, setUrlRead] = useState(false);
    useEffect(() => {
        const p = new URLSearchParams(window.location.search);
        const c = p.get('case');
        const s = Number(p.get('step'));
        if (c) {
            setId(c);
            setStep(0);
        }
        if (Number.isInteger(s) && s >= 1 && s <= 8)
            setStep(s - 1);
        setUrlRead(true);
    }, []);
    const n = state.ncrs.find(n => n.id === id) || state.ncrs[0];
    const report = state.reports.find(r => r.ncrId === n.id)!;
    const section = report.sections[step];
    const accessible = canAccess(state, n.id, step);
    const evidence = history.filter(h => n.evidence.includes(h.id));
    const complete = report.sections.filter(s => s.status === 'Complete' || s.status === 'Approved').length;
    const approved = section.status === 'Approved' || section.status === 'Complete';
    const editorKey = n.id + '-' + step + '-' + section.content;
    const dirty = dirtyKey === editorKey;
    const d4Locked = step === 3 && isD4Locked(state, n.id);
    // Wait for saved state as well, so an NCR created in this browser is not replaced by the first seed NCR in the URL.
    useEffect(() => {
        if (urlRead && ready)
            window.history.replaceState(null, '', '/workspace?case=' + encodeURIComponent(n.id) + '&step=' + (step + 1));
    }, [urlRead, ready, n.id, step]);
    const retrievedIds = report.agentRetrieved ? report.agentRetrieved.map(h => h.id) : evidence.map(h => h.id);
    const currentLot = evidenceFor(state, n.id);
    const banner = d4EvidenceBanner(n.id, retrievedIds, currentLot.map(e => e.id));
    const disclaimer = RULE_BASED_STEPS.includes(step) ? 'D' + (step + 1) + ' is drafted by fixed rules, not AI: ' + (step === 0 ? 'routing from production area, defect discipline and open workload.' : step === 5 ? 'one plan line per approved D5 action with owner, due date and a verification step.' : 'a closure checklist; closing stays a human decision and is refused while a check fails.') : agentBackend !== 'local' ? 'Demo processing uses predefined suggestions. No real AI inference.' : step === 3 ? (state.agent ? 'D4 proposals come from the local agent (' + agentLabel(state.agent) + '). Output is an unverified suggestion for engineer review.' : 'D4 proposals come from the local agent. Its mode is shown after the first proposal.') : step === 1 || step === 2 || step === 6 ? 'D' + (step + 1) + ' drafts come from the local agent by fixed rules, no model: ' + (step === 1 ? 'a 5W2H restatement of the NCR fields; missing fields say Evidence missing.' : step === 2 ? 'containment reused from retrieved cases, each citing its NCR.' : 'prevention citing the historical NCRs where the failure recurred, or Evidence missing.') + ' Review before completing.' : step === 4 ? 'D5 proposals come from the local agent after D4 is approved. Output is an unverified suggestion for engineer review; the action check below is informational and D5 approval stays a human decision.' : 'D' + (step + 1) + ' is simulated: predefined suggestions, no AI inference. Only D4 and D5 call the agent model; D1 to D3 and D6 to D8 use fixed rules.';
    async function simulate() { setBusy(true); const target = n.id, index = step; if (RULE_BASED_STEPS.includes(index)) {
        generateRuleBased(target, index);
        setBusy(false);
        notify('Rule-based D' + (index + 1) + ' draft ready (no model). Review before completing.');
        return;
    } if (agentBackend === 'local' && AGENT_STEPS.includes(index)) {
        await generateWithAgent(target, index);
        setBusy(false);
        return;
    } await new Promise(r => setTimeout(r, 1400)); generate(target, index); setBusy(false); notify('Simulated draft ready. Review and validate before approval.'); }
    // A new suggestion resets the approvals of this and later disciplines, so ask first when any exist.
    function requestGenerate() { const reset = approvalsResetBy(state, n.id, step); if (reset.length)
        setResetConfirm(reset);
    else
        simulate(); }
    function decide() { try {
        reviewSection(state, n.id, step, approval === 'approve', note);
        review(n.id, step, approval === 'approve', note);
        setApproval(null);
        setNote('');
    }
    catch (e) {
        if (e instanceof RootCauseRejectedError)
            logSystem(n.id, rootCauseAuditAction(step, 'approval', e.issues));
        if (e instanceof UnverifiedHypothesisError)
            logSystem(n.id, 'D4 approval blocked: unverified hypothesis, no current-lot evidence registered.');
        setError((e as Error).message);
    } }
    async function ask(e: React.FormEvent) { e.preventDefault(); if (!question.trim())
        return; const q = question; setQuestion(''); setReplying(true); const answer = evidence.length ? 'For ' + n.id + ', ' + evidence.map(h => h.id).join(' and ') + ' provide historical context. They do not confirm the current cause. Compare current-lot process logs and inspection results, then run a controlled trial. Record the validation evidence in D4 before approving D5.' : 'No supporting historical evidence is available for ' + n.id + '. Gather current inspection results, process parameters, and controlled trial data. A root cause cannot be verified from this submission alone.'; await new Promise(r => setTimeout(r, 850)); setMessages(m => [...m, { q, a: answer }]); setReplying(false); }
    return <><PageHeading eyebrow="HUMAN-LED · AI-ASSISTED" title="AI 8D Workspace" description="Turn quality signals into structured, evidence-based action." action={<span className="simulation-label"><Sparkles size={14}/>{agentBackend === 'local' ? LOCAL_AGENT_SCOPE : 'Simulated AI'}</span>}/><div className="workspace-casebar"><select aria-label="Select NCR" disabled={busy} value={n.id} onChange={e => { setId(e.target.value); setStep(0); setMessages([]); }}>{state.ncrs.map(n => <option key={n.id} value={n.id}>{n.id} · {n.title}</option>)}</select><Badge>{n.status}</Badge>{agentBackend === 'local' && <label className="draft-language">Agent draft language<select aria-label="Agent draft language" disabled={busy} value={state.draftLanguage ?? 'en'} onChange={e => setDraftLanguage(e.target.value === 'id' ? 'id' : 'en')}><option value="en">English</option><option value="id">Bahasa Indonesia</option></select></label>}<Link href={'/ncr?case=' + n.id} className="text-link">View NCR <ArrowUpRight size={14}/></Link></div><div className="workspace-grid"><aside className="card discipline-panel"><div className="discipline-heading"><h2>8D workflow</h2><span>{complete}/8 completed</span><div className="progress-track"><i style={{ width: complete / 8 * 100 + '%' }}/></div></div><nav className="discipline-nav">{disciplines.map((title, i) => { const done = report.sections[i].status === 'Complete' || report.sections[i].status === 'Approved'; const available = canAccess(state, n.id, i); return <button key={title} disabled={busy} className={(step === i ? 'selected ' : '') + (done ? 'done' : '')} onClick={() => setStep(i)}><span className="step-circle">{done ? <Check size={14}/> : 'D' + (i + 1)}</span><span>{title}<small>{done ? 'Completed' : !available ? 'Locked' : report.sections[i].status}</small></span>{!available && <Lock size={12}/>}</button>; })}</nav><div className="workflow-policy"><ShieldCheck size={20}/><strong>Human approval gates</strong><p>D4 and D5 require explicit review and recorded validation evidence.</p></div></aside><section className="card workspace-editor"><div className="workspace-title"><div><span className="eyebrow">DISCIPLINE {step + 1} OF 8</span><h2>{disciplines[step]}</h2></div><Badge>{section.status}</Badge></div><div className="case-summary"><span>{n.id}<Badge>{n.severity}</Badge></span><h3>{n.title}</h3><p>{n.area} · {n.code} · {n.quantity} affected units · {n.lot}</p></div>{!accessible && <div className="callout warning"><Lock size={17}/><span>Complete the preceding disciplines. D4 and D5 must be human-approved before proceeding.</span></div>}{(step === 3 || step === 4) && <div className="callout blue-callout"><ShieldCheck size={18}/><span>{approved ? 'Human review recorded.' : 'Human validation required.'} AI-generated content is a suggestion until supported and approved.</span></div>}{step === 3 && banner && <div className="callout warning"><AlertCircle size={18}/><span>{banner}</span></div>}<Editor key={editorKey} onDirtyChange={d => setDirtyKey(d ? editorKey : null)} id={n.id} step={step} content={section.content} locked={!accessible} busy={busy} onGenerate={requestGenerate} check={step === 3 ? text => rootCauseCheck(state, n.id, text) : undefined} actionCheck={step === 4 ? text => d5ActionCheck(state, n.id, text, registryOf(state)) : undefined}/>{step === 3 && accessible && !approved && <RegisterEvidence ncrId={n.id}/>}{step === 0 && accessible && report.sections[0].status !== 'Complete' && <RoutingPanel key={n.id} ncrId={n.id}/>}{step === 7 && <ClosurePanel ncrId={n.id}/>}{section.feedback && <div className="review-note"><strong>Human review record</strong><p>{section.feedback}</p></div>}<div className="approval-box"><div><ShieldCheck size={19}/><span><strong>{step === 3 || step === 4 ? 'Engineering approval' : 'Discipline review'}</strong><small>{approved ? 'Reviewed by Sarah Chen · Demo engineer' : d4Locked ? d4ApprovalLock(n.id) : dirty ? 'Save changes first' : 'Review the saved content before continuing.'}</small></span></div><div className="inline"><Button variant="outline" disabled={!accessible || busy || !section.content} onClick={() => { setApproval('reject'); setNote(''); setError(''); }}>Request revision</Button><Button disabled={!accessible || busy || !section.content || approved || dirty || d4Locked} title={d4Locked ? d4ApprovalLock(n.id) : dirty ? 'Save changes first' : undefined} onClick={() => { setApproval('approve'); setNote(''); setError(''); }}><Check size={16}/>{step === 3 || step === 4 ? 'Approve' : 'Complete'}</Button></div></div>{approved && step < 7 && <Button variant="ghost" className="next-step" onClick={() => setStep(step + 1)}>Continue to D{step + 2}<ChevronRight size={16}/></Button>}{step === 7 && <p className="small muted">The report can close only after all associated CAPAs are completed.</p>}<div className="simulation-disclaimer"><Sparkles size={14}/> {disclaimer}</div></section><aside className="workspace-context"><section className="card"><div className="card-header"><div><h2><Sparkles size={16}/> Agent timeline</h2><p>{agentBackend === 'local' ? 'Workflow activity' : 'Simulated workflow activity'}</p></div></div><div className="context-timeline">{state.audit.filter(a => a.ncrId === n.id).slice(0, 4).map(a => <div key={a.id}><span className={'timeline-point ' + (a.kind === 'AI' ? 'ai' : '')}>{a.kind === 'AI' ? <Sparkles size={12}/> : <CheckCircle2 size={12}/>}</span><p>{a.action}<small>{a.kind === 'AI' ? (isSimulatedActor(a.actor) ? 'Simulated AI' : a.actor) : a.kind} · {new Date(a.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</small></p></div>)}</div></section><section className="card"><div className="card-header"><div><h2><FileSearch size={16}/> Historical evidence</h2><p>Reference cases · {report.agentRetrieved ? report.agentRetrieved.length + ' retrieved by agent tools' : evidence.length + ' retrieved'}</p></div></div><div className="evidence-list">{report.agentRetrieved ? (report.agentRetrieved.length ? report.agentRetrieved.map(h => <div key={h.id} className="evidence-item"><span>{h.id}</span><strong>{h.title}</strong><small>Retrieved by agent tools{h.score !== null ? ' · score ' + h.score : ''} · historical, not validated</small></div>) : <div className="callout warning">{noHistoricalEvidenceText(n.id, currentLot.map(e => e.id), true)}</div>) : evidence.length ? evidence.map(h => <Link key={h.id} href={'/knowledge?case=' + h.id} className="evidence-item"><span>{h.id}<ArrowUpRight size={13}/></span><strong>{h.title}</strong><p>{h.rootCause}</p><small>Historical evidence · not current-case validation</small></Link>) : <div className="callout warning">{noHistoricalEvidenceText(n.id, currentLot.map(e => e.id), false)}</div>}</div></section><section className="card assistant-card"><div className="card-header"><div><h2><Sparkles size={16}/> Case assistant</h2><p>Contextual guidance · simulation</p></div></div><div className="assistant-messages"><p className="assistant-bubble">I can outline what evidence to collect for {n.id}. All replies are simulated guidance.</p>{messages.map((m, i) => <div key={i}><p className="user-bubble">{m.q}</p><p className="assistant-bubble">{m.a}</p></div>)}{replying && <p className="muted">Preparing simulated guidance…</p>}</div><form onSubmit={ask} className="assistant-input"><input aria-label="Ask case assistant" placeholder="Ask about this case…" value={question} onChange={e => setQuestion(e.target.value)}/><button aria-label="Send question" disabled={replying || !question.trim()}><Send size={16}/></button></form></section></aside></div><Dialog open={!!approval} onOpenChange={v => !v && setApproval(null)} title={(approval === 'approve' ? 'Approve' : 'Request revision for') + ' D' + (step + 1)} description={approval === 'approve' ? 'You are recording a human engineering decision for the saved report.' : 'Give the engineer a clear reason for revision.'}><div className="stack">{approval === 'approve' && (step === 3 || step === 4) && <div className="callout warning">Confirm you reviewed objective validation evidence. Historical similarity and {agentBackend === 'local' ? 'agent proposals' : 'simulated suggestions'} alone do not establish a verified current cause.</div>}<label>{approval === 'approve' ? 'Validation evidence / review notes' : 'Reason for revision'}<textarea rows={4} value={note} onChange={e => setNote(e.target.value)} placeholder="Record trial IDs, inspection results, or the reason for rejection…"/></label>{error && <p className="error" role="alert">{error}</p>}<div className="dialog-actions"><Button variant="outline" onClick={() => setApproval(null)}>Cancel</Button><Button onClick={decide}>{approval === 'approve' ? 'Confirm human approval' : 'Return for revision'}</Button></div></div></Dialog><Dialog open={!!resetConfirm} onOpenChange={v => !v && setResetConfirm(null)} title={'Generate a new D' + (step + 1) + ' suggestion?'} description={'The new suggestion replaces the saved D' + (step + 1) + ' content. If it is generated, these approvals are cancelled and must be reviewed again.'}><div className="stack"><ul>{(resetConfirm ?? []).map(i => <li key={i}>D{i + 1} {disciplines[i]} ({report.sections[i].status})</li>)}</ul><div className="dialog-actions"><Button variant="outline" onClick={() => setResetConfirm(null)}>Cancel</Button><Button onClick={() => { setResetConfirm(null); simulate(); }}>Generate and cancel {resetConfirm?.length === 1 ? 'approval' : 'approvals'}</Button></div></div></Dialog></>;
}
