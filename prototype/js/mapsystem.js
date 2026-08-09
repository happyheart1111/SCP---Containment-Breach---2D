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

    // 2. 中央基地建筑 (矩形墙 + 内部房间)
    const bx = 14, by = 10, bw = 20, bh = 12; // 建筑范围
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
    const wy = by + 4;
    for (let c = bx + 1; c < bx + bw - 1; c++) map.grid[wy][c] = TILE.WALL;
    const wx = bx + 6;
    for (let r = by + 5; r < by + bh - 1; r++) map.grid[r][wx] = TILE.WALL;
    const wx2 = bx + 14;
    for (let r = by + 1; r < by + 4; r++) map.grid[r][wx2] = TILE.WALL;

    // 门洞
    map.grid[by + 6][bx] = TILE.CORRIDOR;      // 建筑正门
    map.grid[by + 2][wx2] = TILE.CORRIDOR;
    map.grid[by + 6][wx] = TILE.CORRIDOR;
    map.grid[wy][bx + 3] = TILE.CORRIDOR;
    map.grid[by + 8][bx + bw - 1] = TILE.CORRIDOR; // 后门

    // 3. 障碍物(停机坪边缘护栏、路障等) — 随机小柱子
    const pillars = [
      [4, 3], [8, 26], [26, 3], [34, 26], [44, 8], [44, 20],
      [3, 15], [40, 4], [8, 6], [36, 28], [20, 2], [2, 24],
    ];
    for (const [c, r] of pillars) {
      if (c > 0 && c < W - 1 && r > 0 && r < H - 1) map.grid[r][c] = TILE.WALL;
    }

    // 4. 直升机停机坪标记 (左上开阔地)
    const pad = { x: 3, y: 3 };
    map.spawnPoints['HELI'] = pad;

    // 5. 传送点槽位: 建筑入口大厅 (地图世界绑定为 SZ-EZ 检查点)
    map.portalSlots.push({ id: 'SZ-EZ', col: bx + 6, row: by + 6 });
  }

  // ============================================================
  // 随机区域 (EZ/HCZ/LCZ) — BSP 房间
  // ============================================================
  static _generateRandomZone(map, levelId) {
    const pad = 1;
    const rooms = this._bspRooms(pad, pad, map.cols - pad * 2, map.rows - pad * 2, 4);
    const placedRooms = [];

    for (const room of rooms) {
      for (let r = room.y; r < room.y + room.h; r++) {
        for (let c = room.x; c < room.x + room.w; c++) {
          if (r >= 0 && r < map.rows && c >= 0 && c < map.cols) {
            map.grid[r][c] = TILE.ROOM_FLOOR;
          }
        }
      }
      placedRooms.push(room);
    }

    for (let i = 0; i < placedRooms.length - 1; i++) {
      this._carveCorridor(map, placedRooms[i], placedRooms[i + 1]);
    }
    if (placedRooms.length > 3) {
      this._carveCorridor(map, placedRooms[0], placedRooms[placedRooms.length - 1]);
    }
    map.rooms.push(...placedRooms);

    // 传送点槽位: 随机房间中心
    // EZ 需要 3 个 (SZ-EZ / EZ-LCZ / EZ-HCZ), HCZ/LCZ 各 2 个
    const centers = [];
    for (const room of placedRooms) {
      centers.push({ col: Math.floor(room.x + room.w / 2), row: Math.floor(room.y + room.h / 2) });
    }
    const shuffled = centers.sort(() => Math.random() - 0.5);
    const slots = [];
    for (const s of shuffled) {
      if (slots.length >= 3) break;
      let tooClose = false;
      for (const t of slots) {
        if (Math.abs(s.col - t.col) + Math.abs(s.row - t.row) < 10) { tooClose = true; break; }
      }
      if (!tooClose) slots.push(s);
    }
    // 若房间不够 3 个中心, 用随机 walkable 点补充
    let i = slots.length;
    while (slots.length < 3 && i < 40) {
      const t = map.getRandomWalkableTile(null);
      if (!t) break;
      let tooClose = false;
      for (const s of slots) {
        if (Math.abs(s.col - t.col) + Math.abs(s.row - t.row) < 10) { tooClose = true; break; }
      }
      if (!tooClose) slots.push(t);
      i++;
    }
    for (let idx = 0; idx < slots.length; idx++) {
      const s = slots[idx];
      // 挖一个传送厅
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
      map.spawnPoints[zone] = { col: 4, row: 4 };
      map.grid[4][4] = TILE.SPAWN;
    } else {
      const tile = map.getRandomWalkableTile(zone);
      if (tile) {
        map.spawnPoints[zone] = tile;
        map.grid[tile.row][tile.col] = TILE.SPAWN;
      }
    }

    // 出口: 仅地表区有 (逃离点, 停机坪或大门)
    if (levelId === 'SZ') {
      const exitTile = map.getRandomWalkableTileFar(
        { x: CONFIG.TILE_SIZE * 4, y: CONFIG.TILE_SIZE * 4 },
        CONFIG.TILE_SIZE * 14
      );
      if (exitTile) {
        map.exitPoints[zone] = exitTile;
        map.grid[exitTile.row][exitTile.col] = TILE.EXIT;
      }
    }
  }
}
