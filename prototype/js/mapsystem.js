// ============================================================
// mapsystem.js — 随机设施地图生成 + 网格管理
// ============================================================

// Tile 类型
const TILE = {
  EMPTY: 0,    // 可通行地面
  WALL: 1,     // 墙壁
  DOOR: 2,     // 门 (可通行)
  ROOM_FLOOR: 3, // 房间地面 (可通行, 视觉区分)
  CORRIDOR: 4,   // 走廊 (可通行)
  ZONE_BORDER: 5, // 区域边界门
  EXIT: 6,       // 出口
  SPAWN: 7,      // 出生点标记
};

class GameMap {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.grid = [];
    this.rooms = [];
    this.zoneMap = []; // 每格属于哪个 zone
    this.doors = [];
    this.spawnPoints = {};
    this.exitPoints = {};

    this._initGrid();
  }

  _initGrid() {
    for (let r = 0; r < this.rows; r++) {
      this.grid[r] = [];
      this.zoneMap[r] = [];
      for (let c = 0; c < this.cols; c++) {
        this.grid[r][c] = TILE.WALL;
        this.zoneMap[r][c] = null;
      }
    }
  }

  getZone(col, row) {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return null;
    return this.zoneMap[row][col];
  }

  isWalkable(col, row) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return false;
    const t = this.grid[row][col];
    return t === TILE.EMPTY || t === TILE.ROOM_FLOOR || t === TILE.CORRIDOR ||
           t === TILE.DOOR || t === TILE.ZONE_BORDER || t === TILE.EXIT || t === TILE.SPAWN;
  }

  isWall(col, row) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return true;
    return this.grid[row][col] === TILE.WALL;
  }

  // 阻挡视线: 墙壁挡, 门不挡, 走廊不挡
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

  // 获取区域内随机可通行 tile
  getRandomWalkableTile(zone) {
    const candidates = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.zoneMap[r][c] === zone && this.isWalkable(c, r)) {
          candidates.push({ col: c, row: r });
        }
      }
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
}

// ============================================================
// 地图生成器 — 简化版 BSP 房间生成
// ============================================================

class MapGenerator {
  static generate() {
    const map = new GameMap(CONFIG.MAP_COLS, CONFIG.MAP_ROWS);
    const zoneDefs = [
      { id: 'LCZ', col: 0,  row: 0,  w: 32, h: 20 },
      { id: 'HCZ', col: 32, row: 0,  w: 32, h: 20 },
      { id: 'EZ',  col: 0,  row: 20, w: 32, h: 20 },
      { id: 'SZ',  col: 32, row: 20, w: 32, h: 20 },
    ];

    // 为每个 zone 生成房间
    for (const zd of zoneDefs) {
      this._generateZone(map, zd);
    }

    // 连接 zone (区域间通道)
    this._connectZones(map, zoneDefs);

    // 设置出生点和出口
    this._setupSpawnAndExit(map);

    return map;
  }

  static _generateZone(map, zd) {
    const rooms = this._bspRooms(zd.col, zd.row, zd.w, zd.h, 4);
    const placedRooms = [];

    for (const room of rooms) {
      // 挖出房间
      for (let r = room.y; r < room.y + room.h; r++) {
        for (let c = room.x; c < room.x + room.w; c++) {
          if (r >= 0 && r < map.rows && c >= 0 && c < map.cols) {
            map.grid[r][c] = TILE.ROOM_FLOOR;
            map.zoneMap[r][c] = zd.id;
          }
        }
      }
      placedRooms.push(room);
    }

    // 用走廊连接房间
    for (let i = 0; i < placedRooms.length - 1; i++) {
      this._carveCorridor(map, placedRooms[i], placedRooms[i + 1], zd.id);
    }

    // 随机连接一些非相邻房间增加路径多样性
    if (placedRooms.length > 3) {
      const a = placedRooms[0];
      const b = placedRooms[placedRooms.length - 1];
      this._carveCorridor(map, a, b, zd.id);
    }

    map.rooms.push(...placedRooms.map(r => ({ ...r, zone: zd.id })));
  }

  // 简单 BSP: 把区域递归切分
  static _bspRooms(x, y, w, h, depth) {
    if (depth <= 0 || w < 8 || h < 6) {
      const pad = 1;
      return [{
        x: x + pad,
        y: y + pad,
        w: Math.max(4, w - pad * 2),
        h: Math.max(4, h - pad * 2),
      }];
    }

    const rooms = [];
    if (w > h || (w === h && Math.random() < 0.5)) {
      // 垂直切
      const split = Math.floor(w / 2) + (Math.random() < 0.5 ? -1 : 1);
      rooms.push(...this._bspRooms(x, y, split, h, depth - 1));
      rooms.push(...this._bspRooms(x + split, y, w - split, h, depth - 1));
    } else {
      // 水平切
      const split = Math.floor(h / 2) + (Math.random() < 0.5 ? -1 : 1);
      rooms.push(...this._bspRooms(x, y, w, split, depth - 1));
      rooms.push(...this._bspRooms(x, y + split, w, h - split, depth - 1));
    }
    return rooms;
  }

