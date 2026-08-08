// ============================================================
// facilities.js — 设施系统: 钥匙卡门禁 + SCP-914 + 特斯拉电门
// 参考 SCP:SL (11种钥匙卡/5模式914/特斯拉电门) 简化实现
// ============================================================

// ============================================================
// 钥匙卡定义 (简化线性等级 1-5 + Omni)
// ============================================================
const KEYCARDS = {
  1: { name: '一级钥匙卡', color: '#8a8a8a', role: '清洁工' },
  2: { name: '二级钥匙卡', color: '#ffdd44', role: '科学家' },
  3: { name: '三级钥匙卡', color: '#44aaff', role: '区域经理' },
  4: { name: '四级钥匙卡', color: '#44ff88', role: '特工' },
  5: { name: '五级钥匙卡', color: '#ff44aa', role: '指挥官' },
  0: { name: '万能钥匙卡', color: '#ffffff', role: 'O5' }, // 0 = Omni
};

// 钥匙卡升级链 (914 Fine 用)
function upgradeKeycard(level) {
  if (level === 0) return 0;       // Omni 不再升级
  if (level >= 5) return 0;        // 5级 Fine → Omni (5%概率, 原型100%简化)
  return level + 1;
}

function downgradeKeycard(level) {
  if (level === 0) return 5;       // Omni 降级 → 5级
  return Math.max(0, level - 1);
}

// ============================================================
// SCP-914 模式定义
// ============================================================
const MODE_914 = {
  Rough:     { name: 'Rough',     desc: '降2级/摧毁', destroyBiomass: true,  damageBiomass: 9999 },
  Coarse:    { name: 'Coarse',    desc: '降1级/半伤', destroyBiomass: false, damageBiomass: 0.5 },
  '1:1':     { name: '1:1',       desc: '等值交换',  destroyBiomass: false,  damageBiomass: 0 },
  Fine:      { name: 'Fine',      desc: '升1级/治疗', destroyBiomass: false,  damageBiomass: -0.25 },
  'Very Fine': { name: 'Very Fine', desc: '赌升2级',  destroyBiomass: true,   damageBiomass: 9999 },
};
const MODE_ORDER = ['Rough', 'Coarse', '1:1', 'Fine', 'Very Fine'];

// 914 精加工钥匙卡
// 返回 { level, destroyed }
function refineKeycard914(level, mode) {
  switch (mode) {
    case 'Rough':
      return { level: downgradeKeycard(downgradeKeycard(level)), destroyed: level <= 2 };
    case 'Coarse':
      return { level: downgradeKeycard(level), destroyed: level <= 1 };
    case '1:1':
      return { level, destroyed: false }; // 等值交换 (原型: 等级不变)
    case 'Fine':
      return { level: upgradeKeycard(level), destroyed: false };
    case 'Very Fine': {
      const roll = Math.random();
      if (roll < 0.5) return { level: upgradeKeycard(upgradeKeycard(level)), destroyed: false }; // 50% 升2级
      if (roll < 0.75) return { level, destroyed: false }; // 25% 不变
      return { level, destroyed: true }; // 25% 摧毁
    }
  }
}

// 914 精加工武器: 返回新武器或 null (摧毁)
function refineWeapon914(weapon, mode) {
  const WEAPON_TIERS = {
    pistol: 2, rifle: 3, shotgun: 4, energy: 5,
  };
  const REVERSE = { 2: 'pistol', 3: 'rifle', 4: 'shotgun', 5: 'energy' };

  const tier = WEAPON_TIERS[weapon];
  if (!tier) return { weapon: null, destroyed: true }; // 非升级链武器

  switch (mode) {
    case 'Rough':
      return { weapon: null, destroyed: true };
    case 'Coarse': {
      const newTier = Math.max(2, tier - 1);
      return { weapon: REVERSE[newTier], destroyed: false };
    }
    case '1:1':
      return { weapon, destroyed: false };
    case 'Fine': {
      if (tier >= 5) return { weapon, destroyed: false }; // 能量武器不升
      return { weapon: REVERSE[tier + 1], destroyed: false };
    }
    case 'Very Fine': {
      const roll = Math.random();
      if (roll < 0.5 && tier < 5) return { weapon: REVERSE[tier + 1], destroyed: false };
      if (roll < 0.75) return { weapon, destroyed: false };
      return { weapon: null, destroyed: true };
    }
  }
}

// ============================================================
// FacilitySystem — 管理所有设施对象
// ============================================================
class FacilitySystem {
  constructor(map) {
    this.map = map;
    this.doors = [];          // 钥匙卡门禁
    this.machines914 = [];    // SCP-914
    this.teslaGates = [];     // 特斯拉电门
    this._placeFacilities();
  }

