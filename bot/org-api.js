"use strict";
// واجهة المؤسسات — بطاقة الجهاز العامة + بلاغ العطل من ملصق QR (لكل مؤسسة بياناتها المستقلة)
const SB = Deno.env.get("SUPABASE_URL") || "";
const SK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };
const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { ...CORS, "Content-Type": "application/json" } });
async function rest(path, opt = {}) {
    const r = await fetch(SB + "/rest/v1/" + path, { method: opt.method || "GET", headers: { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json", Prefer: opt.prefer || "return=representation" }, body: opt.body ? JSON.stringify(opt.body) : undefined });
    const t = await r.text();
    let j = null;
    try {
        j = t ? JSON.parse(t) : null;
    }
    catch (_) {
        j = t;
    }
    if (!r.ok)
        throw new Error("db " + r.status + " " + t.slice(0, 200));
    return j;
}
const cl = (v) => { const s = String(v ?? "").replace(/\s+/g, " ").trim(); return /^[.\-_ـ\s]*$/.test(s) ? "" : s; };
const norm = (s) => String(s ?? "").toLowerCase().replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ـ/g, "").trim();
const dname = (d) => cl(d["أسم الجهاز"]) || "جهاز غير مسمى";
const loc = (d) => cl(d["مكان تنصيب الجهاز"]) || "غير محدد";
function stat(d) { const s = norm(d["الحالة"]); if (/عاطل|متوقف|خارج الخدمه/.test(s))
    return "عاطل"; if (/صالح|يعمل|فعال/.test(s))
    return "صالح"; if (/صيان/.test(s))
    return "قيد الصيانة"; return cl(d["الحالة"]) || "غير محدد"; }
const bagh = () => { const x = new Date(Date.now() + 3 * 3600e3).toISOString(); return { date: x.slice(0, 10), time: x.slice(11, 16) }; };
const nowStr = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const CARD_F = { c: "الترميز", m: "الشركه المصنعة", o: "الموديــل", sn: "سريال نمبر", co: "بلد المنشاء", l: "مكان تنصيب الجهاز", a: "توافر الأجهزة", sp: "المكتب المجهز", i: "تأريخ التنصيب", ws: "تأريخ بدء الضمان", w: "تأريخ انتهاء الضمان" };
const okId = (o) => /^[a-z0-9]{4,40}$/.test(o);
async function org(o) { const r = await rest(`orgs?id=eq.${o}&select=id,name,directorate,active`); return r && r[0]; }
async function loadState(o) { const r = await rest(`org_state?org_id=eq.${o}&select=data,version`); return r && r[0] ? { data: r[0].data, version: +r[0].version } : null; }
async function mutate(o, fn) {
    for (let i = 0; i < 4; i++) {
        const s = await loadState(o);
        if (!s)
            throw new Error("no_state");
        const out = fn(s.data);
        const r = await rest(`org_state?org_id=eq.${o}&version=eq.${s.version}`, { method: "PATCH", body: { data: s.data, version: s.version + 1, updated_at: new Date().toISOString() } });
        if (r && r.length)
            return out;
    }
    throw new Error("conflict");
}
async function card(url, o) {
    const id = String(url.searchParams.get("id") || "").slice(0, 80);
    if (!id)
        return J({ error: "missing" }, 400);
    const O = await org(o);
    if (!O || !O.active)
        return J({ error: "org" }, 404);
    const S = await loadState(o);
    if (!S)
        return J({ error: "no_state" }, 404);
    const d = (S.data.devices || []).find((x) => x._uid === id);
    if (!d)
        return J({ error: "device" }, 404);
    const r = { id, n: dname(d), s: d._seq, st: stat(d), ct: O.name + (O.directorate ? " — " + O.directorate : "") };
    if (d._moh)
        r.mo = String(d._moh);
    for (const [k, f] of Object.entries(CARD_F)) {
        const v = cl(d[f]);
        if (v)
            r[k] = v;
    }
    const wa = String(S.data.engWa || "").replace(/\D/g, "");
    if (wa)
        r.wa = wa;
    return new Response(JSON.stringify({ ok: true, d: r }), { headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=60" } });
}
const HITS = new Map();
async function report(req, o) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "x";
    const now = Date.now(), h = (HITS.get(ip) || []).filter((t) => now - t < 600000);
    if (h.length >= 10)
        return J({ error: "too_many" }, 429);
    h.push(now);
    HITS.set(ip, h);
    const b = await req.json().catch(() => ({}));
    if (b.hp)
        return J({ ok: true });
    const uid = String(b.uid || "").slice(0, 80), desc = cl(b.desc).slice(0, 700), who = cl(b.name).slice(0, 60), phone = cl(b.phone).replace(/[^\d+]/g, "").slice(0, 16);
    if (!uid || desc.length < 3)
        return J({ error: "missing" }, 400);
    const O = await org(o);
    if (!O || !O.active)
        return J({ error: "org" }, 404);
    const photo = typeof b.photo === "string" && b.photo.startsWith("data:image/") && b.photo.length < 1600000 ? b.photo : "";
    const S = await loadState(o);
    if (!S)
        return J({ error: "no_state" }, 400);
    let d = (S.data.devices || []).find((x) => x._uid === uid);
    if (!d && b.sn)
        d = (S.data.devices || []).find((x) => norm(x["سريال نمبر"]) === norm(b.sn) && norm(dname(x)) === norm(b.n));
    if (!d)
        return J({ error: "device" }, 404);
    const recent = (S.data.faults || []).filter((f) => f.via === "qr" && f.deviceId === d._uid && Date.now() - (+f.id || 0) < 15 * 60e3).length;
    if (recent >= 3)
        return J({ error: "too_many" }, 429);
    let num = "";
    const T = bagh(), fid = String(Date.now()), pid = photo ? "ph-" + fid : "";
    if (photo) {
        try {
            await rest("org_fault_photos", { method: "POST", prefer: "return=minimal", body: { id: o + "-" + pid, org_id: o, fault_id: fid, device_uid: d._uid, data: photo } });
        }
        catch (e) {
            console.error(e);
        }
    }
    await mutate(o, (data) => {
        data.faults = data.faults || [];
        num = "FLT-" + String(data.faults.length + 1).padStart(4, "0");
        data.faults.push({ id: fid, number: num, deviceId: d._uid, deviceName: dname(d), location: loc(d), date: T.date, time: T.time, priority: "متوسطة", reporter: "QR — " + (who || "بدون اسم") + (phone ? " (" + phone + ")" : ""), reporterName: who, reporterPhone: phone, status: "جديد", description: desc, via: "qr", hasPhoto: !!photo, photoId: photo ? o + "-" + pid : "" });
        (data.history = data.history || []).push({ t: nowStr(), u: d._uid, k: "fault", to: desc.slice(0, 120), ref: num, via: "qr" });
    });
    return J({ ok: true, number: num });
}
Deno.serve(async (req) => {
    if (req.method === "OPTIONS")
        return new Response("ok", { headers: CORS });
    const url = new URL(req.url), action = url.searchParams.get("action"), o = String(url.searchParams.get("o") || "");
    try {
        if (!action)
            return J({ ok: true, service: "org-api" });
        if (!okId(o))
            return J({ error: "org" }, 400);
        if (action === "info") {
            const O = await org(o);
            return O && O.active ? J({ ok: true, name: O.name, directorate: O.directorate || "" }) : J({ error: "org" }, 404);
        }
        if (action === "card")
            return await card(url, o);
        if (action === "report" && req.method === "POST")
            return await report(req, o);
        return J({ error: "unsupported" }, 400);
    }
    catch (e) {
        return J({ error: String(e?.message || e) }, 500);
    }
});
