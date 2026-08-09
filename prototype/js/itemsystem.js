// ============================================================
// itemsystem.js — 物品刷新系统 (SCP:SL + RXSEND 风格)
// 每张地图有刷新点, 周期刷新药品/武器/SCP物品
// ============================================================

class ItemSystem {
  constructor(world) {
    this.world = world;
    this.items = [];            // 当前存在地图上的物品
    this.spawnPoints = [];      // 刷新点
    this.nextId = 1;
    this._initSpawnPoints();
    this._initialSpawn();
  }

  // ============================================================
  // 刷新点初始化
  // ============================================================
  _initSpawnPoints() {
    this.spawnPoints = [];
    for (const levelId of LEVEL_ORDER) {
      const map = this.world.levels[levelId];
      const cfg = ITEM_SPAWN_CONFIG[levelId];
      if (!map || !cfg) continue;

      const count = cfg.count || 8;
      let placed = 0;
      let guard = 0;
      while (placed < count && guard < 300) {
        guard++;
        const tile = map.getRandomWalkableTile(null);
        if (!tile) break;
        const w = map.tileToWorld(tile.col, tile.row);
        const pos = new Vec2(w.x, w.y);
        // 避免与传送点/出生点太近
        let tooClose = false;
        for (const p of this.world.getPortalsIn(levelId)) {
          if (Vec2.dist(pos, p.pos) < CONFIG.TILE_SIZE * 3) { tooClose = true; break; }
        }
        const spawn = map.spawnPoints[levelId];
        if (spawn) {
          const sw = map.tileToWorld(spawn.col, spawn.row);
          if (Vec2.dist(pos, new Vec2(sw.x, sw.y)) < CONFIG.TILE_SIZE * 3) tooClose = true;
        }
        if (tooClose) continue;
        this.spawnPoints.push({ levelId, pos, timer: 0, occupied: false, item: null });
        placed++;
      }
    }
  }

  // 开局立即刷一部分物品
  _initialSpawn() {
    for (const sp of this.spawnPoints) {
      if (Math.random() < 0.7) {
        this._spawnAt(sp);
      }
    }
  }

