import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // ไอคอนของการกระทำใช้รูปเดียวทั้งแอป (docs/design.md หัวข้อ 2.1 · เจ้าของสั่ง 2026-10-02)
      'no-restricted-imports': ['error', {
        paths: [{
          name: 'lucide-react',
          importNames: [
            'Edit', 'Edit2', 'Edit3', 'SquarePen', 'PenSquare', 'PenLine', 'Pen', 'PencilLine',
            'FileDown', 'DownloadCloud', 'CloudDownload', 'ArrowDownToLine',
            'Trash', 'PlusCircle', 'CirclePlus', 'PlusSquare', 'SquarePlus', 'MessageSquarePlus',
          ],
          message: 'ใช้ไอคอนชุดกลาง: ส่งออก=Download · เพิ่ม=Plus · แก้ไข=Pencil · ลบ=Trash2 (docs/design.md 2.1)',
        }],
      }],
    },
  },
])
