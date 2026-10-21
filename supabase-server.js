import http from 'node:http';
import { readFileSync } from 'node:fs';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const unitNames = ['Bahçe', 'Küçükpark', 'Evka3', 'İmalat'];
const roles = ['admin', 'manager', 'operator'];
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/catalog.js': ['catalog.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/logo.png': ['logo.png', 'image/png'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
};
function parseCookies(header = '') {
  const result = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0) {
      try { result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1)); }
      catch { /* Malformed cookies do not authenticate a request. */ }
    }
  }
  return result;
}
function publicProfile(profile, email = '') {
  return { ...profile, username: profile.username || '', email, unit: unitNames[profile.unit_id - 1] || null };
}
function validateUser(body) {
  if (typeof body.username !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(body.username)) {
    throw error('Kullanıcı adı 3–32 karakter olmalı; a-z, 0-9, nokta, tire ve alt çizgi kullanılabilir.');
  }
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120 ||
      !roles.includes(body.role) || typeof body.active !== 'boolean' ||
      body.role === 'operator' && !unitNames.includes(body.unit)) {
    throw error('Ad, rol, birim ve aktiflik bilgilerini kontrol edin.');
  }
  if (body.password && (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128)) {
    throw error('Şifre 12–128 karakter olmalı.');
  }
  if (!body.id && (!body.password || typeof body.email !== 'string' ||
      body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))) {
    throw error('Yeni kullanıcı için e-posta ve en az 12 karakterli şifre gerekli.');
  }
  if (body.id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id)) {
    throw error('Geçersiz kullanıcı kimliği.');
  }
}
export function createApp({
  url = SUPABASE_URL,
  publishableKey = SUPABASE_PUBLISHABLE_KEY,
  serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  fetchImpl = fetch,
  secureCookies = process.env.COOKIE_SECURE === '1' || process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL),
} = {}) {
  const base = url.replace(/\/$/, '');
  if (new URL(base).protocol !== 'https:') throw error('Supabase bağlantısı HTTPS kullanmalı.');
  const attempts = new Map();
  async function remote(path, { token, body, method = body === undefined ? 'GET' : 'POST', privileged = false } = {}) {
    if (privileged && !serviceKey) throw error('Kullanıcı adıyla giriş ve hesap yönetimi için sunucu ayarlarında SUPABASE_SERVICE_ROLE_KEY tanımlanmalı.', 503);
    let response;
    try {
      response = await fetchImpl(base + path, {
        method,
        headers: {
          apikey: privileged ? serviceKey : publishableKey,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(privileged ? { Authorization: `Bearer ${serviceKey}` } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw error('Supabase bağlantısı kurulamadı. Ağ erişimini kontrol edin.', 502);
    }
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; }
    catch { throw error('Supabase beklenmeyen bir yanıt verdi.', 502); }
    if (!response.ok) {
      const message = data?.message || data?.msg || data?.error_description || 'İşlem tamamlanamadı.';
      if (privileged && [401, 403].includes(response.status)) throw error('Sunucunun kullanıcı hesabı bağlantısı doğrulanamadı. Yönetici sunucu ayarlarını kontrol etmeli.', 503);
      if (data?.code === '42501' || response.status === 403) throw error('Bu işlem için yetkiniz yok.', 403);
      if (response.status === 401) throw error('Oturum sona erdi. Yeniden giriş yapın.', 401);
      if (data?.error_code === 'invalid_credentials' || /invalid login credentials/i.test(message)) throw error('Kullanıcı adı veya şifre hatalı.', 401);
      if (/email not confirmed/i.test(message)) throw error('E-posta adresi henüz doğrulanmamış.', 401);
      if (response.status === 429) throw error('Çok fazla deneme yapıldı. Lütfen daha sonra tekrar deneyin.', 429);
      if (data?.code === 'PGRST202' && (path.includes('resolve_login_username') || path.includes('admin_set_profile_v2'))) throw error('Kullanıcı adı güncellemesi eksik. Supabase kullanıcı adı SQL güncellemesini çalıştırın.', 503);
      if (data?.code === '42703') throw error('Veritabanı güncellemesi eksik. Supabase SQL güncellemelerini kontrol edin.', 503);
      if (data?.code === 'PGRST202') throw error('Supabase kategori güncellemesi eksik. Kategori güncelleme SQL dosyasını çalıştırın.', 503);
      if (data?.code === '23505') throw error('Bu kayıt zaten mevcut.');
      if (data?.code?.startsWith('23')) throw error('Kayıt bilgileri geçersiz. Ürün, birim ve miktarı kontrol edin.');
      throw error(message, response.status >= 500 ? 502 : 400);
    }
    return data;
  }
  async function all(path, token) {
    const rows = [];
    // Do not silently truncate history/reports at the PostgREST row limit.
    for (let offset = 0; offset < 100000;) {
      const batch = await remote(`${path}${path.includes('?') ? '&' : '?'}limit=500&offset=${offset}`, { token });
      if (!Array.isArray(batch)) throw error('Veritabanı liste yanıtı geçersiz.', 502);
      if (!batch.length) return rows;
      rows.push(...batch);
      offset += batch.length;
    }
    throw error('Kayıt sayısı tek rapor sınırını aştı. Sunucuda sayfalama gereklidir.', 413);
  }
  function cookies(res, session) {
    const suffix = `; HttpOnly; SameSite=Strict; Path=/${secureCookies ? '; Secure' : ''}`;
    const accessAge = session ? Math.min(Number(session.expires_in) || 3600, 43200) : 0;
    res.setHeader('Set-Cookie', [
      `sb_access=${encodeURIComponent(session?.access_token || '')}; Max-Age=${accessAge}${suffix}`,
      `sb_refresh=${encodeURIComponent(session?.refresh_token || '')}; Max-Age=${session ? 43200 : 0}${suffix}`,
    ]);
  }
  async function profileFor(token) {
    const authUser = await remote('/auth/v1/user', { token });
    if (!authUser?.id) throw error('Oturum doğrulanamadı.', 401);
    const rows = await remote(`/rest/v1/profiles?select=*&id=eq.${encodeURIComponent(authUser.id)}`, { token });
    const profile = rows?.[0];
    if (!profile?.active) throw error('Hesabınız pasif veya birime atanmadı. Yöneticinizle iletişime geçin.', 403);
    return publicProfile(profile, authUser.email);
  }
  async function authenticate(req, res) {
    const stored = parseCookies(req.headers.cookie);
    let token = stored.sb_access;
    if (token) {
      try { return { token, user: await profileFor(token) }; }
      catch (e) { if (e.status !== 401) throw e; }
    }
    if (!stored.sb_refresh) throw error('Oturum açmanız gerekiyor.', 401);
    let session;
    try {
      session = await remote('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: stored.sb_refresh } });
    } catch (e) {
      if (e.status === 400 || e.status === 401) { cookies(res, null); throw error('Oturum sona erdi. Yeniden giriş yapın.', 401); }
      throw e;
    }
    const user = await profileFor(session.access_token);
    cookies(res, session);
    return { token: session.access_token, user };
  }
  async function handler(req, res) {
    const send = (data, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (!path.startsWith('/api/')) {
        const file = files[path];
        if (!file || !['GET', 'HEAD'].includes(req.method)) return send({ error: 'Bulunamadı.' }, 404);
        res.setHeader('Content-Type', file[1]);
        res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
        res.end(req.method === 'HEAD' ? undefined : readFileSync(new URL(`./public/${file[0]}`, import.meta.url)));
        return;
      }
      if (!['GET', 'POST'].includes(req.method)) return send({ error: 'Yöntem desteklenmiyor.' }, 405);
      let body = {};
      if (req.method === 'POST') {
        const origin = req.headers.origin;
        if (origin && ![`https://${req.headers.host}`, `http://${req.headers.host}`].includes(origin)) throw error('Geçersiz istek kaynağı.', 403);
        if (req.body !== undefined) {
          // Vercel may supply an already parsed body instead of an unread stream.
          try { body = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? JSON.parse(String(req.body)) : req.body; }
          catch { throw error('Geçersiz JSON.'); }
          if (JSON.stringify(body).length > 100000) throw error('İstek çok büyük.', 413);
        } else {
          let raw = '';
          for await (const chunk of req) { raw += chunk; if (raw.length > 100000) throw error('İstek çok büyük.', 413); }
          try { body = JSON.parse(raw || '{}'); } catch { throw error('Geçersiz JSON.'); }
        }
        if (!body || Array.isArray(body) || typeof body !== 'object') throw error('Geçersiz istek.');
      }
      if (path === '/api/config' && req.method === 'GET') return send({ backend: 'supabase', userProvisioning: Boolean(serviceKey) });
      if (path === '/api/login' && req.method === 'POST') {
        const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
        if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username) || typeof body.password !== 'string' || !body.password || body.password.length > 128) throw error('Kullanıcı adı veya şifre hatalı.', 401);
        const now = Date.now();
        for (const [key, entry] of attempts) if (now - entry.time > 600000) attempts.delete(key);
        // Username-based limit is shared by requests to this process; Supabase also applies Auth rate limits.
        const key = username;
        const attempt = attempts.get(key) || { count: 0, time: now };
        if (attempt.count >= 20) throw error('Çok fazla deneme. 10 dakika sonra tekrar deneyin.', 429);
        let session;
        try {
          const email = await remote('/rest/v1/rpc/resolve_login_username', { privileged: true, body: { p_username: username } });
          if (typeof email !== 'string' || !email) throw error('Kullanıcı adı veya şifre hatalı.', 401);
          session = await remote('/auth/v1/token?grant_type=password', { body: { email, password: body.password } });
        } catch (e) {
          if (e.status === 401 || e.status === 400) {
            attempt.count++; if (attempts.size < 10000 || attempts.has(key)) attempts.set(key, attempt);
            throw error('Kullanıcı adı veya şifre hatalı.', 401);
          }
          throw e;
        }
        const user = await profileFor(session.access_token);
        attempts.delete(key);
        cookies(res, session);
        return send(user);
      }
      if (path === '/api/logout' && req.method === 'POST') {
        const stored = parseCookies(req.headers.cookie);
        if (stored.sb_access) {
          try { await remote('/auth/v1/logout?scope=local', { token: stored.sb_access, method: 'POST' }); }
          catch (e) { if (e.status !== 401) throw e; }
        }
        cookies(res, null);
        return send({ ok: true });
      }
      const { token, user } = await authenticate(req, res);
      if (path === '/api/me' && req.method === 'GET') return send(user);
      if (path === '/api/products' && req.method === 'GET') return send(await all('/rest/v1/products?select=*&order=id.asc', token));
      if (path === '/api/products' && req.method === 'POST') {
        if (!['admin', 'manager'].includes(user.role)) throw error('Ürün düzenleme yetkiniz yok.', 403);
        await remote('/rest/v1/rpc/save_product_v2', { token, body: { p_name: body.name, p_measure: body.measure, p_category: body.category || null, p_subcategory: body.subcategory || null, p_id: body.id || null, p_active: body.active !== false } });
        return send({ ok: true });
      }
      if (path === '/api/orders' && req.method === 'GET') {
        const rows = await all('/rest/v1/orders?select=*,items:order_items(*),events:order_events(*)&order=id.desc', token);
        return send(rows.map(o => ({ ...o, unit: unitNames[o.unit_id - 1], creator: o.creator_name,
          items: (o.items || []).map(i => ({ ...i, quantity: Number(i.quantity) })).sort((a, b) => a.id - b.id),
          events: (o.events || []).map(e => ({ ...e, actor: e.actor_name })).sort((a, b) => a.id - b.id),
        })));
      }
      if (path === '/api/orders' && req.method === 'POST') {
        const id = await remote('/rest/v1/rpc/create_order_v2', { token, body: {
          p_unit_id: ['admin', 'manager'].includes(user.role) ? unitNames.indexOf(body.unit) + 1 : user.unit_id,
          p_delivery: body.delivery, p_items: body.items, p_note: body.note || '',
        } });
        return send({ id }, 201);
      }
      const statusMatch = path.match(/^\/api\/orders\/(\d+)\/status$/);
      if (statusMatch && req.method === 'POST') {
        await remote('/rest/v1/rpc/change_order_status', { token, body: { p_order_id: Number(statusMatch[1]), p_status: body.status, p_note: body.note || '' } });
        return send({ ok: true });
      }
      if (path === '/api/users') {
        if (user.role !== 'admin') throw error('Kullanıcı yönetimi yetkiniz yok.', 403);
        if (req.method === 'GET') {
          const profiles = await all('/rest/v1/profiles?select=*&order=id.asc', token);
          return send(profiles.map(p => publicProfile(p, p.id === user.id ? user.email : '')));
        }
        body.username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
        validateUser(body);
        if (body.id === user.id && (body.role !== 'admin' || !body.active)) throw error('Kendi yönetici yetkinizi kaldıramazsınız.');
        if ((!body.id || body.password) && !serviceKey) throw error('Kullanıcı adıyla giriş ve hesap yönetimi için sunucu ayarlarında SUPABASE_SERVICE_ROLE_KEY tanımlanmalı.', 503);
        const matches = await remote(`/rest/v1/profiles?select=id&username=eq.${encodeURIComponent(body.username)}`, { token });
        if (matches.some(p => p.id !== body.id)) throw error('Bu kullanıcı adı zaten kullanılıyor.', 409);
        let id = body.id;
        if (!id) {
          const authUser = await remote('/auth/v1/admin/users', { privileged: true, body: { email: body.email.trim(), password: body.password, email_confirm: true, user_metadata: { name: body.name.trim() } } });
          id = authUser.id || authUser.user?.id;
          if (!id) throw error('Kullanıcı oluşturma yanıtı geçersiz.', 502);
        }
        try {
          await remote('/rest/v1/rpc/admin_set_profile_v2', { token, body: { p_user_id: id, p_name: body.name, p_username: body.username, p_role: body.role, p_unit_id: body.role === 'operator' ? unitNames.indexOf(body.unit) + 1 : null, p_active: body.active } });
        } catch (e) {
          if (!body.id) throw error('Giriş hesabı oluşturuldu, fakat rol atanamadı. Kullanıcı listesini yenileyip hesabın yetkilerini düzenleyin. Hesap başlangıçta pasiftir.', 409);
          throw e;
        }
        if (body.id && body.password) {
          try { await remote(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { privileged: true, method: 'PUT', body: { password: body.password } }); }
          catch { throw error('Kullanıcı yetkileri kaydedildi, fakat şifre yenilenemedi. Şifre işlemini tekrar deneyin.', 409); }
        }
        return send({ ok: true, id });
      }
      return send({ error: 'Bulunamadı.' }, 404);
    } catch (e) {
      if (e.status === 401) cookies(res, null);
      if (!e.status) console.error('Topraktan isteği işlenemedi:', e.name);
      return send({ error: e.status ? e.message : 'İşlem tamamlanamadı.' }, e.status || 500);
    }
  }
  return { handler, server: http.createServer(handler) };
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const { server } = createApp();
  server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('Topraktan · Supabase bağlantılı sunucu hazır. Port: ' + (process.env.PORT || 3000)));
}
