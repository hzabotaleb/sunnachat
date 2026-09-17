const ALLOWED_ORIGINS = new Set([
  'https://sunnachat.com',
  'https://www.sunnachat.com',
]);

const RATE_LIMIT_MAX = 20;        // requests per window, per IP
const RATE_LIMIT_WINDOW = 3600;   // seconds (1 hour)
const MAX_BODY_BYTES = 60_000;    // guard against oversized payloads
const MAX_MESSAGES = 40;          // guard against runaway history
const MAX_SYSTEM_PROMPT = 60_000; // sysPrompt() in index.html is ~46KB

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers });
    }
    if (!ALLOWED_ORIGINS.has(origin)) {
      return json({ error: 'origin not allowed' }, 403, headers);
    }
    if (request.method !== 'POST') {
      return json({ error: 'method not allowed' }, 405, headers);
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rateKey = `rl:${ip}`;
    const current = parseInt((await env.RATE_LIMIT.get(rateKey)) || '0', 10);
    if (current >= RATE_LIMIT_MAX) {
      return json(
        { error: 'تم تجاوز الحد المسموح من الأسئلة لهذه الساعة، حاول لاحقاً.' },
        429,
        headers,
      );
    }

    const bodyText = await request.text();
    if (bodyText.length > MAX_BODY_BYTES) {
      return json({ error: 'الطلب كبير جداً' }, 413, headers);
    }

    let payload;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      return json({ error: 'invalid json' }, 400, headers);
    }

    const messages = Array.isArray(payload.messages)
      ? payload.messages.slice(-MAX_MESSAGES).filter(
          (m) => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'),
        )
      : [];
    const systemPrompt = typeof payload.systemPrompt === 'string'
      ? payload.systemPrompt.slice(0, MAX_SYSTEM_PROMPT)
      : '';

    if (!messages.length) {
      return json({ error: 'no messages' }, 400, headers);
    }

    // Count this request against the rate limit before calling upstream,
    // so a burst can't slip through while requests are in flight.
    await env.RATE_LIMIT.put(rateKey, String(current + 1), { expirationTtl: RATE_LIMIT_WINDOW });

    let result;
    try {
      result = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        max_tokens: 1000,
      });
    } catch (e) {
      return json({ error: 'AI service error: ' + e.message }, 502, headers);
    }

    const reply = result?.response;
    if (!reply) {
      return json({ error: 'AI service returned no response' }, 502, headers);
    }

    return json({ reply }, 200, headers);
  },
};
