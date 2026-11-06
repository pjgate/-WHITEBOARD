// Cổng AI cho Bảng trắng — chạy trên Cloudflare Workers.
// Nhiệm vụ: giữ khóa API của Claude ở phía máy chủ (không lộ ra trang web),
// chỉ cho phép người đã đăng nhập Google từ trang Bảng trắng (và có email trong danh sách) gọi AI.
//
// Biến môi trường cần đặt trong Cloudflare (Settings → Variables and Secrets):
//   ANTHROPIC_API_KEY  (Secret, bắt buộc)  khóa API lấy ở https://console.anthropic.com
//   ALLOWED_EMAILS     (Text, nên có)      danh sách email được dùng AI, cách nhau bằng dấu phẩy. Để trống = ai đăng nhập được app đều dùng được.
//   GOOGLE_CLIENT_ID   (Text, nên có)      OAuth Client ID của app, để chỉ nhận đăng nhập từ đúng app Bảng trắng.
//   ALLOWED_ORIGINS    (Text, tùy chọn)    mặc định https://sangs8516.github.io
//   MODEL              (Text, tùy chọn)    mặc định claude-sonnet-5-5
//   MAX_TOKENS         (Text, tùy chọn)    độ dài tối đa mỗi câu trả lời, mặc định 2000

const DEFAULT_ORIGINS = 'https://sangs8516.github.io';
const DEFAULT_MODEL = 'claude-sonnet-5-5';
const MAX_BODY = 8 * 1024 * 1024; // 8 MB
const tokenCache = new Map();     // google token -> {email, exp}

const list = v => String(v || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

function cors(origin, env) {
  const allowed = list(env.ALLOWED_ORIGINS || DEFAULT_ORIGINS);
  const ok = origin && allowed.includes(origin.toLowerCase());
  return {
    'Access-Control-Allow-Origin': ok ? origin : allowed[0] || '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}
const json = (obj, status, h) => new Response(JSON.stringify(obj), { status, headers: { ...h, 'Content-Type': 'application/json; charset=utf-8' } });

async function checkGoogle(token, env) {
  const hit = tokenCache.get(token);
  if (hit && hit.exp > Date.now()) return hit.email;
  // 1) token có phải do app Bảng trắng cấp không
  const ti = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token));
  if (!ti.ok) throw Object.assign(new Error('Phiên đăng nhập Google không hợp lệ hoặc đã hết hạn. Hãy đăng nhập lại.'), { status: 401 });
  const info = await ti.json();
  if (env.GOOGLE_CLIENT_ID && info.azp !== env.GOOGLE_CLIENT_ID && info.aud !== env.GOOGLE_CLIENT_ID)
    throw Object.assign(new Error('Đăng nhập không đến từ app Bảng trắng.'), { status: 403 });
  // 2) lấy email (app chỉ xin quyền Drive nên hỏi Drive)
  const ab = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', { headers: { Authorization: 'Bearer ' + token } });
  if (!ab.ok) throw Object.assign(new Error('Không xác minh được tài khoản Google.'), { status: 401 });
  const email = ((await ab.json()).user?.emailAddress || '').toLowerCase();
  if (!email) throw Object.assign(new Error('Không lấy được email.'), { status: 401 });
  const ttl = Math.min(10 * 60, +info.expires_in || 300) * 1000;
  tokenCache.set(token, { email, exp: Date.now() + ttl });
  if (tokenCache.size > 500) tokenCache.delete(tokenCache.keys().next().value);
  return email;
}

export default {
  async fetch(req, env) {
    const h = cors(req.headers.get('Origin'), env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    if (req.method === 'GET') return json({ ok: true, service: 'bang-trang-ai', configured: !!env.ANTHROPIC_API_KEY }, 200, h);
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, h);

    const origin = (req.headers.get('Origin') || '').toLowerCase();
    if (!list(env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).includes(origin)) return json({ error: 'Trang này không được phép dùng cổng AI.' }, 403, h);
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'Cổng AI chưa có ANTHROPIC_API_KEY.' }, 500, h);

    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Cần đăng nhập Google để dùng AI.' }, 401, h);
    let email;
    try { email = await checkGoogle(token, env); }
    catch (e) { return json({ error: e.message }, e.status || 401, h); }
    const allow = list(env.ALLOWED_EMAILS);
    if (allow.length && !allow.includes(email)) return json({ error: `Tài khoản ${email} chưa được phép dùng AI. Hãy nhờ admin thêm email vào danh sách.` }, 403, h);

    const len = +req.headers.get('Content-Length') || 0;
    if (len > MAX_BODY) return json({ error: 'Nội dung gửi lên quá lớn, hãy chọn ít ảnh/trang hơn.' }, 413, h);
    let body;
    try { body = await req.json(); } catch { return json({ error: 'Dữ liệu gửi lên không hợp lệ.' }, 400, h); }
    if (!Array.isArray(body.messages) || !body.messages.length) return json({ error: 'Thiếu nội dung câu hỏi.' }, 400, h);

    const maxT = Math.max(256, Math.min(+env.MAX_TOKENS || 2000, 8000));
    const payload = {
      model: env.MODEL || DEFAULT_MODEL,
      max_tokens: Math.min(+body.max_tokens || maxT, maxT),
      messages: body.messages.slice(-20),
      metadata: { user_id: email.replace(/[^a-z0-9]/g, '_').slice(0, 64) },
    };
    if (typeof body.system === 'string') payload.system = body.system.slice(0, 60000);

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) {
      const m = out?.error?.message || ('HTTP ' + r.status);
      const vi = r.status === 401 ? 'Khóa API của Claude sai hoặc đã bị thu hồi.'
        : r.status === 429 ? 'AI đang quá tải hoặc hết hạn mức, thử lại sau ít phút.'
        : /credit|billing|balance/i.test(m) ? 'Tài khoản API hết tiền. Hãy nạp thêm ở console.anthropic.com.'
        : 'AI báo lỗi: ' + m;
      return json({ error: vi }, r.status >= 500 ? 502 : r.status, h);
    }
    const text = (out.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
    return json({ text, usage: out.usage, model: out.model, email }, 200, h);
  },
};
