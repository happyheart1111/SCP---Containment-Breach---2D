// 地图连通性测试: 验证每张地图所有可通行 tile 都互相可达
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

let allOk = true;
for (let trial = 0; trial < 5; trial++) {
  const world = new GameWorld().generate();
  for (const lv of ['SZ', 'EZ', 'HCZ', 'LCZ']) {
    const map = world.getLevel(lv);
    const pf = world.getPathfinder(lv);

    // 收集所有可通行 tile
    const walkable = [];
    for (let r = 0; r < map.rows; r++) {
      for (let c = 0; c < map.cols; c++) {
        if (map.isWalkable(c, r)) walkable.push({ col: c, row: r });
      }
    }
    if (walkable.length === 0) { console.log('  [' + lv + '] 无可通行tile! FAIL'); allOk = false; continue; }

    // 从第一个 tile BFS 全图
    const start = walkable[0];
    const visited = new Set([start.col + ',' + start.row]);
    const queue = [start];
    const dirs = [[0,1],[0,-1],[1,0],[-1,0]];
    while (queue.length) {
      const cur = queue.shift();
      for (const [dc, dr] of dirs) {
        const nc = cur.col + dc, nr = cur.row + dr;
        if (nc < 0 || nr < 0 || nc >= map.cols || nr >= map.rows) continue;
        if (!map.isWalkable(nc, nr)) continue;
        const key = nc + ',' + nr;
        if (visited.has(key)) continue;
        visited.add(key);
        queue.push({ col: nc, row: nr });
      }
    }

    const unreachable = walkable.length - visited.size;
    // 出口必须可达
    let exitOk = true;
    const exit = map.exitPoints[lv];
    if (exit && !visited.has(exit.col + ',' + exit.row)) exitOk = false;
    // 传送点必须可达
    let portalOk = true;
    for (const p of world.getPortalsIn(lv)) {
      const t = map.worldToTile(p.pos.x, p.pos.y);
      if (!visited.has(t.col + ',' + t.row)) { portalOk = false; break; }
    }

    const status = (unreachable === 0 && exitOk && portalOk) ? 'OK' : 'FAIL';
    if (status === 'FAIL') allOk = false;
    console.log('  [' + lv + '] 可通行=' + walkable.length + ' 未达=' + unreachable +
      ' 出口=' + (exitOk ? 'Y' : 'N') + ' 传送点=' + (portalOk ? 'Y' : 'N') + ' → ' + status);
  }
}
console.log(allOk ? '连通性测试: 全部通过 (5次随机生成)' : '连通性测试: 存在失败!');
