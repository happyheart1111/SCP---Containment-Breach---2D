// jsdom 测试 v3: 所有代码+测试逻辑同一个 eval 作用域执行
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('C:/Users/admin/.workbuddy/binaries/node/workspace/node_modules/jsdom');

const PROTOTYPE = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(PROTOTYPE, 'index.html'), 'utf8');

const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'http://localhost:8080/',
});
const { window } = dom;

// mock canvas
const mockCtx = new Proxy({}, {
  get: (t, p) => {
    if (p === 'canvas') return { width: 800, height: 600 };
    if (p === 'measureText') return () => ({ width: 10 });
    return () => {};
  },
  set: () => true,
});
window.HTMLCanvasElement.prototype.getContext = () => mockCtx;

const scripts = [
  'config.js','vector2.js','fsm.js','pathfinding.js','mapsystem.js','facilities.js',
  'perception.js','npc.js','npcfactory.js','aisystem.js','combatsystem.js',
  'player.js','missions.js','renderer.js','game.js'
];
let allCode = '';
for (const s of scripts) {
  allCode += fs.readFileSync(path.join(PROTOTYPE, 'js', s), 'utf8') + '\n';
}

// 测试逻辑 (同一个 eval 作用域, 可访问 class)
allCode += `
;(function() {
  const results = [];
  const log = (msg) => results.push(msg);

  try {
    const game = new Game();
    log('Game 构造: OK');

    // 测试六个角色 startGame
    for (const role of ['dclass', 'scientist', 'mtf', 'goc', 'ci', 'scp173']) {
      try {
        game.startGame(role);
        const p = game.player;
        log('startGame(' + role + '): OK state=' + game.state + ' player=' + (p ? p.role : 'null') + ' hp=' + (p ? p.hp : '-'));
        game.state = 'menu'; // 回到菜单
      } catch (e) {
        log('startGame(' + role + ') 抛错: ' + e.message);
        log(e.stack.split('\\n').slice(0, 6).join(' | '));
      }
    }

    // 模拟六个按钮点击 (验证 onclick 绑定)
    try {
      const btnMap = { dclass: 'btn-role-dclass', scientist: 'btn-role-scientist', mtf: 'btn-role-mtf', goc: 'btn-role-goc', ci: 'btn-role-ci', scp173: 'btn-role-scp173' };
      for (const [role, btnId] of Object.entries(btnMap)) {
        game.state = 'menu';
        document.getElementById(btnId).click();
        log('按钮点击 ' + btnId + ': OK state=' + game.state + ' role=' + (game.player ? game.player.role : 'null'));
      }
    } catch (e) {
      log('按钮点击抛错: ' + e.message);
      log(e.stack.split('\\n').slice(0, 6).join(' | '));
    }

    // 跑 60 帧验证循环不死
    try {
      let frames = 0;
      for (let i = 0; i < 60; i++) {
        game._loop(1000 + i * 16.7);
        if (game.state === 'playing') frames++;
      }
      log('循环 60 帧: OK playing帧=' + frames);
    } catch (e) {
      log('循环抛错: ' + e.message);
      log(e.stack.split('\\n').slice(0, 6).join(' | '));
    }

    console.log('RESULT_START');
    results.forEach(r => console.log('  ' + r));
    console.log('RESULT_END');
  } catch (e) {
    console.log('主流程抛错: ' + e.message);
    console.log(e.stack.split('\\n').slice(0, 10).join('\\n'));
  }
})();
`;

try {
  window.eval(allCode);
} catch (e) {
  console.log('eval 失败:', e.message);
  console.log(e.stack.split('\n').slice(0, 10).join('\n'));
}
