'use client';
/* eslint-disable react-hooks/set-state-in-effect -- Hydrate browser-only storage and URL parameters after mount. */
import { createContext, useContext, useEffect, useState } from 'react';
import { AppState, NCR, CAPA, DraftLanguage, EvidenceRecord } from '@/lib/types';
import { createInitialState, sectionDraft } from '@/lib/data';
import { acceptanceEvent, suggestionEvent, withClassification, type ClassificationFields, type ClassificationResponse } from '@/lib/classification';
import { intakeEvents, type DocumentIntake, type PhotoReading } from '@/lib/intake';
import { acceptRouting, d6Plan, d8Draft, proposeRouting, routingDraft, ROUTING_ACTOR } from '@/lib/skeleton';
import { requestSectionDraft, sectionAuditAction, type SectionResponse } from '@/lib/section-client';
import { buildCorrectiveRequest, correctiveAuditAction, correctiveDraft, proposeCorrectiveActions, type CorrectiveResponse } from '@/lib/corrective-client';
import { agentDraft, agentLabel, buildAgentRequest, formatDuration, proposeRootCause, sapContextAuditActions, type AgentResponse } from '@/lib/agent-client';
import { reviewSection, canAccess, registerEvidence, registryOf, rootCauseCheck, rootCauseAuditAction, todayIso, withActionDraft, withAgentDraft, withSectionDraft, withAgentFailure, withEscalations } from '@/lib/workflow';
interface Store {
    state: AppState;
    ready: boolean;
    notice: string;
    // extras: the agent proposals the engineer saw in the form (classification and the values they kept, upload readings).
    addNcr: (n: Omit<NCR, 'id' | 'date' | 'evidence' | 'status'>, extras?: { classification?: { response: ClassificationResponse; chosen: ClassificationFields }; intake?: { document?: DocumentIntake; photo?: PhotoReading } }) => string;
    recordClassificationSuggestion: (id: string, r: ClassificationResponse) => void;
    acceptClassification: (id: string, r: ClassificationResponse, chosen: ClassificationFields) => void;
    saveSection: (id: string, step: number, content: string) => void;
    generate: (id: string, step: number) => void;
    generateWithAgent: (id: string, step: number) => Promise<boolean>;
    // D1 routing, D6 plan and D8 closure checklist: fixed rules, no model, in every backend.
    generateRuleBased: (id: string, step: number) => void;
    acceptRouting: (id: string, owner: string) => void;
    setDraftLanguage: (language: DraftLanguage) => void;
    review: (id: string, step: number, approve: boolean, note: string) => void;
    logSystem: (id: string, action: string) => void;
    // Returns an error message, or null when the evidence was registered.
    registerEvidence: (id: string, input: { id: string; kind: string; summary: string }) => string | null;
    updateCapa: (id: string, status: CAPA['status']) => void;
    assignCapa: (c: Omit<CAPA, 'id'>) => void;
    // Applies the rule-based CAPA escalation for today.
    checkEscalations: () => void;
    notify: (s: string) => void;
    reset: () => void;
}
// Agent helpers live outside the component so the React Compiler can still analyze it.
// ms is the measured round trip of the agent call, as seen by the browser.
async function requestAgentProposal(n: NCR, registry: EvidenceRecord[], language: DraftLanguage): Promise<{ ok: true; response: AgentResponse; ms: number } | { ok: false; error: string; ms: number }> {
    const start = performance.now();
    try {
        const response = await proposeRootCause(buildAgentRequest(n, registry, language));
        return { ok: true, response, ms: performance.now() - start };
    }
    catch (e) {
        return { ok: false, error: (e as Error).message, ms: performance.now() - start };
    }
}
function agentAuditAction(r: AgentResponse, ms: number) {
    return 'Generated D4 proposal in ' + formatDuration(ms) + '; tools retrieved ' + (r.retrieved.map(h => h.id).join(', ') || 'no historical NCR') + '. Agent root cause check: ' + (r.accepted ? 'passed' : 'rejected (' + r.validation.issues.map(i => i.code).join(', ') + ')') + '.';
}
const Context = createContext<Store | null>(null);
const key = '8d-quality-agent-v1';
export function AppProvider({ children }: {
    children: React.ReactNode;
}) {
    const [state, setState] = useState(createInitialState);
    const [ready, setReady] = useState(false);
    const [notice, setNotice] = useState('');
    useEffect(() => {
        try {
            const raw = localStorage.getItem(key);
            if (raw) {
                const saved = JSON.parse(raw);
                if (saved.version === 1 && Array.isArray(saved.ncrs) && Array.isArray(saved.reports) && Array.isArray(saved.capas) && Array.isArray(saved.audit) && (saved.evidence === undefined || Array.isArray(saved.evidence)))
                    setState(saved);
            }
        }
        catch {
            setNotice('Saved demo data could not be loaded. Using the original dataset.');
        }
        setReady(true);
    }, []);
    useEffect(() => {
        if (ready)
            try {
                localStorage.setItem(key, JSON.stringify(state));
            }
            catch {
                setNotice('Browser storage is unavailable. Changes will last for this session only.');
            }
    }, [state, ready]);
    // Opening the app runs the overdue rule once; withEscalations never escalates a CAPA twice.
    useEffect(() => {
        if (ready)
            setState(s => withEscalations(s, todayIso(), new Date().toISOString()));
    }, [ready]);
    useEffect(() => { if (notice) {
        const t = setTimeout(() => setNotice(''), 6000);
        return () => clearTimeout(t);
    } }, [notice]);
    const event = (id: string, action: string, kind: 'AI' | 'Human' | 'System' = 'Human', actor?: string) => ({ id: crypto.randomUUID(), ncrId: id, actor: actor ? actor : kind === 'AI' ? 'Quality agent (simulated)' : kind === 'System' ? 'Root cause validator' : 'Sarah Chen', kind, action, timestamp: new Date().toISOString() });
    const validationEvents = (s: AppState, id: string, step: number, content: string, trigger: 'generated' | 'saved') => { if (step !== 3)
        return []; const check = rootCauseCheck(s, id, content); return check.ok ? [] : [event(id, rootCauseAuditAction(step, trigger, check.issues), 'System')]; };
    const language: DraftLanguage = state.draftLanguage ?? 'en';
    // D5 from the agent: only reachable when D4 is approved (canAccess), and the request carries the D4 status.
    const generateActionsWithAgent = async (n: NCR) => {
        const report = state.reports.find(r => r.ncrId === n.id)!;
        const start = performance.now();
        let r: CorrectiveResponse;
        try {
            r = await proposeCorrectiveActions(buildCorrectiveRequest(n, report.sections[3], registryOf(state), language));
        }
        catch (e) {
            const message = (e as Error).message;
            setState(s => withAgentFailure(s, event(n.id, 'Agent call failed after ' + formatDuration(performance.now() - start) + ': ' + message, 'System')));
            setNotice('Agent unavailable: ' + message);
            return false;
        }
        const ms = performance.now() - start;
        const draft = correctiveDraft(r, language);
        setState(s => {
            const actor = 'Quality agent (' + agentLabel(r) + ')';
            const events = [event(n.id, correctiveAuditAction(r, ms), 'AI', actor)];
            if (r.rejected.length)
                events.unshift(event(n.id, 'Action check withheld ' + r.rejected.length + ' proposed D5 ' + (r.rejected.length === 1 ? 'action' : 'actions') + ': ' + [...new Set(r.rejected.flatMap(a => a.issues.map(i => i.code)))].join(', ') + '.', 'System'));
            return { ...withActionDraft(s, n.id, draft, r.retrieved.map(h => h.id)), agent: { mode: r.mode, model_id: r.model_id, model_name: r.model_name ?? null }, audit: [...events, ...s.audit] };
        });
        setNotice('Agent D5 proposal ready (' + agentLabel(r) + '). Review and validate before approval.');
        return true;
    };
    // D2 (5W2H) and D3 (containment) from the agent: rule-based, no model; the actor says so.
    const generateSectionWithAgent = async (n: NCR, step: 1 | 2 | 6) => {
        const section = step === 1 ? 'D2' : step === 2 ? 'D3' : 'D7';
        const start = performance.now();
        let r: SectionResponse;
        try {
            r = await requestSectionDraft(n, section, registryOf(state), fetch, state.reports.find(x => x.ncrId === n.id)?.sections[3], language);
        }
        catch (e) {
            const message = (e as Error).message;
            setState(s => withAgentFailure(s, event(n.id, 'Agent call failed after ' + formatDuration(performance.now() - start) + ': ' + message, 'System')));
            setNotice('Agent unavailable: ' + message);
            return false;
        }
        const ms = performance.now() - start;
        setState(s => ({ ...withSectionDraft(s, n.id, step, r.draft), audit: [event(n.id, sectionAuditAction(r, ms), 'AI', 'Quality agent (rule-based ' + section + ' draft, no model)'), ...s.audit] }));
        setNotice('Agent ' + section + ' draft ready (rule-based, no model). Review before completing.');
        return true;
    };
    const store: Store = {
        setDraftLanguage: l => setState(s => ({ ...s, draftLanguage: l })),
        generateRuleBased: (id, step) => setState(s => { const n = s.ncrs.find(x => x.id === id); if (!n || ![0, 5, 7].includes(step) || !canAccess(s, id, step))
            return s; const today = todayIso(); const draft = step === 0 ? routingDraft(proposeRouting(s, n)) : step === 5 ? d6Plan(s, id, today) : d8Draft(s, id, today); const actor = step === 0 ? ROUTING_ACTOR : step === 5 ? 'D6 planner (rule-based)' : 'Closure checklist (rule-based)'; return { ...withSectionDraft(s, id, step, draft), audit: [event(id, 'Generated D' + (step + 1) + ' draft by fixed rules, no model.', 'System', actor), ...s.audit] }; }),
        acceptRouting: (id, owner) => { setState(s => { const n = s.ncrs.find(x => x.id === id); return n ? acceptRouting(s, id, proposeRouting(s, n), owner, 'Sarah Chen', new Date().toISOString()) : s; }); setNotice('Routing recorded for ' + id + '. Complete D1 when the team is confirmed.'); }, state, ready, notice, notify: setNotice,
        addNcr: (n, extras) => { const classification = extras?.classification; const id = 'NCR-2026-' + String(Math.max(104, ...state.ncrs.map(x => Number(x.id.split('-').at(-1)))) + 1).padStart(3, '0'); setState(s => ({ ...s, ncrs: [{ ...n, id, date: new Date().toISOString().slice(0, 10), evidence: [], status: 'Open' }, ...s.ncrs], reports: [...s.reports, { ncrId: id, sections: Array.from({ length: 8 }, () => ({ content: '', status: 'Not started' })) }], audit: [...intakeEvents(id, extras?.intake ?? {}, 'Sarah Chen', new Date().toISOString()), ...(classification ? [acceptanceEvent(id, classification.response, classification.chosen, 'Sarah Chen', new Date().toISOString()), suggestionEvent(id, classification.response, new Date().toISOString())] : []), event(id, 'Created NCR' + ([n.document, n.photo].some(Boolean) ? ' with attachments: ' + [n.document, n.photo].filter(Boolean).join(', ') + '.' : '.')), ...s.audit] })); setNotice(id + ' created. Ready for an 8D investigation.'); return id; },
        recordClassificationSuggestion: (id, r) => setState(s => ({ ...s, audit: [suggestionEvent(id, r, new Date().toISOString()), ...s.audit] })),
        acceptClassification: (id, r, chosen) => { setState(s => withClassification(s, id, r, chosen, 'Sarah Chen', new Date().toISOString())); setNotice('Classification saved for ' + id + '.'); },
        saveSection: (id, step, content) => { setState(s => ({ ...s, reports: s.reports.map(r => r.ncrId !== id ? r : { ...r, sections: r.sections.map((x, i) => i === step ? { content, status: 'Draft' } : i > step ? { ...x, status: x.content ? 'Draft' : 'Not started', feedback: undefined } : x) }), ncrs: s.ncrs.map(n => n.id === id ? { ...n, status: 'In progress' } : n), audit: [...validationEvents(s, id, step, content, 'saved'), event(id, 'Edited D' + (step + 1) + '; downstream approvals require revalidation.'), ...s.audit] })); setNotice('Section saved. Changes invalidate downstream approvals.'); },
        generate: (id, step) => setState(s => { if (!canAccess(s, id, step))
            return s; const n = s.ncrs.find(n => n.id === id)!; const draft = sectionDraft(n, step); return { ...s, reports: s.reports.map(r => r.ncrId !== id ? r : { ...r, ...(step === 3 ? { agentRetrieved: undefined } : {}), sections: r.sections.map((x, i) => i === step ? { content: draft, status: 'Draft' } : i > step ? { ...x, status: x.content ? 'Draft' : 'Not started', feedback: undefined } : x) }), audit: [...validationEvents(s, id, step, draft, 'generated'), event(id, 'Generated simulated D' + (step + 1) + ' suggestion. ' + (n.evidence.length ? 'Historical references retrieved; current cause unvalidated.' : 'Evidence missing.'), 'AI'), ...s.audit] }; }),
        generateWithAgent: async (id, step) => {
            const n = state.ncrs.find(n => n.id === id);
            if (!n || step < 1 || step > 6 || step === 5 || !canAccess(state, id, step))
                return false;
            if (step === 4)
                return generateActionsWithAgent(n);
            if (step === 1 || step === 2 || step === 6)
                return generateSectionWithAgent(n, step);
            const result = await requestAgentProposal(n, registryOf(state), language);
            if (!result.ok) {
                setState(s => withAgentFailure(s, event(id, 'Agent call failed after ' + formatDuration(result.ms) + ': ' + result.error, 'System')));
                setNotice('Agent unavailable: ' + result.error);
                return false;
            }
            const r = result.response;
            const draft = agentDraft(r, language);
            setState(s => {
                const next = withAgentDraft(s, id, step, draft, r);
                const actor = 'Quality agent (' + agentLabel(r) + ')';
                const agentEvents = [event(id, agentAuditAction(r, result.ms), 'AI', actor), ...sapContextAuditActions(r).map(a => event(id, a, 'AI', actor))];
                if (!r.accepted)
                    agentEvents.unshift(event(id, 'Agent output withheld by the root cause check; draft states evidence missing.', 'System'));
                return { ...next, agent: { mode: r.mode, model_id: r.model_id, model_name: r.model_name ?? null }, audit: [...validationEvents(next, id, step, draft, 'generated'), ...agentEvents, ...s.audit] };
            });
            setNotice('Agent proposal ready (' + agentLabel(r) + '). Review and validate before approval.');
            return true;
        },
        review: (id, step, approve, note) => { setState(s => ({ ...reviewSection(s, id, step, approve, note), audit: [event(id, (approve ? 'Approved' : 'Rejected') + ' D' + (step + 1) + (note ? ': ' + note : '')), ...s.audit] })); setNotice(approve ? 'Human review recorded. Next discipline unlocked.' : 'Draft returned for revision.'); },
        registerEvidence: (id, input) => { let next: AppState; try {
            next = registerEvidence(state, id, input, 'Sarah Chen', new Date().toISOString());
        }
        catch (e) {
            return (e as Error).message;
        } setState(next); setNotice(input.id.trim().toUpperCase() + ' registered as current-lot evidence for ' + id + '.'); return null; },
        logSystem: (id, action) => setState(s => ({ ...s, audit: [event(id, action, 'System'), ...s.audit] })),
        updateCapa: (id, status) => { setState(s => { const c = s.capas.find(c => c.id === id)!; return { ...s, capas: s.capas.map(c => c.id === id ? { ...c, status } : c), audit: [event(c.ncrId, id + ' status changed to ' + status), ...s.audit] }; }); setNotice('CAPA status updated.'); },
        assignCapa: c => { const id = 'CAPA-' + String(Math.max(42, ...state.capas.map(c => Number(c.id.split('-')[1]))) + 1).padStart(3, '0'); setState(s => ({ ...s, capas: [{ ...c, id }, ...s.capas], audit: [event(c.ncrId, 'Assigned ' + id + ' to ' + c.owner), ...s.audit] })); setNotice('Corrective action assigned.'); },
        checkEscalations: () => setState(s => withEscalations(s, todayIso(), new Date().toISOString())),
        reset: () => { setState(withEscalations(createInitialState(), todayIso(), new Date().toISOString())); setNotice('Demo reset to the original connected dataset.'); } };
    return <Context.Provider value={store}>{children}{notice && <div className="toast" role="status">{notice}</div>}</Context.Provider>;
}
export function useApp() { const ctx = useContext(Context); if (!ctx)
    throw new Error('App provider missing'); return ctx; }
