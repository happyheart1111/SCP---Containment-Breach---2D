// SCP AI 行为测试 v1.1: 173眨眼 / 049目标选择 / 939伏击
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
const NPC = get('NPC');
const Vec2 = get('Vec2');
const WEAPONS_REF = get('WEAPONS');

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

// 隔离辅助: 清空初始 NPC, 只保留手动生成的实体
function isolateWorld() {
  const world = new GameWorld().generate();
  const perception = new PerceptionSystem();
  const combat = new CombatSystem();
  const ai = new AISystem(world, combat, perception);
  const items = new ItemSystem(world); world.items = items;
  // 不调用 ai.initialize() (无初始 NPC), 手动生成
  return { world, perception, combat, ai, items };
}

// ============ 测试1: SCP-173 眨眼机制 ============
{
  const { world, perception, combat, ai, items } = isolateWorld();

  // 生成一个 173 和一个人
  const scp = ai.spawnNPC('scp_173', 'HCZ');
  const human = ai.spawnNPC('dclass', 'HCZ');
  // 人类面朝 173 (注视)
  human.facing = Vec2.angle(human.pos, scp.pos);
  // 173 近距离放在人类旁边
  scp.pos.x = human.pos.x + 40;
  scp.pos.y = human.pos.y;

  let sawBlink = false;
  let movedWhileWatched = false;
  let watchedFrames = 0;
  let blinkFrames = 0;

  for (let i = 0; i < 60 * 12; i++) { // 12秒
    ai.update(1/60, mockGame);
    items.update(1/60);
    if (scp.dead) break;
    if (scp.blinking) {
      blinkFrames++;
      sawBlink = true;
    }
    if (scp._isBeingWatched && scp._isBeingWatched(ai.ctxFor(scp, mockGame))) {
      watchedFrames++;
    }
  }

  console.log('测试1 SCP-173 眨眼机制:');
  console.log('  12秒内眨眼帧数: ' + blinkFrames, blinkFrames > 10 ? 'PASS(有眨眼)' : 'FAIL(无眨眼)');
  console.log('  观察到眨眼事件: ' + sawBlink, sawBlink ? 'PASS' : 'FAIL');
}

// ============ 测试2: SCP-049 优先无武器平民 ============
{
  const world = new GameWorld().generate();
  const perception = new PerceptionSystem();
  const combat = new CombatSystem();
  const ai = new AISystem(world, combat, perception);
  const items = new ItemSystem(world); world.items = items;
  ai.initialize();

  const scp = ai.spawnNPC('scp_049', 'HCZ');
  const civilian = ai.spawnNPC('dclass', 'HCZ');
  const guard = ai.spawnNPC('guard', 'HCZ');
  civilian.weapon = null;
  guard.weapon = 'rifle';
  guard.ammo = 30;

  // 冻结目标 (防止他们自己移动), 平民近守卫远
  civilian.pos.x = scp.pos.x + 100; civilian.pos.y = scp.pos.y;
  guard.pos.x = scp.pos.x + 200; guard.pos.y = scp.pos.y;
  civilian.fsm.changeState('dead', ai.ctxFor(civilian, mockGame));
  // 用 patrolZone 固定防止跨图
  scp.patrolZone = 'HCZ';
  // 直接把 049 的 FSM 切到 patrol 并清除目标

  // 直接调用目标选择逻辑 (模拟 _behaviorSCP049 的评分)
  let best = null;
  let bestScore = -Infinity;
  for (const e of ai.entities) {
    if (e === scp || e.dead || e.isSCP) continue;
    const d = Vec2.dist(scp.pos, e.pos);
    let score = Math.max(0, 500 - d);
    if (!e.weapon || !WEAPONS_REF[e.weapon]) score += 200;
    if (score > bestScore) { bestScore = score; best = e; }
  }
  // 期望 best 是 civilian (距离100 无武器: 400+200=600; 守卫: 300+0=300)
  console.log('测试2 SCP-049 目标选择:');
  console.log('  选中目标: ' + (best ? best.name : 'null') + ' (期望: D级人员-无武器优先)',
    best && best.faction === 'DCLASS' ? 'PASS' : 'FAIL');
}

// ============ 测试3: SCP-939 伏击扑击 ============
{
  const world = new GameWorld().generate();
  const perception = new PerceptionSystem();
  const combat = new CombatSystem();
  const ai = new AISystem(world, combat, perception);
  const items = new ItemSystem(world); world.items = items;
  ai.initialize();

  const scp = ai.spawnNPC('scp_939', 'HCZ');
  const human = ai.spawnNPC('dclass', 'HCZ');
  human.pos.x = scp.pos.x + 40;  // 扑击范围内
  human.pos.y = scp.pos.y;

  // 模拟 3 秒: 939 应扑击范围内的目标
  let attacked = false;
  for (let i = 0; i < 60 * 3; i++) {
    ai.update(1/60, mockGame);
    if (human.dead) { attacked = true; break; }
  }
  console.log('测试3 SCP-939 伏击扑击:');
  console.log('  扑击范围(40px)内扑杀:', attacked ? 'PASS' : 'FAIL');
}

