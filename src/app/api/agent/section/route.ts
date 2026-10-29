import { DEFAULT_AGENT_URL, forwardToAgent } from '@/lib/agent-proxy';

// POST /api/agent/section: forwards a draft_section (D2 or D3) request to the quality agent.
export async function POST(request: Request) {
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || (body as { action?: unknown }).action !== 'draft_section')
        return Response.json({ status: 'error', error: 'Request body must be a draft_section request.' }, { status: 400 });
    const result = await forwardToAgent(body, process.env.AGENT_URL || DEFAULT_AGENT_URL);
    return Response.json(result.body, { status: result.status });
}
