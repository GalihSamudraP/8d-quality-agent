// Server-side forwarding from the Next.js route to the agent's AgentCore-style /invocations endpoint.
export const DEFAULT_AGENT_URL = 'http://127.0.0.1:8080';
const TIMEOUT_MS = 60_000;

export interface ProxyResult {
    status: number;
    body: unknown;
}

export async function forwardToAgent(body: unknown, agentUrl: string = DEFAULT_AGENT_URL, fetchImpl: typeof fetch = fetch): Promise<ProxyResult> {
    const url = agentUrl.replace(/\/+$/, '') + '/invocations';
    let res: Response;
    try {
        res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
    }
    catch {
        return { status: 502, body: { status: 'error', error: 'Agent unavailable at ' + url + '. Start it with: cd agent && .venv/Scripts/python -m quality_agent.app' } };
    }
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok || !json || typeof json !== 'object')
        return { status: 502, body: { status: 'error', error: 'Agent returned HTTP ' + res.status + '.' } };
    // The agent reports failures in the body: error_type "request" is a bad request, anything else a model or upstream failure.
    const result = json as { status?: string; error_type?: string };
    if (result.status !== 'error')
        return { status: 200, body: json };
    return { status: result.error_type === 'request' ? 400 : 502, body: json };
}
