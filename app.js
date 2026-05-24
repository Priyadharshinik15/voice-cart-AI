let PRODUCTS = [];
let FUSE_ALL = null;
let FUSE_CP  = null;

async function loadProducts() {
  const bar    = document.getElementById('loadBar');
  const status = document.getElementById('loadStatus');
  const badge  = document.getElementById('dbBadge');

  
  try {
    status.textContent = 'Fetching BigBasket CSV...';
    bar.style.width = '20%';

    const res = await fetch('cleaned_bigbasket.csv');
    if (!res.ok) throw new Error('CSV not found');

    status.textContent = 'Parsing CSV...';
    bar.style.width = '40%';

    const txt = await res.text();
    bar.style.width = '60%';

    await new Promise(resolve => {
      Papa.parse(txt, {
        header: true,
        skipEmptyLines: true,
        complete(results) {
          status.textContent = 'Building search index...';
          bar.style.width = '80%';
          buildIndex(results.data);
          resolve();
        },
        error() { resolve(); }
      });
    });

  } catch(e) {
    
    status.textContent = 'CSV not found — upload below';
    bar.style.width = '100%';
    showUploadPrompt();
    return;
  }

  bar.style.width = '100%';
  badge.innerHTML = `<span>${PRODUCTS.length.toLocaleString()}</span> products loaded`;
  status.textContent = `${PRODUCTS.length.toLocaleString()} products ready`;
  setTimeout(() => document.getElementById('overlay').classList.add('gone'), 500);
  toast(`✅ ${PRODUCTS.length.toLocaleString()} BigBasket products loaded`, 'ok');
}

function buildIndex(rows) {
  PRODUCTS = [];
  for (const r of rows) {
    const price = parseFloat(r.sale_price || r.price || 0);
    if (!price || price <= 0) continue;
    const brand = (r.brand || '').trim().toLowerCase();
    const cp    = (r.clean_product || '').trim().toLowerCase();
    const cat   = (r.category || '').trim().toLowerCase();
    const sub   = (r.sub_category || '').trim().toLowerCase();
    const prod  = (r.product || '').trim();
    if (!prod) continue;
    PRODUCTS.push({
      id: r.id || '',
      p:  prod,
      b:  brand,
      pr: Math.round(price * 100) / 100,
      u:  (r.unit || '').trim() || 'unit',
      cp: cp,
      s:  `${brand} ${cp} ${cat} ${sub}`.replace(/[&,]/g,' ').replace(/\s+/g,' ').substring(0,180)
    });
  }

  
  
  FUSE_ALL = new Fuse(PRODUCTS, {
    keys: [
      { name: 'b',  weight: 0.5 },
      { name: 'cp', weight: 0.35 },
      { name: 's',  weight: 0.15 }
    ],
    threshold: 0.45,
    minMatchCharLength: 2,
    includeScore: true,
    useExtendedSearch: false
  });

  
  FUSE_CP = new Fuse(PRODUCTS, {
    keys: [
      { name: 'cp', weight: 0.7 },
      { name: 's',  weight: 0.3 }
    ],
    threshold: 0.4,
    minMatchCharLength: 2,
    includeScore: true
  });
}

function showUploadPrompt() {
  document.getElementById('overlay').classList.add('gone');
  
  const panel = document.querySelector('.panel');
  const div = document.createElement('div');
  div.style = 'background:rgba(244,63,94,.08);border:1px solid rgba(244,63,94,.3);border-radius:10px;padding:16px;margin-bottom:16px;font-size:13px';
  div.innerHTML = `
    <div style="color:#f43f5e;font-weight:600;margin-bottom:8px">⚠️ BigBasket CSV not found</div>
    <div style="color:#5a5c70;margin-bottom:12px;font-size:12px">Place <code style="color:#eeeef2">BigBasket Products.csv</code> in the same folder as this HTML file, or upload it below:</div>
    <input type="file" accept=".csv" onchange="handleUpload(event)"
      style="background:#161820;border:1px solid #22242f;border-radius:7px;padding:8px 10px;color:#eeeef2;font-size:12px;width:100%;cursor:pointer"/>
  `;
  document.getElementById('chips').before(div);
  document.getElementById('dbBadge').textContent = 'No CSV loaded';
}

function handleUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const bar = document.getElementById('loadBar');
  const status = document.getElementById('loadStatus');
  document.getElementById('overlay').classList.remove('gone');
  bar.style.width = '30%';
  status.textContent = 'Reading uploaded CSV...';

  const reader = new FileReader();
  reader.onload = (ev) => {
    bar.style.width = '60%';
    status.textContent = 'Parsing...';
    Papa.parse(ev.target.result, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        status.textContent = 'Building search index...';
        bar.style.width = '85%';
        buildIndex(results.data);
        bar.style.width = '100%';
        document.getElementById('dbBadge').innerHTML = `<span>${PRODUCTS.length.toLocaleString()}</span> products`;
        setTimeout(() => document.getElementById('overlay').classList.add('gone'), 400);
        toast(`✅ ${PRODUCTS.length.toLocaleString()} products loaded`, 'ok');
        e.target.closest('div').remove();
      }
    });
  };
  reader.readAsText(file);
}

const WORD_NUMS = {
  'zero':0,'one':1,'two':2,'three':3,'four':4,'five':5,
  'six':6,'seven':7,'eight':8,'nine':9,'ten':10,'eleven':11,
  'twelve':12,'half':0.5,'a':1,'an':1,'couple':2,'dozen':12
};
const STOP = new Set(['add','put','get','buy','want','need','please','can','you','me','i','to','my','cart','the','some','few','also','and','plus','with','in','of','at','for','from']);
const REMOVE_WORDS = new Set(['remove','delete','take','cancel','drop','out','clear','minus']);
const UNIT_RE = /\b(\d+(?:\.\d+)?)\s*(kg|g|gm|gms|gram|grams|litre|liter|liters|litres|ltr|ltrs|l|ml|pack|packs|packet|packets|piece|pieces|pcs|bottle|bottles|box|boxes|unit|units)\b/i;

function parseCommand(raw) {
  let text = raw.toLowerCase().trim();

  
  const isRemove = [...REMOVE_WORDS].some(w => text.startsWith(w) || text.includes(' ' + w + ' ') || text.includes(w + ' '));

  
  for (const [w, n] of Object.entries(WORD_NUMS)) {
    text = text.replace(new RegExp('\\b' + w + '\\b', 'g'), String(n));
  }

  
  let qty = 1, unitRaw = '';
  const unitMatch = text.match(UNIT_RE);
  if (unitMatch) {
    qty     = parseFloat(unitMatch[1]);
    unitRaw = unitMatch[2].toLowerCase();
    text    = text.replace(unitMatch[0], '').trim();
  } else {
    const numMatch = text.match(/\b(\d+(?:\.\d+)?)\b/);
    if (numMatch) {
      qty  = parseFloat(numMatch[1]);
      text = text.replace(numMatch[0], '').trim();
    }
  }

  
  const unitMap = {
    'kg':'kg','g':'g','gm':'g','gms':'g','gram':'g','grams':'g',
    'litre':'L','liter':'L','liters':'L','litres':'L','ltr':'L','ltrs':'L','l':'L',
    'ml':'ml','pack':'pack','packs':'pack','packet':'pack','packets':'pack',
    'piece':'pc','pieces':'pc','pcs':'pc',
    'bottle':'bottle','bottles':'bottle','box':'box','boxes':'box',
    'unit':'unit','units':'unit',''  :'unit'
  };
  const unit = unitMap[unitRaw] || unitRaw || 'unit';

  
  const action = isRemove ? 'remove' : 'add';
  const actionWords = new Set([...REMOVE_WORDS, 'add','put','get','buy','want','need','please','can','you','me','i','to','my','cart','the','some','few','also','and','plus','with']);
  const tokens = text
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !actionWords.has(t) && !/^\d+$/.test(t));

  const query = tokens.join(' ').trim();
  return { action, qty, unit, query, raw };
}

