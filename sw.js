// يعمل البرنامج بدون إنترنت: يفتح فورًا من الذاكرة إذا انقطع الاتصال أو ضعف، ويجلب أحدث نسخة عند توفر الإنترنت
const C='medtech-2026.11.28.0801',FILES=['app.html','org.html','admin.html','index.html','card.html','manifest.webmanifest','org.webmanifest','icon-192.png','icon-512.png','icon-180.png'];
const LIBS=/^https:\/\/(cdn\.jsdelivr\.net|unpkg\.com|fonts\.(googleapis|gstatic)\.com)\//;
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>Promise.all(FILES.map(f=>c.add(new Request(f,{cache:'reload'})).catch(()=>{})))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C&&x!=='medtech-libs').map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
function page(req){const u=new URL(req.url);const name=u.pathname.split('/').pop()||'index.html';return caches.match(req,{ignoreSearch:true}).then(r=>r||caches.match(name,{ignoreSearch:true})).then(r=>r||caches.match(name==='index.html'?'index.html':'app.html'))}
self.addEventListener('fetch',e=>{const req=e.request;if(req.method!=='GET')return;const u=new URL(req.url);
 // المكتبات الخارجية (قارئ الباركود، الخطوط...): من الذاكرة أولًا
 if(LIBS.test(req.url)){e.respondWith(caches.open('medtech-libs').then(c=>c.match(req).then(r=>r||fetch(req).then(n=>{if(n.ok||n.type==='opaque')c.put(req,n.clone());return n}))));return}
 if(u.origin!==location.origin||u.pathname.endsWith('version.json'))return;
 // صفحات البرنامج: من الشبكة مع مهلة 4 ثوانٍ، وإلا من الذاكرة
 e.respondWith(new Promise(res=>{let done=false;const fb=()=>page(req).then(r=>{if(!done&&r){done=true;res(r)}});
  const t=setTimeout(fb,4000);
  fetch(req,{cache:'no-cache'}).then(r=>{clearTimeout(t);if(r.ok){const cp=r.clone();caches.open(C).then(c=>c.put(req,cp))}if(!done){done=true;res(r)}})
  .catch(()=>{clearTimeout(t);page(req).then(r=>{if(!done){done=true;res(r||new Response('غير متاح بدون إنترنت',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}}))}})})}))});
