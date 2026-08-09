// ============================================================
// mapsystem.js — 单地图生成器 (SCP:SL 风格多地图)
// 4 张独立地图: SZ(地表,固定) / EZ(办公,随机) / HCZ(重收容,随机) / LCZ(轻收容,随机)
// 地图之间由传送点(检查点/电梯)连接, 互不可见
// ============================================================

// Tile 类型
const TILE = {
  EMPTY: 0,       // 可通行地面
  WALL: 1,        // 墙壁
  DOOR: 2,        // 钥匙卡门禁 tile
  ROOM_FLOOR: 3,  // 房间地面
  CORRIDOR: 4,    // 走廊/地表
  PORTAL: 5,      // 传送点(检查点/电梯)
  EXIT: 6,        // 出口
  SPAWN: 7,       // 出生点标记
};

class GameMap {
  constructor(levelId, cols, rows) {
    this.levelId = levelId;
    this.cols = cols;
    this.rows = rows;
    this.grid = [];
    this.rooms = [];
    this.doors = [];
    this.spawnPoints = {};   // zone -> tile
    this.exitPoints = {};    // zone -> tile
    this.portalSlots = [];   // 可选传送点位置 (由 world 绑定)

    this._initGrid();
  }

  _initGrid() {
    for (let r = 0; r < this.rows; r++) {
      this.grid[r] = [];
      for (let c = 0; c < this.cols; c++) {
        this.grid[r][c] = TILE.WALL;
      }
    }
  }

  getZone(col, row) { return this.levelId; }

  isWalkable(col, row) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return false;
    const t = this.grid[row][col];
    return t === TILE.EMPTY || t === TILE.ROOM_FLOOR || t === TILE.CORRIDOR ||
           t === TILE.DOOR || t === TILE.PORTAL || t === TILE.EXIT || t === TILE.SPAWN;
  }

  isWall(col, row) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return true;
    return this.grid[row][col] === TILE.WALL;
  }

  // 是否被未开启的钥匙卡门阻挡
  isDoorBlocked(col, row, facilities) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return false;
    if (this.grid[row][col] !== TILE.DOOR) return false;
    if (!facilities) return false;
    const door = facilities.doors.find(d => d.col === col && d.row === row);
    return !!door && !door.open;
  }

  blocksSight(col, row) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return true;
    return this.grid[row][col] === TILE.WALL;
  }

  tileToWorld(col, row) {
    return { x: col * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2, y: row * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2 };
  }

  worldToTile(x, y) {
    return { col: Math.floor(x / CONFIG.TILE_SIZE), row: Math.floor(y / CONFIG.TILE_SIZE) };
  }

  getRandomWalkableTile(zone) {
    const candidates = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.isWalkable(c, r)) candidates.push({ col: c, row: r });
      }
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  // 获取距某点足够远的随机可通行 tile (用于传送点/出生点)
  getRandomWalkableTileFar(pos, minDist) {
    const candidates = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!this.isWalkable(c, r)) continue;
        const w = this.tileToWorld(c, r);
        const d = Math.hypot(w.x - pos.x, w.y - pos.y);
        if (d >= minDist) candidates.push({ col: c, row: r });
      }
    }
    if (candidates.length === 0) return this.getRandomWalkableTile(null);
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
}

// ============================================================
// 地图生成器
// ============================================================
class MapGenerator {
  // 生成单张地图
  static generateLevel(levelId) {
    const size = LEVEL_SIZES[levelId] || { cols: 40, rows: 28 };
    const map = new GameMap(levelId, size.cols, size.rows);

    if (levelId === 'SZ') {
      this._generateSurface(map);
    } else {
      this._generateRandomZone(map, levelId);
    }

    // 出生点 + 出口
    this._setupSpawnAndExit(map, levelId);
    return map;
  }

