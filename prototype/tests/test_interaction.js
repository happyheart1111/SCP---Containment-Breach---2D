// 定向交互测试: 173秒杀 / D级转职 / MTF击杀SCP
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const files = ['config.js','vector2.js','fsm.js','pathfinding.js','mapsystem.js','perception.js','npc.js','npcfactory.js','aisystem.js','combatsystem.js','player.js','missions.js'];
const sandbox = { console, Math, Date, window: {}, document: undefined };
vm.createContext(sandbox);
for (const f of files) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), sandbox, { filename: f });
}
const get = (name) => vm.runInContext(name, sandbox);
const CONFIG = get('CONFIG');
const MapGenerator = get('MapGenerator');
const AISystem = get('AISystem');
const PerceptionSystem = get('PerceptionSystem');
const CombatSystem = get('CombatSystem');
const Player = get('Player');
const MissionSystem = get('MissionSystem');
const Vec2 = get('Vec2');
const isHostile = get('isHostile');

const events = [];
const mockGame = {
  logEvent: (t) => events.push(t),
  onNPCDeath: () => {},
  onPlayerKill: (v) => events.push('kill:' + v.name),
  onPlayerDeath: () => {},
  onPlayerRecruited: (r) => events.push('recruited by ' + r.name),
  onStageAdvance: () => {},
  onMissionEnd: (r, reason) => events.push('END:' + r + ':' + reason),
  onSCPContained: () => {},
  get player() { return sandbox.testPlayer; },
};

function makeWorld() {
  const map = MapGenerator.generate();
  const perception = new PerceptionSystem(map);
  const combat = new CombatSystem();
  const ai = new AISystem(map, combat, perception);
  ai.initialize();
  return { map, perception, combat, ai };
}

function makePlayer(role, pos) {
  const p = new Player(role, pos.clone());
  p.input = { keys: { KeyW: false, KeyS: false, KeyA: false, KeyD: false }, mouseDown: false };
  sandbox.testPlayer = p;
  return p;
}

// ============ 测试1: SCP-173 秒杀人类 ============
{
  const { map, perception, combat, ai } = makeWorld();
  // 找个人类 NPC 作为猎物
  let victim = ai.entities.find(e => e.faction === 'DCLASS' || e.faction === 'SCIENTIST');
  if (!victim) victim = ai.entities[0];
  const player = makePlayer('scp173', victim.pos.clone());
  player.pos.x = victim.pos.x + 3;
  player.pos.y = victim.pos.y + 3;
  ai.entities.push(player);

  const ctx = { map, allEntities: ai.entities, perception, combat, gameTime: 0, game: mockGame, player };
  for (let i = 0; i < 10; i++) {
    ctx.gameTime = i / 60;
    ai.update(1/60, mockGame);
    player.update(1/60, ctx);
  }
  console.log('测试1 173秒杀:', victim.dead ? 'PASS (击杀成功)' : 'FAIL (未击杀)', 'killCount=' + player.killCount);
}

// ============ 测试2: D级接触MTF转职 ============
{
  const { map, perception, combat, ai } = makeWorld();
  // 手动生成一个 MTF 放在固定位置
  const mtf = ai.spawnNPC('mtf_private', 'SZ');
  const player = makePlayer('dclass', mtf.pos.clone());
  player.pos.x = mtf.pos.x + 5;
  player.pos.y = mtf.pos.y + 5;
  ai.entities.push(player);

  const ctx = { map, allEntities: ai.entities, perception, combat, gameTime: 0, game: mockGame, player };
  for (let i = 0; i < 60; i++) {
    ctx.gameTime = i / 60;
    ai.update(1/60, mockGame);
    player.update(1/60, ctx);
  }
  console.log('测试2 D级转职:', player.recruited ? 'PASS (被招募)' : 'FAIL (未转职)',
    'faction=' + player.faction, 'weapon=' + player.weapon);
  console.log('  事件:', events.slice(-3).join(' | '));
}

// ============ 测试3: 阵营关系验证 ============
{
  console.log('测试3 阵营关系:');
  console.log('  MTF→D级:', isHostile('FOUNDATION', 'DCLASS') ? '敌对' : '非敌对', '(期望敌对-处决D级)');
  console.log('  CI→D级:', isHostile('CI', 'DCLASS') ? '敌对' : '非敌对', '(期望非敌对-同盟)');
  console.log('  SCP→人类:', isHostile('SCP', 'FOUNDATION') ? '敌对' : '非敌对', '(期望敌对)');
  console.log('  SCP→CI:', isHostile('SCP', 'CI') ? '敌对' : '非敌对', '(期望非敌对-中立)');
}

console.log('定向交互测试完成');
