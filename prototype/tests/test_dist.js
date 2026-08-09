// 压缩版冒烟测试: 验证 dist 产物可运行
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('C:/Users/admin/.workbuddy/binaries/node/workspace/node_modules/jsdom');

const DIST = path.join(__dirname, '..', 'dist');
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost:8080/' });
const { window } = dom;
const mockCtx = new Proxy({}, {
  get: (t, p) => {
    if (p === 'canvas') return { width: 800, height: 600 };
    if (p === 'measureText') return () => ({ width: 10 });
    return () => {};
  },
  set: () => true,
});
window.HTMLCanvasElement.prototype.getContext = () => mockCtx;

const code = fs.readFileSync(path.join(DIST, 'scp-cb-1.0.0.min.js'), 'utf8');
const testCode = code + `
;(function() {
  try {
    const game = new Game();
    game.startGame('dclass');
    for (let i = 0; i < 60; i++) game._loop(1000 + i * 16.7);
    console.log('压缩版测试: 构造OK 地图=' + Object.keys(game.world.levels).length + ' 传送点=' + game.world.portals.length + ' 物品=' + game.items.items.length + ' 循环60帧OK');
    game.startGame('scp173');
    console.log('压缩版角色切换: scp173 OK level=' + game.player.levelId);
  } catch (e) {
    console.log('压缩版测试 FAIL: ' + e.message);
    console.log((e.stack || '').split('\\n').slice(0, 6).join(' | '));
  }
})();
`;
window.eval(testCode);
