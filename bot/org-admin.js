"use strict";
// إدارة حسابات المؤسسات — اسم مستخدم وكلمة سر تلقائيًا (بدون بريد)
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
async function callerRole(auth, org) {
    const r = await fetch(SB + "/rest/v1/rpc/org_role", { method: "POST", headers: { apikey: AK, Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify({ p_org: org }) });
    if (!r.ok)
        return null;
    return await r.json();
}
async function isAdmin(auth) {
    const r = await fetch(SB + "/rest/v1/rpc/org_is_admin", { method: "POST", headers: { apikey: AK, Authorization: auth, "Content-Type": "application/json" }, body: "{}" });
    return r.ok && (await r.json()) === true;
}
const rnd = (set, n) => { const a = new Uint32Array(n); crypto.getRandomValues(a); return [...a].map((x) => set[x % set.length]).join(""); };
const genPw = () => rnd("ABCDEFGHJKLMNPQRSTUVWXYZ", 1) + rnd("abcdefghjkmnpqrstuvwxyz", 3) + "-" + rnd("23456789", 2) + rnd("abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ", 2);
const okOrg = (o) => /^[a-z0-9]{4,40}$/.test(o);
const okUser = (u) => /^[a-z][a-z0-9_.-]{2,30}$/.test(u);
async function createUser(org, role, wanted) {
    for (let i = 0; i < 6; i++) {
        const username = wanted && i === 0 ? wanted : "med" + rnd("0123456789", i < 3 ? 4 : 6);
        const password = genPw();
        const r = await fetch(SB + "/auth/v1/admin/users", { method: "POST", headers: AH, body: JSON.stringify({ email: `${username}@${DOMAIN}`, password, email_confirm: true, user_metadata: { username, org, kind: "org" } }) });
        if (r.ok) {
            const u = await r.json();
            await rest("org_members?on_conflict=org_id,user_id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { org_id: org, user_id: u.id, email: `${username}@${DOMAIN}`, role } });
            return { username, password, user_id: u.id };
        }
        const t = await r.text();
        if (!(r.status === 422 || /already|exists|registered/i.test(t)))
            throw new Error("create_failed: " + t.slice(0, 160));
        if (wanted && i === 0)
            throw new Error("username_taken");
    }
    throw new Error("create_failed");
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
        const action = String(b.action || ""), org = String(b.org || "");
        if (!okOrg(org))
            return J({ error: "org" }, 400);
        const role = await callerRole(auth, org);
        if (role !== "owner")
            return J({ error: "forbidden" }, 403);
        const admin = await isAdmin(auth);
        if (action === "create_user") {
            const r = b.role === "viewer" ? "viewer" : "owner";
            if (r === "owner" && !admin)
                return J({ error: "forbidden" }, 403);
            const wanted = String(b.username || "").trim().toLowerCase();
            if (wanted && !okUser(wanted))
                return J({ error: "bad_username" }, 400);
            return J({ ok: true, ...(await createUser(org, r, wanted)) });
        }
        const uid = String(b.user_id || "");
        if (!/^[0-9a-f-]{36}$/.test(uid))
            return J({ error: "user" }, 400);
        const m = await rest(`org_members?org_id=eq.${org}&user_id=eq.${uid}&select=email,role`);
        if (!m || !m[0])
            return J({ error: "not_member" }, 404);
        const synthetic = String(m[0].email || "").endsWith("@" + DOMAIN);
        if (m[0].role === "owner" && !admin)
            return J({ error: "forbidden" }, 403);
        if (action === "reset_password") {
            if (!synthetic)
                return J({ error: "not_org_account" }, 400);
            const password = genPw();
            const r = await fetch(SB + "/auth/v1/admin/users/" + uid, { method: "PUT", headers: AH, body: JSON.stringify({ password }) });
            if (!r.ok)
                return J({ error: "reset_failed" }, 400);
            return J({ ok: true, username: String(m[0].email).split("@")[0], password });
        }
        if (action === "delete_user") {
            await rest(`org_members?org_id=eq.${org}&user_id=eq.${uid}`, { method: "DELETE", prefer: "return=minimal" });
            if (synthetic) {
                const others = await rest(`org_members?user_id=eq.${uid}&select=org_id`);
                if (!others || !others.length)
                    await fetch(SB + "/auth/v1/admin/users/" + uid, { method: "DELETE", headers: AH });
            }
            return J({ ok: true });
        }
        return J({ error: "unsupported" }, 400);
    }
    catch (e) {
        const m = String(e?.message || e);
        return J({ error: m }, /username_taken/.test(m) ? 409 : 500);
    }
});