  // ============================================================
  // 物品生成
  // ============================================================
  _pickItem(levelId) {
    const cfg = ITEM_SPAWN_CONFIG[levelId];
    if (!cfg || !cfg.items.length) return 'medkit';
    const pool = cfg.items;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // 在刷新点生成一个物品
  _spawnAt(sp) {
    const itemId = this._pickItem(sp.levelId);
    const item = this._makeItem(itemId, sp.pos.clone(), sp.levelId);
    if (!item) return;
    this.items.push(item);
    sp.occupied = true;
    sp.item = item;
  }

  _makeItem(itemId, pos, levelId) {
    const def = SCP_ITEMS[itemId];
    if (!def) return null;

    const item = {
      id: 'item_' + (this.nextId++),
      itemId,
      def,
      pos,
      levelId,
      taken: false,
      respawnTimer: 0,
    };

    // 特殊物品生成细节
    if (itemId === 'keycard') {
      // 随机 1-4 级卡
      item.def = { ...def, cardLevel: 1 + Math.floor(Math.random() * 4) };
    } else if (itemId === 'weapon') {
      // 按权重随机武器
      const pool = WEAPON_SPAWN_POOL;
      let total = 0;
      for (const p of pool) total += p.w;
      let roll = Math.random() * total;
      let chosen = pool[0].weapon;
      for (const p of pool) {
        roll -= p.w;
        if (roll <= 0) { chosen = p.weapon; break; }
      }
      item.def = { ...def, weapon: chosen, name: WEAPONS[chosen].name };
    }
    return item;
  }

  // ============================================================
  // 更新 (刷新计时)
  // ============================================================
  update(dt) {
    const respawnTime = ITEM_SPAWN_CONFIG.ITEM_RESPAWN_TIME;

    // 刷新点计时: 物品被拾取后重新计时
    for (const sp of this.spawnPoints) {
      if (sp.occupied) continue;
      sp.timer += dt;
      if (sp.timer >= respawnTime) {
        sp.timer = 0;
        this._spawnAt(sp);
      }
    }

    // 拾取后的物品计时 (被拾取 = 从 items 移除, 由刷新点计时)
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.taken) {
        this.items.splice(i, 1);
      }
    }
  }

  // ============================================================
  // 拾取
  // ============================================================
  getNearbyItem(pos, levelId, range = 30) {
    for (const item of this.items) {
      if (item.taken || item.levelId !== levelId) continue;
      if (Vec2.dist(pos, item.pos) < range) return item;
    }
    return null;
  }

  // 玩家拾取物品
  pickup(item, player, ctx) {
    if (!item || item.taken) return false;
    item.taken = true;

    // 关联刷新点
    const sp = this.spawnPoints.find(s => s.item === item);
    if (sp) {
      sp.occupied = false;
      sp.item = null;
      sp.timer = 0;
    }

    const def = item.def;
    const game = ctx.game;

    switch (def.category) {
      case 'consumable':
        // 加入玩家物品栏
        if (player.inventory.length >= player.maxInventory) {
          ctx.game.logEvent('物品栏已满!', 'combat');
          item.taken = false;
          if (sp) { sp.occupied = true; sp.item = item; }
          return false;
        }
        player.inventory.push(item);
        ctx.game.logEvent(`拾取: ${def.name}`, 'info');
        return true;

      case 'passive':
        player.inventory.push(item);
        ctx.game.logEvent(`拾取: ${def.name}`, 'info');
        return true;

      case 'weapon': {
        const wname = def.name || (def.weapon ? WEAPONS[def.weapon].name : '武器');
        const ammoBase = WEAPONS[def.weapon] ? (WEAPONS[def.weapon].infinite ? -1 : 15) : 0;
        // 替换当前武器 (SCP-127 无限弹)
        if (player.weapon) {
          ctx.game.logEvent(`丢弃 ${WEAPONS[player.weapon].name}`, 'info');
        }
        player.weapon = def.weapon;
        player.ammo = ammoBase;
        ctx.game.logEvent(`拾取武器: ${wname}`, 'info');
        return true;
      }

      case 'keycard': {
        const cl = def.cardLevel || 1;
        if (cl > (player.keycardLevel === 0 ? 99 : player.keycardLevel)) {
          player.keycardLevel = cl;
          ctx.game.logEvent(`拾取: ${KEYCARDS[cl].name}`, 'info');
        } else {
          ctx.game.logEvent(`钥匙卡等级不足提升 (Lv.${cl})`, 'info');
        }
        return true;
      }

      case 'ammo': {
        if (player.weapon && WEAPONS[player.weapon] && !WEAPONS[player.weapon].infinite && player.ammo >= 0) {
          player.ammo += def.ammoAmount || 15;
          ctx.game.logEvent(`拾取弹药: +${def.ammoAmount || 15}`, 'info');
        } else if (!player.weapon) {
          ctx.game.logEvent('没有武器, 弹药无法使用', 'info');
        }
        return true;
      }
    }
    return false;
  }

  // 物品使用 (数字键)
  useItem(item, player, ctx) {
    if (!item) return;
    const def = item.def;

    if (def.category === 'consumable') {
      // 治疗
      if (def.heal) {
        const healed = Math.min(player.maxHp - player.hp, def.heal === 9999 ? player.maxHp : def.heal);
        if (healed <= 0) {
          ctx.game.logEvent('生命值已满', 'info');
          return;
        }
        player.hp += healed;
        ctx.game.logEvent(`使用 ${def.name}: +${Math.round(healed)} HP`, 'info');
      }
      // 增益
      if (def.buff) {
        player.buffs[def.buff] = { time: def.buffTime, max: def.buffTime };
        ctx.game.logEvent(`使用 ${def.name}: ${def.desc}`, 'info');
      }
      // 从物品栏移除
      const idx = player.inventory.indexOf(item);
      if (idx >= 0) player.inventory.splice(idx, 1);
    }
  }
}
