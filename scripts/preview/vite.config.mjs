// Vite ของพรีวิวร่วม (docker-compose.preview.yml · docs/dev-preview.md)
//
// ต่างจาก frontend/vite.config.ts แค่สามข้อ — ที่เหลือ (พอร์ต 5180 · strictPort · plugin) เอามาทั้งก้อน
//  1. proxy ไปที่กล่อง api ของพรีวิว (PREVIEW_API) ไม่ใช่ localhost:3011 ของตัวจริง
//  2. cacheDir อยู่ใน /tmp ของกล่อง — รีโปเมานต์อ่านอย่างเดียว
//  3. backend รีสตาร์ตเสร็จ (tsx watch) ⇒ สั่งหน้าเว็บรีโหลดเอง: ถาม /__preview/boot ทุกวินาที
//     รหัสเปลี่ยน = โปรเซสใหม่ขึ้นแล้วและพร้อมตอบ · ไม่ได้เดาจากเวลาไฟล์เปลี่ยน เพราะตอนไฟล์
//     เปลี่ยน backend ตัวเก่ายังตอบอยู่ รีโหลดตอนนั้นจะได้ของเก่าหรือเจอช่วงที่มันกำลังปิด
import base from '../../frontend/vite.config.ts'

const target = process.env.PREVIEW_API || 'http://localhost:3011'

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
  cacheDir: '/tmp/vite-cache',
  plugins: [...(base.plugins || []), reloadOnBackendRestart()],
  server: {
    ...base.server,
    proxy: Object.fromEntries(
      Object.entries(base.server.proxy).map(([k, v]) => [k, { ...v, target }]),
    ),
  },
}
