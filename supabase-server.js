import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createExcelReport, reportFilters } from './reports.js';
import { calendarDate } from './public/dates.js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const unitNames = ['Bahçe', 'Küçükpark', 'Evka3', 'İmalat'];
const roles = ['admin', 'manager', 'operator'];
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/catalog.js': ['catalog.js', 'text/javascript; charset=utf-8'],
  '/workflow.js': ['workflow.js', 'text/javascript; charset=utf-8'],
  '/dates.js': ['dates.js', 'text/javascript; charset=utf-8'],
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
  workflowEnabled = process.env.ORDER_WORKFLOW_ENABLED === '1',
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
      if (data?.code === 'PT409' || data?.code === '40001') throw error(message, 409);
      if (data?.code === 'PGRST202' && workflowEnabled) throw error('Sipariş ve imalat güncellemesi henüz kurulmamış. Yöneticinize başvurun.', 503);
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
  async function ordersFor(token) {
        const rows = await all(`/rest/v1/orders?select=*,items:order_items(*),events:order_events(*)${workflowEnabled?',images:order_images(id,item_id,mime,created_at,removed_at)':''}&order=id.desc`, token);
        return rows.map(o => ({ ...o, delivery: String(o.delivery).slice(0,10), unit: unitNames[o.unit_id - 1], creator: o.creator_name,
          completed_at: (o.events || []).filter(e => e.status === 'ready' && e.kind !== 'reviewed' && ['status',undefined].includes(e.kind)).sort((a,b)=>a.id-b.id).at(-1)?.created_at || null,
          items: (o.items || []).map(i => ({ ...i, quantity: Number(i.quantity), cancelled_quantity: Number(i.cancelled_quantity || 0) })).sort((a, b) => a.id - b.id),
          events: (o.events || []).map(e => ({ ...e, actor: e.actor_name })).sort((a, b) => a.id - b.id),
        }));
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
      const requestURL = new URL(req.url, 'http://localhost');
      const path = requestURL.pathname;
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
          if (Buffer.byteLength(JSON.stringify(body)) > (workflowEnabled && /\/orders\/\d+\/image$/.test(path) ? 1500000 : 100000)) throw error('İstek çok büyük.', 413);
        } else {
          let raw = '';
          req.setEncoding?.('utf8');
          for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > (workflowEnabled && /\/orders\/\d+\/image$/.test(path) ? 1500000 : 100000)) throw error('İstek çok büyük.', 413); }
          try { body = JSON.parse(raw || '{}'); } catch { throw error('Geçersiz JSON.'); }
        }
        if (!body || Array.isArray(body) || typeof body !== 'object') throw error('Geçersiz istek.');
      }
      if (path === '/api/config' && req.method === 'GET') return send({ backend: 'supabase', userProvisioning: Boolean(serviceKey), workflowEnabled });
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
      if (path === '/api/reports/export' && req.method === 'GET') {
        const filter = reportFilters(requestURL.searchParams);
        const branchUnits = ['admin','manager'].includes(user.role) || user.unit === 'İmalat' ? unitNames.slice(0,3) : [user.unit];
        const output = await createExcelReport(await ordersFor(token), filter, { userName: user.name, branchUnits });
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="topraktan-rapor-${calendarDate(new Date())}.xlsx"`,
          'Cache-Control': 'no-store',
        });
        res.end(output);
        return;
      }

      if (path === '/api/products' && req.method === 'GET') return send(await all('/rest/v1/products?select=*&order=id.asc', token));
      if (path === '/api/products' && req.method === 'POST') {
        if (!['admin', 'manager'].includes(user.role)) throw error('Ürün düzenleme yetkiniz yok.', 403);
        await remote('/rest/v1/rpc/save_product_v2', { token, body: { p_name: body.name, p_measure: body.measure, p_category: body.category || null, p_subcategory: body.subcategory || null, p_id: body.id || null, p_active: body.active !== false } });
        return send({ ok: true });
      }
      if (path === '/api/orders' && req.method === 'GET') return send(await ordersFor(token));
      if (path === '/api/orders' && req.method === 'POST') {
        if (workflowEnabled && (user.role === 'manager' || user.unit === 'İmalat')) throw error('Sipariş oluşturma yetkiniz yok.', 403);
        const id = await remote('/rest/v1/rpc/' + (workflowEnabled ? 'create_order_v3' : 'create_order_v2'), { token, body: {
          p_unit_id: ['admin', 'manager'].includes(user.role) ? unitNames.indexOf(body.unit) + 1 : user.unit_id,
          p_delivery: body.delivery, p_items: body.items, p_note: body.note || '',
        } });
        return send({ id }, 201);
      }
      const statusMatch = path.match(/^\/api\/orders\/(\d+)\/status$/);
      if (statusMatch && req.method === 'POST') {
        if (workflowEnabled && ['approved','rejected'].includes(body.status) && user.role !== 'admin') throw error('Onay yetkiniz yok.', 403);
        if (workflowEnabled && ['preparing','ready','delivered'].includes(body.status) && !['admin','manager'].includes(user.role) && user.unit !== 'İmalat') throw error('Üretim yetkiniz yok.', 403);
        await remote('/rest/v1/rpc/change_order_status', { token, body: { p_order_id: Number(statusMatch[1]), p_status: body.status, p_note: body.note || '' } });
        return send({ ok: true });
      }
      if (workflowEnabled) {
        const mutation = path.match(/^\/api\/orders\/(\d+)\/(edit|cancel|image|production-message)$/);
        if (mutation && req.method === 'POST') {
          const id = Number(mutation[1]), action = mutation[2];
          const visible = (await ordersFor(token)).find(o => o.id === id);
          if (!visible) throw error('Sipariş bulunamadı.', 404);
          if (action === 'production-message') {
            if (!['admin','manager'].includes(user.role) && user.unit !== 'İmalat') throw error('İmalat notu yetkiniz yok.', 403);
            await remote('/rest/v1/rpc/production_message', {token, body:{p_order_id:id,p_note:body.note,p_issue:body.issue === true}});
          } else {
            if (user.role !== 'admin' && !(user.role === 'operator' && user.unit !== 'İmalat' && user.unit_id === visible.unit_id && visible.status === 'pending')) throw error('Sipariş düzenleme yetkiniz yok.', 403);
            const common = {p_order_id:id,p_revision:body.revision,p_reason:body.reason};
            if (action === 'edit') await remote('/rest/v1/rpc/edit_order', {token,body:{...common,p_delivery:body.delivery,p_note:body.note||'',p_items:body.items}});
            if (action === 'cancel') await remote('/rest/v1/rpc/cancel_order_items', {token,body:{...common,p_items:body.items ?? null}});
            if (action === 'image') await remote('/rest/v1/rpc/set_order_image', {token,body:{...common,p_item_id:body.item_id,p_mime:body.mime||null,p_content:body.content??null}});
          }
          return send({ok:true});
        }
        const image = path.match(/^\/api\/images\/(\d+)$/);
        if (image && req.method === 'GET') {
          const imageData = await remote('/rest/v1/rpc/get_order_image', {token,body:{p_id:Number(image[1])}});
          if (!['image/png','image/jpeg','image/webp'].includes(imageData?.mime)) throw error('Görsel okunamadı.',502);
          res.writeHead(200,{'Content-Type':imageData.mime,'Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'none'; sandbox"});
          res.end(Buffer.from(imageData.content,'base64'));return;
        }
        if (path === '/api/notifications' && req.method === 'GET') {
          if (user.role !== 'manager') throw error('Bildirim yetkiniz yok.',403);
          const [notifications,reads,visible] = await Promise.all([
            all('/rest/v1/production_notifications?select=*&order=id.desc',token),
            all('/rest/v1/notification_reads?select=*',token),ordersFor(token),
          ]);
          return send(notifications.map(n => {
            const o = visible.find(o => o.id === n.order_id);
            return {...n,read:reads.some(r => r.notification_id === n.id),unit:o?.unit,event:o?.events.find(e => e.id === n.event_id),reviewer:o?.events.find(e => e.kind === 'reviewed' && e.note.endsWith('Bildirim #' + n.id))?.actor};
          }));
        }
        const notification = path.match(/^\/api\/notifications\/(\d+)$/);
        if (notification && req.method === 'POST') {
          if (user.role !== 'manager') throw error('Bildirim yetkiniz yok.',403);
          await remote('/rest/v1/rpc/read_production_notification', {token,body:{p_id:Number(notification[1]),p_review:body.review === true}});
          return send({ok:true});
        }
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
