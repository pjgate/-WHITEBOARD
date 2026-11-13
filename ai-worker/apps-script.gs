// Cổng AI cho Bảng trắng — chạy trên Google Apps Script (máy chủ Google, không bị Gemini chặn theo vùng).
// Giữ khóa Gemini ở phía máy chủ, chỉ cho người đã đăng nhập Google trên Bảng trắng (email trong danh sách) dùng AI.
//
// Cài đặt (Project Settings ⚙ → Script Properties):
//   GEMINI_API_KEY   (bắt buộc)  khóa lấy ở https://aistudio.google.com/apikey
//   ALLOWED_EMAILS   (nên có)    email được dùng AI, cách nhau bằng dấu phẩy. Có thể ghi cả tên miền, vd. @truongthang.vn
//   MODEL            (tùy chọn)  mặc định gemini-3.5-flash-lite
//   MAX_TOKENS       (tùy chọn)  mặc định 8192
//   GOOGLE_CLIENT_SECRET (tùy chọn) mã bí mật của OAuth Client ID -> bật "đăng nhập nhiều ngày" cho Bảng trắng
//                    (Google Cloud Console → APIs & Services → Credentials → OAuth client của Bảng trắng → Client secrets)
// Triển khai: Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone.

const CLIENT_ID = '815013146430-cjh67feg7j7k5asaq72qrkrn3i70048r.apps.googleusercontent.com';
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

function prop_(k) { return (PropertiesService.getScriptProperties().getProperty(k) || '').trim(); }
function out_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function fail_(msg) { throw new Error(msg); }

function doGet() {
  return out_({ ok: true, service: 'bang-trang-ai', provider: 'gemini', model: prop_('MODEL') || DEFAULT_MODEL, configured: !!prop_('GEMINI_API_KEY'), auth: !!prop_('GOOGLE_CLIENT_SECRET') });
}

function doPost(e) {
  try {
    let body;
    try { body = JSON.parse(e.postData.contents); } catch (x) { fail_('Dữ liệu gửi lên không hợp lệ.'); }
    // đăng nhập nhiều ngày: đổi mã đăng nhập lấy refresh token, và dùng refresh token lấy vé mới
    if (body.action === 'auth_ping') return out_({ auth: !!prop_('GOOGLE_CLIENT_SECRET') });
    if (body.action === 'visit') return out_(visit_(body));
    if (body.action === 'auth_code') return out_(authCode_(body));
    if (body.action === 'auth_refresh') return out_(authRefresh_(body));
    if (!prop_('GEMINI_API_KEY')) fail_('Cổng AI chưa có GEMINI_API_KEY (Script Properties).');
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

// ================== Đăng nhập nhiều ngày ==================
// App gửi mã đăng nhập (code) lên đây; script dùng mã bí mật (chỉ nằm ở Script Properties) để đổi lấy
// access token (~1 giờ) + refresh token. App giữ refresh token và nhờ script đổi lấy vé mới khi hết hạn, không cần bật cửa sổ Google.
function tokenCall_(params) {
  const secret = prop_('GOOGLE_CLIENT_SECRET');
  if (!secret) fail_('Cổng chưa có GOOGLE_CLIENT_SECRET (Script Properties).');
  params.client_id = CLIENT_ID; params.client_secret = secret;
  const r = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', { method: 'post', payload: params, muteHttpExceptions: true });
  let j = {};
  try { j = JSON.parse(r.getContentText()); } catch (x) {}
  if (r.getResponseCode() !== 200) {
    if (j.error === 'invalid_grant') return { error: 'Phiên đăng nhập dài hạn đã hết hạn hoặc bị thu hồi, hãy đăng nhập lại.', relogin: true };
    if (j.error === 'invalid_client') fail_('GOOGLE_CLIENT_SECRET sai (không khớp với Client ID).');
    fail_('Google báo lỗi đăng nhập: ' + (j.error_description || j.error || ('HTTP ' + r.getResponseCode())));
  }
  return j;
}
function authCode_(b) {
  if (!b.code) fail_('Thiếu mã đăng nhập.');
  let j;
  try { j = tokenCall_({ code: String(b.code), grant_type: 'authorization_code', redirect_uri: 'postmessage' }); }
  catch (x) { logLogin_('', false, String(x && x.message || x)); throw x; }
  if (j.error) { logLogin_('', false, j.error); return j; }
  const email = emailOf_(j.access_token);
  logLogin_(email, !!email, email ? 'Đăng nhập' : 'Không lấy được email từ Drive');
  return { access_token: j.access_token, expires_in: j.expires_in, refresh_token: j.refresh_token || '' };
}

// ================== Lịch sử đăng nhập ==================
// Mỗi lần người dùng đăng nhập Google qua cổng (auth_code) thì ghi một dòng vào Google Sheet:
// thời gian (giờ VN), email, kết quả, chi tiết. Không ghi các lần gia hạn tự động (auth_refresh).
// ID của Sheet để trong Script Property LOGIN_SHEET_ID. Script chạy bằng tài khoản Me, nên Sheet phải thuộc tài khoản đó.
// Ghi "Mở app" khi người đã đăng nhập tải bảng. Cùng một người chỉ được ghi một lần mỗi giờ (CacheService).
function visit_(b) {
  const email = checkUser_(b.token);
  const cache = CacheService.getScriptCache();
  if (!cache.get('visit:' + email)) {
    cache.put('visit:' + email, '1', 3600);
    logLogin_(email, true, 'Mở app');
  }
  return { ok: true };
}
function emailOf_(token) {
  const ab = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (ab.getResponseCode() !== 200) return '';
  return ((JSON.parse(ab.getContentText()).user || {}).emailAddress || '').toLowerCase();
}
function logLogin_(email, ok, detail) {
  try { // lỗi ghi log không được làm hỏng đăng nhập
    const id = prop_('LOGIN_SHEET_ID');
    if (!id) return;
    const sh = SpreadsheetApp.openById(id).getSheets()[0];
    if (sh.getLastRow() === 0) sh.appendRow(['Thời gian', 'Email', 'Kết quả', 'Chi tiết']);
    sh.appendRow([Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd HH:mm:ss'), email || '', ok ? 'Thành công' : 'Lỗi', detail || '']);
  } catch (x) {}
}
// Chạy hàm này một lần trong trình soạn thảo để Google hỏi quyền truy cập Sheet (sau khi triển khai phiên bản mới).
function thuLichSu() { // không bọc try: lỗi (thiếu ID, thiếu quyền) sẽ hiện ra trong trình soạn thảo
  const sh = SpreadsheetApp.openById(prop_('LOGIN_SHEET_ID')).getSheets()[0];
  if (sh.getLastRow() === 0) sh.appendRow(['Thời gian', 'Email', 'Kết quả', 'Chi tiết']);
  sh.appendRow([new Date(), '', 'Kiểm tra', 'thuLichSu']);
}
function authRefresh_(b) {
  if (!b.refresh_token) fail_('Thiếu refresh token.');
  const j = tokenCall_({ refresh_token: String(b.refresh_token), grant_type: 'refresh_token' });
  if (j.error) return j;
  return { access_token: j.access_token, expires_in: j.expires_in };
}