function findProduct(query) {
  if (!query || query.length < 2 || !PRODUCTS.length) return null;

  const q = query.toLowerCase().trim();
  const tokens = q.split(/\s+/).filter(t => t.length > 1);
  if (!tokens.length) return null;

  
  let brandTokens    = [];
  let productTokens  = [];
  for (const t of tokens) {
    const isBrand = PRODUCTS.some(p => p.b === t || p.b.startsWith(t));
    if (isBrand) brandTokens.push(t);
    else productTokens.push(t);
  }

  
  if (brandTokens.length > 0) {
    const brandQuery = brandTokens.join(' ');
    const prodQuery  = productTokens.join(' ');

    
    let brandPool = PRODUCTS.filter(p =>
      brandTokens.every(bt => p.b.includes(bt))
    );

    if (brandPool.length > 0 && prodQuery) {
      
      const fuseLocal = new Fuse(brandPool, {
        keys: [{ name:'cp', weight:0.7 }, { name:'s', weight:0.3 }],
        threshold: 0.5,
        minMatchCharLength: 2,
        includeScore: true
      });
      const r = fuseLocal.search(prodQuery);
      if (r.length > 0 && r[0].score < 0.5) return r[0].item;
    }
    if (brandPool.length > 0) {
      
      return rankByRelevance(brandPool, prodQuery || brandQuery);
    }
  }

  
  const r1 = FUSE_ALL.search(q);
  if (r1.length > 0 && r1[0].score < 0.45) return r1[0].item;

  
  const r2 = FUSE_CP.search(q);
  if (r2.length > 0 && r2[0].score < 0.45) return r2[0].item;

  
  const allMatch = PRODUCTS.filter(p => tokens.every(t => p.s.includes(t)));
  if (allMatch.length > 0) return rankByRelevance(allMatch, q);

  
  const anyMatch = PRODUCTS.filter(p => tokens.some(t => t.length > 3 && p.s.includes(t)));
  if (anyMatch.length > 0) return rankByRelevance(anyMatch, q);

  return null;
}

function rankByRelevance(pool, query) {
  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter(t => t.length > 1);
  let best = null, bestScore = Infinity;
  for (const p of pool) {
    let sc = p.p.length * 0.01; 
    for (const t of tokens) {
      if (p.cp.includes(t)) sc -= 3;
      else if (p.s.includes(t)) sc -= 1;
    }
    if (sc < bestScore) { bestScore = sc; best = p; }
  }
  return best;
}

