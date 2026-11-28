"use strict";
// بوت الإدارة — منفصل عن بوت المركز: تنبيهات المؤسسات، موافقات كلمات السر، أسئلة سريعة، تنبيهات ذكية، دخول بالباركود
const SB = Deno.env.get("SUPABASE_URL") || "";
const SK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const AK = Deno.env.get("SUPABASE_ANON_KEY") || SK;
const DOMAIN = "orgs.medtech.local";
const BASE = "https://fak123123fa-lang.github.io/burns-center-devices/";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const AH = { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json" };
const H = (x) => String(x ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const LINE = "━━━━━━━━━━━━━━━━";
async function rest(path, opt = {}) {
    const r = await fetch(SB + "/rest/v1/" + path, { method: opt.method || "GET", headers: { ...AH, Prefer: opt.prefer || "return=representation" }, body: opt.body !== undefined ? JSON.stringify(opt.body) : undefined });
    const t = await r.text();
    let j = null;
    try {
        j = t ? JSON.parse(t) : null;
    }
    catch (_) {
        j = t;
    }
    if (!r.ok)
        throw new Error("db " + r.status + " " + t.slice(0, 160));
    return j;
}
const srpc = (fn, args) => rest("rpc/" + fn, { method: "POST", body: args || {} });
async function crpc(auth, fn, args) { const r = await fetch(SB + "/rest/v1/rpc/" + fn, { method: "POST", headers: { apikey: AK, Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(args || {}) }); return r.ok ? await r.json() : null; }
async function userOf(auth) { if (!auth.startsWith("Bearer "))
    return null; const r = await fetch(SB + "/auth/v1/user", { headers: { apikey: SK, Authorization: auth } }); return r.ok ? await r.json() : null; }
const rnd = (set, n) => { const a = new Uint32Array(n); crypto.getRandomValues(a); return [...a].map((x) => set[x % set.length]).join(""); };
const genPw = () => rnd("ABCDEFGHJKLMNPQRSTUVWXYZ", 1) + rnd("abcdefghjkmnpqrstuvwxyz", 3) + "-" + rnd("23456789", 2) + rnd("abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ", 2);
const bagh = (t = Date.now()) => { const x = new Date(t + 3 * 3600e3).toISOString(); return { date: x.slice(0, 10), time: x.slice(11, 16), hour: +x.slice(11, 13) }; };
const pct = (s) => { const n = +s.devices || 0; return n ? Math.round((n - (+s.broken || 0) - (+s.maint || 0)) * 100 / n) : null; };
let CFG = null;
async function cfg() { if (CFG)
    return CFG; const c = await rest("mgmt_tg_config?id=eq.1&select=bot_token,bot_username,secret"); CFG = (c && c[0]) || {}; return CFG; }
async function tg(method, body) { const c = await cfg(); if (!c.bot_token)
    return null; const r = await fetch(`https://api.telegram.org/bot${c.bot_token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return r.json().catch(() => null); }
const KB = { keyboard: [[{ text: "📊 الحالة" }, { text: "⚠️ الأسوأ" }], [{ text: "🚨 البلاغات" }, { text: "❓ مساعدة" }]], resize_keyboard: true };
async function send(chat, text, extra = {}) { return tg("sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra }); }
async function sendMany(chats, text, extra = {}) { for (const c of [...new Set(chats)]) {
    try {
        await send(c, text, extra);
    }
    catch (_) { /* */ }
} }
/* ---------- صلاحيات ---------- */
async function isAdminUid(uid) { const r = await rest(`org_admins?user_id=eq.${uid}&select=user_id`); return !!(r && r.length); }
async function dashUser(auth) { const u = await userOf(auth); if (!u)
    return null; const lvl = await crpc(auth, "dash_me", {}); if (!lvl || !lvl.level)
    return null; return { u, lvl }; }
/* ---------- كلمات السر عبر الموافقة ---------- */
async function contextOf(email) {
    const o = await rest(`org_members?email=eq.${encodeURIComponent(email)}&select=user_id,org_id,role,orgs(name)`);
    if (o && o[0])
        return { uid: o[0].user_id, ctx: `${o[0].orgs?.name || "مؤسسة"} (${o[0].role === "owner" ? "مالك" : "مشاهد"})`, rec: async () => ((await srpc("org_recipients", { p_org: o[0].org_id })) || []).map((x) => +(x.org_recipients ?? x)) };
    const u = await rest(`unit_members?email=eq.${encodeURIComponent(email)}&select=user_id,unit_id,role,org_units(name,parent_id)`);
    if (u && u[0])
        return { uid: u[0].user_id, ctx: `${u[0].org_units?.name || "دائرة"} (${u[0].role === "manager" ? "مدير" : "مشاهد"})`, rec: async () => {
                const par = u[0].org_units?.parent_id;
                const ids = new Set((await rest("org_admins?select=user_id")).map((x) => x.user_id));
                if (par) {
                    const ch = await srpc("unit_chain", { p_unit: par });
                    const chain = (ch || []).map((x) => x.unit_chain ?? x);
                    if (chain.length)
                        (await rest(`unit_members?role=eq.manager&unit_id=in.(${chain.join(",")})&select=user_id`)).forEach((x) => ids.add(x.user_id));
                }
                ids.delete(u[0].user_id);
                if (!ids.size)
                    return [];
                return (await rest(`mgmt_tg_users?user_id=in.(${[...ids].join(",")})&select=chat_id`)).map((x) => +x.chat_id);
            } };
    const a = await rest(`org_admins?email=eq.${encodeURIComponent(email)}&select=user_id`);
    if (a && a[0])
        return { uid: a[0].user_id, ctx: "حساب وزاري", rec: async () => { const ad = (await rest("org_admins?select=user_id")).map((x) => x.user_id).filter((x) => x !== a[0].user_id); if (!ad.length)
                return []; return (await rest(`mgmt_tg_users?user_id=in.(${ad.join(",")})&select=chat_id`)).map((x) => +x.chat_id); } };
    return null;
}
const HITS = new Map();
async function pwRequest(req, b) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "x";
    const now = Date.now(), h = (HITS.get(ip) || []).filter((t) => now - t < 600000);
    if (h.length >= 5)
        return J({ error: "too_many" }, 429);
    h.push(now);
    HITS.set(ip, h);
    let un = String(b.username || "").trim().toLowerCase();
    if (!un)
        return J({ error: "missing" }, 400);
    const email = un.includes("@") ? un : un + "@" + DOMAIN;
    if (!email.endsWith("@" + DOMAIN))
        return J({ error: "not_org_account" }, 400);
    const c = await contextOf(email);
    if (!c)
        return J({ error: "not_found" }, 404);
    const chats = await c.rec();
    if (!chats.length)
        return J({ error: "no_approver" }, 409);
    const token = rnd("abcdefghijkmnpqrstuvwxyz23456789", 24);
    const r = await rest("pw_requests", { method: "POST", body: { user_id: c.uid, username: un.split("@")[0], ctx: c.ctx, client_token: token } });
    const id = r[0].id, T = bagh();
    await sendMany(chats, `${LINE}\n🔑 <b>طلب كلمة سر جديدة</b>\n👤 ${H(un.split("@")[0])}\n🏥 ${H(c.ctx)}\n🕐 ${T.date} — ${T.time}\n${LINE}\nإذا كان الطلب من صاحب الحساب فعلًا اضغط موافقة، فتظهر له كلمة مؤقتة على شاشته.`, { reply_markup: { inline_keyboard: [[{ text: "✅ موافقة", callback_data: "pw:a:" + id }, { text: "❌ رفض", callback_data: "pw:r:" + id }]] } });
    return J({ ok: true, id, token });
}
async function pwStatus(b) {
    const r = await rest(`pw_requests?id=eq.${+b.id || 0}&client_token=eq.${encodeURIComponent(String(b.token || ""))}&select=id,status,temp_pw,created_at,username`);
    const x = r && r[0];
    if (!x)
        return J({ error: "not_found" }, 404);
    if (x.status === "pending" && Date.now() - new Date(x.created_at).getTime() > 30 * 60e3) {
        await rest(`pw_requests?id=eq.${x.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "expired" } });
        return J({ status: "expired" });
    }
    if (x.status === "approved" && x.temp_pw) {
        await rest(`pw_requests?id=eq.${x.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "delivered", temp_pw: null } });
        return J({ status: "approved", password: x.temp_pw, username: x.username });
    }
    return J({ status: x.status });
}
async function pwDecide(chat, cbId, msgId, ok, id) {
    const r = await rest(`pw_requests?id=eq.${id}&select=*`);
    const x = r && r[0];
    if (!x || x.status !== "pending") {
        await tg("answerCallbackQuery", { callback_query_id: cbId, text: "هذا الطلب لم يعد قائمًا" });
        return;
    }
    const em = x.username + "@" + DOMAIN, c = await contextOf(em);
    const chats = c ? await c.rec() : [];
    if (!chats.includes(chat)) {
        await tg("answerCallbackQuery", { callback_query_id: cbId, text: "لا تملك صلاحية على هذا الحساب" });
        return;
    }
    const who = (await rest(`mgmt_tg_users?chat_id=eq.${chat}&select=name`))[0]?.name || "";
    if (!ok) {
        await rest(`pw_requests?id=eq.${id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "rejected", decided_at: new Date().toISOString(), decided_by: who } });
        await tg("editMessageText", { chat_id: chat, message_id: msgId, text: `❌ رُفض طلب كلمة السر لـ ${x.username} (${x.ctx})`, parse_mode: "HTML" });
        await tg("answerCallbackQuery", { callback_query_id: cbId, text: "رُفض الطلب" });
        return;
    }
    const pw = genPw();
    const u = await fetch(SB + "/auth/v1/admin/users/" + x.user_id, { method: "PUT", headers: AH, body: JSON.stringify({ password: pw, user_metadata: { must_change: true } }) });
    if (!u.ok) {
        await tg("answerCallbackQuery", { callback_query_id: cbId, text: "تعذّر تغيير كلمة السر" });
        return;
    }
    await rest(`pw_requests?id=eq.${id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "approved", temp_pw: pw, decided_at: new Date().toISOString(), decided_by: who } });
    await tg("editMessageText", { chat_id: chat, message_id: msgId, text: `✅ وافقت — ظهرت كلمة مؤقتة لـ <b>${H(x.username)}</b> (${H(x.ctx)}) على شاشته، وسيُطلب منه تغييرها.`, parse_mode: "HTML" });
    await tg("answerCallbackQuery", { callback_query_id: cbId, text: "تمت الموافقة" });
}
/* ---------- دخول جهاز آخر بالباركود ---------- */
async function qrCreate(auth) { const u = await userOf(auth); if (!u)
    return J({ error: "login" }, 401); const code = rnd("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 10); await rest("qr_logins", { method: "POST", prefer: "return=minimal", body: { code, user_id: u.id } }); return J({ ok: true, code, expires_in: 180 }); }
async function qrRedeem(b) {
    const code = String(b.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const r = await rest(`qr_logins?code=eq.${code}&used=eq.false&select=user_id,created_at`);
    const x = r && r[0];
    if (!x || Date.now() - new Date(x.created_at).getTime() > 180e3)
        return J({ error: "expired" }, 410);
    await rest(`qr_logins?code=eq.${code}`, { method: "PATCH", prefer: "return=minimal", body: { used: true } });
    const u = await fetch(SB + "/auth/v1/admin/users/" + x.user_id, { headers: AH }).then((r) => r.json());
    const g = await fetch(SB + "/auth/v1/admin/generate_link", { method: "POST", headers: AH, body: JSON.stringify({ type: "magiclink", email: u.email }) }).then((r) => r.json());
    const th = g?.properties?.hashed_token || g?.hashed_token;
    if (!th)
        return J({ error: "link_failed" }, 500);
    return J({ ok: true, token_hash: th });
}
/* ---------- إعداد البوت والربط ---------- */
async function setup(auth, b) {
    const u = await userOf(auth);
    if (!u || !(await isAdminUid(u.id)))
        return J({ error: "forbidden" }, 403);
    const token = String(b.token || "").trim();
    if (!/^\d{6,12}:[A-Za-z0-9_-]{30,50}$/.test(token))
        return J({ error: "bad_token" }, 400);
    const me = await fetch(`https://api.telegram.org/bot${token}/getMe`).then((r) => r.json()).catch(() => null);
    if (!me || !me.ok)
        return J({ error: "bad_token" }, 400);
    const secret = rnd("abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789", 32);
    const old = await cfg();
    if (old.bot_token === token) { /* same */ }
    await rest("mgmt_tg_config?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { id: 1, bot_token: token, bot_username: me.result.username, secret, updated_at: new Date().toISOString() } });
    CFG = null;
    const wh = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: SB + "/functions/v1/mgmt-bot?action=hook", secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true }) }).then((r) => r.json());
    await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commands: [{ command: "status", description: "الحالة العامة" }, { command: "worst", description: "أسوأ المؤسسات" }, { command: "faults", description: "البلاغات المفتوحة" }, { command: "help", description: "مساعدة" }] }) });
    await fetch(`https://api.telegram.org/bot${token}/setMyDescription`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description: "بوت إدارة منظومة الأجهزة الطبية — تنبيهات المؤسسات وموافقات الحسابات والتقارير السريعة." }) });
    return J({ ok: !!(wh && wh.ok), username: me.result.username });
}
async function status(auth) {
    const d = await dashUser(auth);
    if (!d)
        return J({ error: "forbidden" }, 403);
    const c = await cfg();
    const l = await rest(`mgmt_tg_users?user_id=eq.${d.u.id}&select=chat_id,name`);
    return J({ ok: true, configured: !!c.bot_token, username: c.bot_username || "", linked: l || [], admin: d.lvl.level === "ministry" });
}
async function linkCode(auth) {
    const d = await dashUser(auth);
    if (!d)
        return J({ error: "forbidden" }, 403);
    const c = await cfg();
    if (!c.bot_token)
        return J({ error: "not_configured" }, 409);
    const code = rnd("abcdefghjkmnpqrstuvwxyz23456789", 12);
    await rest("mgmt_tg_codes", { method: "POST", prefer: "return=minimal", body: { code, user_id: d.u.id } });
    return J({ ok: true, url: `https://t.me/${c.bot_username}?start=${code}` });
}
async function unlink(auth) { const u = await userOf(auth); if (!u)
    return J({ error: "login" }, 401); await rest(`mgmt_tg_users?user_id=eq.${u.id}`, { method: "DELETE", prefer: "return=minimal" }); return J({ ok: true }); }
