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
  }
};
