// 跨图行为测试 v2: 按 NPC 类型追踪跨图 (模拟 25 分钟覆盖 MTF/CI 波次)
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const files = ['config.js','vector2.js','fsm.js','pathfinding.js','mapsystem.js','facilities.js','world.js','perception.js','npc.js','npcfactory.js','aisystem.js','combatsystem.js','itemsystem.js','player.js','missions.js'];
const sandbox = { console, Math, Date, window: {}, document: undefined };
vm.createContext(sandbox);
for (const f of files) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), sandbox, { filename: f });
}

const get = (name) => vm.runInContext(name, sandbox);
const GameWorld = get('GameWorld');
const AISystem = get('AISystem');
const PerceptionSystem = get('PerceptionSystem');
const CombatSystem = get('CombatSystem');
const ItemSystem = get('ItemSystem');

const mockGame = {
  logEvent: () => {},
  onNPCDeath: () => {},
  onPlayerKill: () => {},
  onPlayerDeath: () => {},
  onPlayerRecruited: () => {},
  onStageAdvance: () => {},
  onMissionEnd: () => {},
  onSCPContained: () => {},
  onLevelChanged: () => {},
  get player() { return null; },
};

const world = new GameWorld().generate();
const perception = new PerceptionSystem();
const combat = new CombatSystem();
const ai = new AISystem(world, combat, perception);
const items = new ItemSystem(world);
world.items = items;
ai.initialize();

// 用实体 id 追踪
const track = new Map(); // id -> { type, start, end }
for (const e of ai.entities) {
  track.set(e.id, { type: e.typeId, start: e.levelId, end: e.levelId, changed: false });
}

// 模拟 25 分钟 (1500秒)
for (let i = 0; i < 90000; i++) {
  ai.update(1/60, mockGame);
  items.update(1/60);
}

// 统计 (含波次生成的新实体)
const byType = {};
for (const [id, log] of track) {
  const npc = ai.entities.find(e => e.id === id);
  if (npc) log.end = npc.levelId;
  if (log.start !== log.end) log.changed = true;
  if (!byType[log.type]) byType[log.type] = { total: 0, crossed: 0, from: [], to: [] };
  byType[log.type].total++;
  if (log.changed) {
    byType[log.type].crossed++;
    byType[log.type].from.push(log.start);
    byType[log.type].to.push(log.end);
  }
}

let totalCrossed = 0;
for (const [type, s] of Object.entries(byType)) {
  totalCrossed += s.crossed;
  console.log(`  ${type}: 跨图 ${s.crossed}/${s.total}  ${s.crossed > 0 ? '(e.g. ' + s.from[0] + '→' + s.to[0] + ')' : ''}`);
}
console.log(`跨图行为测试 v2: 共 ${totalCrossed} 个 NPC 发生跨图`);
