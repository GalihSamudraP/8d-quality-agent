// NCR intake from uploads (agent actions extract_ncr_intake and describe_photo, agent/quality_agent/intake.py).
// Both return proposals: nothing is saved until the engineer creates the NCR, and an upload is never evidence.
import { AgentError } from './agent-client';
import type { AuditEvent } from './types';

export const DOCUMENT_ACTOR = 'Document intake agent (rule-based extraction)';
export const PHOTO_ACTOR = 'Photo reading agent (SAP AI Core)';
export const PHOTO_LABEL = 'Agent reading of the photo, not validated';
export const PHOTO_UNAVAILABLE = 'Photo analysis not available in this build';
export const DOCUMENT_TYPES = /\.(pdf|txt)$/i;
export const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

export interface IntakeFields {
    title: string | null;
    description: string | null;
    lot: string | null;
    quantity: number | null;
    area: string | null;
}

export interface DocumentIntake {
    status: 'success';
    task: 'extract_ncr_intake';
    method: string;
    file_name: string;
    text_chars: number;
    proposal: IntakeFields;
    missing_fields: string[];
    missing_data: string[];
    text_excerpt: string;
}

export interface PhotoReading {
    status: 'success';
    task: 'describe_photo';
    label: string;
    file_name: string;
    description: string;
}

function failure(json: unknown): never {
    const e = json as { status?: string; error?: unknown; error_type?: string } | null;
    if (e && e.status === 'error' && e.error_type === 'unavailable')
        throw new AgentError(PHOTO_UNAVAILABLE + '.');
    throw new AgentError(e && e.status === 'error' && typeof e.error === 'string' ? e.error : 'Agent response does not match the expected shape.');
}

export function parseDocumentIntake(json: unknown): DocumentIntake {
    const r = json as DocumentIntake;
    const p = r?.proposal;
    const strOrNull = (v: unknown) => v === null || typeof v === 'string';
    if (!r || r.status !== 'success' || r.task !== 'extract_ncr_intake' || !p || !strOrNull(p.title) || !strOrNull(p.description) || !strOrNull(p.lot) || !strOrNull(p.area) || !(p.quantity === null || (Number.isInteger(p.quantity) && p.quantity > 0)) || !Array.isArray(r.missing_fields) || !Array.isArray(r.missing_data))
        failure(json);
    return r;
}

export function parsePhotoReading(json: unknown): PhotoReading {
    const r = json as PhotoReading;
    if (!r || r.status !== 'success' || r.task !== 'describe_photo' || typeof r.description !== 'string' || !r.description.trim() || r.label !== PHOTO_LABEL)
        failure(json);
    return r;
}

export function toBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

async function post(body: unknown, fetchImpl: typeof fetch): Promise<unknown> {
    let res: Response;
    try {
        res = await fetchImpl('/api/agent/intake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }
    catch {
        throw new AgentError('Could not reach the app API.');
    }
    return res.json().catch(() => null);
}

export async function requestDocumentIntake(name: string, bytes: Uint8Array, fetchImpl: typeof fetch = fetch): Promise<DocumentIntake> {
    return parseDocumentIntake(await post({ action: 'extract_ncr_intake', file: { name, content_base64: toBase64(bytes) } }, fetchImpl));
}

export async function requestPhotoReading(name: string, mime: string, bytes: Uint8Array, fetchImpl: typeof fetch = fetch): Promise<PhotoReading> {
    return parsePhotoReading(await post({ action: 'describe_photo', image: { name, mime, content_base64: toBase64(bytes) } }, fetchImpl));
}

export function fieldsSummary(p: IntakeFields): string {
    return ['title', 'lot', 'quantity', 'area'].map(k => k + ' ' + (p[k as keyof IntakeFields] ?? 'not found')).join(', ');
}

// Events recorded when the engineer creates the NCR from the form: the proposals (AI) and the confirmation (Human).
export function intakeEvents(ncrId: string, intake: { document?: DocumentIntake; photo?: PhotoReading }, actor: string, now: string): AuditEvent[] {
    const events: AuditEvent[] = [];
    const add = (who: string, kind: AuditEvent['kind'], action: string) => events.push({ id: crypto.randomUUID(), ncrId, actor: who, kind, action, timestamp: now });
    if (intake.document || intake.photo)
        add(actor, 'Human', 'Confirmed the NCR form after reviewing the ' + [intake.document && 'document proposal', intake.photo && 'photo reading'].filter(Boolean).join(' and ') + '. Uploads are attachments, not current-lot evidence.');
    if (intake.photo)
        add(PHOTO_ACTOR, 'AI', PHOTO_LABEL + ' (' + intake.photo.file_name + '): ' + intake.photo.description);
    if (intake.document)
        add(DOCUMENT_ACTOR, 'AI', 'Proposed NCR fields from ' + intake.document.file_name + ': ' + fieldsSummary(intake.document.proposal) + '.' + (intake.document.missing_fields.length ? ' Evidence missing: ' + intake.document.missing_fields.join(', ') + '.' : ''));
    return events;
}
