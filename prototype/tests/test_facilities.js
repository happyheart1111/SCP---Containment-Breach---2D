// 设施系统测试: 钥匙卡门禁 / SCP-914 / 特斯拉电门
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const files = ['config.js','vector2.js','fsm.js','pathfinding.js','mapsystem.js','facilities.js','perception.js','npc.js','npcfactory.js','aisystem.js','combatsystem.js','player.js','missions.js'];
const sandbox = { console, Math, Date, window: {}, document: undefined };
vm.createContext(sandbox);
for (const f of files) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), sandbox, { filename: f });
}
const get = (name) => vm.runInContext(name, sandbox);
const CONFIG = get('CONFIG');
const MapGenerator = get('MapGenerator');
const FacilitySystem = get('FacilitySystem');
const refineKeycard914 = get('refineKeycard914');
const KEYCARDS = get('KEYCARDS');

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
  get player() { return null; },
};

// ============ 测试1: 门禁生成 ============
{
  const map = MapGenerator.generate();
  const fac = new FacilitySystem(map);
  console.log('测试1 门禁生成:');
  console.log('  钥匙卡门禁数:', fac.doors.length, fac.doors.map(d => 'Lv.' + d.level).join(', '));
  console.log('  SCP-914 数量:', fac.machines914.length);
  console.log('  特斯拉电门数:', fac.teslaGates.length, fac.teslaGates.map(g => g.zone).join(', '));
}

// ============ 测试2: 门禁开门逻辑 ============
{
  const map = MapGenerator.generate();
  const fac = new FacilitySystem(map);
  const door = fac.doors[0]; // 找一个 Lv.3 检查点
  const lv3door = fac.doors.find(d => d.level === 3) || door;

  console.log('测试2 开门逻辑 (' + lv3door.name + ' Lv.' + lv3door.level + '):');
  const r1 = fac.tryOpenDoor(lv3door, 1, mockGame);
  console.log('  Lv.1 卡:', r1 ? 'FAIL(不该开)' : 'PASS(拒绝)');
  const r2 = fac.tryOpenDoor(lv3door, 3, mockGame);
  console.log('  Lv.3 卡:', r2 ? 'PASS(开启)' : 'FAIL(应开启)');
  const r3 = fac.tryOpenDoor(lv3door, 0, mockGame);
  console.log('  Omni 卡:', r3 ? 'PASS(开启)' : 'FAIL(应开启)');
}

// ============ 测试3: 914 精加工 ============
{
  console.log('测试3 SCP-914 钥匙卡精加工:');
  // Fine: 升1级
  const f1 = refineKeycard914(2, 'Fine');
  console.log('  Lv.2 + Fine →', f1.level, f1.destroyed ? '(摧毁)' : '', f1.level === 3 ? 'PASS' : 'FAIL');
  // Coarse: 降1级
  const c1 = refineKeycard914(4, 'Coarse');
  console.log('  Lv.4 + Coarse →', c1.level, c1.level === 3 ? 'PASS' : 'FAIL');
  // 5级 + Fine → Omni (0)
  const f5 = refineKeycard914(5, 'Fine');
  console.log('  Lv.5 + Fine →', f5.level === 0 ? 'Omni PASS' : 'FAIL');
  // Very Fine: 概率测试 (100次)
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
  const map = MapGenerator.generate();
  const fac = new FacilitySystem(map);
  const combat = get('CombatSystem') ? new (get('CombatSystem'))() : null;
  const perception = get('PerceptionSystem') ? new (get('PerceptionSystem'))(map) : null;
  const ai = new (get('AISystem'))(map, combat, perception);
  ai.initialize();

  // 手动把一个人放在特斯拉电门里
  const gate = fac.teslaGates[0];
  if (gate) {
    const victim = ai.entities[0];
    victim.pos.x = gate.pos.x;
    victim.pos.y = gate.pos.y;

    // 模拟 8 秒
    let discharged = 0;
    for (let i = 0; i < 8 * 60; i++) {
      fac.update(1/60, { map, allEntities: ai.entities, perception, combat, gameTime: i/60, game: mockGame });
      if (gate.state === 'discharging') {
        discharged++;
      }
    }
    console.log('测试4 特斯拉电门:');
    console.log('  8秒内放电帧数:', discharged, discharged > 0 ? 'PASS(有放电)' : 'FAIL(未放电)');
    const victimWasHuman = !victim.isSCP;
    if (victimWasHuman) {
      console.log('  人类受害者被电死:', victim.dead ? 'PASS(符合设计-人类致命)' : 'FAIL(未死)');
    } else {
      console.log('  SCP受害者存活:', !victim.dead ? 'PASS(符合设计-SCP免疫/减伤)' : 'FAIL(被电死)');
    }
  } else {
    console.log('测试4 特斯拉电门: SKIP (无电门生成)');
  }
}

console.log('设施系统测试完成');
