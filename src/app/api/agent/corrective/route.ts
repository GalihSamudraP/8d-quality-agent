import { DEFAULT_AGENT_URL, forwardToAgent } from '@/lib/agent-proxy';

// POST /api/agent/corrective: forwards a propose_corrective_actions (D5) request to the quality agent.
export async function POST(request: Request) {
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || (body as { action?: unknown }).action !== 'propose_corrective_actions')
        return Response.json({ status: 'error', error: 'Request body must be a propose_corrective_actions request.' }, { status: 400 });
    const result = await forwardToAgent(body, process.env.AGENT_URL || DEFAULT_AGENT_URL);
    return Response.json(result.body, { status: result.status });
}
