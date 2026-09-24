// Vite ของพรีวิวร่วม (scripts/preview/preview.sh · docs/dev-preview.md)
//
// ต่างจาก frontend/vite.config.ts แค่สองข้อ — ที่เหลือ (พอร์ต 5180 · strictPort · plugin) เอามาทั้งก้อน
//  1. proxy ไปที่ backend ของพรีวิว (PREVIEW_API · ตั้งต้น 127.0.0.1:3098) ไม่ใช่ 3011 ของตัวจริง
//     ซึ่งรันโค้ดของ deploy ล่าสุด ไม่ใช่ main
//  2. backend รีสตาร์ตเสร็จ (tsx watch) ⇒ สั่งหน้าเว็บรีโหลดเอง: ถาม /__preview/boot ทุกวินาที
//     รหัสเปลี่ยน = โปรเซสใหม่ขึ้นแล้วและพร้อมตอบ · ไม่ได้เดาจากเวลาไฟล์เปลี่ยน เพราะตอนไฟล์
//     เปลี่ยน backend ตัวเก่ายังตอบอยู่ รีโหลดตอนนั้นจะได้ของเก่าหรือเจอช่วงที่มันกำลังปิด
import base from '../../frontend/vite.config.ts'

const target = process.env.PREVIEW_API || 'http://127.0.0.1:3098'

function reloadOnBackendRestart() {
  return {
    name: 'preview-reload-on-backend-restart',
    configureServer(server) {
      let last = null
      const tick = async () => {
        try {
          const res = await fetch(`${target}/__preview/boot`, { signal: AbortSignal.timeout(2000) })
          if (!res.ok) return
          const id = (await res.text()).trim()
          if (last !== null && id !== last) {
            server.config.logger.info(`[preview] backend รีสตาร์ตแล้ว (${id}) — สั่งหน้าเว็บรีโหลด`, { timestamp: true })
            server.ws.send({ type: 'full-reload' })
          }
          last = id
        } catch {
          // backend กำลังรีสตาร์ต/ยังไม่ขึ้น — รอบหน้าค่อยถามใหม่
        }
      }
      const timer = setInterval(tick, 1000)
      void tick()
      server.httpServer?.on('close', () => clearInterval(timer))
    },
  }
}

export default {
  ...base,
  plugins: [...(base.plugins || []), reloadOnBackendRestart()],
  server: {
    ...base.server,
    proxy: Object.fromEntries(
      Object.entries(base.server.proxy).map(([k, v]) => [k, { ...v, target }]),
    ),
  },
}