  // ============================================================
  // 地图生成时放置设施
  // ============================================================
  _placeFacilities() {
    // ---- 1. 区域检查点门禁 ----
    // 在区域边界通道上放置门禁 (LCZ-HCZ / HCZ-EZ / EZ-SZ)
    const checkpoints = [
      // LCZ(左) <-> HCZ(右) 边界 x=31
      { col: 31, row: 5,  level: 3, name: 'LCZ-HCZ 检查点' },
      { col: 31, row: 14, level: 3, name: 'LCZ-HCZ 检查点' },
      // LCZ(上) <-> EZ(下) 边界 y=19
      { col: 10, row: 19, level: 2, name: 'LCZ-EZ 检查点' },
      { col: 22, row: 19, level: 2, name: 'LCZ-EZ 检查点' },
      // HCZ(上) <-> SZ(下) 边界 y=19
      { col: 42, row: 19, level: 4, name: 'HCZ-SZ 检查点' },
      { col: 54, row: 19, level: 4, name: 'HCZ-SZ 检查点' },
      // EZ(左) <-> SZ(右) 边界 x=31
      { col: 31, row: 25, level: 5, name: 'EZ-SZ 检查点' },
      { col: 31, row: 33, level: 5, name: 'EZ-SZ 检查点' },
    ];

    for (const cp of checkpoints) {
      // 检查该位置是否真的是通道 (非墙)
      if (this.map.isWalkable(cp.col, cp.row)) {
        this.doors.push({
          id: 'door_' + this.doors.length,
          col: cp.col, row: cp.row,
          level: cp.level,
          name: cp.name,
          open: false,
          locked: true,
          type: 'checkpoint',
        });
        // 标记为门禁 tile
        this.map.grid[cp.row][cp.col] = TILE.DOOR;
      }
    }

    // ---- 2. SCP-914 室 (LCZ) ----
    this._place914();

    // ---- 3. 特斯拉电门 (HCZ/EZ 走廊) ----
    this._placeTeslaGates();
  }

  _place914() {
    // 在 LCZ 找一个房间的中心作为 914 室
    const lczTiles = [];
    for (let r = 0; r < 20; r++) {
      for (let c = 0; c < 32; c++) {
        if (this.map.isWalkable(c, r) && this.map.zoneMap[r][c] === 'LCZ') {
          lczTiles.push({ col: c, row: r });
        }
      }
    }
    if (lczTiles.length === 0) return;

    // 随机选一个房间中心点
    const center = lczTiles[Math.floor(Math.random() * lczTiles.length)];
    const worldPos = this.map.tileToWorld(center.col, center.row);

    this.machines914.push({
      id: '914_0',
      panelPos: new Vec2(worldPos.x, worldPos.y),
      mode: 'Fine',
      modeIndex: 3,
      processing: false,
      processTimer: 0,
      PROCESS_TIME: 3, // 秒
      // 进料/出料舱 (简化: 面板左右各 1.5 格)
      intakePos: new Vec2(worldPos.x - CONFIG.TILE_SIZE * 1.5, worldPos.y),
      outputPos: new Vec2(worldPos.x + CONFIG.TILE_SIZE * 1.5, worldPos.y),
      inputPlayerId: null, // 站进料舱的玩家
      lastResult: '',
      resultTimer: 0,
    });
  }

