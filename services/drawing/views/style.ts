// ─────────────────────────────────────────────────────────────────────────────
//  หัวลูกศร + สไตล์ของภาพ 2 มิติ/กระดาษแบบ — ยกจาก `<defs>` ของ Appsale `engine/sheet.js` ที่ `4dd2475`
//  + คลาส `st*` ของป้ายบนภาพนิ่ง 3 มิติ (`snapshot()` ของตัวดู) — หน่วยเป็นพิกเซลของภาพนิ่ง 872 กว้าง ซึ่งย่อครึ่งหนึ่งลงกรอบ 436 ของกระดาษ
//  สีหมึกคงที่ (ไม่ตามธีม) เพราะพื้นของภาพ 2 มิติ/กระดาษเป็นสีขาวเสมอ ทั้งบนจอ PDF และ PNG
// ─────────────────────────────────────────────────────────────────────────────

export const SHEET_FONT = 'IBM Plex Sans Thai, Sarabun, Noto Sans Thai, Leelawadee UI, Tahoma, sans-serif';

export const SHEET_DEFS = `<defs>
    <marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#12212B"/>
    </marker>
    <style>
      .part{fill:none;stroke:#12212B;stroke-width:1.7;stroke-linejoin:round}
      .clamp{fill:#12212B;stroke:none}
      .wire{fill:none;stroke:#12212B;stroke-width:1.4}
      .thin{fill:none;stroke:#7C919E;stroke-width:.9}
      .hidden{fill:none;stroke:#9FB0BA;stroke-width:.9;stroke-dasharray:7 5}
      .center{stroke:#7C919E;stroke-width:.8;stroke-dasharray:9 3 2 3}
      .dim{stroke:#12212B;stroke-width:.9}
      .ext{stroke:#7C919E;stroke-width:.7}
      .lead{stroke:#12212B;stroke-width:.9}
      .dimtx{font-size:12.5px;fill:#12212B;font-weight:600}
      .viewtx{font-size:12.5px;fill:#3D5261}
      .zonetx{font-size:11px;fill:#3D5261}
      .h3{font-size:13px;fill:#00764A;font-weight:700}
      .lbl{font-size:12px;fill:#3D5261}
      .val{font-size:12.5px;fill:#12212B;font-weight:500}
      .tb{fill:none;stroke:#12212B;stroke-width:1.4}
      .tbhead{fill:#00764A}
      .tbtitle{font-size:12px;fill:#fff;font-weight:600}
      .tbline{stroke:#12212B;stroke-width:.8}
      .frame{fill:none;stroke:#12212B;stroke-width:1.6}
      .disc{font-size:10.5px;fill:#3D5261}
      .stdm{stroke:#12212B;stroke-width:1.2;fill:none}.stah{fill:#12212B}
      .stdt{font-size:19px;fill:#12212B;font-weight:600;paint-order:stroke;stroke:#fff;stroke-width:4px;stroke-linejoin:round}
      .stld{fill:none;stroke:#3D5261;stroke-width:1.2;stroke-linejoin:round}.stdot{fill:#3D5261}
      .stlb{font-size:19px;fill:#12212B;font-weight:600;text-anchor:middle;paint-order:stroke;stroke:#fff;stroke-width:4.4px;stroke-linejoin:round}
      .stsb{font-size:17px;fill:#3D5261;font-weight:500;text-anchor:middle;paint-order:stroke;stroke:#fff;stroke-width:4px;stroke-linejoin:round}
    </style>
  </defs>`;
