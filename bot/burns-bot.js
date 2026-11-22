// بوت تلغرام — نظام إدارة الأجهزة الطبية (المركز التخصصي للحروق)
const SB = Deno.env.get("SUPABASE_URL") || "";
const SK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const APP_URL = Deno.env.get("APP_URL") || "https://fak123123fa-lang.github.io/burns-center-devices/app.html";
const FN_URL = SB + "/functions/v1/burns-bot";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };
const CENTER = "المركز التخصصي للحروق — الديوانية";

/* ---------------- قاعدة البيانات ---------------- */
async function rest(path, opt = {}) {
  const r = await fetch(SB + "/rest/v1/" + path, { method: opt.method || "GET", headers: { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json", Prefer: opt.prefer || "return=representation" }, body: opt.body ? JSON.stringify(opt.body) : undefined });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (_) { j = t; }
  if (!r.ok) throw new Error("db " + r.status + " " + t.slice(0, 200));
  return j;
}
let CFG = null;
async function cfg(force) {
  if (CFG && !force) return CFG;
  const r = await rest("burns_tg_config?id=eq.1&select=*");
  CFG = (r && r[0]) || {};
  CFG.token = Deno.env.get("TELEGRAM_BOT_TOKEN") || CFG.bot_token;
  return CFG;
}
async function loadState() { const r = await rest("burns_app_state?id=eq.main&select=data,version"); return r && r[0] ? { data: r[0].data, version: +r[0].version } : null; }
async function mutate(fn) {
  for (let i = 0; i < 4; i++) {
    const s = await loadState(); if (!s) throw new Error("no_state");
    const out = fn(s.data);
    const r = await rest(`burns_app_state?id=eq.main&version=eq.${s.version}`, { method: "PATCH", body: { data: s.data, version: s.version + 1, updated_at: new Date().toISOString() } });
    if (r && r.length) return out;
  }
  throw new Error("conflict");
}
async function getUser(chat) { const r = await rest(`burns_tg_users?chat_id=eq.${chat}&select=*`); return r && r[0]; }
async function getSess(chat) { const r = await rest(`burns_tg_sessions?chat_id=eq.${chat}&select=state`); return (r && r[0] && r[0].state) || {}; }
async function setSess(chat, st) { await rest("burns_tg_sessions?on_conflict=chat_id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { chat_id: chat, state: st || {}, updated_at: new Date().toISOString() } }); }

/* ---------------- تلغرام ---------------- */
async function tg(method, body) {
  const c = await cfg();
  const r = await fetch(`https://api.telegram.org/bot${c.token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}
async function sendDoc(chat, name, bytes, caption, mime) {
  const c = await cfg(); const fd = new FormData();
  fd.append("chat_id", String(chat)); if (caption) { fd.append("caption", caption); fd.append("parse_mode", "HTML"); }
  fd.append("document", new Blob([bytes], { type: mime || "application/octet-stream" }), name);
  const r = await fetch(`https://api.telegram.org/bot${c.token}/sendDocument`, { method: "POST", body: fd });
  return r.json();
}
const H = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const send = (chat, text, kb) => tg("sendMessage", { chat_id: chat, text: text.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true, reply_markup: kb ? { inline_keyboard: kb } : undefined });
const edit = (chat, mid, text, kb) => tg("editMessageText", { chat_id: chat, message_id: mid, text: text.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true, reply_markup: kb ? { inline_keyboard: kb } : undefined });
const B = (text, data) => ({ text, callback_data: data });

/* ---------------- مساعدات الأجهزة ---------------- */
const cl = (v) => { const s = String(v ?? "").replace(/\s+/g, " ").trim(); return /^[.\-_ـ\s]*$/.test(s) ? "" : s; };
const norm = (s) => String(s ?? "").toLowerCase().replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ـ/g, "").trim();
const dname = (d) => cl(d["أسم الجهاز"]) || "جهاز غير مسمى";
const loc = (d) => cl(d["مكان تنصيب الجهاز"]) || "غير محدد";
function stat(d) { const s = norm(d["الحالة"]); if (/عاطل|متوقف|خارج الخدمه/.test(s)) return "عاطل"; if (/صالح|يعمل|فعال/.test(s)) return "صالح"; if (/صيان/.test(s)) return "قيد الصيانة"; return cl(d["الحالة"]) || "غير محدد"; }
const SIC = { "صالح": "🟢", "عاطل": "🔴", "قيد الصيانة": "🟡" };
function wstate(d) { const x = cl(d["تأريخ انتهاء الضمان"]); if (!x) return "غير مسجل"; const t = new Date(x); if (isNaN(+t)) return "غير مسجل"; const days = Math.ceil((+t - Date.now()) / 864e5); if (days < 0) return "منتهي"; if (days <= 60) return "ينتهي خلال " + days + " يوم"; return "ساري"; }
const today = () => new Date().toISOString().slice(0, 10);
const bagh = () => { const x = new Date(Date.now() + 3 * 3600e3).toISOString(); return { date: x.slice(0, 10), time: x.slice(11, 16) }; };
const VIEWER = "https://fak123123fa-lang.github.io/burns-center-devices/";
const qrLink = (d, wa) => VIEWER + "#i=" + encodeURIComponent(d._uid) + (d._seq ? "&s=" + d._seq : "") + (wa ? "&w=" + wa : "");
const qrImg = (d, wa) => "https://api.qrserver.com/v1/create-qr-code/?size=700x700&ecc=Q&margin=18&format=png&data=" + encodeURIComponent(qrLink(d, wa));
const qrCap = (d) => `🔳 <b>${H(d._seq)}. ${H(dname(d))}</b>\n🏛️ الوزاري: ${H(d._moh || "—")} • 📍 ${H(loc(d))}${cl(d["سريال نمبر"]) ? "\n🔢 S/N: " + H(cl(d["سريال نمبر"])) : ""}\n\nامسح الباركود لعرض بطاقة الجهاز والإبلاغ عن عطل.`;
const nowStr = () => new Date().toISOString().slice(0, 19).replace("T", " ");
function devCard(d) {
  return `${SIC[stat(d)] || "⚪"} <b>${H(d._seq)}. ${H(dname(d))}</b>\n` +
    [["🏛️ تسلسل الوزاري", d._moh ? String(d._moh) : "غير موجود في الوزاري"], ["الحالة", stat(d)], ["الموقع", loc(d)], ["الشركة", cl(d["الشركه المصنعة"])], ["الموديل", cl(d["الموديــل"])], ["الرقم التسلسلي", cl(d["سريال نمبر"])], ["الرمز", cl(d["الترميز"])], ["التنصيب", cl(d["تأريخ التنصيب"])], ["الضمان", (cl(d["تأريخ انتهاء الضمان"]) ? cl(d["تأريخ انتهاء الضمان"]) + " — " : "") + wstate(d)], ["المجهز", cl(d["المكتب المجهز"])]]
      .filter((x) => x[1]).map((x) => `• ${x[0]}: ${H(x[1])}`).join("\n");
}
function search(data, q) {
  q = norm(q); const words = q.split(/\s+/).filter(Boolean);
  return (data.devices || []).filter((d) => { const t = norm([d._seq, d._moh ? "و" + d._moh + " وزاري" + d._moh : "", dname(d), d["الترميز"], d["سريال نمبر"], loc(d), d["الشركه المصنعة"], d["الموديــل"]].join(" ")); return words.every((w) => t.includes(w)) || String(d._seq) === q || (d._moh && /^(و|وزاري)\s*\d+$/.test(q) && String(d._moh) === q.replace(/\D/g, "")); }).slice(0, 12);
}

/* ---------------- ملفات: XLSX / DOCX / CSV ---------------- */
const enc = new TextEncoder();
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
  const parts = [], central = []; let off = 0;
  const u16 = (n) => [n & 255, (n >>> 8) & 255], u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === "string" ? enc.encode(f.data) : f.data, c = crc32(data);
    const lh = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0), ...u32(c), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)]);
    parts.push(lh, name, data);
    central.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0), ...u32(c), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), name);
    off += lh.length + name.length + data.length;
  }
  const csize = central.reduce((a, b) => a + b.length, 0);
  const end = new Uint8Array([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(csize), ...u32(off), ...u16(0)]);
  const all = [...parts, ...central, end], total = all.reduce((a, b) => a + b.length, 0), out = new Uint8Array(total); let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}