  // ============================================================
  // 地表区 (SZ) — 固定布局
  // ============================================================
  static _generateSurface(map) {
    const W = map.cols, H = map.rows;

    // 1. 整片地表可通行(开阔地面)
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        map.grid[r][c] = TILE.CORRIDOR;
      }
    }

    // 2. 中央基地建筑 (矩形墙 + 内部房间) — 扩大版
    const bx = 17, by = 12, bw = 24, bh = 14; // 建筑范围
    // 外墙
    for (let c = bx; c < bx + bw; c++) {
      map.grid[by][c] = TILE.WALL;
      map.grid[by + bh - 1][c] = TILE.WALL;
    }
    for (let r = by; r < by + bh; r++) {
      map.grid[r][bx] = TILE.WALL;
      map.grid[r][bx + bw - 1] = TILE.WALL;
    }
    // 内部房间地面
    for (let r = by + 1; r < by + bh - 1; r++) {
      for (let c = bx + 1; c < bx + bw - 1; c++) {
        map.grid[r][c] = TILE.ROOM_FLOOR;
      }
    }
    // 内墙分割成房间
    const wy = by + 5;
    for (let c = bx + 1; c < bx + bw - 1; c++) map.grid[wy][c] = TILE.WALL;
    const wx = bx + 7;
    for (let r = by + 6; r < by + bh - 1; r++) map.grid[r][wx] = TILE.WALL;
    const wx2 = bx + 17;
    for (let r = by + 1; r < by + 5; r++) map.grid[r][wx2] = TILE.WALL;

    // 门洞
    map.grid[by + 7][bx] = TILE.CORRIDOR;      // 建筑正门
    map.grid[by + 2][wx2] = TILE.CORRIDOR;
    map.grid[by + 7][wx] = TILE.CORRIDOR;
    map.grid[wy][bx + 4] = TILE.CORRIDOR;
    map.grid[by + 10][bx + bw - 1] = TILE.CORRIDOR; // 后门

    // 3. 障碍物(停机坪边缘护栏、路障等) — 随机小柱子
    const pillars = [
      [4, 3], [10, 30], [30, 3], [42, 30], [52, 8], [52, 26],
      [3, 17], [48, 4], [10, 6], [44, 32], [24, 2], [2, 28],
      [52, 16], [8, 20], [36, 33],
    ];
    for (const [c, r] of pillars) {
      if (c > 0 && c < W - 1 && r > 0 && r < H - 1) map.grid[r][c] = TILE.WALL;
    }

    // 4. 直升机停机坪标记 (左上开阔地)
    const pad = { x: 4, y: 4 };
    map.spawnPoints['HELI'] = pad;

    // 5. 传送点槽位: 建筑入口大厅 (地图世界绑定为 SZ-EZ 检查点)
    map.portalSlots.push({ id: 'SZ-EZ', col: bx + 7, row: by + 7 });
  }

  // ============================================================
  // 随机区域 (EZ/HCZ/LCZ) — SCP:SL 风格: 直走廊网格 + 路口 + 贴走廊房间
  // 参考 SCP:SL: 宽阔直走廊(2格)构成主干, 十字/T型路口,
  // 房间紧贴走廊两侧, 检查点/电梯在关键路口
  // ============================================================
  static _generateRandomZone(map, levelId) {
    const W = map.cols, H = map.rows;

    // ---- 1. 主干走廊网格 (水平 + 垂直, 宽2格) ----
    const hRows = [];  // 水平走廊所在行 (走廊占 y, y+1)
    const vCols = [];  // 垂直走廊所在列 (走廊占 x, x+1)

    let y = 5 + Math.floor(Math.random() * 3);
    while (y < H - 6) {
      hRows.push(y);
      y += 10 + Math.floor(Math.random() * 5);
    }
    let x = 6 + Math.floor(Math.random() * 3);
    while (x < W - 6) {
      vCols.push(x);
      x += 12 + Math.floor(Math.random() * 5);
    }

    // 挖水平走廊
    for (const hy of hRows) {
      for (let r = hy; r < hy + 2 && r < H; r++) {
        for (let c = 2; c < W - 2; c++) {
          map.grid[r][c] = TILE.CORRIDOR;
        }
      }
    }
    // 挖垂直走廊
    for (const vx of vCols) {
      for (let c = vx; c < vx + 2 && c < W; c++) {
        for (let r = 2; r < H - 2; r++) {
          map.grid[r][c] = TILE.CORRIDOR;
        }
      }
    }

    // ---- 2. 房间紧贴走廊旁挖 (天然连通, 无需门洞) ----
    const placedRooms = [];
    const roomCount = 22 + Math.floor(Math.random() * 8); // 22-29 个房间

    // 候选走廊边: 所有走廊 tile 的上下左右紧邻格
    const corridorEdges = [];
    const isCorridor = (c, r) => r >= 0 && r < H && c >= 0 && c < W && map.grid[r][c] === TILE.CORRIDOR;

    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        if (!isCorridor(c, r)) continue;
        // 该走廊格的四个紧邻格 (非走廊非房间的墙)
        const nb = [
          [c, r - 1], [c, r + 1], [c - 1, r], [c + 1, r],
        ];
        for (const [nc, nr] of nb) {
          if (nc >= 1 && nr >= 1 && nc < W - 1 && nr < H - 1 && map.grid[nr][nc] === TILE.WALL) {
            corridorEdges.push({ col: nc, row: nr });
          }
        }
      }
    }

    // 打乱候选
    const shuffled = corridorEdges.sort(() => Math.random() - 0.5);
    let placed = 0;
    for (let i = 0; i < shuffled.length && placed < roomCount; i++) {
      const seed = shuffled[i];
      const sc = seed.col, sr = seed.row;

      // 确定房间扩展方向: 房间向"远离走廊"方向扩展, seed 格保留为门口
      let dir = null;
      if (isCorridor(sc, sr - 1)) dir = 'down';       // 走廊在上, 房间向下扩展
      else if (isCorridor(sc, sr + 1)) dir = 'up';    // 走廊在下, 房间向上扩展
      else if (isCorridor(sc - 1, sr)) dir = 'right'; // 走廊在左, 房间向右扩展
      else if (isCorridor(sc + 1, sr)) dir = 'left';  // 走廊在右, 房间向左扩展
      if (!dir) continue;

      const rw = 4 + Math.floor(Math.random() * 4); // 4-7
      const rh = 3 + Math.floor(Math.random() * 3); // 3-5

      // 房间矩形: 贴走廊边界
      let rx, ry;
      if (dir === 'up') { ry = sr - rh + 1; rx = sc - Math.floor(rw / 2); }
      else if (dir === 'down') { ry = sr; rx = sc - Math.floor(rw / 2); }
      else if (dir === 'left') { rx = sc - rw + 1; ry = sr - Math.floor(rh / 2); }
      else { rx = sc; ry = sr - Math.floor(rh / 2); }

      // 越界检查
      if (rx < 2 || ry < 2 || rx + rw > W - 2 || ry + rh > H - 2) continue;
      // 与其他房间重叠检查
      let overlap = false;
      for (const pr of placedRooms) {
        if (rx < pr.x + pr.w && rx + rw > pr.x && ry < pr.y + pr.h && ry + rh > pr.y) {
          overlap = true;
          break;
        }
      }
      // 房间覆盖走廊检查 (房间不应盖住另一条走廊, 除非是门洞处)
      let coversCorridor = false;
      for (let rr = ry; rr < ry + rh; rr++) {
        for (let cc = rx; cc < rx + rw; cc++) {
          // 房间主体应落在墙区; 允许贴走廊那一边
          if (isCorridor(cc, rr)) { coversCorridor = true; break; }
        }
        if (coversCorridor) break;
      }
      // 房间主体不应含走廊 (除了贴边那格由门洞保证)
      if (overlap || coversCorridor) continue;

      // 挖房间 (保留贴走廊边为 ROOM_FLOOR, 与走廊相邻即开门)
      for (let rr = ry; rr < ry + rh; rr++) {
        for (let cc = rx; cc < rx + rw; cc++) {
          if (map.grid[rr][cc] === TILE.WALL) map.grid[rr][cc] = TILE.ROOM_FLOOR;
        }
      }
      placedRooms.push({ x: rx, y: ry, w: rw, h: rh });
      placed++;
    }

    map.rooms.push(...placedRooms);

    // ---- 3. 传送点槽位: 选路口的走廊交叉处 (远离房间) ----
    const candidates = [];
    for (const vx of vCols) {
      for (const hy of hRows) {
        const cx = vx + 1, cy = hy + 1;
        if (cx > 2 && cx < W - 2 && cy > 2 && cy < H - 2) {
          candidates.push({ col: cx, row: cy });
        }
      }
    }
    const shuffled2 = candidates.sort(() => Math.random() - 0.5);
    const slots = [];
    for (const s of shuffled2) {
      if (slots.length >= 3) break;
      let tooClose = false;
      for (const t of slots) {
        if (Math.abs(s.col - t.col) + Math.abs(s.row - t.row) < 14) { tooClose = true; break; }
      }
      if (!tooClose) slots.push(s);
    }
    let guard = 0;
    while (slots.length < 3 && guard < 60) {
      guard++;
      const t = map.getRandomWalkableTile(null);
      if (!t) break;
      let tooClose = false;
      for (const s of slots) {
        if (Math.abs(s.col - t.col) + Math.abs(s.row - t.row) < 14) { tooClose = true; break; }
      }
      if (!tooClose) slots.push(t);
    }

    for (let idx = 0; idx < slots.length; idx++) {
      const s = slots[idx];
      for (let r = s.row - 1; r <= s.row + 1; r++) {
        for (let c = s.col - 1; c <= s.col + 1; c++) {
          if (r >= 0 && r < map.rows && c >= 0 && c < map.cols && map.grid[r][c] === TILE.WALL) {
            map.grid[r][c] = TILE.CORRIDOR;
          }
        }
      }
      map.grid[s.row][s.col] = TILE.PORTAL;
      map.portalSlots.push({ id: `${levelId}-${idx}`, col: s.col, row: s.row });
    }
  }

  // 简单 BSP 切分
  static _bspRooms(x, y, w, h, depth) {
    if (depth <= 0 || w < 9 || h < 7) {
      const pad = 1;
      return [{
        x: x + pad, y: y + pad,
        w: Math.max(4, w - pad * 2),
        h: Math.max(4, h - pad * 2),
      }];
    }
    const rooms = [];
    if (w > h || (w === h && Math.random() < 0.5)) {
      const split = Math.floor(w / 2) + (Math.random() < 0.5 ? -1 : 1);
      rooms.push(...this._bspRooms(x, y, split, h, depth - 1));
      rooms.push(...this._bspRooms(x + split, y, w - split, h, depth - 1));
    } else {
      const split = Math.floor(h / 2) + (Math.random() < 0.5 ? -1 : 1);
      rooms.push(...this._bspRooms(x, y, w, split, depth - 1));
      rooms.push(...this._bspRooms(x, y + split, w, h - split, depth - 1));
    }
    return rooms;
  }

  static _carveCorridor(map, roomA, roomB) {
    const ax = Math.floor(roomA.x + roomA.w / 2);
    const ay = Math.floor(roomA.y + roomA.h / 2);
    const bx = Math.floor(roomB.x + roomB.w / 2);
    const by = Math.floor(roomB.y + roomB.h / 2);
    const horizFirst = Math.random() < 0.5;
    if (horizFirst) {
      this._carveHLine(map, ax, bx, ay);
      this._carveVLine(map, ay, by, bx);
    } else {
      this._carveVLine(map, ay, by, ax);
      this._carveHLine(map, ax, bx, by);
    }
  }

  static _carveHLine(map, x1, x2, y) {
    const [a, b] = x1 < x2 ? [x1, x2] : [x2, x1];
    for (let x = a; x <= b; x++) {
      if (y >= 0 && y < map.rows && x >= 0 && x < map.cols && map.grid[y][x] === TILE.WALL) {
        map.grid[y][x] = TILE.CORRIDOR;
      }
    }
  }

  static _carveVLine(map, y1, y2, x) {
    const [a, b] = y1 < y2 ? [y1, y2] : [y2, y1];
    for (let y = a; y <= b; y++) {
      if (y >= 0 && y < map.rows && x >= 0 && x < map.cols && map.grid[y][x] === TILE.WALL) {
        map.grid[y][x] = TILE.CORRIDOR;
      }
    }
  }

  static _setupSpawnAndExit(map, levelId) {
    const zone = levelId;
    // 出生点
    if (levelId === 'SZ') {
      // 地表出生: 直升机停机坪旁
      map.spawnPoints[zone] = { col: 5, row: 5 };
      map.grid[5][5] = TILE.SPAWN;
    } else {
      // 随机出生: 找离传送点远的可通行 tile
      let tile = null;
      if (map.portalSlots.length > 0) {
        const p0 = map.portalSlots[0];
        const pPos = map.tileToWorld(p0.col, p0.row);
        tile = map.getRandomWalkableTileFar(pPos, CONFIG.TILE_SIZE * 12);
      }
      if (!tile) tile = map.getRandomWalkableTile(zone);
      if (tile) {
        map.spawnPoints[zone] = tile;
        map.grid[tile.row][tile.col] = TILE.SPAWN;
      }
    }

    // 出口: 仅地表区有 (逃离点, 停机坪或大门)
    if (levelId === 'SZ') {
      const exitTile = map.getRandomWalkableTileFar(
        { x: CONFIG.TILE_SIZE * 5, y: CONFIG.TILE_SIZE * 5 },
        CONFIG.TILE_SIZE * 16
      );
      if (exitTile) {
        map.exitPoints[zone] = exitTile;
        map.grid[exitTile.row][exitTile.col] = TILE.EXIT;
      }
    }
  }
}