function splitCommands(text) {
  
  
  const parts = text
    .replace(/\band\b(?=\s+(?:\d|\w+\s+\d|add|remove|get|buy|put))/gi, '|')
    .replace(/,(?=\s*(?:\d|\w+\s+\d|add|remove))/g, '|')
    .split('|')
    .map(s => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [text];
}

async function processVoice(text) {
  if (!text.trim()) return;
  const commands = splitCommands(text);
  const results = [];

  for (const cmd of commands) {
    const parsed = parseCommand(cmd);
    if (!parsed.query) continue;

    if (parsed.action === 'remove') {
      const removed = removeFromCartByQuery(parsed.query);
      results.push({ action:'remove', query: parsed.query, removed });
    } else {
      const match = findProduct(parsed.query);
      results.push({ action:'add', query: parsed.query, qty: parsed.qty, unit: parsed.unit, match });
      if (match) {
        addToCart(match, parsed.qty, parsed.unit);
      }
    }
  }
  showDetected(results);
}

let cart = [];
let cartIdSeq = 0;

function addToCart(product, qty, unit) {
  const existing = cart.find(c => c.id === product.id);
  if (existing) {
    existing.qty   = Math.round((existing.qty + qty) * 100) / 100;
    existing.total = Math.round(existing.qty * existing.pr * 100) / 100;
    toast(`+${qty} ${existing.p.substring(0,30)}`, 'ok');
  } else {
    cart.push({
      cartId: ++cartIdSeq,
      id:     product.id,
      p:      product.p,
      b:      product.b,
      pr:     product.pr,
      u:      unit !== 'unit' ? unit : product.u,
      qty:    qty,
      total:  Math.round(qty * product.pr * 100) / 100
    });
    toast(`✅ ${product.p.substring(0,35)}`, 'ok');
  }
  renderCart();
}

function removeFromCartByQuery(query) {
  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter(t => t.length > 1);
  const idx = cart.findIndex(c =>
    tokens.every(t => c.p.toLowerCase().includes(t) || c.b.includes(t))
  );
  if (idx !== -1) {
    const name = cart[idx].p;
    cart.splice(idx, 1);
    renderCart();
    toast(`🗑️ Removed: ${name.substring(0,30)}`, 'rm');
    return true;
  }
  toast(`❌ Not in cart: "${query}"`, 'err');
  return false;
}

function updateQty(cartId, delta) {
  const item = cart.find(c => c.cartId === cartId);
  if (!item) return;
  item.qty = Math.max(0.5, Math.round((item.qty + delta) * 10) / 10);
  item.total = Math.round(item.qty * item.pr * 100) / 100;
  renderCart();
}

function removeItem(cartId) {
  const item = cart.find(c => c.cartId === cartId);
  if (item) toast(`🗑️ ${item.p.substring(0,30)}`, 'rm');
  cart = cart.filter(c => c.cartId !== cartId);
  renderCart();
}

function clearCart() {
  cart = [];
  renderCart();
  toast('🗑️ Cart cleared', 'rm');
}

function renderCart() {
  const tbody = document.getElementById('cartBody');
  const cnt   = document.getElementById('cartCnt');
  cnt.textContent = cart.length;

  if (!cart.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6"><span class="empty-icon">🛍️</span>Start speaking to add items</td></tr>`;
    setbill(0,0,0);
    return;
  }

  tbody.innerHTML = cart.map((item, i) => `
    <tr>
      <td class="td-num">${i + 1}</td>
      <td>
        <div class="td-name">${esc(item.p)}</div>
        <div class="td-brand-tag">${esc(item.b)}</div>
      </td>
      <td class="td-right">
        <div class="qty">
          <button onclick="updateQty(${item.cartId},-1)">−</button>
          <span class="qty-v">${item.qty}</span>
          <button onclick="updateQty(${item.cartId},1)">+</button>
        </div>
      </td>
      <td class="td-right td-muted">₹${item.pr.toFixed(2)}</td>
      <td class="td-right td-total">₹${item.total.toFixed(2)}</td>
      <td class="td-act"><button class="btn-rm" onclick="removeItem(${item.cartId})">✕</button></td>
    </tr>
  `).join('');

  const sub   = cart.reduce((s,c) => s + c.total, 0);
  const gst   = Math.round(sub * 0.05 * 100) / 100;
  const total = Math.round((sub + gst) * 100) / 100;
  const items = cart.reduce((s,c) => s + c.qty, 0);
  setbill(sub, gst, total, items);
}

function setbill(sub, gst, total, items=0) {
  document.getElementById('bItems').textContent  = items;
  document.getElementById('bSub').textContent    = `₹${sub.toFixed(2)}`;
  document.getElementById('bGst').textContent    = `₹${gst.toFixed(2)}`;
  document.getElementById('bTotal').textContent  = `₹${total.toFixed(2)}`;
}

function showDetected(results) {
  const panel = document.getElementById('detPanel');
  const list  = document.getElementById('detList');
  panel.style.display = 'block';
  list.innerHTML = results.map(r => {
    if (r.action === 'remove') {
      return `<div class="det-item ${r.removed?'ok':'fail'}">
        <div class="det-icon">${r.removed?'🗑️':'❌'}</div>
        <div class="det-body">
          <div class="det-cmd">REMOVE: "${esc(r.query)}"</div>
          <div class="det-name">${r.removed ? 'Removed from cart' : 'Not found in cart'}</div>
        </div>
      </div>`;
    }
    const m = r.match;
    return `<div class="det-item ${m?'ok':'fail'}">
      <div class="det-icon">${m?'✅':'❌'}</div>
      <div class="det-body">
        <div class="det-cmd">ADD: "${esc(r.query)}" × ${r.qty} ${r.unit}</div>
        <div class="det-name">${m ? esc(m.p) : 'No match found in database'}</div>
        ${m ? `<div class="det-brand">${esc(m.b)}</div>` : ''}
      </div>
      ${m ? `<div class="det-price">₹${m.pr.toFixed(2)}</div>` : ''}
    </div>`;
  }).join('');
}

let searchTimer = null;
function onSearchInput(val) {
  clearTimeout(searchTimer);
  const results = document.getElementById('srResults');
  if (!val.trim() || val.length < 2) { results.classList.remove('show'); return; }
  searchTimer = setTimeout(() => {
    if (!PRODUCTS.length) return;
    const hits = FUSE_ALL.search(val, { limit: 10 });
    if (!hits.length) { results.classList.remove('show'); return; }
    results.innerHTML = hits.map(h => `
      <div class="sr-result-item" onclick="addSearchResult('${h.item.id}')">
        <div class="sr-ri-name">${esc(h.item.p)}</div>
        <div class="sr-ri-meta">
          <span class="sr-ri-brand">${esc(h.item.b)}</span>
          <span class="sr-ri-price">₹${h.item.pr.toFixed(2)}</span>
          <span>${esc(h.item.u)}</span>
        </div>
      </div>
    `).join('');
    results.classList.add('show');
  }, 200);
}

function addSearchResult(id) {
  const p = PRODUCTS.find(x => x.id === id);
  if (p) { addToCart(p, 1, p.u); }
  document.getElementById('searchInput').value = '';
  document.getElementById('srResults').classList.remove('show');
}

function clearSearch() {
  document.getElementById('searchInput').value = '';
  document.getElementById('srResults').classList.remove('show');
}

function onSearchKey(e) {
  if (e.key === 'Escape') clearSearch();
}
document.addEventListener('click', e => {
  if (!e.target.closest('.sr-dropdown')) clearSearch();
});

let SR = null, listening = false, finalT = '';

function initSR() {
  const S = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!S) { document.getElementById('nosr').style.display = 'block'; return false; }
  SR = new S();
  SR.continuous      = true;
  SR.interimResults  = true;
  SR.lang            = 'en-IN';

  SR.onstart = () => {
    listening = true;
    setStatus('listening','Listening...');
    document.getElementById('micBtn').classList.add('active');
    document.getElementById('wave').classList.add('active');
    document.getElementById('vstate').className = 'voice-state on';
    document.getElementById('vstate').textContent = 'Listening — speak now';
    document.getElementById('transcript').classList.remove('empty');
  };

  SR.onresult = async (ev) => {
    let interim = '';
    finalT = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const t = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) finalT += t + ' ';
      else interim += t;
    }
    const el = document.getElementById('transcript');
    el.innerHTML = `<span class="t-final">${esc(finalT)}</span><span class="t-interim">${esc(interim)}</span>`;
    if (finalT.trim()) {
      setStatus('processing','Processing...');
      await processVoice(finalT.trim());
      finalT = '';
      if (listening) setStatus('listening','Listening...');
    }
  };

  SR.onerror = (e) => {
    if (e.error !== 'no-speech') toast(`Speech error: ${e.error}`, 'err');
  };

  SR.onend = () => {
    if (listening) setTimeout(() => SR.start(), 200);
    else {
      setStatus('','Ready');
      document.getElementById('micBtn').classList.remove('active');
      document.getElementById('wave').classList.remove('active');
      document.getElementById('vstate').className = 'voice-state';
      document.getElementById('vstate').textContent = 'Tap to start listening';
    }
  };
  return true;
}

