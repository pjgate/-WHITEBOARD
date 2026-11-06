// Cổng AI cho Bảng trắng — chạy trên Google Apps Script (máy chủ Google, không bị Gemini chặn theo vùng).
// Giữ khóa Gemini ở phía máy chủ, chỉ cho người đã đăng nhập Google trên Bảng trắng (email trong danh sách) dùng AI.
//
// Cài đặt (Project Settings ⚙ → Script Properties):
//   GEMINI_API_KEY   (bắt buộc)  khóa lấy ở https://aistudio.google.com/apikey
//   ALLOWED_EMAILS   (nên có)    email được dùng AI, cách nhau bằng dấu phẩy. Có thể ghi cả tên miền, vd. @truongthang.vn
//   MODEL            (tùy chọn)  mặc định gemini-3.5-flash-lite
//   MAX_TOKENS       (tùy chọn)  mặc định 8192
// Triển khai: Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone.

const CLIENT_ID = '815013146430-cjh67feg7j7k5asaq72qrkrn3i70048r.apps.googleusercontent.com';
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

function prop_(k) { return (PropertiesService.getScriptProperties().getProperty(k) || '').trim(); }
function out_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function fail_(msg) { throw new Error(msg); }

function doGet() {
  return out_({ ok: true, service: 'bang-trang-ai', provider: 'gemini', model: prop_('MODEL') || DEFAULT_MODEL, configured: !!prop_('GEMINI_API_KEY') });
}

function doPost(e) {
  try {
    if (!prop_('GEMINI_API_KEY')) fail_('Cổng AI chưa có GEMINI_API_KEY (Script Properties).');
    let body;
    try { body = JSON.parse(e.postData.contents); } catch (x) { fail_('Dữ liệu gửi lên không hợp lệ.'); }
    const email = checkUser_(body.token);
    if (!Array.isArray(body.messages) || !body.messages.length) fail_('Thiếu nội dung câu hỏi.');
    const system = typeof body.system === 'string' ? body.system.slice(0, 60000) : '';
    const text = askGemini_(system, body.messages.slice(-20));
    return out_({ text: text, email: email });
  } catch (err) {
    return out_({ error: String(err && err.message || err) });
  }
}

function checkUser_(token) {
  if (!token) fail_('Cần đăng nhập Google để dùng AI.');
  const cache = CacheService.getScriptCache();
  const ck = 't' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)).slice(0, 40);
  let email = cache.get(ck);
  if (!email) {
    const ti = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
    if (ti.getResponseCode() !== 200) fail_('Phiên đăng nhập Google không hợp lệ hoặc đã hết hạn. Hãy đăng nhập lại.');
    const info = JSON.parse(ti.getContentText());
    if (info.azp !== CLIENT_ID && info.aud !== CLIENT_ID) fail_('Đăng nhập không đến từ app Bảng trắng.');
    const ab = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    if (ab.getResponseCode() !== 200) fail_('Không xác minh được tài khoản Google. Hãy đăng nhập lại.');
    email = ((JSON.parse(ab.getContentText()).user || {}).emailAddress || '').toLowerCase();
    if (!email) fail_('Không lấy được email.');
    cache.put(ck, email, Math.max(60, Math.min(600, (+info.expires_in || 300) - 30)));
  }
  const allow = prop_('ALLOWED_EMAILS').toLowerCase().split(/[\s,;]+/).filter(String);
  const ok = !allow.length || allow.some(function (a) { return a === email || (a.charAt(0) === '@' && email.slice(-a.length) === a); });
  if (!ok) fail_('Tài khoản ' + email + ' chưa được phép dùng AI. Hãy nhờ admin thêm email vào danh sách.');
  return email;
}

function askGemini_(system, messages) {
  const model = prop_('MODEL') || DEFAULT_MODEL;
  const maxT = Math.max(512, Math.min(+prop_('MAX_TOKENS') || 8192, 65536));
  const part = function (c) {
    return c && c.type === 'image' ? { inline_data: { mime_type: c.source.media_type, data: c.source.data } } : { text: String((c && c.text) || '') };
  };
  const contents = messages.map(function (m) {
    return { role: m.role === 'assistant' ? 'model' : 'user', parts: Array.isArray(m.content) ? m.content.map(part) : [{ text: String(m.content || '') }] };
  });
  const payload = { contents: contents, generationConfig: { maxOutputTokens: maxT } };
  if (system) payload.systemInstruction = { parts: [{ text: system }] };
  const r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': prop_('GEMINI_API_KEY') },
    payload: JSON.stringify(payload), muteHttpExceptions: true,
  });
  const code = r.getResponseCode();
  let res = {};
  try { res = JSON.parse(r.getContentText()); } catch (x) {}
  if (code !== 200) {
    const m = (res.error && res.error.message) || ('HTTP ' + code);
    fail_(/api key/i.test(m) ? 'Khóa Gemini sai hoặc đã bị xóa.'
      : code === 429 ? 'Gemini báo hết hạn mức (model ' + model + '). Chi tiết: ' + m.slice(0, 300)
      : code === 404 ? 'Không tìm thấy model "' + model + '". Sửa MODEL trong Script Properties.'
      : 'Gemini báo lỗi: ' + m);
  }
  if (res.promptFeedback && res.promptFeedback.blockReason) fail_('Gemini từ chối câu hỏi này (' + res.promptFeedback.blockReason + ').');
  const cand = (res.candidates || [])[0] || {};
  const text = ((cand.content || {}).parts || []).filter(function (p) { return p.text && !p.thought; }).map(function (p) { return p.text; }).join('').trim();
  if (!text) fail_(cand.finishReason === 'MAX_TOKENS' ? 'Câu trả lời quá dài, bị cắt hết. Tăng MAX_TOKENS hoặc hỏi ngắn hơn.' : 'Gemini không trả lời (' + (cand.finishReason || 'trống') + ').');
  return text + (cand.finishReason === 'MAX_TOKENS' ? '\n…(bị cắt do quá dài)' : '');
}
