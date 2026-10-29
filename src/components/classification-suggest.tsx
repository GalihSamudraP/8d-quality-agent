'use client';
import { useState } from 'react';
import { LoaderCircle, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { agentBackend } from '@/lib/agent-client';
import { agreementLabel, AREAS, CATEGORIES, CLASSIFICATION_ACTOR, requestClassification, SEVERITIES, UNCLASSIFIED, type ClassificationFields, type ClassificationResponse } from '@/lib/classification';
import type { Severity } from '@/lib/types';

const LABELS: [keyof ClassificationResponse['proposal'], string][] = [['category', 'Category'], ['defect_code', 'Defect code'], ['severity', 'Severity'], ['area', 'Production area']];

// "Suggest classification": asks the agent for a retrieval-vote proposal. Without the local agent there is no
// suggestion at all; nothing is simulated here.
export function SuggestClassificationButton({ input, onResult }: { input: () => { id?: string; title: string; description: string }; onResult: (r: ClassificationResponse) => void }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    if (agentBackend !== 'local')
        return <p className="small muted">Suggest classification needs the local agent (NEXT_PUBLIC_AGENT_BACKEND=local). It is not simulated.</p>;
    async function run() {
        const value = input();
        if (!(value.title.trim() || value.description.trim())) {
            setError('Enter a title or description first.');
            return;
        }
        setError(''); setBusy(true);
        try {
            onResult(await requestClassification(value));
        }
        catch (e) {
            setError('Classification unavailable: ' + (e as Error).message);
        }
        setBusy(false);
    }
    return <div className="stack"><Button type="button" variant="outline" disabled={busy} onClick={run}>{busy ? <LoaderCircle size={16} className="spin"/> : <Sparkles size={16}/>}Suggest classification</Button>{error && <p className="error" role="alert">{error}</p>}</div>;
}

export function ClassificationProposal({ r }: { r: ClassificationResponse }) {
    return <div className="classification-proposal callout blue-callout"><div><strong>Agent proposal, not validated</strong><small>{CLASSIFICATION_ACTOR} over {r.retrieved.length} similar historical {r.retrieved.length === 1 ? 'case' : 'cases'}</small><ul>{LABELS.map(([f, label]) => <li key={f}>{label}: <strong>{r.proposal[f] ?? UNCLASSIFIED}</strong>{agreementLabel(r, f) && <> <span className="badge badge-major">{agreementLabel(r, f)}</span></>} <small>({Object.entries(r.votes[f]).map(([v, n]) => v + ' ' + n).join(', ') || 'no votes'})</small></li>)}</ul><small>Cited cases: {r.cited_ncr_ids.join(', ') || 'none'}</small>{r.missing_data.map(m => <small key={m}>{m}</small>)}</div></div>;
}

// Editable fields for the engineer; used in the create form and in the NCR detail.
export function ClassificationFieldsEditor({ value, onChange }: { value: ClassificationFields; onChange: (v: ClassificationFields) => void }) {
    return <div className="form-grid"><label>Production area<select name="area" value={value.area} onChange={e => onChange({ ...value, area: e.target.value })}>{AREAS.map(x => <option key={x}>{x}</option>)}</select></label><label>Severity<select name="severity" value={value.severity} onChange={e => onChange({ ...value, severity: e.target.value as Severity })}>{SEVERITIES.map(x => <option key={x}>{x}</option>)}</select></label><label>Defect category<select name="category" value={value.category} onChange={e => onChange({ ...value, category: e.target.value })}>{CATEGORIES.map(x => <option key={x}>{x}</option>)}</select></label><label>Defect code<input name="code" required placeholder="POR-01" value={value.code} onChange={e => onChange({ ...value, code: e.target.value })}/></label></div>;
}
