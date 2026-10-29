'use client';
import { useState } from 'react';
import { Camera, FileText, LoaderCircle, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { agentBackend } from '@/lib/agent-client';
import { DOCUMENT_ACTOR, DOCUMENT_TYPES, MAX_DOCUMENT_BYTES, MAX_PHOTO_BYTES, PHOTO_ACTOR, PHOTO_LABEL, PHOTO_TYPES, PHOTO_UNAVAILABLE, requestDocumentIntake, requestPhotoReading, type DocumentIntake, type IntakeFields, type PhotoReading } from '@/lib/intake';

export interface IntakeState {
    documentName?: string;
    document?: DocumentIntake;
    photoName?: string;
    photo?: PhotoReading;
}

// Document and photo uploads in the New NCR form. Readings are proposals the engineer applies to the form; the
// files are attachments, never current-lot evidence. Without the local agent nothing is read and nothing is simulated.
export function IntakeUploads({ value, onChange, fill, appendDescription }: { value: IntakeState; onChange: (v: IntakeState) => void; fill: (p: IntakeFields) => void; appendDescription: (text: string) => void }) {
    const [busy, setBusy] = useState<'document' | 'photo' | null>(null);
    const [error, setError] = useState('');
    const [note, setNote] = useState('');
    const local = agentBackend === 'local';
    async function pickDocument(f: File | undefined) {
        if (!f)
            return;
        setError(''); setNote('');
        if (/\.docx$/i.test(f.name)) {
            onChange({ ...value, documentName: f.name, document: undefined });
            setNote('.docx is not supported in this build: the file is attached by name only and not read. Save it as PDF or TXT to get a proposal.');
            return;
        }
        if (!DOCUMENT_TYPES.test(f.name) || f.size > MAX_DOCUMENT_BYTES) {
            setError('Use a PDF or TXT smaller than 5 MB (DOCX is attached by name only).');
            return;
        }
        if (!local) {
            onChange({ ...value, documentName: f.name, document: undefined });
            setNote('Document reading needs the local agent. The file is attached by name only and not read.');
            return;
        }
        setBusy('document');
        try {
            const r = await requestDocumentIntake(f.name, new Uint8Array(await f.arrayBuffer()));
            onChange({ ...value, documentName: f.name, document: r });
        }
        catch (e) {
            onChange({ ...value, documentName: f.name, document: undefined });
            setError('Document not read: ' + (e as Error).message + ' The file stays attached by name.');
        }
        setBusy(null);
    }
    async function pickPhoto(f: File | undefined) {
        if (!f)
            return;
        setError(''); setNote('');
        if (!PHOTO_TYPES.includes(f.type) || f.size > MAX_PHOTO_BYTES) {
            setError('Use a PNG, JPEG or WebP photo smaller than 4 MB.');
            return;
        }
        if (!local) {
            onChange({ ...value, photoName: f.name, photo: undefined });
            setNote(PHOTO_UNAVAILABLE + ' without the local agent. The photo is attached by name only.');
            return;
        }
        setBusy('photo');
        try {
            const r = await requestPhotoReading(f.name, f.type, new Uint8Array(await f.arrayBuffer()));
            onChange({ ...value, photoName: f.name, photo: r });
        }
        catch (e) {
            onChange({ ...value, photoName: f.name, photo: undefined });
            setNote((e as Error).message + ' The photo is attached by name only.');
        }
        setBusy(null);
    }
    const d = value.document;
    return <div className="stack intake-uploads">
        <div className="form-grid">
            <label className="upload-zone"><UploadCloud size={22}/><strong>{busy === 'document' ? 'Reading document…' : value.documentName || 'Attach a document'}</strong><span>PDF, TXT · Max 5 MB · DOCX attached by name only</span><input type="file" accept=".pdf,.txt,.docx" disabled={!!busy} onChange={e => pickDocument(e.target.files?.[0])}/></label>
            <label className="upload-zone"><Camera size={22}/><strong>{busy === 'photo' ? 'Reading photo…' : value.photoName || 'Attach a photo'}</strong><span>PNG, JPEG, WebP · Max 4 MB</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={!!busy} onChange={e => pickPhoto(e.target.files?.[0])}/></label>
        </div>
        {busy && <p className="small muted"><LoaderCircle size={13} className="spin"/> Waiting for the agent…</p>}
        {note && <p className="small muted" role="status">{note}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {d && <div className="callout blue-callout"><FileText size={17}/><div className="stack-tight"><strong>Proposed from {d.file_name} · {DOCUMENT_ACTOR}, not validated</strong><small>Title: {d.proposal.title ?? 'not found'} · Lot: {d.proposal.lot ?? 'not found'} · Quantity: {d.proposal.quantity ?? 'not found'} · Area: {d.proposal.area ?? 'not found'}</small>{d.proposal.description && <small>Description: {d.proposal.description}</small>}{d.missing_data.map(m => <small key={m}>{m}</small>)}<div><Button type="button" variant="outline" onClick={() => fill(d.proposal)}>Fill the form with these values</Button></div></div></div>}
        {value.photo && <div className="callout blue-callout"><Camera size={17}/><div className="stack-tight"><strong>{PHOTO_LABEL}</strong><small>{PHOTO_ACTOR} · {value.photo.file_name}</small><p>{value.photo.description}</p><small>Not current-lot evidence. Register an inspection record in D4 to use it as evidence.</small><div><Button type="button" variant="outline" onClick={() => appendDescription(value.photo!.description)}>Add to description</Button></div></div></div>}
    </div>;
}
