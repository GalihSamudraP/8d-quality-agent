import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentError } from '../src/lib/agent-client';
import { DOCUMENT_ACTOR, intakeEvents, parseDocumentIntake, parsePhotoReading, PHOTO_ACTOR, PHOTO_LABEL, requestDocumentIntake, requestPhotoReading, toBase64, type DocumentIntake, type PhotoReading } from '../src/lib/intake';
import { createInitialState } from '../src/lib/data';
import { eventBadge, isD4Locked, registryOf, rootCauseCheck } from '../src/lib/workflow';

const txt = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'intake', 'ncr-sample.txt'));
const doc: DocumentIntake = { status: 'success', task: 'extract_ncr_intake', method: 'rule-based extraction', file_name: 'ncr-sample.txt', text_chars: 300, proposal: { title: 'Porosity in aluminum motor housing', description: 'X-ray inspection found internal porosity.', lot: 'LOT-DC-2411', quantity: 48, area: 'Die casting' }, missing_fields: [], missing_data: [], text_excerpt: '...' };
const photo: PhotoReading = { status: 'success', task: 'describe_photo', label: PHOTO_LABEL, file_name: 'boss.png', description: 'Porosity cluster visible near a boss.' };

function capture(response: unknown) {
    const sent: { url?: string; body?: Record<string, unknown> } = {};
    const fetchImpl = (async (url: string, init: RequestInit) => { sent.url = url; sent.body = JSON.parse(String(init.body)); return new Response(JSON.stringify(response)); }) as unknown as typeof fetch;
    return { sent, fetchImpl };
}

test('a document upload is sent as base64 to the intake route and parsed as a proposal', async () => {
    const { sent, fetchImpl } = capture(doc);
    const r = await requestDocumentIntake('ncr-sample.txt', new Uint8Array(txt), fetchImpl);
    assert.equal(sent.url, '/api/agent/intake');
    assert.equal(sent.body?.action, 'extract_ncr_intake');
    assert.equal(Buffer.from((sent.body?.file as { content_base64: string }).content_base64, 'base64').toString('utf8'), txt.toString('utf8'));
    assert.equal(r.proposal.lot, 'LOT-DC-2411');
    assert.equal(toBase64(new Uint8Array(70000).fill(65)), Buffer.alloc(70000, 65).toString('base64'), 'large files are encoded in chunks');
    assert.throws(() => parseDocumentIntake({ ...doc, proposal: { ...doc.proposal, quantity: -2 } }), AgentError);
    assert.throws(() => parseDocumentIntake({ status: 'error', error_type: 'request', error: '.docx is not supported in this build. Save the document as PDF or TXT.' }), /docx is not supported/);
});

test('a photo reading carries its label; an agent without image support says photo analysis is not available', async () => {
    const { sent, fetchImpl } = capture(photo);
    const r = await requestPhotoReading('boss.png', 'image/png', new Uint8Array([137, 80, 78, 71]), fetchImpl);
    assert.equal((sent.body?.image as { mime: string }).mime, 'image/png');
    assert.equal(r.label, 'Agent reading of the photo, not validated');
    assert.throws(() => parsePhotoReading({ ...photo, label: 'Photo analysis' }), AgentError, 'an unlabelled reading is refused');
    assert.throws(() => parsePhotoReading({ status: 'error', error_type: 'unavailable', error: 'x' }), /Photo analysis not available in this build/);
});

test('upload proposals are AI events, the confirmation a Human event, and neither adds evidence', () => {
    const events = intakeEvents('NCR-2026-105', { document: doc, photo }, 'Sarah Chen', '2026-10-28T09:00:00Z');
    assert.deepEqual(events.map(e => [e.kind, e.actor]), [['Human', 'Sarah Chen'], ['AI', PHOTO_ACTOR], ['AI', DOCUMENT_ACTOR]]);
    assert.match(events[0].action, /Uploads are attachments, not current-lot evidence\./);
    assert.match(events[1].action, /^Agent reading of the photo, not validated \(boss\.png\): Porosity cluster/);
    assert.equal(events[2].action, 'Proposed NCR fields from ncr-sample.txt: title Porosity in aluminum motor housing, lot LOT-DC-2411, quantity 48, area Die casting.');
    assert.deepEqual(events.map(eventBadge), ['Human', 'Agent', 'Rule-based']);
    assert.deepEqual(intakeEvents('NCR-2026-105', {}, 'Sarah Chen', 'now'), []);
    // An NCR with attachments is still locked at D4 and its registry is unchanged.
    const s = createInitialState();
    const withFiles = { ...s, ncrs: s.ncrs.map(n => n.id === 'NCR-2026-100' ? { ...n, document: 'report.pdf', photo: 'boss.png' } : n), audit: [...intakeEvents('NCR-2026-100', { document: doc, photo }, 'Sarah Chen', 'now'), ...s.audit] };
    assert.equal(isD4Locked(withFiles, 'NCR-2026-100'), true);
    assert.deepEqual(registryOf(withFiles), registryOf(s));
});

test('"the photo shows" in D4 fails the check unless the sentence cites registered evidence (Rule G)', () => {
    const s = createInitialState();
    s.reports.find(r => r.ncrId === 'NCR-2026-104')!.agentRetrieved = [{ id: 'NCR-2025-084', title: 'x', score: 1 }];
    const fail = rootCauseCheck(s, 'NCR-2026-104', 'Hypothesis: vent blockage per NCR-2025-084. The photo shows pores near the boss.');
    assert.deepEqual(fail.issues.map(i => i.code), ['UPLOAD_AS_EVIDENCE']);
    const pass = rootCauseCheck(s, 'NCR-2026-104', 'Hypothesis: vent blockage per NCR-2025-084. The X-ray photo registered as TR-104 shows pores near the boss.');
    assert.equal(pass.ok, true);
});
