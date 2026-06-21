import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 渲染进程用 Vite 构建,base 用相对路径,Electron 加载本地文件
export default defineConfig({
  plugins: [vue()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist-renderer',
    emptyOutDir: true,
  },
});
