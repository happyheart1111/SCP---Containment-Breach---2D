// ============================================================
// world.js — 多地图世界管理器 (SCP:SL 风格)
// 4 张独立地图 (SZ/EZ/HCZ/LCZ) + 跨图传送点(检查点/电梯)
// 每张地图拥有独立的 pathfinder 与 facilities
// ============================================================

class GameWorld {
  constructor() {
    this.levels = {};          // levelId -> GameMap
    this.portals = [];         // 传送点列表
    this.pathfinders = {};     // levelId -> Pathfinder
    this.facilities = {};      // levelId -> FacilitySystem
    this.currentLevelId = 'LCZ';
    this.entities = [];        // 全地图实体 (与 AISystem 共享)
  }

  // 生成全部地图 + 传送点
  generate() {
    this.levels = {};
    this.portals = [];
    this.pathfinders = {};
    this.facilities = {};

    for (const levelId of LEVEL_ORDER) {
      const map = MapGenerator.generateLevel(levelId);
      this.levels[levelId] = map;
      this.pathfinders[levelId] = new Pathfinder(this._buildGrid(map), map.cols, map.rows);
    }

    // 创建传送点(检查点/电梯) — 双向绑定
    this._createPortals();

    // 为每张地图创建设施系统
    for (const levelId of LEVEL_ORDER) {
      this.facilities[levelId] = new FacilitySystem(this.levels[levelId]);
    }

    return this;
  }

  _buildGrid(map) {
    const grid = [];
    for (let r = 0; r < map.rows; r++) {
      grid[r] = [];
      for (let c = 0; c < map.cols; c++) {
        grid[r][c] = map.isWalkable(c, r) ? 0 : 1;
      }
    }
    return grid;
  }

  // ============================================================
  // 传送点创建 — SCP:SL 拓扑:
  //   SZ <-> EZ (检查点: 地表大门, Lv.2)
  //   EZ <-> LCZ (电梯: 办公区-轻收容)
  //   EZ <-> HCZ (电梯: 办公区-重收容)
  //   HCZ <-> LCZ (检查点: 重收容边界, Lv.3)
  // ============================================================
  _createPortals() {
    const defs = [
      { id: 'sz-ez',  type: 'checkpoint', level: 2, name: '地表大门检查点',
        a: { level: 'SZ',  slot: 'SZ-EZ' },
        b: { level: 'EZ',  slot: 'EZ-0' } },
      { id: 'ez-lcz', type: 'elevator', level: 0, name: '办公区-轻收容 电梯',
        a: { level: 'EZ',  slot: 'EZ-1' },
        b: { level: 'LCZ', slot: 'LCZ-0' } },
      { id: 'ez-hcz', type: 'elevator', level: 0, name: '办公区-重收容 电梯',
        a: { level: 'EZ',  slot: 'EZ-2' },
        b: { level: 'HCZ', slot: 'HCZ-0' } },
      { id: 'hcz-lcz', type: 'checkpoint', level: 3, name: '重收容边界检查点',
        a: { level: 'HCZ', slot: 'HCZ-1' },
        b: { level: 'LCZ', slot: 'LCZ-1' } },
    ];

    for (const def of defs) {
      const posA = this._portalPos(def.a.level, def.a.slot);
      const posB = this._portalPos(def.b.level, def.b.slot);
      if (!posA || !posB) continue;

      const pA = {
        id: def.id + '_A', type: def.type, level: def.level, name: def.name,
        levelId: def.a.level, pos: posA,
        targetLevelId: def.b.level, targetPos: posB,
      };
      const pB = {
        id: def.id + '_B', type: def.type, level: def.level, name: def.name,
        levelId: def.b.level, pos: posB,
        targetLevelId: def.a.level, targetPos: posA,
      };
      this.portals.push(pA, pB);
    }
  }

  _portalPos(levelId, slotId) {
    const map = this.levels[levelId];
    const slot = map.portalSlots.find(s => s.id === slotId);
    if (!slot) return null;
    const w = map.tileToWorld(slot.col, slot.row);
    return new Vec2(w.x, w.y);
  }

  // ============================================================
  // 查询
  // ============================================================
  getLevel(levelId) { return this.levels[levelId] || this.levels[this.currentLevelId]; }
  getPathfinder(levelId) { return this.pathfinders[levelId] || this.pathfinders[this.currentLevelId]; }
  getFacilities(levelId) { return this.facilities[levelId] || this.facilities[this.currentLevelId]; }

  // 玩家/实体附近的传送点
  getNearbyPortal(pos, levelId, range = CONFIG.TILE_SIZE * 1.6) {
    for (const p of this.portals) {
      if (p.levelId !== levelId) continue;
      if (Vec2.dist(pos, p.pos) < range) return p;
    }
    return null;
  }

  // 某一地图的所有传送点
  getPortalsIn(levelId) {
    return this.portals.filter(p => p.levelId === levelId);
  }

  // 从 fromLevel 出发, 通往 toLevel 的下一步传送点 (BFS)
  nextPortalFor(fromLevel, toLevel) {
    if (fromLevel === toLevel) return null;
    // 优先直达
    const direct = this.portals.find(p => p.levelId === fromLevel && p.targetLevelId === toLevel);
    if (direct) return direct;
    // 否则经 EZ 中转 (SCP:SL 拓扑: EZ 是枢纽)
    const viaEZ = this.portals.find(p => p.levelId === fromLevel && p.targetLevelId === 'EZ');
    if (viaEZ) return viaEZ;
    // 兜底: 任意传送点
    return this.portals.find(p => p.levelId === fromLevel) || null;
  }

  // 执行传送
  teleport(entity, portal) {
    const targetLevel = this.levels[portal.targetLevelId];
    if (!targetLevel) return false;
    entity.levelId = portal.targetLevelId;
    entity.pos = portal.targetPos.clone();
    // 实体传送冷却 (防来回弹跳)
    entity.teleportCooldown = 1.0;
    return true;
  }

  // 玩家通过传送点 (检查卡等级)
  tryUsePortal(portal, keycardLevel) {
    if (portal.type === 'elevator') return true; // 电梯无卡限制
    return keycardLevel === 0 || keycardLevel >= portal.level;
  }
}

// 地图顺序
const LEVEL_ORDER = ['SZ', 'EZ', 'HCZ', 'LCZ'];
