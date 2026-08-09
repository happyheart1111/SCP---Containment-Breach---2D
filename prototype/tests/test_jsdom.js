// jsdom 测试 v1.0.0: 多地图架构 + 所有角色 + 物品系统
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
  'config.js','vector2.js','fsm.js','pathfinding.js','mapsystem.js','facilities.js','world.js',
  'perception.js','npc.js','npcfactory.js','aisystem.js','combatsystem.js',
  'itemsystem.js','player.js','missions.js','renderer.js','game.js'
];
let allCode = '';
for (const s of scripts) {
  allCode += fs.readFileSync(path.join(PROTOTYPE, 'js', s), 'utf8') + '\n';
}

allCode += `
;(function() {
  const results = [];
  const log = (msg) => results.push(msg);

  try {
    const game = new Game();
    log('Game 构造: OK');
    log('地图数量: ' + Object.keys(game.world.levels).length + ' (期望4)');
    log('传送点数量: ' + game.world.portals.length + ' (期望8)');
    log('物品刷新点: ' + game.items.spawnPoints.length);
    log('当前地图: ' + game.currentMap.levelId);

    // 测试六个角色 startGame
    for (const role of ['dclass', 'scientist', 'mtf', 'goc', 'ci', 'scp173']) {
      try {
        game.startGame(role);
        const p = game.player;
        log('startGame(' + role + '): OK state=' + game.state + ' player=' + (p ? p.role : 'null') + ' hp=' + (p ? p.hp : '-') + ' level=' + (p ? p.levelId : '-'));
        game.state = 'menu';
      } catch (e) {
        log('startGame(' + role + ') 抛错: ' + e.message);
        log(e.stack.split('\\n').slice(0, 6).join(' | '));
      }
    }

    // 模拟六个按钮点击
    try {
      const btnMap = { dclass: 'btn-role-dclass', scientist: 'btn-role-scientist', mtf: 'btn-role-mtf', goc: 'btn-role-goc', ci: 'btn-role-ci', scp173: 'btn-role-scp173' };
      for (const [role, btnId] of Object.entries(btnMap)) {
        game.state = 'menu';
        document.getElementById(btnId).click();
        log('按钮点击 ' + btnId + ': OK state=' + game.state + ' role=' + (game.player ? game.player.role : 'null'));
      }
    } catch (e) {
      log('按钮点击抛错: ' + e.message);
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

    // 测试传送: 把玩家放到 LCZ 传送点旁并传送
    try {
      game.startGame('dclass');
      const lczPortals = game.world.getPortalsIn('LCZ');
      if (lczPortals.length > 0) {
        const p0 = lczPortals[0];
        game.player.pos = p0.pos.clone();
        game.player.levelId = 'LCZ';
        const ctx = game._getCtx();
        game.player.tryInteract(ctx);
        log('传送测试: 目标地图=' + game.player.levelId + ' (从LCZ)');
      } else {
        log('传送测试: LCZ无传送点 (跳过)');
      }
    } catch (e) {
      log('传送测试抛错: ' + e.message);
    }

    // 测试物品拾取 (选可入物品栏的: consumable/passive)
    try {
      game.startGame('dclass');
      const items = game.items.items;
      const pickable = items.find(it => it.def.category === 'consumable' || it.def.category === 'passive');
      if (pickable) {
        game.player.pos = pickable.pos.clone();
        game.player.levelId = pickable.levelId;
        const ctx = game._getCtx();
        game.player._tryPickupItem(ctx);
        log('物品拾取测试: 拾取=' + game.player.inventory.length + ' item=' + pickable.itemId + ' (' + pickable.def.name + ')');
      } else if (items.length > 0) {
        log('物品拾取测试: 无消耗品可拾取 (跳过, 共' + items.length + '件物品)');
      } else {
        log('物品拾取测试: 无物品生成 (跳过)');
      }
    } catch (e) {
      log('物品拾取测试抛错: ' + e.message);
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
