// 设施系统测试 v1.0.0: 钥匙卡门禁 / SCP-914 / 特斯拉电门 (多地图)
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
const FacilitySystem = get('FacilitySystem');
const refineKeycard914 = get('refineKeycard914');

const events = [];
const mockGame = {
  logEvent: (t) => events.push(t),
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

// ============ 测试1: 门禁/914/特斯拉生成 (各地图) ============
{
  const world = new GameWorld().generate();
  console.log('测试1 设施生成:');
  for (const lv of ['LCZ', 'HCZ', 'EZ', 'SZ']) {
    const fac = world.getFacilities(lv);
    console.log(`  [${lv}] 门禁=${fac.doors.length} 914=${fac.machines914.length} 特斯拉=${fac.teslaGates.length}`);
  }
}

// ============ 测试2: 门禁开门逻辑 ============
{
  const world = new GameWorld().generate();
  const fac = world.getFacilities('LCZ');
  let lv3door = fac.doors.find(d => d.level === 3);
  if (!lv3door && fac.doors.length > 0) lv3door = fac.doors[0];
  if (lv3door) {
    console.log('测试2 开门逻辑 (' + lv3door.name + ' Lv.' + lv3door.level + '):');
    const r1 = fac.tryOpenDoor(lv3door, 1, mockGame);
    console.log('  Lv.1 卡:', r1 ? 'FAIL(不该开)' : 'PASS(拒绝)');
    const r2 = fac.tryOpenDoor(lv3door, lv3door.level, mockGame);
    console.log('  Lv.' + lv3door.level + ' 卡:', r2 ? 'PASS(开启)' : 'FAIL(应开启)');
    const door2 = fac.doors[0];
    if (door2) {
      const r3 = fac.tryOpenDoor(door2, 0, mockGame);
      console.log('  Omni 卡:', r3 ? 'PASS(开启)' : 'FAIL(应开启)');
    }
  } else {
    console.log('测试2 开门逻辑: SKIP (LCZ无门禁)');
  }
}

// ============ 测试3: 914 精加工 ============
{
  console.log('测试3 SCP-914 钥匙卡精加工:');
  const f1 = refineKeycard914(2, 'Fine');
  console.log('  Lv.2 + Fine →', f1.level, f1.destroyed ? '(摧毁)' : '', f1.level === 3 ? 'PASS' : 'FAIL');
  const c1 = refineKeycard914(4, 'Coarse');
  console.log('  Lv.4 + Coarse →', c1.level, c1.level === 3 ? 'PASS' : 'FAIL');
  const f5 = refineKeycard914(5, 'Fine');
  console.log('  Lv.5 + Fine →', f5.level === 0 ? 'Omni PASS' : 'FAIL');
  let upgrade2 = 0, destroyed = 0, unchanged = 0;
  for (let i = 0; i < 1000; i++) {
    const r = refineKeycard914(2, 'Very Fine');
    if (r.level === 4) upgrade2++;
    if (r.destroyed) destroyed++;
    if (r.level === 2 && !r.destroyed) unchanged++;
  }
  console.log('  Very Fine 1000次: 升2级=' + upgrade2 + ' 摧毁=' + destroyed + ' 不变=' + unchanged, '(期望约500/250/250)');
}

// ============ 测试4: 特斯拉电门周期 ============
{
  const world = new GameWorld().generate();
  let tested = false;
  for (const lv of ['HCZ', 'EZ']) {
    const fac = world.getFacilities(lv);
    if (fac.teslaGates.length === 0) continue;
    const gate = fac.teslaGates[0];
    const ctx = {
      world, map: world.getLevel(lv), allEntities: [],
      perception: { emitNoise: () => {} }, combat: { dealDamage: () => {} },
      gameTime: 0, game: mockGame,
    };
    let discharged = 0;
    for (let i = 0; i < 8 * 60; i++) {
      ctx.gameTime = i / 60;
      fac.update(1/60, ctx);
      if (gate.state === 'discharging') discharged++;
    }
    console.log(`测试4 特斯拉电门[${lv}]:`);
    console.log('  8秒内放电帧数:', discharged, discharged > 0 ? 'PASS(有放电)' : 'FAIL(未放电)');
    tested = true;
    break;
  }
  if (!tested) console.log('测试4 特斯拉电门: SKIP (无电门生成)');
}

console.log('设施系统测试完成');
