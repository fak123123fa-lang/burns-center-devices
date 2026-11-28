"use strict";
// إدارة الحسابات بكل المستويات — اسم مستخدم وكلمة سر تلقائيًا (بدون بريد)
// المستويات: ministry (حساب وزاري) • unit (دائرة/قطاع: مدير أو مشاهد) • org (مؤسسة: مالك أو مشاهد)
const SB = Deno.env.get("SUPABASE_URL") || "";
const SK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const AK = Deno.env.get("SUPABASE_ANON_KEY") || SK;
const DOMAIN = "orgs.medtech.local";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const AH = { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json" };
async function rest(path, opt = {}) {
    const r = await fetch(SB + "/rest/v1/" + path, { method: opt.method || "GET", headers: { ...AH, Prefer: opt.prefer || "return=representation" }, body: opt.body ? JSON.stringify(opt.body) : undefined });
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
async function crpc(auth, fn, args) {
    const r = await fetch(SB + "/rest/v1/rpc/" + fn, { method: "POST", headers: { apikey: AK, Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(args || {}) });
    if (!r.ok)
        return null;
    return await r.json();
}
const rnd = (set, n) => { const a = new Uint32Array(n); crypto.getRandomValues(a); return [...a].map((x) => set[x % set.length]).join(""); };
const genPw = () => rnd("ABCDEFGHJKLMNPQRSTUVWXYZ", 1) + rnd("abcdefghjkmnpqrstuvwxyz", 3) + "-" + rnd("23456789", 2) + rnd("abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ", 2);
const okId = (o) => /^[a-z0-9]{4,40}$/.test(o);
const okUser = (u) => /^[a-z][a-z0-9_.-]{2,30}$/.test(u);
const PREFIX = { ministry: "moh", unit: "dir", org: "med" };
async function newAccount(prefix, wanted, meta) {
    for (let i = 0; i < 6; i++) {
        const username = wanted && i === 0 ? wanted : prefix + rnd("0123456789", i < 3 ? 4 : 6);
        const password = genPw();
        const r = await fetch(SB + "/auth/v1/admin/users", { method: "POST", headers: AH, body: JSON.stringify({ email: `${username}@${DOMAIN}`, password, email_confirm: true, user_metadata: { username, ...meta } }) });
        if (r.ok) {
            const u = await r.json();
            return { username, password, user_id: u.id, email: `${username}@${DOMAIN}` };
        }
        const t = await r.text();
        if (!(r.status === 422 || /already|exists|registered/i.test(t)))
            throw new Error("create_failed: " + t.slice(0, 160));
        if (wanted && i === 0)
            throw new Error("username_taken");
    }
    throw new Error("create_failed");
}
async function stillUsed(uid) {
    const a = await rest(`org_members?user_id=eq.${uid}&select=user_id&limit=1`), b = await rest(`unit_members?user_id=eq.${uid}&select=user_id&limit=1`), c = await rest(`org_admins?user_id=eq.${uid}&select=user_id&limit=1`);
    return (a && a.length) || (b && b.length) || (c && c.length);
}
Deno.serve(async (req) => {
    if (req.method === "OPTIONS")
        return new Response("ok", { headers: CORS });
    if (req.method !== "POST")
        return J({ ok: true, service: "org-admin" });
    try {
        const auth = req.headers.get("authorization") || "";
        if (!auth.startsWith("Bearer "))
            return J({ error: "login" }, 401);
        const b = await req.json().catch(() => ({}));
        const action = String(b.action || "");
        const scope = String(b.scope || (b.org ? "org" : b.unit ? "unit" : ""));
        const admin = (await crpc(auth, "org_is_admin", {})) === true;
        const wanted = String(b.username || "").trim().toLowerCase();
        if (wanted && !okUser(wanted))
            return J({ error: "bad_username" }, 400);
        // ---------- الصلاحية على النطاق ----------
        let table = "", key = {}, can = false, canOwner = false;
        if (scope === "ministry") {
            table = "org_admins";
            can = admin;
            canOwner = admin;
        }
        else if (scope === "unit") {
            const u = String(b.unit || "");
            if (!okId(u))
                return J({ error: "unit" }, 400);
            table = "unit_members";
            key = { unit_id: u };
            const r = await crpc(auth, "unit_role", { p_unit: u });
            can = r === "manager";
            canOwner = can;
        }
        else if (scope === "org") {
            const o = String(b.org || "");
            if (!okId(o))
                return J({ error: "org" }, 400);
            table = "org_members";
            key = { org_id: o };
            const r = await crpc(auth, "org_role", { p_org: o });
            can = r === "owner";
            canOwner = (await crpc(auth, "org_can_admin", { p_org: o })) === true;
        }
        else
            return J({ error: "scope" }, 400);
        if (!can)
            return J({ error: "forbidden" }, 403);
        if (action === "create_user") {
            let role = scope === "ministry" ? "" : scope === "unit" ? (b.role === "viewer" ? "viewer" : "manager") : (b.role === "viewer" ? "viewer" : "owner");
            if ((role === "owner" || role === "manager" || scope === "ministry") && !canOwner)
                return J({ error: "forbidden" }, 403);
            const acc = await newAccount(PREFIX[scope], wanted, { scope, ...key });
            const row = scope === "ministry" ? { user_id: acc.user_id, email: acc.email } : { ...key, user_id: acc.user_id, email: acc.email, role };
            await rest(table + (scope === "ministry" ? "?on_conflict=user_id" : scope === "unit" ? "?on_conflict=unit_id,user_id" : "?on_conflict=org_id,user_id"), { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: row });
            return J({ ok: true, username: acc.username, password: acc.password, user_id: acc.user_id, role });
        }
        const uid = String(b.user_id || "");
        if (!/^[0-9a-f-]{36}$/.test(uid))
            return J({ error: "user" }, 400);
        const q = Object.entries(key).map(([k, v]) => `${k}=eq.${v}&`).join("");
        const m = await rest(`${table}?${q}user_id=eq.${uid}&select=email${scope === "ministry" ? "" : ",role"}`);
        if (!m || !m[0])
            return J({ error: "not_member" }, 404);
        const synthetic = String(m[0].email || "").endsWith("@" + DOMAIN);
        if ((m[0].role === "owner" || m[0].role === "manager") && !canOwner)
            return J({ error: "forbidden" }, 403);
        if (action === "reset_password") {
            if (!synthetic)
                return J({ error: "not_org_account" }, 400);
            const password = genPw();
            const r = await fetch(SB + "/auth/v1/admin/users/" + uid, { method: "PUT", headers: AH, body: JSON.stringify({ password }) });
            if (!r.ok)
                return J({ error: "reset_failed" }, 400);
            return J({ ok: true, username: String(m[0].email).split("@")[0], password, role: m[0].role || "" });
        }
        if (action === "delete_user") {
            if (scope === "ministry") {
                const me = await fetch(SB + "/auth/v1/user", { headers: { apikey: SK, Authorization: auth } }).then((r) => r.json()).catch(() => ({}));
                if (me && me.id === uid)
                    return J({ error: "cannot_remove_self" }, 400);
            }
            await rest(`${table}?${q}user_id=eq.${uid}`, { method: "DELETE", prefer: "return=minimal" });
            if (synthetic && !(await stillUsed(uid)))
                await fetch(SB + "/auth/v1/admin/users/" + uid, { method: "DELETE", headers: AH });
            return J({ ok: true });
        }
        return J({ error: "unsupported" }, 400);
    }
    catch (e) {
        const m = String(e?.message || e);
        return J({ error: m }, /username_taken/.test(m) ? 409 : 500);
    }
});
