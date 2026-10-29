'use client';
/* eslint-disable react-hooks/set-state-in-effect -- Hydrate browser-only storage and URL parameters after mount. */
import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';
import { Plus, ArrowUpRight } from 'lucide-react';
import { useApp } from '@/components/app-provider';
import { PageHeading, SearchBox, Badge } from '@/components/common';
import { NcrTable } from '@/components/ncr-table';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { NCR } from '@/lib/types';
import { ClassificationFieldsEditor, ClassificationProposal, SuggestClassificationButton } from '@/components/classification-suggest';
import { IntakeUploads, type IntakeState } from '@/components/intake-uploads';
import type { IntakeFields } from '@/lib/intake';
import { AREAS, missingRequiredFields, proposedFields, type ClassificationFields, type ClassificationResponse } from '@/lib/classification';
const DEFAULT_FIELDS: ClassificationFields = { area: 'Die casting', severity: 'Major', category: 'Porosity', code: '' };
export default function NcrPage() {
    const { state, addNcr, recordClassificationSuggestion, acceptClassification } = useApp();
    const formRef = useRef<HTMLFormElement>(null);
    const [fields, setFields] = useState<ClassificationFields>(DEFAULT_FIELDS);
    const [suggestion, setSuggestion] = useState<ClassificationResponse | null>(null);
    const [detailSuggestion, setDetailSuggestion] = useState<ClassificationResponse | null>(null);
    const [detailFields, setDetailFields] = useState<ClassificationFields>(DEFAULT_FIELDS);
    const [query, setQuery] = useState('');
    const [status, setStatus] = useState('All statuses');
    const [severity, setSeverity] = useState('All severities');
    const [create, setCreate] = useState(false);
    const [selected, setSelected] = useState<NCR | null>(null);
    const [intake, setIntake] = useState<IntakeState>({});
    const [error, setError] = useState('');
    useEffect(() => {
        const p = new URLSearchParams(window.location.search);
        if (p.has('new'))
            setCreate(true);
        if (p.get('case'))
            setSelected(state.ncrs.find(n => n.id === p.get('case')) || null);
    }, [state.ncrs]);
    // The dialog shows the stored record, so an accepted classification appears at once.
    const current = selected ? state.ncrs.find(n => n.id === selected.id) ?? selected : null;
    function formInput() { const f = new FormData(formRef.current ?? undefined); return { title: String(f.get('title') ?? ''), description: String(f.get('description') ?? '') }; }
    function openCreate() { setCreate(true); setError(''); setFields(DEFAULT_FIELDS); setSuggestion(null); setIntake({}); }
    // Applying an upload proposal only fills the form; nothing is saved until Create NCR.
    function setInput(name: string, value: string) { const el = formRef.current?.elements.namedItem(name); if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.value = value; }
    function fillFromDocument(p: IntakeFields) { if (p.title) setInput('title', p.title); if (p.description) setInput('description', p.description); if (p.lot) setInput('lot', p.lot); if (p.quantity) setInput('quantity', String(p.quantity)); if (p.area && AREAS.includes(p.area)) setFields(f => ({ ...f, area: p.area! })); }
    function appendPhotoReading(text: string) { const el = formRef.current?.elements.namedItem('description'); const before = el instanceof HTMLTextAreaElement ? el.value.trim() : ''; setInput('description', (before ? before + '\n' : '') + 'Photo (agent reading, not validated): ' + text); }
    function select(n: NCR | null) { setSelected(n); setDetailSuggestion(null); }
    const records = state.ncrs.filter(n => (n.id + ' ' + n.title + ' ' + n.area + ' ' + n.code).toLowerCase().includes(query.toLowerCase()) && (status === 'All statuses' || n.status === status) && (severity === 'All severities' || n.severity === severity));
    function submit(e: React.FormEvent<HTMLFormElement>) { e.preventDefault(); const f = new FormData(e.currentTarget); const title = String(f.get('title')).trim(), description = String(f.get('description')).trim(); const missing = missingRequiredFields({ title, description, code: fields.code, lot: String(f.get('lot') ?? ''), quantity: String(f.get('quantity') ?? '') }); if (missing.length) {
        setError('Fill in the required ' + (missing.length === 1 ? 'field' : 'fields') + ': ' + missing.join(', ') + '.');
        return;
    } if (title.length < 5 || description.length < 20) {
        setError('Use a title of at least 5 characters and a description of at least 20 characters.');
        return;
    } const payload = { title, description, area: fields.area, code: fields.code.trim(), category: fields.category, severity: fields.severity, owner: String(f.get('owner')), quantity: Number(f.get('quantity')), lot: String(f.get('lot')).trim(), document: intake.documentName, photo: intake.photoName }; const id = addNcr(payload, { classification: suggestion ? { response: suggestion, chosen: { area: payload.area, code: payload.code, category: payload.category, severity: payload.severity } } : undefined, intake: { document: intake.document, photo: intake.photo } }); setCreate(false); setSuggestion(null); setIntake({}); window.history.replaceState(null, '', '/ncr'); select({ ...payload, id, date: new Date().toISOString().slice(0, 10), status: 'Open', evidence: [] }); }
    return <><PageHeading eyebrow="NON-CONFORMANCE MANAGEMENT" title="NCR Management" description="Capture, classify, and investigate quality issues in one place." action={<Button onClick={openCreate}><Plus size={16}/>New NCR</Button>}/><div className="summary-strip"><span><strong>{state.ncrs.length}</strong> Total records</span><span><i className="dot-orange"/><strong>{state.ncrs.filter(n => n.status === 'Open').length}</strong> Open</span><span><i className="dot-blue"/><strong>{state.ncrs.filter(n => n.status === 'In progress').length}</strong> In progress</span><span><i className="dot-purple"/><strong>{state.ncrs.filter(n => n.status === 'Pending approval').length}</strong> Awaiting review</span></div><section className="card"><div className="filter-bar"><SearchBox value={query} onChange={setQuery} placeholder="Search case, defect, or production area…"/><select aria-label="Filter status" value={status} onChange={e => setStatus(e.target.value)}>{['All statuses', 'Open', 'In progress', 'Pending approval', 'Closed'].map(s => <option key={s}>{s}</option>)}</select><select aria-label="Filter severity" value={severity} onChange={e => setSeverity(e.target.value)}>{['All severities', 'Critical', 'Major', 'Minor'].map(s => <option key={s}>{s}</option>)}</select></div><NcrTable records={records} onSelect={select}/><div className="card-foot">Showing {records.length} of {state.ncrs.length} records</div></section><Dialog open={!!current} onOpenChange={v => !v && select(null)} title={current?.id || 'NCR detail'} description={current?.title}>{current && <div className="stack"><div className="inline"><Badge>{current.status}</Badge><Badge>{current.severity}</Badge></div><p>{current.description}</p><div className="detail-grid">{[['Production area', current.area], ['Defect classification', current.category + ' · ' + current.code], ['Assigned engineer', current.owner], ['Affected quantity', current.quantity + ' units'], ['Lot number', current.lot], ['Document', current.document || 'Text-based submission'], ['Photo', current.photo || 'None attached']].map(([k, v]) => <div key={k}><small>{k}</small><strong>{v}</strong></div>)}</div><div className="callout">{current.evidence.length ? current.evidence.length + ' historical references available for investigation.' : 'Evidence missing: collect inspection and process records before validating a root cause.'}</div><div className="stack"><SuggestClassificationButton input={() => ({ id: current.id, title: current.title, description: current.description })} onResult={r => { recordClassificationSuggestion(current.id, r); setDetailSuggestion(r); setDetailFields(proposedFields(r, current)); }}/>{detailSuggestion && <><ClassificationProposal r={detailSuggestion}/><ClassificationFieldsEditor value={detailFields} onChange={setDetailFields}/><div className="dialog-actions"><Button variant="outline" onClick={() => setDetailSuggestion(null)}>Dismiss</Button><Button disabled={!detailFields.code.trim()} onClick={() => { acceptClassification(current.id, detailSuggestion, { ...detailFields, code: detailFields.code.trim() }); setDetailSuggestion(null); }}>Accept classification</Button></div></>}</div><Button asChild><Link href={'/workspace?case=' + current.id}><ArrowUpRight size={16}/>Open associated 8D report</Link></Button></div>}</Dialog><Dialog open={create} onOpenChange={setCreate} title="Create a non-conformance" description="Record the observed issue. Uploaded documents and photos give proposals you confirm; they are attachments, not current-lot evidence."><form ref={formRef} className="stack" noValidate onSubmit={submit}><label>Problem title<input name="title" required minLength={5} maxLength={120} placeholder="e.g. Porosity in aluminum motor housing"/></label><label>Problem description<textarea name="description" required minLength={20} rows={3} placeholder="What happened, where, when, and how many units are affected?"/></label><SuggestClassificationButton input={formInput} onResult={r => { setSuggestion(r); setFields(proposedFields(r, fields)); }}/>{suggestion && <ClassificationProposal r={suggestion}/>}<ClassificationFieldsEditor value={fields} onChange={setFields}/><div className="form-grid"><label>Lot / batch number<input name="lot" required placeholder="LOT-DC-2411"/></label><label>Affected quantity<input name="quantity" type="number" min={1} max={1000000} defaultValue={1} required/></label><label className="span-two">Assigned engineer<select name="owner">{['Sarah Chen', 'James Wilson', 'Maria Garcia', 'David Park'].map(x => <option key={x}>{x}</option>)}</select></label></div><IntakeUploads value={intake} onChange={setIntake} fill={fillFromDocument} appendDescription={appendPhotoReading}/>{error && <p className="error" role="alert">{error}</p>}<div className="dialog-actions"><Button type="button" variant="outline" onClick={() => setCreate(false)}>Cancel</Button><Button type="submit">Create NCR</Button></div></form></Dialog></>;
}
