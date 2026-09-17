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
      { href: 'pr-calc.html', text: 'ลองคิดราคา', key: 'calc' }
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