function toggleVoice() {
  if (!SR) { toast('Use Chrome/Edge for voice', 'err'); return; }
  if (listening) {
    listening = false;
    SR.stop();
  } else {
    finalT = '';
    document.getElementById('transcript').textContent = 'Your speech will appear here...';
    document.getElementById('transcript').classList.add('empty');
    listening = true;
    SR.start();
  }
}

function sim(text) {
  const el = document.getElementById('transcript');
  el.innerHTML = `<span class="t-final">${esc(text)}</span>`;
  el.classList.remove('empty');
  setStatus('processing','Processing...');
  processVoice(text).then(() => setStatus('','Ready'));
}

function setStatus(type, text) {
  const dot  = document.getElementById('sdot');
  const span = document.getElementById('stext');
  dot.className  = 'sdot' + (type ? ' ' + type : '');
  span.textContent = text;
}

function toast(msg, type) {
  const c = document.getElementById('toasts');
  const d = document.createElement('div');
  d.className = `toast ${type}`;
  d.textContent = msg;
  c.appendChild(d);
  setTimeout(() => d.remove(), 3200);
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function checkout() {
  if (!cart.length) { toast('Cart is empty!', 'err'); return; }
  const now    = new Date();
  const billNo = 'VC' + Date.now().toString().slice(-7);
  const sub    = cart.reduce((s,c) => s + c.total, 0);
  const gst    = Math.round(sub * 0.05 * 100) / 100;
  const grand  = Math.round((sub + gst) * 100) / 100;

  const rows = cart.map((c, i) => `
    <tr style="background:${i%2===0?'rgba(255,255,255,0.04)':'transparent'}">
      <td style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.07);font-size:13px">${esc(c.p)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.07);font-size:12px;color:#818cf8;text-align:center">${esc(c.b)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.07);font-size:13px;text-align:center">${c.qty} ${esc(c.u)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.07);font-size:13px;text-align:right;color:#a8b4c8">₹${c.pr.toFixed(2)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.07);font-size:13px;text-align:right;font-weight:700;color:#4ade80">₹${c.total.toFixed(2)}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>VoiceCart Bill ${billNo}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Courier New',monospace;background:linear-gradient(135deg,#07080d,#0f1520);color:#eeeef2;min-height:100vh;padding:40px 24px}
.page{max-width:700px;margin:0 auto}
.hdr{text-align:center;padding-bottom:24px;margin-bottom:24px;border-bottom:2px solid rgba(74,222,128,.35)}
.logo{font-size:32px;font-weight:900}em{color:#4ade80;font-style:normal}
.tag{font-size:10px;color:#5a5c70;letter-spacing:3px;text-transform:uppercase;margin-top:4px}
.meta{display:flex;justify-content:space-between;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:14px 18px;margin-bottom:24px;font-size:12px;color:#5a5c70;line-height:2}
strong{color:#b0bcd4}
table{width:100%;border-collapse:collapse;margin-bottom:24px;border-radius:10px;overflow:hidden}
thead{background:rgba(74,222,128,.12)}
thead td{padding:11px 14px;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#4ade80;border-bottom:1px solid rgba(74,222,128,.25)}
.totals{margin-left:auto;width:280px}
.tr{display:flex;justify-content:space-between;padding:7px 0;font-size:12px;color:#5a5c70;border-bottom:1px solid rgba(255,255,255,.07)}
.tg{display:flex;justify-content:space-between;padding:14px 0 0;font-size:22px;font-weight:900}
.tg span:last-child{color:#4ade80}
hr{border:none;border-top:1px dashed rgba(255,255,255,.12);margin:24px 0}
.footer{text-align:center;font-size:11px;color:#5a5c70;line-height:2}
.ty{font-size:20px;font-weight:700;margin-bottom:4px}
.badge{display:inline-block;background:rgba(74,222,128,.15);color:#4ade80;padding:3px 12px;border-radius:999px;font-size:11px;border:1px solid rgba(74,222,128,.3)}
@media print{body{background:#07080d!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.np{display:none!important}}</style></head>
<body><div class="page">
<div class="hdr"><div class="logo">Voice<em>Cart</em></div><div class="tag">BigBasket Smart Shopping</div></div>
<div class="meta"><div><strong>Bill No:</strong> ${billNo}<br/><strong>Date:</strong> ${now.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}<br/><strong>Time:</strong> ${now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</div>
<div style="text-align:right"><strong>Items:</strong> ${cart.length}<br/><strong>Total Qty:</strong> ${cart.reduce((s,c)=>s+c.qty,0)}<br/><span class="badge">🎤 Voice Order</span></div></div>
<table><thead><tr><td>Product</td><td style="text-align:center">Brand</td><td style="text-align:center">Qty</td><td style="text-align:right">Unit Price</td><td style="text-align:right">Total</td></tr></thead>
<tbody>${rows}</tbody></table>
<div class="totals"><div class="tr"><span>Subtotal</span><span>₹${sub.toFixed(2)}</span></div>
<div class="tr"><span>GST (5%)</span><span>₹${gst.toFixed(2)}</span></div>
<div class="tg"><span>TOTAL</span><span>₹${grand.toFixed(2)}</span></div></div>
<hr/><div class="footer"><div class="ty">Thank you for shopping! 🛒</div>Powered by VoiceCart — BigBasket AI Voice System<br/>All prices sourced from BigBasket database</div>
<div class="np" style="text-align:center;margin-top:32px;display:flex;justify-content:center;gap:10px">
<button onclick="window.print()" style="background:#4ade80;color:#07080d;border:none;padding:12px 28px;font-size:14px;font-weight:700;border-radius:8px;cursor:pointer;font-family:monospace">🖨️ PRINT</button>
<button onclick="window.close()" style="background:rgba(255,255,255,.08);color:#b0bcd4;border:1px solid rgba(255,255,255,.15);padding:12px 20px;font-size:14px;border-radius:8px;cursor:pointer;font-family:monospace">✕ Close</button>
</div></div></body></html>`;

  const blob = new Blob([html], { type:'text/html' });
  const url  = URL.createObjectURL(blob);
  window.open(url, '_blank');
  const a = document.createElement('a');
  a.href = url; a.download = `VoiceCart_Bill_${billNo}.html`;
  a.click();
  toast(`🧾 Bill ${billNo} ready!`, 'ok');
}

window.addEventListener('DOMContentLoaded', async () => {
  renderCart();
  initSR();
  await loadProducts();
});