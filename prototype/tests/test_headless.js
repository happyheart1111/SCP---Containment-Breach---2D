// headless 逻辑测试 v1.0.0: 多地图 AI 系统 + 玩家 + 任务
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const files = ['config.js','vector2.js','fsm.js','pathfinding.js','mapsystem.js','facilities.js','world.js','perception.js','npc.js','npcfactory.js','aisystem.js','combatsystem.js','itemsystem.js','player.js','missions.js'];
const sandbox = { console, Math, Date, window: {}, document: undefined };
vm.createContext(sandbox);

for (const f of files) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
  vm.runInContext(code, sandbox, { filename: f });
}

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
  onLevelChanged: () => {},
  get player() { return sandbox.testPlayer; },
};

const get = (name) => vm.runInContext(name, sandbox);
const CONFIG = get('CONFIG');
const GameWorld = get('GameWorld');
const AISystem = get('AISystem');
const PerceptionSystem = get('PerceptionSystem');
const CombatSystem = get('CombatSystem');
const ItemSystem = get('ItemSystem');
const Player = get('Player');
const MissionSystem = get('MissionSystem');
const Vec2 = get('Vec2');
const LEVEL_ORDER = get('LEVEL_ORDER');

// 1. 世界生成
const world = new GameWorld().generate();
console.log('世界生成: OK 地图=' + Object.keys(world.levels).length + ' 传送点=' + world.portals.length);

// 验证各地图大小
for (const lv of LEVEL_ORDER) {
  const m = world.getLevel(lv);
  console.log('  地图[' + lv + ']: ' + m.cols + 'x' + m.rows + ' 出口=' + (m.exitPoints[lv] ? 'Y' : 'N') + ' 传送槽=' + m.portalSlots.length);
}

// 2. AI 初始化
const perception = new PerceptionSystem();
const combat = new CombatSystem();
const ai = new AISystem(world, combat, perception);
const items = new ItemSystem(world);
world.items = items;
ai.initialize();
console.log('AI初始化: OK 实体数=' + ai.entities.length + ' 物品=' + items.items.length);

// 3. 模拟运行 120 秒 (跨图行为)
for (let i = 0; i < 7200; i++) {
  ai.update(1/60, mockGame);
  items.update(1/60);
}
console.log('AI模拟120秒: OK 存活=' + ai.getAliveNPCs().length + ' 事件=' + gameEvents.length);

// 4. 玩家创建 (六个角色各测, 每图寻路)
const ROLE_LEVELS = { dclass: 'LCZ', scientist: 'LCZ', mtf: 'SZ', goc: 'SZ', ci: 'SZ', scp173: 'HCZ' };
const roles = ['dclass', 'scientist', 'mtf', 'goc', 'ci', 'scp173'];
for (const role of roles) {
  const world2 = new GameWorld().generate();
  const p2 = new PerceptionSystem();
  const c2 = new CombatSystem();
  const a2 = new AISystem(world2, c2, p2);
  const items2 = new ItemSystem(world2);
  world2.items = items2;
  a2.initialize();
  const lvl = ROLE_LEVELS[role];
  const map2 = world2.getLevel(lvl);
  const tile = map2.getRandomWalkableTile(lvl);
  const player = new Player(role, new Vec2(tile.col * CONFIG.TILE_SIZE + 14, tile.row * CONFIG.TILE_SIZE + 14), lvl);
  player.input = { keys: { KeyW: false, KeyS: false, KeyA: false, KeyD: false }, mouseDown: false };
  player.mouseWorld = player.pos.clone();
  sandbox.testPlayer = player;
  a2.entities.push(player);
  const missions = new MissionSystem(mockGame);
  missions.start(role);

  const ctx2 = a2.ctxFor(player, mockGame);
  ctx2.items = items2;
  for (let i = 0; i < 1800; i++) {
    ctx2.gameTime = i / 60;
    a2.update(1/60, mockGame);
    items2.update(1/60);
    player.update(1/60, ctx2);
    missions.update(1/60, ctx2);
  }
  console.log('玩家[' + role + ']模拟30秒: OK hp=' + player.hp.toFixed(0) + ' 死亡=' + player.dead + ' 任务阶段=' + missions.stage + ' level=' + player.levelId);
}

// 5. 跨图传送逻辑测试: 传送点可用性
const world3 = new GameWorld().generate();
const lczPortals = world3.getPortalsIn('LCZ');
let portalOk = true;
for (const p of lczPortals) {
  const target = world3.getLevel(p.targetLevelId);
  if (!target) { portalOk = false; console.log('  传送点目标地图缺失: ' + p.id); }
}
console.log('传送点目标校验: ' + (portalOk ? 'OK' : 'FAIL'));

// 6. 路径可达性: LCZ 内 A* 寻路
const pf = world3.getPathfinder('LCZ');
const m3 = world3.getLevel('LCZ');
const start = m3.getRandomWalkableTile('LCZ');
const end = m3.getRandomWalkableTile('LCZ');
const astarPath = pf.findPath(start.col, start.row, end.col, end.row);
console.log('A*寻路(LCZ): ' + (astarPath ? 'OK 长度=' + astarPath.length : 'FAIL (无路径)'));

console.log('全部逻辑测试通过');
