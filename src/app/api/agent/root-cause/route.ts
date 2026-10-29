import { DEFAULT_AGENT_URL, forwardToAgent } from '@/lib/agent-proxy';

// POST /api/agent/root-cause: forwards a propose_root_cause request to the quality agent.
// AGENT_URL is server-only, so the browser never needs to know where the agent runs.
export async function POST(request: Request) {
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object')
        return Response.json({ status: 'error', error: 'Request body must be JSON.' }, { status: 400 });
    const result = await forwardToAgent(body, process.env.AGENT_URL || DEFAULT_AGENT_URL);
    return Response.json(result.body, { status: result.status });
}