/* ---------- أسئلة البوت ---------- */
async function scopeOf(chat) { const r = await rest(`mgmt_tg_users?chat_id=eq.${chat}&select=user_id,name`); return r && r[0]; }
async function overview(uid) { const r = await srpc("scope_overview", { p_user: uid }); return (Array.isArray(r) ? r : (r && r.scope_overview) || []); }
function totals(L) { const a = { orgs: 0, devices: 0, broken: 0, maint: 0, open_faults: 0, warranty_exp: 0 }; for (const o of L.filter((x) => x.active)) {
    a.orgs++;
    for (const k of ["devices", "broken", "maint", "open_faults", "warranty_exp"])
        a[k] += +o[k] || 0;
} return a; }
const bar = (p) => p == null ? "—" : (p >= 85 ? "🟢" : p >= 65 ? "🟡" : "🔴") + " " + p + "%";
async function cmdStatus(chat, uid) {
    const L = await overview(uid), t = totals(L), p = pct(t), T = bagh();
    const worst = L.filter((o) => o.active && +o.devices).sort((a, b) => (pct(a) ?? 101) - (pct(b) ?? 101)).slice(0, 3);
    return send(chat, `${LINE}\n📊 <b>الحالة العامة</b> — ${T.date} ${T.time}\n${LINE}\n🏥 المؤسسات: <b>${t.orgs}</b>\n📟 الأجهزة: <b>${t.devices}</b>\n✅ الجاهزية: <b>${bar(p)}</b>\n⚠️ عاطل/صيانة: <b>${t.broken + t.maint}</b>\n🚨 بلاغات مفتوحة: <b>${t.open_faults}</b>\n🛡 ضمانات منتهية: <b>${t.warranty_exp}</b>${worst.length ? "\n\n<b>الأكثر حاجة للمتابعة:</b>\n" + worst.map((o, i) => `${i + 1}. ${H(o.name)} — ${bar(pct(o))}`).join("\n") : ""}`, { reply_markup: KB });
}
async function cmdWorst(chat, uid) {
    const L = (await overview(uid)).filter((o) => o.active && +o.devices).sort((a, b) => (pct(a) ?? 101) - (pct(b) ?? 101)).slice(0, 5);
    if (!L.length)
        return send(chat, "لا توجد مؤسسات ببيانات بعد.", { reply_markup: KB });
    return send(chat, `⚠️ <b>أسوأ ${L.length} مؤسسات جاهزيةً</b>\n\n` + L.map((o, i) => `${i + 1}. <b>${H(o.name)}</b>${o.unit ? " · " + H(o.unit) : ""}\n   ${bar(pct(o))} • 📟 ${o.devices} • ⚠️ ${(+o.broken || 0) + (+o.maint || 0)} • 🚨 ${o.open_faults}`).join("\n\n"), { reply_markup: KB });
}
async function cmdFaults(chat, uid) {
    const ids = (await overview(uid)).filter((o) => o.active).map((o) => o.id);
    if (!ids.length)
        return send(chat, "لا توجد مؤسسات.", { reply_markup: KB });
    const st = await rest(`org_state?org_id=in.(${ids.join(",")})&select=org_id,data->faults,orgs(name)`);
    const F = [];
    for (const s of st || [])
        for (const f of (s.faults || []))
            if (!/(مغلق|تم الإصلاح|منجز|مكتمل)/.test(String(f.status || "")))
                F.push({ ...f, org: s.orgs?.name });
    F.sort((a, b) => String(b.id).localeCompare(String(a.id)));
    if (!F.length)
        return send(chat, "✅ لا توجد بلاغات مفتوحة.", { reply_markup: KB });
    return send(chat, `🚨 <b>البلاغات المفتوحة (${F.length})</b>\n\n` + F.slice(0, 12).map((f) => `• <b>${H(f.number || "")}</b> — ${H(f.deviceName || "")}\n   🏥 ${H(f.org || "")} • 📍 ${H(f.location || "")} • 🕐 ${H(f.date || "")}`).join("\n") + (F.length > 12 ? `\n\n… و${F.length - 12} أخرى` : ""), { reply_markup: KB });
}
async function cmdOrg(chat, uid, q) {
    const n = (s) => String(s || "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").toLowerCase();
    const L = (await overview(uid)).filter((o) => n(o.name).includes(n(q)) || n(o.unit || "").includes(n(q)));
    if (!L.length)
        return send(chat, `لم أجد مؤسسة باسم «${H(q)}» ضمن صلاحيتك.\nاكتب: <b>📊 الحالة</b> أو <b>⚠️ الأسوأ</b> أو اسم مؤسسة.`, { reply_markup: KB });
    if (L.length > 1 && !L.some((o) => n(o.name) === n(q))) {
        const t = totals(L);
        return send(chat, `🔎 <b>${H(q)}</b> — ${L.length} مؤسسة\n📟 ${t.devices} جهاز • ${bar(pct(t))} • 🚨 ${t.open_faults}\n\n` + L.slice(0, 15).map((o) => `• ${H(o.name)} — ${bar(pct(o))} • ⚠️ ${(+o.broken || 0) + (+o.maint || 0)}`).join("\n"), { reply_markup: KB });
    }
    const o = L.find((x) => n(x.name) === n(q)) || L[0];
    const st = await rest(`org_state?org_id=eq.${o.id}&select=data`);
    const D = (st[0]?.data?.devices || []);
    const bad = D.filter((d) => /(عاطل|متوقف|خارج الخدمة|صيان)/.test(String(d["الحالة"] || ""))).slice(0, 12);
    return send(chat, `${LINE}\n🏥 <b>${H(o.name)}</b>${o.unit ? "\n🏛 " + H(o.unit) : ""}\n${LINE}\n✅ الجاهزية: <b>${bar(pct(o))}</b>\n📟 الأجهزة: ${o.devices} في ${o.depts} قسم\n⚠️ عاطل: ${o.broken} • صيانة: ${o.maint}\n🚨 بلاغات مفتوحة: ${o.open_faults}\n🛡 ضمانات منتهية: ${o.warranty_exp}${bad.length ? "\n\n<b>العاطلة / قيد الصيانة:</b>\n" + bad.map((d) => `• ${H(d["أسم الجهاز"] || "")} — ${H(d["مكان تنصيب الجهاز"] || "")} (${H(d["الحالة"] || "")})`).join("\n") : ""}`, { reply_markup: { inline_keyboard: [[{ text: "📲 فتح لوحة القيادة", url: BASE + "admin.html" }]] } });
}
const HELP = `🤖 <b>بوت إدارة منظومة الأجهزة الطبية</b>\n\nاكتب أو اضغط:\n📊 <b>الحالة</b> — الأرقام العامة ضمن صلاحيتك\n⚠️ <b>الأسوأ</b> — أقل المؤسسات جاهزية\n🚨 <b>البلاغات</b> — البلاغات المفتوحة\n🔎 <b>اسم مؤسسة أو دائرة</b> — تفاصيلها والأجهزة العاطلة\n\nوتصلك تلقائيًا: دخول المؤسسات، البلاغات، ملخص النشاط، تنبيهات الجاهزية والضمان، وطلبات كلمات السر للموافقة.`;
async function hook(req) {
    const c = await cfg();
    if (!c.secret || req.headers.get("x-telegram-bot-api-secret-token") !== c.secret)
        return new Response("forbidden", { status: 403 });
    const up = await req.json().catch(() => ({}));
    try {
        if (up.callback_query) {
            const q = up.callback_query, m = /^pw:([ar]):(\d+)$/.exec(q.data || "");
            if (m)
                await pwDecide(q.message.chat.id, q.id, q.message.message_id, m[1] === "a", +m[2]);
            return new Response("ok");
        }
        const msg = up.message;
        if (!msg || !msg.text)
            return new Response("ok");
        const chat = msg.chat.id, text = String(msg.text).trim();
        const st = /^\/start\s+([a-z0-9]{8,20})$/.exec(text);
        if (st) {
            const r = await rest(`mgmt_tg_codes?code=eq.${st[1]}&used=eq.false&select=user_id,created_at`);
            const x = r && r[0];
            if (!x || Date.now() - new Date(x.created_at).getTime() > 3600e3) {
                await send(chat, "⛔ رمز الربط غير صالح أو منتهي. أنشئ رمزًا جديدًا من لوحة القيادة.");
                return new Response("ok");
            }
            await rest(`mgmt_tg_codes?code=eq.${st[1]}`, { method: "PATCH", prefer: "return=minimal", body: { used: true } });
            const u = await fetch(SB + "/auth/v1/admin/users/" + x.user_id, { headers: AH }).then((r) => r.json()).catch(() => ({}));
            const name = String(u.email || "").split("@")[0];
            await rest("mgmt_tg_users?on_conflict=chat_id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { chat_id: chat, user_id: x.user_id, name } });
            await send(chat, `✅ <b>تم الربط</b> بالحساب <b>${H(name)}</b>\n\n` + HELP, { reply_markup: KB });
            return new Response("ok");
        }
        const s = await scopeOf(chat);
        if (!s) {
            await send(chat, "👋 أهلًا بك في بوت إدارة منظومة الأجهزة الطبية.\nللربط: افتح لوحة القيادة ← ⚙️ الإعدادات ← «ربط حسابي بتلغرام».");
            return new Response("ok");
        }
        const t = text.replace(/^\//, "");
        if (/^(start|help|مساعدة|❓ مساعدة)$/i.test(t))
            await send(chat, HELP, { reply_markup: KB });
        else if (/^(status|الحالة|حالة|📊 الحالة)$/i.test(t))
            await cmdStatus(chat, s.user_id);
        else if (/^(worst|الأسوأ|اسوأ|أسوأ|⚠️ الأسوأ)$/i.test(t))
            await cmdWorst(chat, s.user_id);
        else if (/^(faults|البلاغات|بلاغات|🚨 البلاغات)$/i.test(t))
            await cmdFaults(chat, s.user_id);
        else
            await cmdOrg(chat, s.user_id, t.replace(/^(حالة|العاطلة|عاطلة)\s+/, ""));
    }
    catch (e) {
        console.error(e);
    }
    return new Response("ok");
}
/* ---------- التنبيهات الذكية (كل 15 دقيقة) ---------- */
async function once(k) { try {
    await rest("alerts_state", { method: "POST", prefer: "return=minimal", body: { k } });
    return true;
}
catch (_) {
    return false;
} }
async function recipients(org) { const r = await srpc("org_recipients", { p_org: org }); return (r || []).map((x) => +(x.org_recipients ?? x)); }
async function tick(b) {
    const s = await rest("org_secrets?k=eq.tick&select=v");
    if (!s || !s[0] || b.secret !== s[0].v)
        return J({ error: "forbidden" }, 403);
    const c = await cfg();
    if (!c.bot_token)
        return J({ ok: true, skipped: "no_bot" });
    const T = bagh(), wk = T.date.slice(0, 8) + String(Math.ceil(+T.date.slice(8) / 7)), month = T.date.slice(0, 7);
    const orgs = await rest("orgs?active=eq.true&select=id,name,org_state(data,updated_at)");
    let sent = 0;
    for (const o of orgs || []) {
        const st = o.org_state && (Array.isArray(o.org_state) ? o.org_state[0] : o.org_state);
        const D = st?.data?.devices || [], F = st?.data?.faults || [];
        if (!D.length)
            continue;
        const bad = D.filter((d) => /(عاطل|متوقف|خارج الخدمة|صيان)/.test(String(d["الحالة"] || ""))).length, p = Math.round((D.length - bad) * 100 / D.length);
        const msgs = [];
        if (D.length >= 5 && p < 70 && await once(`low:${o.id}:${T.date}`))
            msgs.push(`📉 <b>الجاهزية منخفضة: ${p}%</b>\n${bad} جهاز عاطل أو قيد الصيانة من ${D.length}`);
        const upd = st?.updated_at ? new Date(st.updated_at).getTime() : 0;
        if (upd && Date.now() - upd > 7 * 864e5) {
            const days = Math.floor((Date.now() - upd) / 864e5);
            if (await once(`idle:${o.id}:${Math.floor(Date.now() / (3 * 864e5))}`))
                msgs.push(`💤 <b>لم تُحدَّث منذ ${days} يومًا</b>\nتأكد أن المؤسسة تستخدم التطبيق.`);
        }
        const lim = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
        const soon = D.filter((d) => { const w = String(d["تأريخ انتهاء الضمان"] || "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(w) && w >= T.date && w <= lim; });
        if (soon.length && await once(`warr:${o.id}:${wk}`))
            msgs.push(`🛡 <b>${soon.length} ضمان ينتهي خلال 30 يومًا</b>\n` + soon.slice(0, 5).map((d) => `• ${H(d["أسم الجهاز"] || "")} — ${String(d["تأريخ انتهاء الضمان"]).slice(0, 10)}`).join("\n"));
        const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10), cnt = {};
        for (const f of F)
            if (String(f.date || "") >= since && f.deviceId)
                cnt[f.deviceId] = (cnt[f.deviceId] || 0) + 1;
        for (const [uid, n] of Object.entries(cnt))
            if (n >= 3 && await once(`rep:${o.id}:${uid}:${month}`)) {
                const d = D.find((x) => x._uid === uid);
                msgs.push(`🔁 <b>عطل متكرر: ${n} مرات خلال 90 يومًا</b>\n${H(d ? d["أسم الجهاز"] : "جهاز")} — ${H(d ? d["مكان تنصيب الجهاز"] : "")}\n💡 مرشّح للفحص الشامل أو الإحلال`);
            }
        if (msgs.length) {
            const ch = await recipients(o.id);
            if (ch.length) {
                await sendMany(ch, `${LINE}\n🏢 <b>${H(o.name)}</b>\n${LINE}\n` + msgs.join("\n\n"));
                sent++;
            }
        }
    }
    // الملخص اليومي الساعة 8 صباحًا بتوقيت بغداد
    if (T.hour >= 8 && await once(`daily:${T.date}`)) {
        const users = await rest("mgmt_tg_users?select=chat_id,user_id");
        for (const u of users || []) {
            try {
                await send(+u.chat_id, "☀️ <b>صباح الخير — ملخص اليوم</b>");
                await cmdStatus(+u.chat_id, u.user_id);
            }
            catch (_) { /* */ }
        }
    }
    return J({ ok: true, sent });
}
Deno.serve(async (req) => {
    if (req.method === "OPTIONS")
        return new Response("ok", { headers: CORS });
    const url = new URL(req.url), action = url.searchParams.get("action") || "";
    try {
        if (action === "hook")
            return await hook(req);
        if (req.method !== "POST")
            return J({ ok: true, service: "mgmt-bot" });
        const auth = req.headers.get("authorization") || "";
        const b = await req.json().catch(() => ({}));
        switch (action) {
            case "setup": return await setup(auth, b);
            case "status": return await status(auth);
            case "link_code": return await linkCode(auth);
            case "unlink": return await unlink(auth);
            case "pw_request": return await pwRequest(req, b);
            case "pw_status": return await pwStatus(b);
            case "qr_create": return await qrCreate(auth);
            case "qr_redeem": return await qrRedeem(b);
            case "tick": return await tick(b);
        }
        return J({ error: "unsupported" }, 400);
    }
    catch (e) {
        return J({ error: String(e?.message || e) }, 500);
    }
});