const xe = (v) => String(v ?? "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colL = (i) => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
function xlsx(title, cols, rows) {
  const tone = (v) => { const n = norm(v); if (/عاطل|منتهي|مفتوح/.test(n)) return 4; if (/صالح|ساري/.test(n)) return 5; if (/قيد|ينتهي/.test(n)) return 6; return 0; };
  const cell = (r, c, v, s, num) => num && v !== "" && !isNaN(Number(v)) ? `<c r="${colL(c)}${r}" s="${s}"><v>${Number(v)}</v></c>` : `<c r="${colL(c)}${r}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xe(v)}</t></is></c>`;
  const last = colL(cols.length - 1);
  let sd = `<row r="1" ht="26" customHeight="1">${cell(1, 0, title, 3)}</row><row r="2">${cell(2, 0, "وزارة الصحة — دائرة صحة الديوانية • " + CENTER + " • تاريخ: " + today() + " • عدد السجلات: " + rows.length, 0)}</row>`;
  sd += `<row r="4" ht="28" customHeight="1">${cols.map((c, i) => cell(4, i, c.h, 1)).join("")}</row>`;
  rows.forEach((r, ri) => { sd += `<row r="${ri + 5}">${cols.map((c, i) => cell(ri + 5, i, r[i] ?? "", c.tone ? (tone(r[i]) || 2) : 2, c.num)).join("")}</row>`; });
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.w || 16}" customWidth="1"/>`).join("")}</cols><sheetData>${sd}</sheetData>${rows.length ? `<autoFilter ref="A4:${last}${rows.length + 4}"/>` : ""}<mergeCells count="2"><mergeCell ref="A1:${last}1"/><mergeCell ref="A2:${last}2"/></mergeCells><pageSetup paperSize="9" orientation="landscape"/></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="6"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><b/><sz val="15"/><color rgb="FF0F2A40"/><name val="Arial"/></font><font><b/><color rgb="FFC0392B"/><sz val="11"/><name val="Arial"/></font><font><b/><color rgb="FF14895C"/><sz val="11"/><name val="Arial"/></font><font><b/><color rgb="FFB7791F"/><sz val="11"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F5F6E"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFC9D5DF"/></left><right style="thin"><color rgb="FFC9D5DF"/></right><top style="thin"><color rgb="FFC9D5DF"/></top><bottom style="thin"><color rgb="FFC9D5DF"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf><xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf><xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return zip([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xe(title.slice(0, 30))}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: styles }, { name: "xl/worksheets/sheet1.xml", data: sheet }]);
}
function docx(title, cols, rows, meta) {
  const R = (t, o = {}) => `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${o.b ? "<w:b/><w:bCs/>" : ""}${o.c ? `<w:color w:val="${o.c}"/>` : ""}<w:sz w:val="${o.sz || 18}"/><w:szCs w:val="${o.sz || 18}"/><w:rtl/></w:rPr><w:t xml:space="preserve">${xe(t)}</w:t></w:r>`;
  const P = (t, o = {}) => `<w:p><w:pPr><w:bidi/><w:spacing w:after="${o.a ?? 60}"/>${o.jc ? `<w:jc w:val="${o.jc}"/>` : ""}</w:pPr>${R(t, o)}</w:p>`;
  const tot = cols.reduce((a, c) => a + (c.w || 14), 0), W = 15200, ws = cols.map((c) => Math.floor(W * (c.w || 14) / tot));
  const cell = (t, w, o = {}) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : ""}</w:tcPr><w:p><w:pPr><w:bidi/><w:spacing w:after="0"/></w:pPr>${R(t, o)}</w:p></w:tc>`;
  const brd = `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((k) => `<w:${k} w:val="single" w:sz="4" w:space="0" w:color="C9D5DF"/>`).join("")}</w:tblBorders>`;
  let tb = `<w:tbl><w:tblPr><w:bidiVisual/><w:tblW w:w="${W}" w:type="dxa"/>${brd}<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${ws.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid><w:tr><w:trPr><w:tblHeader/></w:trPr>${cols.map((c, i) => cell(c.h, ws[i], { fill: "0F5F6E", c: "FFFFFF", b: 1 })).join("")}</w:tr>`;
  rows.forEach((r, ri) => { tb += `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((v, i) => cell(v, ws[i], { fill: ri % 2 ? "F7FAFC" : null, c: cols[i].tone ? (/عاطل|منتهي/.test(norm(v)) ? "C0392B" : /صالح|ساري/.test(norm(v)) ? "14895C" : null) : null, b: cols[i].tone })).join("")}</w:tr>`; });
  tb += "</w:tbl>";
  const body = P("وزارة الصحة — دائرة صحة الديوانية", { jc: "center", b: 1, sz: 22, c: "35566E" }) + P(CENTER + " • وحدة إدارة الأجهزة الطبية", { jc: "center", sz: 20 }) + P(title, { jc: "center", b: 1, sz: 32, c: "0F2A40" }) + P("تاريخ التقرير: " + today() + " • عدد السجلات: " + rows.length + (meta ? " • " + meta : ""), { jc: "center", sz: 19, a: 200 }) + tb;
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="700" w:right="600" w:bottom="700" w:left="600" w:header="300" w:footer="300" w:gutter="0"/><w:bidi/></w:sectPr></w:body></w:document>`;
  return wordZip(doc);
}
function wordZip(doc) {
  return zip([{ name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: "word/document.xml", data: doc }]);
}
function letterDocx(o) {
  const R = (t, op = {}) => `<w:r><w:rPr><w:rFonts w:ascii="Simplified Arabic" w:hAnsi="Simplified Arabic" w:cs="Simplified Arabic"/>${op.b ? "<w:b/><w:bCs/>" : ""}${op.u ? '<w:u w:val="single"/>' : ""}<w:sz w:val="${op.sz || 28}"/><w:szCs w:val="${op.sz || 28}"/><w:rtl/></w:rPr><w:t xml:space="preserve">${xe(t)}</w:t></w:r>`;
  const P = (t, op = {}) => `<w:p><w:pPr><w:bidi/><w:spacing w:before="${op.before || 0}" w:after="${op.after ?? 60}" w:line="360" w:lineRule="auto"/><w:jc w:val="${op.jc || "both"}"/></w:pPr>${Array.isArray(t) ? t.join("") : R(t, op)}</w:p>`;
  const HEAD = ["جمهورية العراق", "وزارة الصحة", "دائرة صحة الديوانية", "المركز التخصصي للحروق", "وحدة إدارة الأجهزة الطبية"];
  let b = HEAD.map((h) => P(h, { b: 1, sz: 26, jc: "right", after: 0 })).join("") + P("العدد: " + (o.no || "") + "    التاريخ: " + (o.date || ""), { jc: "left", sz: 26, after: 200 });
  b += P([R("إلى / ", { b: 1 }), R(o.to || "", { b: 1 })], { jc: "right", after: 120 }) + P([R("م / ", { b: 1 }), R(o.subj || "", { b: 1, u: 1 })], { jc: "center", after: 160 }) + P("تحية طيبة ...", { jc: "right" });
  String(o.body || "").split("\n").forEach((l) => { b += P(l, { after: 40 }); });
  (o.table || []).forEach((r) => { b += P([R(r[0] + ": ", { b: 1, sz: 24 }), R(r[1], { sz: 24 })], { jc: "right", after: 0 }); });
  b += P("للتفضل بالاطلاع واتخاذ ما يلزم ... مع التقدير.", { before: 160, after: 500 }) + P(o.sign || "", { b: 1, jc: "left", after: 0 }) + P(o.role || "", { jc: "left" });
  if ((o.cc || []).length) { b += P("نسخة منه إلى /", { b: 1, before: 300, jc: "right", sz: 24, after: 0 }); o.cc.forEach((c) => { b += P("- " + c, { sz: 24, jc: "right", after: 0 }); }); }
  return wordZip(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${b}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1150" w:bottom="1000" w:left="1150" w:header="500" w:footer="500" w:gutter="0"/><w:bidi/></w:sectPr></w:body></w:document>`);
}
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const INV_COLS = [{ h: "ت", w: 6, num: 1 }, { h: "اسم الجهاز", w: 30 }, { h: "الرمز", w: 9 }, { h: "الشركة المصنعة", w: 15 }, { h: "الموديل", w: 14 }, { h: "الرقم التسلسلي", w: 20 }, { h: "الموقع", w: 20 }, { h: "الحالة", w: 11, tone: 1 }, { h: "التنصيب", w: 12 }, { h: "انتهاء الضمان", w: 12 }, { h: "حالة الضمان", w: 16, tone: 1 }];
const invRow = (d) => [d._seq, dname(d), cl(d["الترميز"]), cl(d["الشركه المصنعة"]), cl(d["الموديــل"]), cl(d["سريال نمبر"]), loc(d), stat(d), cl(d["تأريخ التنصيب"]), cl(d["تأريخ انتهاء الضمان"]), wstate(d)];
const sorted = (arr) => arr.slice().sort((a, b) => loc(a).localeCompare(loc(b), "ar") || (+a._seq - +b._seq));

/* ---------------- القوائم ---------------- */
function mainMenu(u) {
  const kb = [
    [B("📋 الجرد العام", "inv"), B("🛡️ الضمانات", "war")],
    [B("🔍 بحث عن جهاز", "srch"), B("⛔ الأجهزة العاطلة", "bad")],
    [B("🔳 الباركود", "qrm")],
    [B("🚨 البلاغات المفتوحة", "flt"), B("📅 الصيانة المستحقة", "pm")],
    [B("📤 كتب صادرة", "out"), B("📥 كتب واردة", "in")],
  ];
  if (u.role === "owner") { kb.push([B("➕ إضافة", "add"), B("✏️ تعديل جهاز", "edit")]); kb.push([B("💾 نسخة احتياطية الآن", "bk")]); }
  kb.push([B("📊 ملخص اليوم", "sum"), { text: "🌐 فتح البرنامج", url: APP_URL }]);
  return kb;
}
const back = [[B("🏠 القائمة الرئيسية", "m")]];
const MENU_TXT = (u) => `🏥 <b>نظام إدارة الأجهزة الطبية</b>\n${CENTER}\n\nأهلًا ${H(u.name || "")} 👋 ${u.role === "owner" ? "(المالك)" : "(مشاهد)"}\nماذا تريد؟`;

async function showMenu(chat, u, mid) { await setSess(chat, {}); return mid ? edit(chat, mid, MENU_TXT(u), mainMenu(u)) : send(chat, MENU_TXT(u), mainMenu(u)); }

async function onCallback(cq) {
  const chat = cq.message.chat.id, mid = cq.message.message_id, data = cq.data || "";
  if (cq.id) await tg("answerCallbackQuery", { callback_query_id: cq.id });
  const u = await getUser(chat); if (!u) return send(chat, "🔒 غير مصرّح. اطلب رمز ربط من صاحب البرنامج.");
  const S = await loadState(); if (!S) return send(chat, "⚠️ لا توجد بيانات على الإنترنت بعد. افتح البرنامج وفعّل «الحفظ الأونلاين» أولًا.");
  const D = S.data, devs = D.devices || [];
  const [cmd, a1, a2] = data.split(":");
  const owner = u.role === "owner";
  if (cmd === "add" && a1) {
    if (!owner) return;
    if (a1 === "dev") { await setSess(chat, { mode: "add_dev", step: 0, d: {} }); return send(chat, "🏥 <b>جهاز جديد</b> (1/5)\nاكتب <b>اسم الجهاز</b>:", back); }
    if (a1 === "flt") { await setSess(chat, { mode: "search", then: "fault" }); return send(chat, "🚨 ابحث عن الجهاز أولًا — اكتب اسمه أو رقمه:", back); }
    if (a1 === "in") { await setSess(chat, { mode: "add_in", step: 0, b: {} }); return send(chat, "📥 <b>كتاب وارد</b> (1/4)\nاكتب <b>رقم الكتاب</b>:", back); }
    if (a1 === "out") { await setSess(chat, { mode: "add_out", step: 0, o: {} }); return send(chat, "📤 <b>كتاب صادر</b> (1/3)\nاكتب <b>الجهة المرسل إليها</b> (إلى /):", back); }
  }
  switch (cmd) {
    case "m": return showMenu(chat, u, mid);
    case "bk": { if (!owner) return; await sendBackup([chat], S); return send(chat, "✅ أُرسلت النسخة الاحتياطية. احتفظ بالملف — يمكن استعادته من البرنامج: الإعدادات ← استيراد.", back); }
    case "inv": {
      if (!a1) { const st = {}; devs.forEach((d) => { const s = stat(d); st[s] = (st[s] || 0) + 1; }); const locs = new Set(devs.map(loc)).size;
        return edit(chat, mid, `📋 <b>الجرد العام</b>\n\nإجمالي الأجهزة: <b>${devs.length}</b> في ${locs} قسم\n${Object.entries(st).map(([k, v]) => `${SIC[k] || "⚪"} ${k}: ${v}`).join("\n")}\n\nاختر صيغة الملف:`, [[B("📊 Excel", "inv:x"), B("📝 Word", "inv:w"), B("🧾 CSV", "inv:c")], ...back]); }
      const rows = sorted(devs).map(invRow), name = "الجرد_العام_" + today();
      if (a1 === "x") await sendDoc(chat, name + ".xlsx", xlsx("الجرد العام للأجهزة الطبية", INV_COLS, rows), `📋 الجرد العام — ${rows.length} جهاز`, XLSX);
      else if (a1 === "w") await sendDoc(chat, name + ".docx", docx("الجرد العام للأجهزة الطبية", INV_COLS, rows), `📋 الجرد العام — ${rows.length} جهاز`, DOCX);
      else await sendDoc(chat, name + ".csv", enc.encode("\ufeff" + [INV_COLS.map((c) => c.h), ...rows].map((r) => r.map((v) => '"' + String(v ?? "").replace(/"/g, '""') + '"').join(",")).join("\r\n")), "🧾 CSV", "text/csv");
      return send(chat, "✅ تم إرسال الملف. اضغط عليه لفتحه أو مشاركته.", back);
    }
    case "war": {
      const exp = devs.filter((d) => wstate(d) === "منتهي"), soon = devs.filter((d) => /ينتهي/.test(wstate(d))), ok = devs.filter((d) => wstate(d) === "ساري");
      if (a1 === "x") { const rows = sorted(devs.filter((d) => cl(d["تأريخ انتهاء الضمان"]))).map(invRow); await sendDoc(chat, "الضمانات_" + today() + ".xlsx", xlsx("تقرير الضمانات", INV_COLS, rows), "🛡️ تقرير الضمانات", XLSX); return send(chat, "✅ تم إرسال تقرير الضمانات.", back); }
      return edit(chat, mid, `🛡️ <b>الضمانات</b>\n\n🟢 ساري: ${ok.length}\n🟡 ينتهي خلال 60 يومًا: ${soon.length}\n🔴 منتهي: ${exp.length}\n\n${soon.length ? "<b>تنتهي قريبًا:</b>\n" + soon.slice(0, 15).map((d) => `• ${H(dname(d))} — ${H(loc(d))} — ${H(cl(d["تأريخ انتهاء الضمان"]))}`).join("\n") : "لا توجد ضمانات تنتهي قريبًا ✅"}`, [[B("📊 تقرير Excel", "war:x")], ...back]);
    }
    case "bad": { const b = devs.filter((d) => stat(d) !== "صالح");
      return edit(chat, mid, `⛔ <b>الأجهزة غير الصالحة (${b.length})</b>\n\n${b.slice(0, 25).map((d) => `${SIC[stat(d)] || "⚪"} ${H(d._seq)}. ${H(dname(d))} — ${H(loc(d))}`).join("\n") || "كل الأجهزة صالحة ✅"}`, [...b.slice(0, 8).map((d) => [B(`${d._seq}. ${dname(d).slice(0, 30)}`, "dev:" + d._uid)]), ...back]); }
    case "flt": { const f = (D.faults || []).filter((x) => !/مغلق|تمت|مكتمل/.test(x.status || ""));
      return edit(chat, mid, `🚨 <b>البلاغات المفتوحة (${f.length})</b>\n\n${f.slice(-20).reverse().map((x) => `• ${H(x.number || "")} — ${H(x.deviceName || "")}\n   ${H(cl(x.description).slice(0, 90))} <i>(${H(x.status || "")} • ${H(x.date || "")})</i>`).join("\n") || "لا توجد بلاغات مفتوحة ✅"}`, back); }
    case "pm": { const t = today(), due = (D.preventive || []).filter((p) => p.status !== "منجزة" && p.date && p.date <= new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10)).sort((a, b) => String(a.date).localeCompare(String(b.date)));
      return edit(chat, mid, `📅 <b>الصيانة الوقائية المستحقة (14 يومًا)</b>\n\n${due.slice(0, 25).map((p) => `${p.date < t ? "⏰" : "📅"} ${H(p.date)} — ${H(p.deviceName || "")} — ${H(p.location || "")}`).join("\n") || "لا توجد مواعيد مستحقة ✅"}`, back); }
    case "sum": { const st = {}; devs.forEach((d) => { const s = stat(d); st[s] = (st[s] || 0) + 1; }); const f = (D.faults || []).filter((x) => !/مغلق|تمت|مكتمل/.test(x.status || "")).length;
      const over = (D.preventive || []).filter((p) => p.status !== "منجزة" && p.date && p.date < today()).length, soon = devs.filter((d) => /ينتهي/.test(wstate(d))).length;
      return edit(chat, mid, `📊 <b>ملخص اليوم — ${today()}</b>\n\n🏥 الأجهزة: ${devs.length}\n${Object.entries(st).map(([k, v]) => `${SIC[k] || "⚪"} ${k}: ${v}`).join("\n")}\n\n🚨 بلاغات مفتوحة: ${f}\n⏰ صيانة وقائية متأخرة: ${over}\n🛡️ ضمانات تنتهي قريبًا: ${soon}`, back); }
    case "qrm": { const locs = [...new Set(devs.map(loc))].sort((a, b) => a.localeCompare(b, "ar"));
      return edit(chat, mid, `🔳 <b>الباركود</b>\n\n• ابحث عن جهاز فأرسل لك باركوده كصورة جاهزة للطباعة أو المشاركة.\n• أو اختر قسمًا لتصلك باركودات كل أجهزته.\n• ولطباعة ملصقات كاملة (من 1 إلى 50 بالصفحة) افتح البرنامج.`, [[B("🔍 باركود جهاز", "qrs")], ...locs.slice(0, 14).map((l, i) => [B(`🏥 ${l} (${devs.filter((d) => loc(d) === l).length})`, "qrd:" + i)]), [{ text: "🖨️ طباعة الملصقات في البرنامج", url: APP_URL + "#qr" }], ...back]); }
    case "qrs": await setSess(chat, { mode: "search", then: "qr" }); return edit(chat, mid, "🔳 اكتب اسم الجهاز أو رقمه أو الرقم التسلسلي:", back);
    case "qr": { const d = devs.find((x) => x._uid === a1); if (!d) return send(chat, "لم أجد الجهاز.", back); const wa = String(D.engWa || "").replace(/\D/g, "");
      await tg("sendPhoto", { chat_id: chat, photo: qrImg(d, wa), caption: qrCap(d), parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🌐 فتح بطاقة الجهاز", url: qrLink(d, wa) }], ...back] } }); return; }
    case "qrd": { const locs = [...new Set(devs.map(loc))].sort((a, b) => a.localeCompare(b, "ar")), l = locs[+a1]; if (!l) return; const wa = String(D.engWa || "").replace(/\D/g, "");
      const L = sorted(devs.filter((d) => loc(d) === l)).slice(0, 40);
      await send(chat, `🔳 باركودات <b>${H(l)}</b> — ${L.length} جهاز${devs.filter((d) => loc(d) === l).length > 40 ? " (أول 40)" : ""}…`);
      for (let i = 0; i < L.length; i += 10) await tg("sendMediaGroup", { chat_id: chat, media: L.slice(i, i + 10).map((d) => ({ type: "photo", media: qrImg(d, wa), caption: `${d._seq}. ${dname(d)} — الوزاري ${d._moh || "—"}`.slice(0, 1000) })) });
      return send(chat, "✅ أُرسلت الباركودات. لطباعة ملصقات كاملة بالمعلومات والملاحظات افتح البرنامج:", [[{ text: "🖨️ طباعة الملصقات", url: APP_URL + "#qr" }], ...back]); }
    case "srch": case "edit": await setSess(chat, { mode: "search" }); return edit(chat, mid, "🔍 اكتب اسم الجهاز أو رقمه أو الرقم التسلسلي أو القسم (أو و12 للبحث بتسلسل الوزاري):", back);
    case "dev": { const d = devs.find((x) => x._uid === a1); if (!d) return send(chat, "لم أجد الجهاز.", back);
      const kb = owner ? [[B("🟢 صالح", "st:" + d._uid + ":0"), B("🔴 عاطل", "st:" + d._uid + ":1"), B("🟡 صيانة", "st:" + d._uid + ":2")], [B("🚨 بلاغ عطل", "fl:" + d._uid), B("📍 نقل لقسم", "mv:" + d._uid)], [B("🔳 الباركود", "qr:" + d._uid)], ...back] : [[B("🔳 الباركود", "qr:" + d._uid)], ...back];
      return send(chat, devCard(d), kb); }
    case "st": { if (!owner) return; const s = ["صالح", "عاطل", "قيد الصيانة"][+a2]; let name = "";
      await mutate((data) => { const d = (data.devices || []).find((x) => x._uid === a1); if (!d) return; const from = stat(d); d["الحالة"] = s; d["عدل في"] = nowStr(); name = dname(d); (data.history = data.history || []).push({ t: nowStr(), u: d._uid, k: "status", f: "الحالة", from, to: s, via: "telegram" }); });
      return send(chat, `✅ تغيّرت حالة «${H(name)}» إلى <b>${s}</b>`, back); }
    case "fl": if (!owner) return; await setSess(chat, { mode: "fault", uid: a1 }); return send(chat, "🚨 اكتب وصف العطل:", back);
    case "mv": { if (!owner) return; const locs = [...new Set(devs.map(loc))].sort((a, b) => a.localeCompare(b, "ar")); await setSess(chat, { mode: "move", uid: a1, locs });
      return send(chat, "📍 اختر القسم الجديد أو اكتب اسمه:", [...locs.slice(0, 20).map((l, i) => [B(l, "mvto:" + a1 + ":" + i)]), ...back]); }
    case "mvto": { if (!owner) return; const ss = await getSess(chat); const to = (ss.locs || [])[+a2]; if (!to) return; return doMove(chat, a1, to); }
    case "add": if (!owner) return; return edit(chat, mid, "➕ <b>ماذا تريد أن تضيف؟</b>", [[B("🏥 جهاز جديد", "add:dev")], [B("🚨 بلاغ عطل", "add:flt")], [B("📥 كتاب وارد", "add:in"), B("📤 كتاب صادر", "add:out")], ...back]);
    case "out": { const L = (D.letters || []).slice(-10).reverse();
      if (a1 !== undefined && a1 !== "") { const l = (D.letters || []).find((x) => x.id === a1); if (!l) return; await sendDoc(chat, ("كتاب_" + (l.no || "") + "_" + (l.subj || "")).replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 70) + ".docx", letterDocx(l), "📤 " + H(l.subj || ""), DOCX); return send(chat, "✅ تم إرسال الكتاب.", back); }
      return edit(chat, mid, `📤 <b>الكتب الصادرة (${(D.letters || []).length})</b>\n\n${L.map((l) => `• العدد ${H(l.no)} — ${H(l.date)}\n   ${H(l.subj)}`).join("\n") || "لا توجد كتب صادرة بعد."}\n\nاضغط على كتاب لتنزيله Word:`, [...L.slice(0, 8).map((l) => [B(`📝 ${l.no} — ${String(l.subj || "").slice(0, 32)}`, "out:" + l.id)]), ...(owner ? [[B("➕ كتاب صادر جديد", "add:out")]] : []), ...back]); }
    case "in": { const I = (D.books || []).filter((b) => b.type === "incoming").slice(-12).reverse();
      if (a1 === "x") { const all = (D.books || []).filter((b) => b.type === "incoming"); await sendDoc(chat, "سجل_الوارد_" + today() + ".xlsx", xlsx("سجل الكتب الواردة", [{ h: "رقم الكتاب", w: 14 }, { h: "التاريخ", w: 12 }, { h: "الجهة", w: 30 }, { h: "الموضوع", w: 44 }, { h: "تاريخ الاستلام", w: 14 }, { h: "ملاحظات", w: 30 }], all.map((b) => [b.no, b.date, b.org, b.subject, b.received, b.notes])), "📥 سجل الوارد", XLSX); return send(chat, "✅ تم الإرسال.", back); }
      return edit(chat, mid, `📥 <b>الكتب الواردة (${(D.books || []).filter((b) => b.type === "incoming").length})</b>\n\n${I.map((b) => `• ${H(b.no)} — ${H(b.date || "")} — ${H(b.org || "")}\n   ${H(b.subject || "")}`).join("\n") || "لا توجد كتب واردة مسجلة."}`, [[B("📊 سجل الوارد Excel", "in:x")], ...(owner ? [[B("➕ تسجيل كتاب وارد", "add:in")]] : []), ...back]); }
  }
}
async function doMove(chat, uid, to) {
  let name = ""; await mutate((data) => { const d = (data.devices || []).find((x) => x._uid === uid); if (!d) return; const from = loc(d); d["مكان تنصيب الجهاز"] = to; d["عدل في"] = nowStr(); name = dname(d); (data.history = data.history || []).push({ t: nowStr(), u: uid, k: "loc", f: "الموقع", from, to, via: "telegram" }); });
  await setSess(chat, {}); return send(chat, `✅ نُقل «${H(name)}» إلى <b>${H(to)}</b>`, back);
}
const ADD_DEV = [["أسم الجهاز", "اسم الجهاز"], ["سريال نمبر", "الرقم التسلسلي"], ["مكان تنصيب الجهاز", "القسم / الموقع"], ["الشركه المصنعة", "الشركة المصنعة"], ["الموديــل", "الموديل"]];
async function onText(msg) {
  const chat = msg.chat.id, text = String(msg.text || "").trim();
  if (text.startsWith("/start")) {
    const code = text.split(/\s+/)[1];
    let u = await getUser(chat);
    if (!u && code) {
      const c = await rest(`burns_tg_codes?code=eq.${encodeURIComponent(code.toUpperCase())}&used_by=is.null&select=*`);
      if (c && c[0] && Date.now() - new Date(c[0].created_at).getTime() < 3 * 864e5) {
        await rest("burns_tg_users?on_conflict=chat_id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { chat_id: chat, name: [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" "), role: c[0].role } });
        await rest(`burns_tg_codes?code=eq.${encodeURIComponent(c[0].code)}`, { method: "PATCH", prefer: "return=minimal", body: { used_by: chat, used_at: new Date().toISOString() } });
        u = await getUser(chat); await send(chat, "✅ تم ربط حسابك بالبوت بنجاح.");
      } else return send(chat, "⚠️ رمز الربط غير صحيح أو منتهي. اطلب رمزًا جديدًا من صاحب البرنامج.");
    }
    if (!u) return send(chat, "🔒 هذا البوت خاص بوحدة إدارة الأجهزة الطبية — " + CENTER + ".\nللاستخدام اطلب رابط ربط من صاحب البرنامج.");
    return showMenu(chat, u);
  }
  const u = await getUser(chat); if (!u) return send(chat, "🔒 غير مصرّح. اطلب رابط ربط من صاحب البرنامج.");
  const ss = await getSess(chat);
  if (ss.mode === "search") {
    const S = await loadState(); if (!S) return send(chat, "⚠️ لا توجد بيانات على الإنترنت بعد.");
    const res = search(S.data, text);
    if (!res.length) return send(chat, "لم أجد أجهزة مطابقة. جرّب كلمة أخرى:", back);
    if (ss.then === "qr") { await setSess(chat, {}); if (res.length === 1) return onCallback({ id: "", data: "qr:" + res[0]._uid, message: { chat: { id: chat }, message_id: 0 } }); return send(chat, `🔳 اختر الجهاز:`, [...res.map((d) => [B(`${d._seq}${d._moh ? " 🏛" + d._moh : ""}. ${dname(d).slice(0, 26)} — ${loc(d).slice(0, 18)}`, "qr:" + d._uid)]), ...back]); }
    if (res.length === 1 && ss.then !== "fault") { await setSess(chat, {}); return onCallback({ id: "", data: "dev:" + res[0]._uid, message: { chat: { id: chat }, message_id: 0 } }); }
    if (ss.then === "fault") { await setSess(chat, { mode: "pickfault" }); return send(chat, "اختر الجهاز:", [...res.map((d) => [B(`${SIC[stat(d)] || "⚪"} ${d._seq}. ${dname(d).slice(0, 28)} — ${loc(d).slice(0, 18)}`, "fl:" + d._uid)]), ...back]); }
    await setSess(chat, {});
    return send(chat, `🔍 وجدت ${res.length} جهاز:`, [...res.map((d) => [B(`${SIC[stat(d)] || "⚪"} ${d._seq}${d._moh ? " 🏛" + d._moh : ""}. ${dname(d).slice(0, 26)} — ${loc(d).slice(0, 18)}`, "dev:" + d._uid)]), ...back]);
  }
  if (u.role !== "owner" && ss.mode) { await setSess(chat, {}); return send(chat, "👁 حسابك للمشاهدة فقط.", back); }
  if (ss.mode === "fault") {
    let num = ""; await mutate((data) => { const d = (data.devices || []).find((x) => x._uid === ss.uid); data.faults = data.faults || []; num = "FLT-" + String(data.faults.length + 1).padStart(4, "0");
      data.faults.push({ id: String(Date.now()), number: num, deviceId: ss.uid, deviceName: d ? dname(d) : "", location: d ? loc(d) : "", date: today(), priority: "متوسطة", reporter: "تلغرام — " + (u.name || ""), status: "جديد", description: text });
      (data.history = data.history || []).push({ t: nowStr(), u: ss.uid, k: "fault", to: text.slice(0, 120), ref: num, via: "telegram" }); });
    await setSess(chat, {}); return send(chat, `✅ سُجّل بلاغ العطل <b>${num}</b>`, back);
  }
  if (ss.mode === "move") return doMove(chat, ss.uid, text);
  if (ss.mode === "add_dev") {
    const st = ss.step || 0, d = ss.d || {}; d[ADD_DEV[st][0]] = text === "-" ? "" : text;
    if (st + 1 < ADD_DEV.length) { await setSess(chat, { mode: "add_dev", step: st + 1, d }); return send(chat, `🏥 جهاز جديد (${st + 2}/${ADD_DEV.length})\nاكتب <b>${ADD_DEV[st + 1][1]}</b> (أو - للتخطي):`, back); }
    let seq = 0; await mutate((data) => { data.devices = data.devices || []; seq = Math.max(0, ...data.devices.map((x) => +x._seq || 0)) + 1; const nd = { ...d, "الحالة": "صالـــح", "الترميز": "3666", "مسار المؤسسة": "دائرة صحة الديوانية / المركز التخصصي للحروق", "دائرة الصحة": "دائرة صحة الديوانية", "أدخل في": nowStr(), "المدخل": "telegram", _uid: "dev-tg-" + Date.now(), _seq: seq, _photos: [] }; data.devices.push(nd); (data.history = data.history || []).push({ t: nowStr(), u: nd._uid, k: "add", to: dname(nd), via: "telegram" }); });
    await setSess(chat, {}); return send(chat, `✅ أُضيف الجهاز رقم <b>${seq}</b>: ${H(d["أسم الجهاز"])}\nأكمل باقي بياناته من البرنامج.`, back);
  }
  if (ss.mode === "add_in") {
    const F = [["no", "رقم الكتاب"], ["org", "الجهة المرسلة"], ["subject", "موضوع الكتاب"], ["date", "تاريخ الكتاب (مثال 2026-11-05) أو - لتاريخ اليوم"]];
    const st = ss.step || 0, b = ss.b || {}; b[F[st][0]] = text === "-" ? (F[st][0] === "date" ? today() : "") : text;
    if (st + 1 < F.length) { await setSess(chat, { mode: "add_in", step: st + 1, b }); return send(chat, `📥 كتاب وارد (${st + 2}/${F.length})\nاكتب <b>${F[st + 1][1]}</b>:`, back); }
    await mutate((data) => { (data.books = data.books || []).push({ id: String(Date.now()), type: "incoming", no: b.no, date: b.date, org: b.org, subject: b.subject, received: today(), notes: "سُجّل عبر تلغرام" }); });
    await setSess(chat, {}); return send(chat, `✅ سُجّل الكتاب الوارد رقم <b>${H(b.no)}</b>`, back);
  }
  if (ss.mode === "add_out") {
    const F = [["to", "الجهة المرسل إليها"], ["subj", "الموضوع"], ["body", "نص الكتاب"]];
    const st = ss.step || 0, o = ss.o || {}; o[F[st][0]] = text;
    if (st + 1 < F.length) { await setSess(chat, { mode: "add_out", step: st + 1, o }); return send(chat, `📤 كتاب صادر (${st + 2}/${F.length})\nاكتب <b>${F[st + 1][1]}</b>:`, back); }
    let L = null; await mutate((data) => { data.letters = data.letters || []; const nums = data.letters.map((x) => parseInt(x.no)).filter((n) => !isNaN(n)); L = { id: "LT-" + Date.now(), type: "custom", no: String((nums.length ? Math.max(...nums) : 0) + 1), date: today(), to: o.to, subj: o.subj, body: o.body, table: null, sign: (data.letters.at(-1) || {}).sign || "", role: (data.letters.at(-1) || {}).role || "مسؤول وحدة إدارة الأجهزة الطبية", cc: [], created: nowStr(), via: "telegram" }; data.letters.push(L); });
    await setSess(chat, {}); await sendDoc(chat, ("كتاب_" + L.no + "_" + L.subj).replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 70) + ".docx", letterDocx(L), `📤 الكتاب رقم ${H(L.no)} — ${H(L.subj)}`, DOCX);
    return send(chat, "✅ أُنشئ الكتاب وحُفظ في سجل الصادر.", back);
  }
  return showMenu(chat, u);
}

/* ---------------- نسخة احتياطية ---------------- */
async function owners() { const r = await rest("burns_tg_users?role=eq.owner&select=chat_id"); return (r || []).map((x) => x.chat_id); }
async function sendBackup(chats, S) {
  S = S || await loadState(); if (!S) return 0;
  const d = S.data || {}, n = (d.devices || []).length;
  const bytes = enc.encode(JSON.stringify({ app: "medtech_system_v3", exportedAt: new Date().toISOString(), version: S.version, data: d }));
  for (const c of chats) await sendDoc(c, "نسخة_احتياطية_الأجهزة_" + today() + ".json", bytes, `💾 <b>نسخة احتياطية يومية</b> — ${today()}\n🏥 ${n} جهاز • 🚨 ${(d.faults || []).length} بلاغ • 🔧 ${(d.maintenance || []).length} صيانة • 📤 ${(d.letters || []).length} كتاب`, "application/json");
  return chats.length;
}

/* ---------------- الطيار الآلي: ملخص الصباح + التقرير الشهري ---------------- */
const CLOSED = /مغلق|تمت|مكتمل|منجز/;
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
function digest(D) {
  const t = today(), devs = D.devices || [], wk = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10), m30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const st = {}; devs.forEach((d) => { const s = stat(d); st[s] = (st[s] || 0) + 1; });
  const open = (D.faults || []).filter((f) => !CLOSED.test(String(f.status || "")));
  const pm = (D.preventive || []).filter((p) => p.status !== "منجزة" && p.date), over = pm.filter((p) => p.date < t), week = pm.filter((p) => p.date >= t && p.date <= wk);
  const war = devs.filter((d) => { const w = cl(d["تأريخ انتهاء الضمان"]); return w && w >= t && w <= m30; });
  const sf = {}; (D.safety || []).filter((r) => r.type === "safety").forEach((r) => { if (!sf[r.uid] || r.date > sf[r.uid].date) sf[r.uid] = r; });
  const sfOver = Object.values(sf).filter((r) => r.next && r.next < t);
  const ms = D.mohSync || {}, done = ms.done || {}; const pend = new Set((D.history || []).filter((h) => h && h.u && ["status", "loc", "edit", "add"].includes(h.k) && ms.base && h.t > ms.base && h.t > (done[h.u] || "")).map((h) => h.u));
  const L = [`☀️ <b>صباح الخير — ملخص ${t}</b>`, `🏥 ${devs.length} جهاز • 🟢 ${st["صالح"] || 0} • 🔴 ${st["عاطل"] || 0} • 🟡 ${st["قيد الصيانة"] || 0}`];
  let any = false;
  if (open.length) { any = true; L.push("", `🚨 <b>بلاغات مفتوحة: ${open.length}</b>`, ...open.slice(-5).reverse().map((f) => `• ${H(f.deviceName || "")} — ${H(f.location || "")} <i>(منذ ${Math.max(0, days(f.date || t, t))} يوم)</i>`)); }
  if (over.length) { any = true; L.push("", `⏰ <b>وقائية متأخرة: ${over.length}</b>`, ...over.slice(0, 5).map((p) => `• ${H(p.deviceName || "")} — ${H(p.date)}`)); }
  if (week.length) { any = true; L.push("", `📅 <b>وقائية هذا الأسبوع: ${week.length}</b>`, ...week.slice(0, 6).map((p) => `• ${H(p.date)} — ${H(p.deviceName || "")} — ${H(p.location || "")}`)); }
  if (sfOver.length) { any = true; L.push("", `⚡ فحص سلامة كهربائية متأخر: <b>${sfOver.length}</b> جهاز`); }
  if (war.length) { any = true; L.push("", `🛡️ <b>ضمانات تنتهي خلال 30 يومًا: ${war.length}</b>`, ...war.slice(0, 5).map((d) => `• ${H(dname(d))} — ${H(cl(d["تأريخ انتهاء الضمان"]))}`)); }
  if (pend.size) { any = true; L.push("", `📌 بانتظار النقل للبرنامج الوزاري: <b>${pend.size}</b> جهاز`); }
  if (!any) L.push("", "✅ لا يوجد ما يحتاج انتباهك اليوم. يوم موفق!");
  return L.join("\n");
}
function monthly(D) {
  const n = new Date(); const from = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, 1)).toISOString().slice(0, 10), to = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 0)).toISOString().slice(0, 10), label = from.slice(0, 7);
  const inM = (x) => x && x >= from && x <= to;
  const F = (D.faults || []).filter((f) => inM(f.date)), M = (D.maintenance || []).filter((m) => inM(m.date)), P = (D.preventive || []).filter((p) => inM(p.date));
  const rows = [...F.map((f) => ["بلاغ عطل", f.number || "", f.date || "", f.deviceName || "", f.location || "", cl(f.description), f.status || ""]), ...M.map((m) => ["صيانة", m.number || "", m.date || "", m.deviceName || "", m.location || "", cl(m.actions || m.description || m.work || ""), m.status || ""]), ...P.map((p) => ["وقائية", "", p.date || "", p.deviceName || "", p.location || "", cl(p.actions), p.status || ""])].sort((a, b) => String(a[2]).localeCompare(String(b[2])));
  const pmDone = P.filter((p) => p.status === "منجزة").length;
  const cap = `📊 <b>التقرير الشهري — ${label}</b>\n🚨 أعطال: ${F.length} • 🔧 صيانات: ${M.length}\n📅 وقائية: ${pmDone} منجزة من ${P.length}${P.length ? " (" + Math.round(pmDone / P.length * 100) + "%)" : ""}`;
  const bytes = xlsx("التقرير الشهري — " + label, [{ h: "النوع", w: 11 }, { h: "الرقم", w: 11 }, { h: "التاريخ", w: 12 }, { h: "الجهاز", w: 30 }, { h: "القسم", w: 20 }, { h: "التفاصيل", w: 44 }, { h: "الحالة", w: 13, tone: 1 }], rows);
  return { cap, bytes, name: "التقرير_الشهري_" + label + ".xlsx" };
}
async function daily() {
  const S = await loadState(); if (!S) return { sent: 0 };
  const D = S.data || {}, ap = D.autopilot || {}, chats = await owners(); let r = { owners: chats.length, digest: false, monthly: false };
  if (ap.digest !== false) { for (const c of chats) await tg("sendMessage", { chat_id: c, text: digest(D).slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true, reply_markup: { inline_keyboard: [[B("🚨 البلاغات", "flt"), B("📅 الوقائية", "pm")], [{ text: "🌐 فتح البرنامج", url: APP_URL }]] } }); r.digest = true; }
  if (ap.monthly !== false && new Date().getUTCDate() === 1) { const m = monthly(D); for (const c of chats) await sendDoc(c, m.name, m.bytes, m.cap, XLSX); r.monthly = true; }
  return r;
}

/* ---------------- بلاغ عطل من ملصق QR (عام بدون حساب) ---------------- */
async function report(req) {
  const b = await req.json().catch(() => ({}));
  if (b.hp) return J({ ok: true });
  const uid = String(b.uid || "").slice(0, 80), desc = cl(b.desc).slice(0, 700), who = cl(b.name).slice(0, 60), phone = cl(b.phone).replace(/[^\d+]/g, "").slice(0, 16);
  if (!uid || desc.length < 3) return J({ error: "missing" }, 400);
  const photo = typeof b.photo === "string" && b.photo.startsWith("data:image/") && b.photo.length < 1600000 ? b.photo : "";
  const S = await loadState(); if (!S) return J({ error: "no_state" }, 400);
  let d = (S.data.devices || []).find((x) => x._uid === uid);
  if (!d && b.sn) d = (S.data.devices || []).find((x) => norm(x["سريال نمبر"]) === norm(b.sn) && norm(dname(x)) === norm(b.n));
  if (!d) return J({ error: "device" }, 404);
  const recent = (S.data.faults || []).filter((f) => f.via === "qr" && f.deviceId === d._uid && Date.now() - (+f.id || 0) < 15 * 60e3).length;
  if (recent >= 3) return J({ error: "too_many" }, 429);
  let num = ""; const T = bagh(), fid = String(Date.now()), pid = photo ? "ph-" + fid : "";
  if (photo) { try { await rest("burns_fault_photos", { method: "POST", prefer: "return=minimal", body: { id: pid, fault_id: fid, device_uid: d._uid, data: photo } }); } catch (e) { console.error(e); } }
  await mutate((data) => { data.faults = data.faults || []; num = "FLT-" + String(data.faults.length + 1).padStart(4, "0");
    data.faults.push({ id: fid, number: num, deviceId: d._uid, deviceName: dname(d), location: loc(d), date: T.date, time: T.time, priority: "متوسطة", reporter: "QR — " + (who || "بدون اسم") + (phone ? " (" + phone + ")" : ""), reporterName: who, reporterPhone: phone, status: "جديد", description: desc, via: "qr", hasPhoto: !!photo, photoId: pid });
    (data.history = data.history || []).push({ t: nowStr(), u: d._uid, k: "fault", to: desc.slice(0, 120), ref: num, via: "qr" }); });
  const cap = `🚨 <b>بلاغ عطل جديد ${num}</b> (من ملصق QR)\n🕐 ${T.date} — الساعة ${T.time}\n\n🏥 <b>${H(d._seq)}. ${H(dname(d))}</b>${d._moh ? " — 🏛 وزاري " + H(d._moh) : ""}\n📍 ${H(loc(d))}\n🔢 S/N: ${H(cl(d["سريال نمبر"]) || "—")}\n\n📝 ${H(desc)}\n\n👤 ${H(who || "بدون اسم")}${phone ? " — 📞 " + H(phone) : ""}`;
  const kb = { inline_keyboard: [[B("📋 بطاقة الجهاز", "dev:" + d._uid), B("🔴 عاطل", "st:" + d._uid + ":1")], ...(phone ? [[{ text: "💬 واتساب المبلّغ", url: "https://wa.me/" + phone.replace(/^0/, "964").replace(/^\+/, "") }]] : [])] };
  const c = await cfg();
  for (const chat of await owners()) {
    if (photo) { const bin = Uint8Array.from(atob(photo.split(",")[1]), (ch) => ch.charCodeAt(0)); const fd = new FormData(); fd.append("chat_id", String(chat)); fd.append("caption", cap.slice(0, 1020)); fd.append("parse_mode", "HTML"); fd.append("reply_markup", JSON.stringify(kb)); fd.append("photo", new Blob([bin], { type: "image/jpeg" }), "fault.jpg"); await fetch(`https://api.telegram.org/bot${c.token}/sendPhoto`, { method: "POST", body: fd }); }
    else await tg("sendMessage", { chat_id: chat, text: cap, parse_mode: "HTML", reply_markup: kb });
  }
  return J({ ok: true, number: num });
}

/* ---------------- إدارة من البرنامج (المالك) ---------------- */
async function ownerOf(req) {
  const auth = req.headers.get("authorization") || ""; if (!auth.startsWith("Bearer ")) return null;
  const r = await fetch(SB + "/auth/v1/user", { headers: { apikey: SK, Authorization: auth } }); if (!r.ok) return null;
  const user = await r.json(); const m = await rest(`burns_members?user_id=eq.${user.id}&role=eq.owner&select=user_id`); return m && m[0] ? user : null;
}
const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { ...CORS, "Content-Type": "application/json" } });
async function admin(req, action) {
  const user = await ownerOf(req); if (!user) return J({ error: "not_owner" }, 403);
  const body = await req.json().catch(() => ({}));
  if (action === "setup") {
    const token = String(body.token || "").trim() || (await cfg(true)).token; if (!token) return J({ error: "no_token" }, 400);
    const me = await (await fetch(`https://api.telegram.org/bot${token}/getMe`)).json(); if (!me.ok) return J({ error: "bad_token" }, 400);
    const secret = crypto.randomUUID().replace(/-/g, "");
    await rest("burns_tg_config?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { id: 1, bot_token: Deno.env.get("TELEGRAM_BOT_TOKEN") ? null : token, bot_username: me.result.username, secret } });
    CFG = null;
    const wh = await (await fetch(`https://api.telegram.org/bot${token}/setWebhook`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: FN_URL, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true }) })).json();
    await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commands: [{ command: "start", description: "القائمة الرئيسية" }] }) });
    return J({ ok: wh.ok, username: me.result.username, webhook: wh.description });
  }
  if (action === "code") {
    const c = await cfg(true); if (!c.bot_username) return J({ error: "not_setup" }, 400);
    const code = Array.from(crypto.getRandomValues(new Uint8Array(8))).map((b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
    await rest("burns_tg_codes", { method: "POST", prefer: "return=minimal", body: { code, role: body.role === "owner" ? "owner" : "viewer" } });
    return J({ code, link: `https://t.me/${c.bot_username}?start=${code}`, username: c.bot_username });
  }
  if (action === "status") { const c = await cfg(true); const us = await rest("burns_tg_users?select=chat_id,name,role,linked_at&order=linked_at"); return J({ configured: !!(c.token && c.bot_username), username: c.bot_username || null, users: us || [] }); }
  if (action === "backup") { const n = await sendBackup(await owners()); return J({ ok: true, sent: n }); }
  if (action === "unlink") { await rest(`burns_tg_users?chat_id=eq.${+body.chat_id}`, { method: "DELETE", prefer: "return=minimal" }); return J({ ok: true }); }
  return J({ error: "unknown" }, 400);
}

/* ---------------- إنشاء حساب فوري (بدون رسالة تأكيد بالبريد) ---------------- */
const SU_HITS = new Map();
async function signup(req) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "x";
  const now = Date.now(), h = (SU_HITS.get(ip) || []).filter((t) => now - t < 600000);
  if (h.length >= 6) return J({ error: "rate" }, 429);
  h.push(now); SU_HITS.set(ip, h);
  const b = await req.json().catch(() => ({}));
  const email = String(b.email || "").trim().toLowerCase(), password = String(b.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return J({ error: "bad_email" }, 400);
  if (password.length < 6 || password.length > 72) return J({ error: "bad_password" }, 400);
  const H = { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json" };
  const r = await fetch(SB + "/auth/v1/admin/users", { method: "POST", headers: H, body: JSON.stringify({ email, password, email_confirm: true }) });
  if (r.ok) return J({ ok: true, created: true });
  const t = await r.text();
  if (r.status === 422 || /already|exists|registered/i.test(t)) {
    for (let page = 1; page <= 5; page++) {
      const l = await fetch(SB + `/auth/v1/admin/users?page=${page}&per_page=200`, { headers: H }).then((x) => x.json()).catch(() => ({}));
      const us = (l && l.users) || [];
      const u = us.find((x) => String(x.email || "").toLowerCase() === email);
      if (u) { if (!u.email_confirmed_at) await fetch(SB + "/auth/v1/admin/users/" + u.id, { method: "PUT", headers: H, body: JSON.stringify({ email_confirm: true }) }); return J({ ok: true, exists: true }); }
      if (us.length < 200) break;
    }
    return J({ ok: true, exists: true });
  }
  return J({ error: "signup_failed", detail: t.slice(0, 200) }, 400);
}

/* ---------------- بطاقة الجهاز العامة (للباركود القصير) ---------------- */
const CARD_F = { c: "الترميز", m: "الشركه المصنعة", o: "الموديــل", sn: "سريال نمبر", co: "بلد المنشاء", l: "مكان تنصيب الجهاز", a: "توافر الأجهزة", sp: "المكتب المجهز", i: "تأريخ التنصيب", ws: "تأريخ بدء الضمان", w: "تأريخ انتهاء الضمان" };
async function card(url) {
  const id = String(url.searchParams.get("id") || "").slice(0, 80); if (!id) return J({ error: "missing" }, 400);
  const S = await loadState(); if (!S) return J({ error: "no_state" }, 404);
  const d = (S.data.devices || []).find((x) => x._uid === id); if (!d) return J({ error: "device" }, 404);
  const o = { id, n: dname(d), s: d._seq, st: stat(d), ct: CENTER };
  if (d._moh) o.mo = String(d._moh);
  for (const [k, f] of Object.entries(CARD_F)) { const v = cl(d[f]); if (v) o[k] = v; }
  const wa = String((S.data.engWa || "")).replace(/\D/g, ""); if (wa) o.wa = wa;
  return new Response(JSON.stringify({ ok: true, d: o }), { headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=60" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url), action = url.searchParams.get("action");
  try {
    if (action === "report") return await report(req);
    if (action === "card") return await card(url);
    if (action === "signup") return await signup(req);
    if (action === "cron-backup" || action === "cron-daily") { const c = await cfg(true); if (!c.secret || req.headers.get("x-cron-key") !== c.secret) return J({ error: "forbidden" }, 403);
      if (action === "cron-daily") return J(await daily());
      const S0 = await loadState(); if (S0 && S0.data && S0.data.autopilot && S0.data.autopilot.backup === false) return J({ skipped: true });
      return J({ sent: await sendBackup(await owners(), S0) }); }
    if (action) return await admin(req, action);
    if (req.method !== "POST") return new Response("burns-bot ok", { headers: CORS });
    const c = await cfg(); if (!c.secret || req.headers.get("x-telegram-bot-api-secret-token") !== c.secret) return new Response("forbidden", { status: 403 });
    const up = await req.json();
    if (up.callback_query) await onCallback(up.callback_query);
    else if (up.message && up.message.text) await onText(up.message);
    return new Response("ok");
  } catch (e) {
    console.error(e);
    return action ? J({ error: String(e && e.message || e) }, 500) : new Response("ok");
  }
});
