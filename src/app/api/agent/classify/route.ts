import { DEFAULT_AGENT_URL, forwardToAgent } from '@/lib/agent-proxy';

// POST /api/agent/classify: forwards a classify_ncr request (retrieval vote, no model) to the quality agent.
export async function POST(request: Request) {
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || (body as { action?: unknown }).action !== 'classify_ncr')
        return Response.json({ status: 'error', error: 'Request body must be a classify_ncr request.' }, { status: 400 });
    const result = await forwardToAgent(body, process.env.AGENT_URL || DEFAULT_AGENT_URL);
    return Response.json(result.body, { status: result.status });
}