  _placeTeslaGates() {
    // 在 HCZ 和 EZ 的走廊随机放置 2-3 个特斯拉电门
    const corridors = [];
    for (let r = 0; r < this.map.rows; r++) {
      for (let c = 0; c < this.map.cols; c++) {
        if (this.map.grid[r][c] === TILE.CORRIDOR) {
          const zone = this.map.zoneMap[r][c];
          if (zone === 'HCZ' || zone === 'EZ') {
            corridors.push({ col: c, row: r, zone });
          }
        }
      }
    }
    if (corridors.length === 0) return;

    // 随机选 2-3 个, 间隔至少 8 格
    const count = Math.min(3, corridors.length);
    const selected = [];
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * corridors.length);
      const tile = corridors[idx];
      // 避免与已选的太近
      let tooClose = false;
      for (const s of selected) {
        if (Math.abs(s.col - tile.col) + Math.abs(s.row - tile.row) < 10) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      selected.push(tile);
      const worldPos = this.map.tileToWorld(tile.col, tile.row);
      this.teslaGates.push({
        id: 'tesla_' + this.teslaGates.length,
        col: tile.col, row: tile.row,
        zone: tile.zone,
        pos: new Vec2(worldPos.x, worldPos.y),
        state: 'idle',        // idle | charging | discharging
        stateTimer: 0,
        cycle: 4 + Math.random() * 2, // 放电周期
        chargeTime: 0.6,      // 充能时间(预兆)
        dischargeTime: 0.8,   // 放电持续时间
        cooldown: 2 + Math.random() * 2, // 放电后冷却
        lastDischarge: 0,
        arcParticles: [],
      });
    }
  }

  // ============================================================
  // 更新 (特斯拉电门周期 + 914 处理)
  // ============================================================
  update(dt, ctx) {
    this._updateTeslaGates(dt, ctx);
    this._update914(dt, ctx);
  }

  // ---- 特斯拉电门 ----
  _updateTeslaGates(dt, ctx) {
    for (const gate of this.teslaGates) {
      // 检查有没有实体在门内
      const entityInGate = this._entityInTesla(gate, ctx.allEntities);

      // 状态机
      switch (gate.state) {
        case 'idle':
          gate.stateTimer += dt;
          // 有实体接近 → 开始充能
          if (entityInGate || gate.stateTimer >= gate.cycle) {
            gate.state = 'charging';
            gate.stateTimer = 0;
          }
          break;

        case 'charging':
          gate.stateTimer += dt;
          if (gate.stateTimer >= gate.chargeTime) {
            gate.state = 'discharging';
            gate.stateTimer = 0;
            gate.lastDischarge = ctx.gameTime;
            this._discharge(gate, ctx);
          }
          break;

        case 'discharging':
          gate.stateTimer += dt;
          if (gate.stateTimer >= gate.dischargeTime) {
            gate.state = 'idle';
            gate.stateTimer = 0;
          }
          break;
      }
    }
  }

  _entityInTesla(gate, entities) {
    for (const e of entities) {
      if (e.dead) continue;
      const d = Vec2.dist(e.pos, gate.pos);
      if (d < CONFIG.TILE_SIZE * 0.9) return e;
    }
    return null;
  }

  _discharge(gate, ctx) {
    // 对门内实体造成伤害
    const entity = this._entityInTesla(gate, ctx.allEntities);
    if (!entity) return;

    let damage;
    if (entity.isPlayer) {
      // 玩家: SCP-173 玩家免疫, 其他人类致命
      damage = entity.role === 'scp173' ? 0 : 100;
    } else if (entity.isSCP) {
      // AI SCP: 173 免疫, 其他受伤
      damage = entity.typeId === 'scp_173' ? 0 : 60;
    } else {
      // AI 人类: 致命
      damage = 100;
    }

    if (damage > 0) {
      ctx.combat.dealDamage(entity, damage, null, 'tesla', ctx);
      ctx.game.logEvent(`${entity.name} 被特斯拉电门击中 (-${damage})`, 'combat');
    }

    // 电弧粒子
    for (let i = 0; i < 12; i++) {
      gate.arcParticles.push({
        x: gate.pos.x, y: gate.pos.y,
        life: 0.4 + Math.random() * 0.3,
        maxLife: 0.7,
        dx: (Math.random() - 0.5) * 60,
        dy: (Math.random() - 0.5) * 60,
      });
    }
  }

  // ---- SCP-914 ----
  _update914(dt, ctx) {
    for (const m of this.machines914) {
      // 结果提示计时
      if (m.resultTimer > 0) {
        m.resultTimer -= dt;
        if (m.resultTimer <= 0) m.lastResult = '';
      }

      // 处理中
      if (m.processing) {
        m.processTimer -= dt;
        if (m.processTimer <= 0) {
          m.processing = false;
          this._complete914(m, ctx);
        }
      }
    }
  }

  // 切换模式
  cycle914Mode(machine) {
    machine.modeIndex = (machine.modeIndex + 1) % MODE_ORDER.length;
    machine.mode = MODE_ORDER[machine.modeIndex];
  }

  // 激活 914 (玩家按 E)
  activate914(machine, ctx) {
    if (machine.processing) return false;

    const player = ctx.player;
    if (!player || player.dead) return false;

    // 检查玩家是否在进料舱附近
    const dist = Vec2.dist(player.pos, machine.intakePos);
    if (dist > CONFIG.TILE_SIZE * 1.5) {
      ctx.game.logEvent('需要站在进料舱(左侧)内', 'info');
      return false;
    }

    // 开始处理
    machine.processing = true;
    machine.processTimer = machine.PROCESS_TIME;
    machine.inputPlayerId = player;

    // 生物效果 (在舱内)
    const mode = MODE_914[machine.mode];
    if (mode.damageBiomass !== 0 && mode.damageBiomass !== 1) {
      // 存档玩家状态, 处理完成后结算
    }

    ctx.game.logEvent(`SCP-914 启动... (${machine.mode})`, 'info');
    return true;
  }

  _complete914(machine, ctx) {
    const player = machine.inputPlayerId;
    machine.inputPlayerId = null;
    if (!player || player.dead) return;

    const mode = MODE_914[machine.mode];

    // ---- 生物效果 ----
    if (mode.damageBiomass === 9999) {
      // Rough / Very Fine 摧毁生物
      if (player.role !== 'scp173') {
        ctx.combat.dealDamage(player, 9999, null, 'tesla', ctx);
        ctx.game.logEvent('SCP-914 摧毁了你!', 'death');
        return;
      }
    } else if (mode.damageBiomass === 0.5) {
      // Coarse: 50% 生命
      const dmg = Math.floor(player.hp * 0.5);
      ctx.combat.dealDamage(player, dmg, null, 'tesla', ctx);
      ctx.game.logEvent(`SCP-914 粗加工: -${dmg}HP`, 'combat');
    } else if (mode.damageBiomass < 0) {
      // Fine: 治疗 25%
      const heal = Math.floor(player.maxHp * 0.25);
      player.hp = Math.min(player.maxHp, player.hp + heal);
      ctx.game.logEvent(`SCP-914 精加工: +${heal}HP`, 'info');
    }

    // ---- 物品精加工 ----
    if (player.keycardLevel > 0) {
      const result = refineKeycard914(player.keycardLevel, machine.mode);
      if (result.destroyed) {
        player.keycardLevel = 0;
        ctx.game.logEvent('钥匙卡被 SCP-914 摧毁了!', 'combat');
      } else {
        player.keycardLevel = result.level;
        const cardName = KEYCARDS[player.keycardLevel]?.name || '未知';
        ctx.game.logEvent(`钥匙卡精加工完成: ${cardName}`, 'info');
      }
    }

    if (player.weapon && WEAPONS[player.weapon]) {
      const result = refineWeapon914(player.weapon, machine.mode);
      if (result.destroyed) {
        player.weapon = null;
        player.ammo = 0;
        ctx.game.logEvent('武器被 SCP-914 摧毁了!', 'combat');
      } else if (result.weapon && result.weapon !== player.weapon) {
        player.weapon = result.weapon;
        player.ammo = Math.max(player.ammo, WEAPONS[player.weapon].damage > 40 ? 6 : 12);
        ctx.game.logEvent(`武器精加工完成: ${WEAPONS[player.weapon].name}`, 'info');
      }
    }

    machine.lastResult = `${machine.mode} 完成`;
    machine.resultTimer = 3;
  }

  // ============================================================
  // 门禁操作
  // ============================================================
  // 尝试开门 (玩家/AI 调用)
  tryOpenDoor(door, keycardLevel, ctx) {
    if (door.open) return true;

    // Omni (0) 或 等级足够
    if (keycardLevel === 0 || keycardLevel >= door.level) {
      door.open = true;
      door.locked = false;
      return true;
    }
    return false;
  }

  // 获取玩家附近的门
  getNearbyDoor(pos, range = CONFIG.TILE_SIZE * 1.2) {
    for (const door of this.doors) {
      const w = this.map.tileToWorld(door.col, door.row);
      if (Vec2.dist(pos, new Vec2(w.x, w.y)) < range) {
        return door;
      }
    }
    return null;
  }

  // 获取玩家附近的 914
  getNearby914(pos, range = CONFIG.TILE_SIZE * 2) {
    for (const m of this.machines914) {
      if (Vec2.dist(pos, m.panelPos) < range) return m;
    }
    return null;
  }

  // AI NPC 的门禁处理: NPC 有卡自动开门
  handleNPCDoor(npc, ctx) {
    const door = this.getNearbyDoor(npc.pos);
    if (!door || door.open) return;

    // 获得 NPC 的钥匙卡等级
    const cardLevel = this._npcCardLevel(npc);
    if (cardLevel === null) return; // 无卡

    if (this.tryOpenDoor(door, cardLevel, ctx)) {
      // 短暂停留 (开门动画时间)
      npc.doorCooldown = 0.8;
    }
  }

  _npcCardLevel(npc) {
    if (npc.isSCP || npc.faction === 'ZOMBIE' || npc.faction === 'SCP' || npc.faction === 'WILD') {
      return 0; // Omni: SCP 能过任何门
    }
    switch (npc.typeId) {
      case 'guard':       return 3;
      case 'scientist':   return 2;
      case 'mtf_private': return 4;
      case 'mtf_sergeant':return 4;
      case 'ci_soldier':  return 3;
      case 'goc_soldier': return 4;
      default:            return null;
    }
  }
}
