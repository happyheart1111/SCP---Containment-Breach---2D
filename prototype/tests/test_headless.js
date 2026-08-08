// headless 逻辑测试: AI系统 + 玩家 + 任务系统
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const files = ['config.js','vector2.js','fsm.js','pathfinding.js','mapsystem.js','perception.js','npc.js','npcfactory.js','aisystem.js','combatsystem.js','player.js','missions.js'];
const sandbox = { console, Math, Date, window: {}, document: undefined };
vm.createContext(sandbox);

for (const f of files) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
  vm.runInContext(code, sandbox, { filename: f });
}

// 补充测试辅助: 让 mockGame 也能在沙箱内被引用
vm.runInContext('globalThis.__test = {}', sandbox);

const gameEvents = [];
const mockGame = {
  logEvent: (t, ty) => gameEvents.push('[' + ty + '] ' + t),
  onNPCDeath: () => {},
  onPlayerKill: () => {},
  onPlayerDeath: () => {},
  onPlayerRecruited: () => {},
  onStageAdvance: () => {},
  onMissionEnd: () => {},
  onSCPContained: () => {},
  get player() { return sandbox.testPlayer; },
};

// 从沙箱求值获取引用 (const/class 不挂到 sandbox 对象上)
const get = (name) => vm.runInContext(name, sandbox);
const CONFIG = get('CONFIG');
const MapGenerator = get('MapGenerator');
const AISystem = get('AISystem');
const PerceptionSystem = get('PerceptionSystem');
const CombatSystem = get('CombatSystem');
const Player = get('Player');
const MissionSystem = get('MissionSystem');
const Vec2 = get('Vec2');

// 1. 地图生成
const map = MapGenerator.generate();
console.log('地图生成: OK', map.cols + 'x' + map.rows + ' 房间=' + map.rooms.length + ' 出口=' + !!map.exitPoints['SZ'] + ' 出生点=' + Object.keys(map.spawnPoints).join(','));

// 2. AI 初始化
const perception = new PerceptionSystem(map);
const combat = new CombatSystem();
const ai = new AISystem(map, combat, perception);
ai.initialize();
console.log('AI初始化: OK', '实体数=' + ai.entities.length);

// 3. 模拟运行 60 秒 (AI 自主交战)
for (let i = 0; i < 3600; i++) {
  ai.update(1/60, mockGame);
}
console.log('AI模拟60秒: OK', '存活=' + ai.getAliveNPCs().length + ' 事件=' + gameEvents.length);

// 4. 玩家创建 (六个角色各测)
const ROLE_ZONES = { dclass: 'LCZ', scientist: 'LCZ', mtf: 'SZ', goc: 'SZ', ci: 'SZ', scp173: 'HCZ' };
const roles = ['dclass', 'scientist', 'mtf', 'goc', 'ci', 'scp173'];
for (const role of roles) {
  const map2 = MapGenerator.generate();
  const p2 = new PerceptionSystem(map2);
  const c2 = new CombatSystem();
  const a2 = new AISystem(map2, c2, p2);
  a2.initialize();
  const zone = ROLE_ZONES[role];
  const tile = map2.getRandomWalkableTile(zone);
  const player = new Player(role, new Vec2(tile.col * CONFIG.TILE_SIZE + 14, tile.row * CONFIG.TILE_SIZE + 14));
  player.input = { keys: { KeyW: false, KeyS: false, KeyA: false, KeyD: false }, mouseDown: false };
  sandbox.testPlayer = player;
  a2.entities.push(player);
  const missions = new MissionSystem(mockGame);
  missions.start(role);

  const ctx2 = {
    map: map2, allEntities: a2.entities, perception: p2, combat: c2,
    gameTime: 0, game: mockGame, player,
  };
  for (let i = 0; i < 1800; i++) {
    ctx2.gameTime = i / 60;
    a2.update(1/60, mockGame);
    player.update(1/60, ctx2);
    missions.update(1/60, ctx2);
  }
  console.log('玩家[' + role + ']模拟30秒: OK hp=' + player.hp.toFixed(0) + ' 死亡=' + player.dead + ' 任务阶段=' + missions.stage);
}

console.log('全部逻辑测试通过');