  static _carveCorridor(map, roomA, roomB, zoneId) {
    const ax = Math.floor(roomA.x + roomA.w / 2);
    const ay = Math.floor(roomA.y + roomA.h / 2);
    const bx = Math.floor(roomB.x + roomB.w / 2);
    const by = Math.floor(roomB.y + roomB.h / 2);

    // L 形走廊
    const horizFirst = Math.random() < 0.5;
    if (horizFirst) {
      this._carveHLine(map, ax, bx, ay, zoneId);
      this._carveVLine(map, ay, by, bx, zoneId);
    } else {
      this._carveVLine(map, ay, by, ax, zoneId);
      this._carveHLine(map, ax, bx, by, zoneId);
    }
  }

  static _carveHLine(map, x1, x2, y, zoneId) {
    const [a, b] = x1 < x2 ? [x1, x2] : [x2, x1];
    for (let x = a; x <= b; x++) {
      if (y >= 0 && y < map.rows && x >= 0 && x < map.cols) {
        if (map.grid[y][x] === TILE.WALL) {
          map.grid[y][x] = TILE.CORRIDOR;
        }
        map.zoneMap[y][x] = map.zoneMap[y][x] || zoneId;
      }
    }
  }

  static _carveVLine(map, y1, y2, x, zoneId) {
    const [a, b] = y1 < y2 ? [y1, y2] : [y2, y1];
    for (let y = a; y <= b; y++) {
      if (y >= 0 && y < map.rows && x >= 0 && x < map.cols) {
        if (map.grid[y][x] === TILE.WALL) {
          map.grid[y][x] = TILE.CORRIDOR;
        }
        map.zoneMap[y][x] = map.zoneMap[y][x] || zoneId;
      }
    }
  }

  // 在 zone 边界开门连接
  static _connectZones(map, zoneDefs) {
    // LCZ <-> HCZ (上方水平连接)
    this._punchDoor(map, 31, 5, 'LCZ', 'HCZ');
    this._punchDoor(map, 31, 14, 'LCZ', 'HCZ');

    // LCZ <-> EZ (左侧垂直连接)
    this._punchDoor(map, 10, 19, 'LCZ', 'EZ');
    this._punchDoor(map, 22, 19, 'LCZ', 'EZ');

    // HCZ <-> SZ (右侧垂直连接)
    this._punchDoor(map, 42, 19, 'HCZ', 'SZ');
    this._punchDoor(map, 54, 19, 'HCZ', 'SZ');

    // EZ <-> SZ (下方水平连接)
    this._punchDoor(map, 31, 25, 'EZ', 'SZ');
    this._punchDoor(map, 31, 33, 'EZ', 'SZ');

    // HCZ <-> EZ (对角连接, 额外路径)
    this._punchDoor(map, 31, 19, 'HCZ', 'EZ');
  }

  static _punchDoor(map, col, row, zoneA, zoneB) {
    // 挖出一个 1x2 的通道 + 门
    for (let dr = 0; dr <= 1; dr++) {
      for (let dc = -0; dc <= 0; dc++) {
        const r = row + dr;
        const c = col + dc;
        if (r >= 0 && r < map.rows && c >= 0 && c < map.cols) {
          map.grid[r][c] = TILE.ZONE_BORDER;
          if (!map.zoneMap[r][c]) map.zoneMap[r][c] = zoneA;
        }
      }
    }
    map.doors.push({ col, row, zoneA, zoneB, open: true });
  }

  static _setupSpawnAndExit(map) {
    // 出生点: 每个 zone 一个
    for (const zoneId of ['LCZ', 'HCZ', 'EZ', 'SZ']) {
      const tile = map.getRandomWalkableTile(zoneId);
      if (tile) {
        map.spawnPoints[zoneId] = tile;
        map.grid[tile.row][tile.col] = TILE.SPAWN;
      }
    }

    // 出口: SZ 边缘
    const szTile = map.getRandomWalkableTile('SZ');
    if (szTile) {
      map.exitPoints['SZ'] = szTile;
      map.grid[szTile.row][szTile.col] = TILE.EXIT;
    }
  }
}
