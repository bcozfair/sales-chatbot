/* ─────────────────────────────────────────────────────────────────────────────
   ของร่วมของ mockup ชุด pr-* — แถบบน + ปุ่มสลับธีม + ตัวช่วยเล็ก ๆ

   ธีมมืดเป็นค่าเริ่มต้นเหมือนแอปจริง และตัวเซ็ตธีมต้องทำงาน "ก่อน" หน้าวาด
   ไม่งั้นจอวาบขาวหนึ่งเฟรม (docs/design.md §2) — ไฟล์นี้จึงถูกโหลดใน <head>
   ───────────────────────────────────────────────────────────────────────────── */

(function () {
  try {
    const saved = localStorage.getItem('admin-theme');
    if (saved === 'light') document.documentElement.setAttribute('data-theme', 'light');
  } catch (_) {
    /* โหมดส่วนตัว / ปิดคุกกี้ — ใช้ธีมมืดตามค่าเริ่มต้น */
  }
})();

window.PR_UI = {
  /** แถบบนของทุกหน้าในชุด — ลิงก์ข้ามหน้า + ปุ่มสลับธีม */
  bar(active) {
    const pages = [
      { href: 'pr-index.html', text: 'สารบัญ', key: 'index' },
      { href: 'pr-manual.html', text: 'คู่มือการใช้งาน', key: 'manual' },
      { href: 'pr-calc.html', text: 'ลองคิดราคา', key: 'calc' },
      { href: 'pr-rules.html', text: 'แก้กฎราคา', key: 'rules' }
    ];
    const bar = document.createElement('div');
    bar.className = 'mock-bar';
    bar.innerHTML =
      '<span class="mock-title">ตัวอย่าง · เครื่องคิดราคาสินค้าสั่งทำ</span>' +
      pages
        .map((p) =>
          p.key === active
            ? `<span class="small" style="color:var(--c-text-faint);font-weight:600">${p.text}</span>`
            : `<a href="${p.href}">${p.text}</a>`
        )
        .join('') +
      '<span class="mock-spacer"></span>' +
      '<button class="btn" id="pr-theme" type="button">สลับธีม</button>';
    document.body.prepend(bar);

    document.getElementById('pr-theme').addEventListener('click', () => {
      const root = document.documentElement;
      const light = root.getAttribute('data-theme') === 'light';
      if (light) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', 'light');
      try {
        localStorage.setItem('admin-theme', light ? 'dark' : 'light');
      } catch (_) {
        /* ไม่เป็นไร — ธีมยังสลับได้ในหน้านี้ แค่ไม่จำข้ามหน้า */
      }
    });
  },

  baht(n) {
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  },

  // ── สมุดราคาที่หน้าจอกำลังใช้ ────────────────────────────────────────────
  //
  // ของจริงจะเก็บกฎที่แก้แล้วไว้ในฐานข้อมูล แต่ตัวอย่างนี้ไม่มีหลังบ้าน จึงเก็บไว้ใน
  // localStorage ของเครื่องที่เปิด — **แปลว่าของที่แก้ไม่ข้ามเครื่องและไม่ข้ามเบราว์เซอร์**
  // ซึ่งตรงกับข้อจำกัดที่ต้องพูดตอนพรีเซนต์อยู่แล้ว: นี่คือตัวอย่าง ไม่ใช่ระบบ
  EDIT_KEY: 'pr-book-edits',

  book() {
    try {
      const saved = localStorage.getItem(this.EDIT_KEY);
      if (saved) return JSON.parse(saved);
    } catch (_) {
      /* โหมดส่วนตัว / ข้อมูลเสีย — ใช้สมุดราคาต้นฉบับ ดีกว่าหน้าจอพัง */
    }
    return window.PR_BOOK;
  },

  isEdited() {
    try {
      return !!localStorage.getItem(this.EDIT_KEY);
    } catch (_) {
      return false;
    }
  },

  saveBook(book) {
    try {
      localStorage.setItem(this.EDIT_KEY, JSON.stringify(book));
      return true;
    } catch (_) {
      return false;
    }
  },

  clearBook() {
    try {
      localStorage.removeItem(this.EDIT_KEY);
    } catch (_) {
      /* ไม่มีอะไรให้ลบ */
    }
  },

  /** แถบเตือนบนหน้าอื่น ๆ ว่ากำลังคิดราคาด้วยกฎที่แก้ไว้ ไม่ใช่กฎจากไฟล์ราคา */
  editedBanner(book) {
    if (!book || !book.edited) return null;
    const b = this.el('div', 'banner amber');
    b.innerHTML =
      '<span>กำลังใช้ <b>กฎที่แก้ไว้ในเครื่องนี้</b> ไม่ใช่กฎจากไฟล์ราคาต้นฉบับ' +
      (book.edited.note ? ' · ' + book.edited.note : '') +
      ' · <a href="pr-rules.html" style="color:inherit;text-decoration:underline">ดู/คืนค่าเดิม</a></span>';
    return b;
  },

  /** ยิงไฟล์ให้ผู้ใช้ดาวน์โหลด — ไม่ผ่าน server ไฟล์ถูกปั้นในเบราว์เซอร์ทั้งก้อน */
  download(bytes, filename) {
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // ปล่อยช้าหน่อย — Safari ยกเลิกการดาวน์โหลดถ้า revoke ทันที
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  },

  today() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  },

  el(tag, cls, txt) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  },

  /** ชื่อไทยของแกน/ขนาด/ตัวเลือก — ไม่เจอในพจนานุกรมให้คืนชื่อดิบ ดีกว่าขึ้นค่าว่าง */
  axis(k) {
    return (window.PR_LABELS.axes[k] || {}).label || k;
  },
  dim(k) {
    return (window.PR_LABELS.dims[k] || window.PR_LABELS.derived[k] || {}).label || k;
  },
  unit(k) {
    return (window.PR_LABELS.dims[k] || window.PR_LABELS.derived[k] || {}).unit || '';
  },
  opt(k) {
    return window.PR_LABELS.options[k] || k;
  },

  /**
   * แปลบรรทัด "ที่มา" ที่ engine คืนมา ให้เป็นคำไทย
   *
   * engine เขียนบรรทัดนั้นด้วยชื่อคอลัมน์ในชีต (`area_in2 439 × 25`) ซึ่งถูกสำหรับคนที่เปิดชีต
   * แต่แอดมินที่ไม่เคยเปิดอ่านไม่ออก — แปลตอนแสดงผล **ไม่ใช่แก้ใน engine**
   * เพราะ engine ต้องคืนชื่อที่ตามกลับไปหาเซลล์ต้นทางได้ เวลามีคนเถียงกันว่าราคามาจากไหน
   */
  humanDetail(text) {
    if (!text) return text;
    const L = window.PR_LABELS;
    const dict = { ...L.axes, ...L.dims, ...L.derived };
    // ยาวก่อนสั้น ไม่งั้น "L1" จะไปกิน "L_total" ไม่ลง และ "D" จะไปกินตัว D ในคำอื่น
    const keys = Object.keys(dict).sort((a, b) => b.length - a.length);
    let out = text;
    for (const k of keys) {
      const re = new RegExp('(^|[\\s(·])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[\\s=:]|$)', 'g');
      out = out.replace(re, (_, pre) => pre + dict[k].label);
    }
    return out;
  },

  // ── ตารางรหัสย่อย: ของที่หน้า "ลองคิดราคา" กับ "แก้กฎราคา" ใช้ร่วมกัน ──────
  //
  // อยู่ในไฟล์ร่วมเพราะ **ฟอร์มเดียวกันต้องอยู่สองที่**: ตรงจุดที่เจอปัญหา (ข้างรหัสย่อย
  // ที่อ่านไม่ออกบนหน้าคิดราคา) และในหน้าตั้งค่าสำหรับคนที่ตั้งใจมานั่งไล่เก็บ
  // ถ้าเขียนสองชุด วันหนึ่งสองที่จะรับค่าไม่เหมือนกัน แล้วราคาจะต่างกันตามที่ที่กรอก

  /** คำไทยของ "ผลกับราคา" มาจาก sheet.ts ที่เดียว — ห้ามพิมพ์ซ้ำที่นี่ ไม่งั้นไฟล์ .xlsx จะอ่านกลับไม่ตรง */
  subEffects() {
    const TH = window.PR_ENGINE.VOCAB.EFFECT_TH;
    const HINT = {
      none: 'อ่านออก บันทึกไว้ แต่ไม่คิดเงิน — เช่น หมายเลขแบบ หรือแรงดันไฟ',
      flat: 'บวกจำนวนเงินตายตัว ไม่ขึ้นกับขนาด',
      percent: 'คิดจากยอดสะสม ณ ลำดับนั้น ⇒ ลำดับมีผลกับเงิน',
      perUnit: 'เช่น ยาวเกินที่รวมในราคาตั้ง คิดเป็นช่วง ๆ เศษปัดขึ้น',
      basePrice: 'ทิ้งราคาจากตารางไปเลย แล้วใช้ราคานี้แทน',
      setAxis: 'เซ็ตค่าให้ช่องหนึ่ง แล้วปล่อยให้ตารางราคาเดิมคิดต่อ'
    };
    return ['none', 'flat', 'percent', 'perUnit', 'basePrice', 'setAxis'].map((v) => ({ v, t: TH[v], hint: HINT[v] }));
  },

  /** ข้อความสั้น ๆ ว่าแถวนี้ทำอะไรกับเงิน — ใช้ทั้งในตารางและในรายการ */
  subEffectText(sc) {
    const TH = window.PR_ENGINE.VOCAB.EFFECT_TH;
    const n = (x) => this.baht(x || 0);
    if (sc.effect === 'flat') return TH.flat + ' ' + n(sc.amount) + ' บาท';
    if (sc.effect === 'basePrice') return TH.basePrice + ' ' + n(sc.amount) + ' บาท';
    if (sc.effect === 'percent') return TH.percent + ' ' + (sc.percent || 0) + '%';
    if (sc.effect === 'perUnit') {
      return TH.perUnit + ' — ' + this.dim(sc.dim) + ' เกิน ' + n(sc.over) + ' ทีละ ' + n(sc.step) + ' ช่วงละ ' + n(sc.rate) + ' บาท';
    }
    if (sc.effect === 'setAxis') return TH.setAxis + ' ' + this.axis(sc.axis) + ' = ' + (sc.value || '—');
    return TH.none;
  },

  /** ขอบเขตในรูปคำพูด */
  subScopeText(scope) {
    if (!scope || scope === '*') return 'ทุกรุ่น';
    if (scope.slice(-1) === '*') return 'ทั้งตระกูล ' + scope.slice(0, -1);
    return 'เฉพาะรุ่น ' + scope;
  },

  /** ตระกูลของรหัสรุ่น — BH-01C → BH-01 · TSK-04 → TSK-04 (ตัดเลขท้ายไม่ได้ ใช้ทั้งก้อน) */
  subFamily(code) {
    const m = String(code || '').match(/^([A-Z]+-\d+)/i);
    return m ? m[1] : code;
  },

  /** สไตล์ของกล่อง — ฉีดครั้งเดียว ใช้โทเคนสีจาก _theme.css เหมือนทั้งชุด */
  subStyle() {
    if (document.getElementById('pr-sub-style')) return;
    const s = document.createElement('style');
    s.id = 'pr-sub-style';
    s.textContent = [
      '.pr-mask{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:flex-start;',
      'justify-content:center;padding:24px 16px;overflow:auto;z-index:90}',
      '.pr-modal{width:100%;max-width:560px;background:var(--c-surface);border:1px solid var(--c-line-strong);',
      'border-radius:14px;padding:16px 16px 14px;box-shadow:0 18px 50px rgba(0,0,0,.4)}',
      '.pr-modal h3{margin:0 0 2px;font-size:15px;font-weight:800;color:var(--c-text-max)}',
      '.pr-modal .why{font-size:11.5px;color:var(--c-text-faint);line-height:1.6;margin:0 0 12px}',
      '.pr-modal .fld{display:flex;flex-direction:column;gap:4px;margin-bottom:10px;min-width:0}',
      '.pr-modal .fld>label{font-size:11.5px;font-weight:700;color:var(--c-text-soft)}',
      '.pr-modal .fld .hint{font-size:10.5px;color:var(--c-text-faint);line-height:1.5}',
      '.pr-modal .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}',
      '.pr-modal .chk{display:flex;align-items:flex-start;gap:7px;font-size:12px;color:var(--c-text-soft);',
      'cursor:pointer;line-height:1.5}',
      '.pr-modal .chk input{margin-top:3px;accent-color:var(--brand);flex:none}',
      '.pr-modal .acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}',
      '.pr-modal .acts .btn{flex:1 1 130px;justify-content:center;height:36px}',
      '.pr-modal .btn.go{border-color:var(--brand-border);color:var(--brand-fg);background:var(--brand-soft);font-weight:700}',
      '.pr-modal .prev{margin-top:10px;font-size:12px;color:var(--c-text-muted);line-height:1.6;',
      'border-top:1px dashed var(--c-line);padding-top:10px}',
      '.pr-modal .prev b{color:var(--brand-fg)}',
      '.pr-modal .bad{color:var(--red-700)}',
      '.subrow{display:grid;grid-template-columns:auto 1fr auto;gap:2px 10px;align-items:start;',
      'padding:8px 0;border-bottom:1px dashed var(--c-surface-3)}',
      '.subrow.off{opacity:.5}',
      '.subrow .tk{font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;font-size:12.5px;',
      'font-weight:700;color:var(--c-text-max);white-space:nowrap}',
      '.subrow .mid{min-width:0;font-size:12px;color:var(--c-text-strong);overflow-wrap:anywhere}',
      '.subrow .mid .sub2{display:block;font-size:10.5px;color:var(--c-text-faint);line-height:1.55}',
      '.subrow .acts{display:flex;gap:4px;flex:none}',
      '.subrow .acts .btn{padding:3px 7px;font-size:10.5px}',
      '.subadd{display:flex;flex-wrap:wrap;gap:6px}',
      '.subadd .btn{padding:4px 9px;font-size:11.5px;font-family:ui-monospace,Consolas,monospace}',
      '.subadd .btn .n{font-family:inherit;color:var(--c-text-faint);margin-left:5px;font-size:10.5px}'
    ].join('');
    document.head.appendChild(s);
  },

  /**
   * กล่องกรอกรหัสย่อยหนึ่งตัว
   *
   * o = { token, modelCode, book, existing, preview, onSave }
   *   preview(sc)  คืนข้อความว่า "ถ้าบันทึกแล้วราคาจะเป็นเท่าไหร่" — ไม่ส่งมาก็ไม่ต้องโชว์
   *   onSave(sc)   ผู้เรียกเป็นคนเก็บลงสมุดราคาเอง เพราะสองหน้าเก็บคนละที่ (หน้าแก้กฎมีสำเนาของตัวเอง)
   */
  subcodeBox(o) {
    this.subStyle();
    const el = this.el;
    const token = String(o.token || '').replace(/[()]/g, '').toUpperCase();
    const model = window.PR_ENGINE.resolveModel(o.book, o.modelCode);
    const draft = Object.assign(
      { subCode: token, match: 'exact', scope: o.modelCode, reads: '', effect: 'none', order: 50 },
      o.existing || {}
    );

    const mask = el('div', 'pr-mask');
    mask.id = 'pr-sub-mask';
    const box = el('div', 'pr-modal');
    mask.appendChild(box);

    box.appendChild(el('h3', null, (o.existing ? 'แก้รหัสย่อย ' : 'เพิ่มรหัสย่อย ') + '“' + draft.subCode + '”'));
    box.appendChild(el('p', 'why',
      'ไฟล์ราคาไม่ได้เขียนไว้ว่าตัวอักษรท่อนนี้แปลว่าอะไร — บอกระบบตรงนี้ครั้งเดียว ' +
      'แล้วรหัสทุกตัวที่มีท่อนนี้จะคิดราคาเหมือนกันหมด'));

    function fld(label, control, hint) {
      const f = el('div', 'fld');
      f.appendChild(el('label', null, label));
      f.appendChild(control);
      if (hint) f.appendChild(el('div', 'hint', hint));
      return f;
    }
    function input(type, value, onInput) {
      const i = document.createElement('input');
      i.className = 'cell';
      i.type = type;
      if (type === 'number') i.step = 'any';
      i.value = value === undefined || value === null ? '' : value;
      i.addEventListener('input', () => onInput(type === 'number' ? (i.value === '' ? undefined : Number(i.value)) : i.value));
      return i;
    }
    function select(opts, value, onChange) {
      const s = document.createElement('select');
      s.className = 'cell';
      opts.forEach((x) => {
        const op = new Option(x.t, x.v);
        if (x.v === value) op.selected = true;
        s.appendChild(op);
      });
      s.addEventListener('change', () => onChange(s.value));
      return s;
    }

    // อ่านว่าอะไร — บังคับกรอก เพราะข้อความนี้คือสิ่งที่คนออกใบคนถัดไปจะเห็น
    const readsIn = input('text', draft.reads, (v) => { draft.reads = v; refresh(); });
    readsIn.id = 'sub-reads';
    readsIn.placeholder = 'เช่น หัวกระโหลก Blacklite ใหญ่';
    box.appendChild(fld('รหัสย่อยนี้อ่านว่าอะไร', readsIn, 'เขียนให้คนที่ไม่เคยเห็นรหัสนี้อ่านแล้วเข้าใจ'));

    const effectSel = select(this.subEffects().map((e) => ({ v: e.v, t: e.t })), draft.effect, (v) => {
      draft.effect = v;
      drawValue();
      refresh();
    });
    effectSel.id = 'sub-effect';
    const effectHint = el('div', 'hint', '');
    const effectFld = el('div', 'fld');
    effectFld.appendChild(el('label', null, 'ทำอะไรกับราคา'));
    effectFld.appendChild(effectSel);
    effectFld.appendChild(effectHint);
    box.appendChild(effectFld);

    const valueHost = el('div');
    box.appendChild(valueHost);

    const U = this;
    function drawValue() {
      const e = U.subEffects().find((x) => x.v === draft.effect);
      effectHint.textContent = e ? e.hint : '';
      valueHost.replaceChildren();
      const grid = el('div', 'grid');

      if (draft.effect === 'flat' || draft.effect === 'basePrice') {
        if (draft.amount === undefined) draft.amount = 0;
        const amt = input('number', draft.amount, (v) => { draft.amount = v === undefined ? 0 : v; refresh(); });
        amt.id = 'sub-amount';
        grid.appendChild(fld(draft.effect === 'flat' ? 'บวกเพิ่มกี่บาท' : 'ราคาตั้งต้นกี่บาท', amt));
      } else if (draft.effect === 'percent') {
        if (draft.percent === undefined) draft.percent = 10;
        const pc = input('number', draft.percent, (v) => { draft.percent = v === undefined ? 0 : v; refresh(); });
        pc.id = 'sub-percent';
        grid.appendChild(fld('กี่เปอร์เซ็นต์', pc, 'ใส่เลขติดลบ = ส่วนลด'));
      } else if (draft.effect === 'perUnit') {
        const dims = model ? Object.keys(model.standard) : [];
        if (!draft.dim) draft.dim = dims[0] || '';
        if (draft.over === undefined && model) draft.over = model.standard[draft.dim];
        if (draft.step === undefined) draft.step = 100;
        if (draft.rate === undefined) draft.rate = 50;
        grid.appendChild(fld('คิดจากขนาดไหน',
          select(dims.map((d) => ({ v: d, t: U.dim(d) })), draft.dim, (v) => {
            draft.dim = v;
            draft.over = model ? model.standard[v] : 0;
            draft.unit = U.unit(v);
            drawValue();
            refresh();
          })));
        grid.appendChild(fld('เกินกว่า', input('number', draft.over, (v) => { draft.over = v; refresh(); }), U.unit(draft.dim)));
        grid.appendChild(fld('คิดทีละ', input('number', draft.step, (v) => { draft.step = v === undefined ? 1 : v; refresh(); }), 'เศษปัดขึ้น'));
        grid.appendChild(fld('ช่วงละกี่บาท', input('number', draft.rate, (v) => { draft.rate = v === undefined ? 0 : v; refresh(); })));
        draft.unit = U.unit(draft.dim);
        draft.round = 'ceil';
      } else if (draft.effect === 'setAxis') {
        const axes = model && model.base.kind === 'matrix' ? model.base.axes.slice() : [];
        (model ? model.adders : []).forEach((a) => { if (a.byAxis && axes.indexOf(a.byAxis) < 0) axes.push(a.byAxis); });
        if (!draft.axis) draft.axis = axes[0] || '';
        const values = model ? window.PR_ENGINE.axisValues(model, draft.axis) : [];
        grid.appendChild(fld('เซ็ตช่องไหน',
          select(axes.map((a) => ({ v: a, t: U.axis(a) })), draft.axis, (v) => {
            draft.axis = v;
            draft.value = '';
            drawValue();
            refresh();
          })));
        if (values.length) {
          if (!draft.value) draft.value = values[0];
          grid.appendChild(fld('เป็นค่าอะไร', select(values.map((v) => ({ v: v, t: v })), draft.value, (v) => {
            draft.value = v;
            refresh();
          })));
        } else {
          grid.appendChild(fld('เป็นค่าอะไร', input('text', draft.value, (v) => { draft.value = v; refresh(); }),
            'พิมพ์ให้ตรงกับค่าที่ตารางราคาใช้'));
        }
      }

      if (grid.children.length) valueHost.appendChild(grid);
    }

    // ใช้กับรุ่นไหน — ค่าเริ่มต้นคือ "รุ่นนี้" เสมอ เพราะคำเดียวกันข้ามรุ่นราคาไม่เท่ากันจริง
    const fam = this.subFamily(o.modelCode) + '*';
    const scopeOpts = [
      { v: o.modelCode, t: 'เฉพาะรุ่น ' + o.modelCode },
      { v: fam, t: 'ทั้งตระกูล ' + this.subFamily(o.modelCode) },
      { v: '*', t: 'ทุกรุ่นในสมุดราคา' }
    ];
    const scopeSel = select(scopeOpts, draft.scope, (v) => { draft.scope = v; refresh(); });
    scopeSel.id = 'sub-scope';
    box.appendChild(fld('ใช้กับรุ่นไหน', scopeSel,
      'เริ่มจากรุ่นเดียวก่อนปลอดภัยที่สุด — ของจริงมีคำเดียวกันที่คนละรุ่นคิดคนละราคา'));

    // แม่แบบ — เสนอให้เฉพาะตอนที่รหัสย่อยมีตัวเลขอยู่ข้างใน
    if (/\d/.test(token)) {
      const pat = token.replace(/\d/g, '#');
      const lab = el('label', 'chk');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = draft.match === 'pattern';
      cb.addEventListener('change', () => {
        draft.match = cb.checked ? 'pattern' : 'exact';
        draft.subCode = cb.checked ? pat : token;
        refresh();
      });
      lab.appendChild(cb);
      lab.appendChild(el('span', null, 'ใช้กับตัวที่เลขต่างกันด้วย (แม่แบบ ' + pat + ' — จับได้ทุกเลข)'));
      box.appendChild(lab);
      if (draft.match === 'pattern') draft.subCode = pat;
    }

    const prev = el('div', 'prev');
    box.appendChild(prev);

    const acts = el('div', 'acts');
    const save = el('button', 'btn go', 'บันทึก');
    save.type = 'button';
    save.id = 'sub-save';
    const cancel = el('button', 'btn', 'ยกเลิก');
    cancel.type = 'button';
    acts.appendChild(save);
    acts.appendChild(cancel);
    box.appendChild(acts);

    function clean() {
      const sc = { subCode: draft.subCode, match: draft.match, scope: draft.scope,
                   reads: (draft.reads || '').trim(), effect: draft.effect, order: draft.order || 50 };
      if (draft.effect === 'flat' || draft.effect === 'basePrice') sc.amount = draft.amount || 0;
      if (draft.effect === 'percent') sc.percent = draft.percent || 0;
      if (draft.effect === 'perUnit') {
        sc.dim = draft.dim; sc.over = draft.over; sc.step = draft.step || 1;
        sc.rate = draft.rate || 0; sc.round = 'ceil';
        if (draft.unit) sc.unit = draft.unit;
      }
      if (draft.effect === 'setAxis') { sc.axis = draft.axis; sc.value = draft.value || ''; }
      // ไม่มี "ที่มาในไฟล์ราคา" = คนตั้งค่าเอง ⇒ ไฟล์ราคารอบใหม่ต้องไม่ทับทิ้ง
      sc.custom = true;
      sc.by = 'แอดมิน (ตัวอย่าง)';
      sc.at = U.today();
      return sc;
    }

    function refresh() {
      const ok = (draft.reads || '').trim() !== '';
      save.disabled = !ok;
      prev.replaceChildren();
      if (!ok) {
        prev.appendChild(el('span', 'bad', 'ต้องเขียนก่อนว่ารหัสย่อยนี้อ่านว่าอะไร'));
        return;
      }
      if (!o.preview) return;
      const text = o.preview(clean());
      if (text) prev.innerHTML = text;
    }

    function close() {
      document.removeEventListener('keydown', onKey);
      mask.remove();
    }
    function onKey(e) {
      if (e.key === 'Escape') close();
    }
    cancel.addEventListener('click', close);
    mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
    document.addEventListener('keydown', onKey);
    save.addEventListener('click', () => {
      if ((draft.reads || '').trim() === '') return;
      close();
      o.onSave(clean());
    });

    drawValue();
    refresh();
    document.body.appendChild(mask);
    readsIn.focus();
    return mask;
  }
};