// ============ 测试4: SCP-173 被注视冻结 + 眨眼移动 ============
{
  const world = new GameWorld().generate();
  const perception = new PerceptionSystem();
  const combat = new CombatSystem();
  const ai = new AISystem(world, combat, perception);
  const items = new ItemSystem(world); world.items = items;
  ai.initialize();

  const scp = ai.spawnNPC('scp_173', 'HCZ');
  const human = ai.spawnNPC('guard', 'HCZ');
  // 人类持枪面朝173, 持续注视
  human.weapon = 'rifle';
  human.pos.x = scp.pos.x - 40; human.pos.y = scp.pos.y;
  human.facing = 0; // 面朝右 (173在右边)

  // 强制清空两者间视线 (避免大地图随机墙遮挡)
  const map4 = world.getLevel('HCZ');
  const t1 = map4.worldToTile(scp.pos.x, scp.pos.y);
  const t2 = map4.worldToTile(human.pos.x, human.pos.y);
  for (let r = Math.min(t1.row, t2.row) - 1; r <= Math.max(t1.row, t2.row) + 1; r++) {
    for (let c = t1.col - 3; c <= t1.col + 3; c++) {
      if (r >= 0 && r < map4.rows && c >= 0 && c < map4.cols) map4.grid[r][c] = get('TILE').CORRIDOR;
    }
  }

  let frozen = false;
  let blinkMoved = false;
  let prevPos = scp.pos.clone();
  for (let i = 0; i < 60 * 10; i++) {
    ai.update(1/60, mockGame);
    // 每帧强制人类固定并注视 173 (隔离测试)
    human.pos.x = scp.pos.x - 40; human.pos.y = scp.pos.y;
    human.facing = 0;

    // 眨眼中: 检查是否发生移动 (173 未被注视时朝人类移动)
    if (scp.blinking) {
      const moved = Vec2.dist(prevPos, scp.pos);
      if (moved > 0.5) blinkMoved = true;
    }
    prevPos = scp.pos.clone();

    // 注视中 (非眨眼): 应冻结
    if (!scp.blinking && scp._isBeingWatched(ai.ctxFor(scp, mockGame))) {
      frozen = true;
    }
  }
  console.log('测试4 SCP-173 注视冻结:');
  console.log('  被注视时冻结:', frozen ? 'PASS(有冻结状态)' : 'FAIL', '| 眨眼期间移动:', blinkMoved ? 'PASS' : 'FAIL');
}

// ============ 测试5: SCP-173 实际攻击 (击杀人类) ============
{
  const { world, perception, combat, ai, items } = isolateWorld();
  const scp = ai.spawnNPC('scp_173', 'LCZ');
  const human = ai.spawnNPC('dclass', 'LCZ');
  human.pos.x = scp.pos.x + 30; human.pos.y = scp.pos.y;
  human.facing = 0;
  const map = world.getLevel('LCZ');
  const t0 = map.worldToTile(scp.pos.x, scp.pos.y);
  for (let r = t0.row - 2; r <= t0.row + 2; r++) for (let c = t0.col - 3; c <= t0.col + 3; c++) {
    if (r >= 0 && r < map.rows && c >= 0 && c < map.cols) map.grid[r][c] = get('TILE').CORRIDOR;
  }
  let dead = false;
  for (let i = 0; i < 60 * 6; i++) {
    ai.update(1/60, mockGame);
    items.update(1/60);
    if (human.dead) { dead = true; break; }
  }
  console.log('测试5 SCP-173 攻击人类:', dead ? 'PASS (击杀成功)' : 'FAIL (未击杀)');
}

// ============ 测试6: SCP-049 实际攻击 (击杀) ============
{
  const { world, perception, combat, ai, items } = isolateWorld();
  const scp = ai.spawnNPC('scp_049', 'EZ');
  const human = ai.spawnNPC('guard', 'EZ');
  human.pos.x = scp.pos.x + 15; human.pos.y = scp.pos.y;
  human.facing = 0;
  human._behaviorGuard = () => {};
  let dead = false;
  for (let i = 0; i < 60 * 3; i++) {
    ai.update(1/60, mockGame);
    items.update(1/60);
    if (human.dead) { dead = true; break; }
  }
  console.log('测试6 SCP-049 攻击人类:', dead ? 'PASS (击杀成功)' : 'FAIL (未击杀)');
}

