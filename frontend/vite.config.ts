import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  server: {
    // พอร์ตของ dev server ตายตัวที่ 5180 — ค่าเริ่มต้นของ Vite คือ 5173 แล้ว "ขยับหนีเอง"
    // เมื่อพอร์ตไม่ว่าง (5174 มี server ของ mockup นั่งอยู่ประจำ) ⇒ ลิงก์ที่ส่งให้เจ้าของดู
    // เปลี่ยนไปเรื่อยทุกครั้งที่เปิดใหม่ · strictPort = ชนแล้วให้ตายเสียงดัง ไม่ใช่ย้ายพอร์ตเงียบ ๆ
    // แล้วปล่อยให้เปิดลิงก์เดิมไปเจอของเก่าที่ยังค้างอยู่
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3011',
        changeOrigin: true
      },
      '/data': {
        target: 'http://localhost:3011',
        changeOrigin: true
      },
      '/download-pdf': {
        target: 'http://localhost:3011',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: resolve(__dirname, '../public'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html')
      }
    }
  }
})
