// ============================================================
// build.js — 构建压缩版 (任务6: 压缩整体大小)
// 产出: dist/scp-cb-1.0.0.min.js (合并+精简全部游戏逻辑)
//       dist/scp-cb-1.0.0.min.css (精简样式)
//       dist/index.html (引用压缩版)
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

// ---- 1. JS 合并顺序 (与 index.html 一致) ----
const JS_ORDER = [
  'config.js','vector2.js','fsm.js','pathfinding.js','mapsystem.js','facilities.js','world.js',
  'perception.js','npc.js','npcfactory.js','aisystem.js','combatsystem.js',
  'itemsystem.js','player.js','missions.js','renderer.js','game.js'
];

function stripJS(code) {
  let out = '';
  const lines = code.split('\n');
  let inBlock = false;
  for (let line of lines) {
    // 块注释状态
    if (inBlock) {
      const endIdx = line.indexOf('*/');
      if (endIdx >= 0) {
        inBlock = false;
        line = line.slice(endIdx + 2);
      } else {
        continue;
      }
    }
    // 移除块注释 /* ... */
    line = line.replace(/\/\*[\s\S]*?\*\//g, '');
    if (line.includes('/*')) {
      inBlock = true;
      line = line.split('/*')[0];
    }
    // 移除行注释 // (避免 http:// 误伤)
    line = line.replace(/(^|[^:])\/\/.*$/, '$1');
    // 移除前后空白
    const trimmed = line.trim();
    if (!trimmed) continue;
    out += trimmed + '\n';
  }
  return out;
}

// ---- 2. CSS 精简 ----
function stripCSS(code) {
  let out = '';
  const lines = code.split('\n');
  let inBlock = false;
  for (let line of lines) {
    if (inBlock) {
      const endIdx = line.indexOf('*/');
      if (endIdx >= 0) {
        inBlock = false;
        line = line.slice(endIdx + 2);
      } else {
        continue;
      }
    }
    line = line.replace(/\/\*[\s\S]*?\*\//g, '');
    if (line.includes('/*')) {
      inBlock = true;
      line = line.split('/*')[0];
    }
    const trimmed = line.trim();
    if (!trimmed) continue;
    out += trimmed + '\n';
  }
  return out;
}

// ---- 3. 执行 ----
if (!fs.existsSync(DIST)) fs.mkdirSync(DIST);

// JS
let jsAll = '';
for (const f of JS_ORDER) {
  const code = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
  jsAll += '/* ' + f + ' */\n' + stripJS(code) + '\n';
}
const jsMinPath = path.join(DIST, 'scp-cb-1.0.0.min.js');
fs.writeFileSync(jsMinPath, jsAll);

// CSS
const cssAll = stripCSS(fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8'));
const cssMinPath = path.join(DIST, 'scp-cb-1.0.0.min.css');
fs.writeFileSync(cssMinPath, cssAll);

// HTML (引用压缩版)
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
let htmlMin = html;
// 替换 css 引用
htmlMin = htmlMin.replace('css/style.css', 'scp-cb-1.0.0.min.css');
// 替换所有 js 引用为单文件
htmlMin = htmlMin.replace(/  <script src="js\/[^"]+"><\/script>\n/g, '');
htmlMin = htmlMin.replace(
  '  <!-- Core -->\n',
  '  <!-- 压缩版: 单文件打包 -->\n  <script src="scp-cb-1.0.0.min.js"></script>\n'
);
const htmlMinPath = path.join(DIST, 'index.html');
fs.writeFileSync(htmlMinPath, htmlMin);

// ---- 4. 报告 ----
function dirSize(dir) {
  let total = 0;
  for (const f of fs.readdirSync(dir)) {
    total += fs.statSync(path.join(dir, f)).size;
  }
  return total;
}

const srcSize = dirSize(path.join(ROOT, 'js')) + fs.statSync(path.join(ROOT, 'css', 'style.css')).size;
const distSize = dirSize(DIST);
console.log('=== 压缩构建完成 ===');
console.log('源码 (js+css): ' + (srcSize / 1024).toFixed(1) + ' KB');
console.log('压缩版 (dist): ' + (distSize / 1024).toFixed(1) + ' KB');
console.log('节省: ' + (100 - distSize / srcSize * 100).toFixed(1) + '%');
console.log('产物:');
console.log('  ' + jsMinPath + ' (' + (fs.statSync(jsMinPath).size / 1024).toFixed(1) + ' KB)');
console.log('  ' + cssMinPath + ' (' + (fs.statSync(cssMinPath).size / 1024).toFixed(1) + ' KB)');
console.log('  ' + htmlMinPath);