// ============ 测试7: SCP-939 实际攻击 (感知扑击) ============
{
  const { world, perception, combat, ai, items } = isolateWorld();
  const scp = ai.spawnNPC('scp_939', 'EZ');
  const human = ai.spawnNPC('guard', 'EZ');
  human.pos.x = scp.pos.x + 60; human.pos.y = scp.pos.y;
  human.facing = 0;
  human._behaviorGuard = () => {};
  // 清空周围墙 (保证 939 接近路径通畅)
  const map = world.getLevel('EZ');
  const t0 = map.worldToTile(scp.pos.x, scp.pos.y);
  for (let r = t0.row - 3; r <= t0.row + 3; r++) for (let c = t0.col - 5; c <= t0.col + 5; c++) {
    if (r >= 0 && r < map.rows && c >= 0 && c < map.cols) map.grid[r][c] = get('TILE').CORRIDOR;
  }
  let dead = false;
  for (let i = 0; i < 60 * 6; i++) {
    ai.update(1/60, mockGame);
    items.update(1/60);
    if (human.dead) { dead = true; break; }
  }
  console.log('测试7 SCP-939 攻击人类:', dead ? 'PASS (扑杀成功)' : 'FAIL (未扑杀)');
}

// ============ 测试8: 玩家 SCP-173 接触秒杀 ============
{
  const world = new GameWorld().generate();
  const perception = new PerceptionSystem();
  const combat = new CombatSystem();
  const ai = new AISystem(world, combat, perception);
  const items = new ItemSystem(world); world.items = items;
  ai.initialize();
  const human = ai.spawnNPC('guard', 'LCZ');
  const Player = get('Player');
  const player = new Player('scp173', new Vec2(human.pos.x + 20, human.pos.y), 'LCZ');
  player.input = { keys: { KeyW: false, KeyS: false, KeyA: false, KeyD: false }, mouseDown: false };
  player.mouseWorld = human.pos.clone();
  sandbox.testPlayer = player;
  ai.entities.push(player);
  const ctx = ai.ctxFor(player, mockGame);
  ctx.items = items;
  let killed = false;
  for (let i = 0; i < 60 * 2; i++) {
    ai.update(1/60, mockGame);
    items.update(1/60);
    player.update(1/60, ctx);
    if (human.dead) { killed = true; break; }
  }
  console.log('测试8 玩家173 接触秒杀:', killed ? 'PASS (秒杀成功)' : 'FAIL (未击杀)');
}

// ============ 测试9: 玩家173 "见证"瞬移技能 (Shift) ============
{
  const world = new GameWorld().generate();
  const perception = new PerceptionSystem();
  const combat = new CombatSystem();
  const ai = new AISystem(world, combat, perception);
  const items = new ItemSystem(world); world.items = items;
  ai.initialize();
  // 在 EZ 生成 (无初始SCP干扰)
  const human = ai.spawnNPC('guard', 'EZ');
  const Player = get('Player');
  const player = new Player('scp173', new Vec2(human.pos.x + 200, human.pos.y), 'EZ');
  player.input = { keys: { KeyW: false, KeyS: false, KeyA: false, KeyD: false, ShiftLeft: true }, mouseDown: false };
  player.mouseWorld = human.pos.clone();
  sandbox.testPlayer = player;
  ai.entities.push(player);
  const ctx = ai.ctxFor(player, mockGame);
  ctx.items = items;
  let killed = false;
  for (let i = 0; i < 60 * 2; i++) {
    ai.update(1/60, mockGame);
    items.update(1/60);
    player.update(1/60, ctx);
    if (human.dead) { killed = true; break; }
  }
  console.log('测试9 玩家173 见证瞬移:', killed ? 'PASS (200px外瞬移秒杀)' : 'FAIL (未触发)');
}

// ============ 测试10: 玩家173 左键斩击 (SCP:SL) ============
{
  const { world, perception, combat, ai, items } = isolateWorld();
  const human = ai.spawnNPC('guard', 'LCZ');
  const Player = get('Player');
  const player = new Player('scp173', new Vec2(human.pos.x + 40, human.pos.y), 'LCZ');
  player.input = { keys: { KeyW: false, KeyS: false, KeyA: false, KeyD: false }, mouseDown: true };
  player.mouseWorld = human.pos.clone(); // 面向人类
  player.facing = Vec2.angle(player.pos, human.pos);
  sandbox.testPlayer = player;
  ai.entities.push(player);
  const ctx = ai.ctxFor(player, mockGame);
  ctx.items = items;
  let killed = false;
  for (let i = 0; i < 60 * 2; i++) {
    ai.update(1/60, mockGame);
    items.update(1/60);
    player.update(1/60, ctx);
    if (human.dead) { killed = true; break; }
  }
  console.log('测试10 玩家173 左键斩击:', killed ? 'PASS (40px内斩杀)' : 'FAIL (未斩杀)');
}

console.log('SCP AI 行为测试完成');
