import { DEFAULT_AGENT_URL, forwardToAgent } from '@/lib/agent-proxy';

// POST /api/agent/intake: forwards extract_ncr_intake (document) and describe_photo (photo) requests to the agent.
export async function POST(request: Request) {
    const body: unknown = await request.json().catch(() => null);
    const action = body && typeof body === 'object' ? (body as { action?: unknown }).action : undefined;
    if (action !== 'extract_ncr_intake' && action !== 'describe_photo')
        return Response.json({ status: 'error', error: 'Request body must be an extract_ncr_intake or describe_photo request.' }, { status: 400 });
    const result = await forwardToAgent(body, process.env.AGENT_URL || DEFAULT_AGENT_URL);
    return Response.json(result.body, { status: result.status });
}
