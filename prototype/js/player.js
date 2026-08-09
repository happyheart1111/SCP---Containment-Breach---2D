// ============================================================
// player.js — 玩家实体 (多地图版)
// - 鼠标控制朝向, WASD 仅移动 (任务2)
// - levelId 多地图 + 传送点交互 (任务3)
// - 物品栏: SCP物品 (任务4/5)
// ============================================================

class Player {
  constructor(role, spawnPos, levelId) {
    this.role = role;
    this.name = role === 'dclass' ? 'D级人员(玩家)' :
                role === 'scientist' ? '科学家(玩家)' :
                role === 'mtf' ? 'MTF特遣队(玩家)' :
                role === 'goc' ? 'GOC特工(玩家)' :
                role === 'ci' ? '混沌分裂者(玩家)' : 'SCP-173(玩家)';
    this.pos = spawnPos.clone();
    this.vel = new Vec2(0, 0);
    this.facing = 0;
    this.levelId = levelId || 'LCZ';
    this.teleportCooldown = 0;

    this.dead = false;
    this.radius = 10;
    this.hp = 100;
    this.maxHp = 100;
    this.flashTimer = 0;

    this.faction = role === 'dclass' ? 'DCLASS' :
                   role === 'mtf' ? 'FOUNDATION' :
                   role === 'scientist' ? 'SCIENTIST' :
                   role === 'goc' ? 'GOC' :
                   role === 'ci' ? 'CI' : 'SCP';
    this.factionInfo = FACTIONS[this.faction];
    this.color = this.factionInfo.color;
    this.isSCP = role === 'scp173';

    this.speed = role === 'scp173' ? 260 : 120;
    this.moveInput = { up: false, down: false, left: false, right: false };

    this.weapon = null;
    this.ammo = 0;
    this.fireCooldown = 0;
    this.pickupRange = 45;

    this.watched = false;
    this.blinkCooldown = 0;
    this.killCount = 0;

    this.containedCount = 0;
    this.recruited = false;

    this.keycardLevel = 0;
    this.interactRange = CONFIG.TILE_SIZE * 1.2;

    this._lastZone = null;

    this.input = null;
    this.mouseWorld = new Vec2(0, 0);

    // 物品栏 (任务4/5)
    this.inventory = [];
    this.maxInventory = 6;
    this.buffs = {};        // { sprint: {time,max}, invisible: {...} }
    this.baseSpeed = this.speed;

    this._initRole();
  }

  _initRole() {
    switch (this.role) {
      case 'dclass':
        this.weapon = null;
        this.keycardLevel = 1;
        this.ammo = 0;
        break;
      case 'scientist':
        this.weapon = null;
        this.keycardLevel = 2;
        this.ammo = 0;
        this.hp = 100;
        this.maxHp = 100;
        this.speed = 105;
        this.baseSpeed = 105;
        this.docCount = 0;
        this.medkit = 1;
        break;
      case 'goc':
        this.weapon = 'energy';
        this.ammo = 20;
        this.hp = 120;
        this.maxHp = 120;
        this.armor = 0.15;
        this.speed = 120;
        this.keycardLevel = 3;
        this.scpKills = 0;
        break;
      case 'ci':
        this.weapon = 'rifle';
        this.ammo = 30;
        this.hp = 130;
        this.maxHp = 130;
        this.armor = 0.20;
        this.speed = 120;
        this.keycardLevel = 3;
        this.foundationKills = 0;
        this.dclassEscorted = 0;
        break;
      case 'mtf':
        this.weapon = 'rifle';
        this.ammo = 30;
        this.hp = 150;
        this.maxHp = 150;
        this.armor = 0.30;
        this.speed = 120;
        this.keycardLevel = 4;
        break;
      case 'scp173':
        this.weapon = 'touch_kill';
        this.ammo = -1;
        this.hp = 500;
        this.maxHp = 500;
        this.armor = 1.0;
        this.speed = 260;
        this.keycardLevel = 0;
        break;
    }
  }

  // ============================================================
  // 主更新
  // ============================================================
  update(dt, ctx) {
    if (this.dead) return;

    this.fireCooldown -= dt;
    this.flashTimer = Math.max(0, this.flashTimer - dt);
    this.blinkCooldown -= dt;
    this.teleportCooldown = Math.max(0, this.teleportCooldown - dt);

    // 增益更新
    this._updateBuffs(dt);

    // 朝向: 鼠标控制 (任务2)
    this.facing = Vec2.angle(this.pos, this.mouseWorld);

    switch (this.role) {
      case 'dclass':    this._updateDClass(dt, ctx); break;
      case 'scientist': this._updateScientist(dt, ctx); break;
      case 'goc':       this._updateGOC(dt, ctx); break;
      case 'ci':        this._updateCI(dt, ctx); break;
      case 'mtf':       this._updateMTF(dt, ctx); break;
      case 'scp173':    this._updateSCP173(dt, ctx); break;
    }

    // 拾取附近物品 (任务4)
    this._tryPickupItem(ctx);
  }

  _updateBuffs(dt) {
    this.speed = this.baseSpeed;
    for (const key of Object.keys(this.buffs)) {
      const b = this.buffs[key];
      b.time -= dt;
      if (b.time <= 0) {
        delete this.buffs[key];
        if (key === 'sprint') {
          // 可乐副作用: 结束后损失少量HP
          this.hp = Math.max(1, this.hp - 10);
        }
        continue;
      }
      if (key === 'sprint') {
        this.speed = this.baseSpeed * 1.4;
        // 持续掉血
        this.hp -= dt * 2;
        if (this.hp <= 0) {
          this.hp = 0;
          this.dead = true;
          // 场景: 玩家被可乐副作用致死
          const g = this.input && this.input.onPlayerDeath ? this.input : this.game;
          if (g && g.onPlayerDeath) g.onPlayerDeath(null);
        }
      }
      if (key === 'invisible' && this.input && this.input.game) {
        // 隐形: 由渲染/AI 处理
      }
    }
  }

  // ============================================================
  // 科学家
  // ============================================================
  _updateScientist(dt, ctx) {
    this._handleMovement(dt, ctx);

    // 收集文档: 每个区域 (EZ/HCZ/SZ) 只收集一次
    const zone = this.levelId;
    if (zone && zone !== this._lastZone) {
      this._lastZone = zone;
      if (!this.collectedZones) this.collectedZones = {};
      if ((zone === 'HCZ' || zone === 'EZ' || zone === 'SZ') && !this.collectedZones[zone]) {
        this.collectedZones[zone] = true;
        this.docCount = Math.min(3, this.docCount + 1);
        ctx.game.logEvent(`发现 SCP 文档 (${this.docCount}/3)`, 'info');
      }
    }

    if (this.input.keys['KeyH'] && this.medkit > 0 && this.hp < this.maxHp) {
      this.medkit--;
      this.hp = Math.min(this.maxHp, this.hp + 50);
      ctx.game.logEvent(`使用急救包 (+50HP) 剩余 ${this.medkit}`, 'info');
    }
  }

  // ============================================================
  // GOC
  // ============================================================
  _updateGOC(dt, ctx) {
    this._handleMovement(dt, ctx);
    if (this.input.mouseDown) {
      this._tryShoot(dt, ctx);
    }
  }

  // ============================================================
  // CI
  // ============================================================
  _updateCI(dt, ctx) {
    this._handleMovement(dt, ctx);
    if (this.input.mouseDown) {
      this._tryShoot(dt, ctx);
    }

    for (const e of ctx.allEntities) {
      if (e === this || e.dead || e.isPlayer) continue;
      if (e.faction !== 'DCLASS') continue;
      const d = Vec2.dist(this.pos, e.pos);
      if (d < this.pickupRange + 10) {
        if (!e.escorted) {
          e.escorted = true;
          this.dclassEscorted++;
          ctx.game.logEvent(`接应了 D级人员 (${this.dclassEscorted}/2)`, 'info');
        }
      }
    }
  }

  // ============================================================
  // D级
  // ============================================================
  _updateDClass(dt, ctx) {
    this._handleMovement(dt, ctx);
    this._tryPickupWeapon(ctx);
    this._tryRecruit(ctx);
    if (this.weapon && this.input.mouseDown) {
      this._tryShoot(dt, ctx);
    }
  }

  // ============================================================
  // MTF
  // ============================================================
  _updateMTF(dt, ctx) {
    this._handleMovement(dt, ctx);
    if (this.input.mouseDown) {
      this._tryShoot(dt, ctx);
    }
  }

  _tryShoot(dt, ctx) {
    if (!this.weapon || this.ammo <= 0 || this.fireCooldown > 0) return;

    const wdef = WEAPONS[this.weapon];
    if (wdef.infinite) {
      // SCP-127: 无限弹药
    } else {
      this.ammo--;
    }

    this.fireCooldown = 0.15;
    if (wdef.melee) return;

    const spread = (Math.random() - 0.5) * wdef.spread * 2;
    const pellets = wdef.pellets || 1;

    for (let i = 0; i < pellets; i++) {
      const pSpread = pellets > 1 ? (Math.random() - 0.5) * wdef.spread * 2 : spread;
      const pAngle = this.facing + pSpread;
      ctx.combat.spawnBullet({
        x: this.pos.x, y: this.pos.y,
        vx: Math.cos(pAngle) * wdef.bulletSpeed,
        vy: Math.sin(pAngle) * wdef.bulletSpeed,
        damage: wdef.damage,
        scpDamage: wdef.scpDamage,
        range: wdef.range,
        traveled: 0,
        faction: this.faction,
        source: this,
        color: wdef.color,
        levelId: this.levelId,
      });
    }

    ctx.perception.emitNoise(this.pos, CONFIG.HEAR_GUNSHOT, 2, this);

    if (this.ammo === 0 && !wdef.infinite) {
      ctx.game.logEvent('弹药耗尽!', 'info');
    }
  }

  // ============================================================
  // SCP-173 (玩家版): 眨眼机制 + 猎杀
  // ============================================================
  _updateSCP173(dt, ctx) {
    // 眨眼计时 (SCP原设定: 周期眨眼, 眨眼瞬间无视注视可移动)
    if (this.blinkTimer === undefined) {
      this.blinkTimer = 2 + Math.random() * 2;
      this.blinking = false;
      this.blinkRemain = 0;
      this.blinkDuration = 0.5;
      this.blinkInterval = 4 + Math.random() * 2;
    }
    this.blinkTimer -= dt;
    if (this.blinking) {
      this.blinkRemain -= dt;
      if (this.blinkRemain <= 0) {
        this.blinking = false;
        this.blinkTimer = this.blinkInterval;
      }
    } else if (this.blinkTimer <= 0) {
      this.blinking = true;
      this.blinkRemain = this.blinkDuration;
    }

    this.watched = !this.blinking && this._isWatched(ctx);

    if (this.watched) {
      this.vel.x = 0;
      this.vel.y = 0;
    } else {
      this.speed = 260;
      this._handleMovement(dt, ctx);
    }

    for (const e of ctx.allEntities) {
      if (e === this || e.dead || e.isSCP) continue;
      if (!isHostile(this.faction, e.faction)) continue;
      const d = Vec2.dist(this.pos, e.pos);
      if (d < this.radius + e.radius + 4) {
        ctx.combat.dealDamage(e, 9999, this, 'touch_kill', ctx);
        this.killCount++;
        ctx.game.onPlayerKill(e);
      }
    }
  }

  // ============================================================
  // 移动 (WASD 仅移动, 不控制方向)
  // ============================================================
  _handleMovement(dt, ctx) {
    let dx = 0, dy = 0;
    if (this.input.keys['KeyW'] || this.input.keys['ArrowUp'])    dy -= 1;
    if (this.input.keys['KeyS'] || this.input.keys['ArrowDown'])  dy += 1;
    if (this.input.keys['KeyA'] || this.input.keys['ArrowLeft'])  dx -= 1;
    if (this.input.keys['KeyD'] || this.input.keys['ArrowRight']) dx += 1;

    if (dx !== 0 || dy !== 0) {
      const dir = new Vec2(dx, dy).normalize();
      this.vel.x = dir.x * this.speed;
      this.vel.y = dir.y * this.speed;
    } else {
      this.vel.x *= 0.8;
      this.vel.y *= 0.8;
    }

    const newX = this.pos.x + this.vel.x * dt;
    const newY = this.pos.y + this.vel.y * dt;

    const tileX = ctx.map.worldToTile(newX + Math.sign(this.vel.x || 1) * this.radius, this.pos.y);
    if (!ctx.map.isWall(tileX.col, tileX.row) && !ctx.map.isDoorBlocked(tileX.col, tileX.row, ctx.facilities)) {
      this.pos.x = newX;
    }

    const tileY = ctx.map.worldToTile(this.pos.x, newY + Math.sign(this.vel.y || 1) * this.radius);
    if (!ctx.map.isWall(tileY.col, tileY.row) && !ctx.map.isDoorBlocked(tileY.col, tileY.row, ctx.facilities)) {
      this.pos.y = newY;
    }

    this.pos.x = Math.max(this.radius, Math.min(ctx.map.cols * CONFIG.TILE_SIZE - this.radius, this.pos.x));
    this.pos.y = Math.max(this.radius, Math.min(ctx.map.rows * CONFIG.TILE_SIZE - this.radius, this.pos.y));

    if (this.vel.magSq > 100) {
      ctx.perception.emitNoise(this.pos, CONFIG.HEAR_WALK, 1, this);
    }
    // 不再设置 facing (鼠标控制)
  }

  // ============================================================
  // 物品拾取 (任务4)
  // ============================================================
  _tryPickupItem(ctx) {
    const items = ctx.items || (ctx.world ? ctx.world.items : null);
    if (!items) return;
    const item = items.getNearbyItem(this.pos, this.levelId, this.pickupRange);
    if (item) {
      items.pickup(item, this, ctx);
    }
  }

  // 使用物品 (数字键 1-6)
  tryUseInventory(index, ctx) {
    const item = this.inventory[index];
    if (!item) return;
    const itemSys = ctx.items || (ctx.world ? ctx.world.items : null);
    if (itemSys) itemSys.useItem(item, this, ctx);
  }

  // ============================================================
  // D级: 拾取武器
  // ============================================================
  _tryPickupWeapon(ctx) {
    if (this.weapon) return;
    for (const e of ctx.allEntities) {
      if (!e.dead || e.faction === this.faction) continue;
      if (e.weapon && WEAPONS[e.weapon] && !WEAPONS[e.weapon].melee) {
        const d = Vec2.dist(this.pos, e.pos);
        if (d < this.pickupRange) {
          this.weapon = e.weapon;
          this.ammo = WEAPONS[e.weapon].infinite ? -1 : Math.max(6, Math.floor(e.maxAmmo * 0.4));
          ctx.game.logEvent(`拾取了 ${WEAPONS[this.weapon].name} (${this.ammo}发)`, 'info');
          return;
        }
      }
    }
  }

  // ============================================================
  // D级: 转职
  // ============================================================
  _tryRecruit(ctx) {
    if (this.recruited) return;
    for (const e of ctx.allEntities) {
      if (e.dead || e.faction !== 'FOUNDATION') continue;
      if (e.typeId !== 'mtf_private' && e.typeId !== 'mtf_sergeant') continue;
      const d = Vec2.dist(this.pos, e.pos);
      if (d < this.pickupRange) {
        this.recruited = true;
        this.faction = 'FOUNDATION';
        this.factionInfo = FACTIONS.FOUNDATION;
        this.color = '#4488ff';
        this.weapon = 'rifle';
        this.ammo = 30;
        this.hp = Math.min(150, this.hp + 50);
        this.maxHp = 150;
        this.speed = 120;
        this.baseSpeed = 120;
        ctx.game.onPlayerRecruited(e);
        return;
      }
    }
  }

  // ============================================================
  // SCP-173: 是否被注视 (考虑隐形)
  // ============================================================
  _isWatched(ctx) {
    // 隐形帽: 不被注视
    if (this.buffs['invisible'] && this.buffs['invisible'].time > 0) return false;

    for (const e of ctx.allEntities) {
      if (e === this || e.dead || e.faction === 'SCP' || e.faction === 'ZOMBIE') continue;
      if (e.visionRange <= 0) continue;
      const d = Vec2.dist(this.pos, e.pos);
      if (d > e.visionRange) continue;
      if (e.visionAngle < Math.PI * 2) {
        const angleToMe = Vec2.angle(e.pos, this.pos);
        const diff = Math.abs(Vec2.angleDiff2(e.facing, angleToMe));
        if (diff > e.visionAngle / 2) continue;
      }
      if (PerceptionSystem._lineBlocked(e.pos, this.pos, ctx.map)) continue;
      return true;
    }
    return false;
  }

  // ============================================================
  // E 键交互
  // ============================================================
  tryInteract(ctx) {
    if (this.dead) return;

    // 1. 传送点 (电梯/检查点) — 最高优先级
    const world = ctx.world;
    if (world) {
      const portal = world.getNearbyPortal(this.pos, this.levelId);
      if (portal && this.teleportCooldown <= 0) {
        if (world.tryUsePortal(portal, this.keycardLevel)) {
          world.teleport(this, portal);
          this.vel.x = 0; this.vel.y = 0;
          ctx.game.onLevelChange(this.levelId);
          ctx.game.logEvent(`通过 ${portal.name} 进入${LEVEL_NAMES[this.levelId]}`, 'spawn');
        } else {
          ctx.game.logEvent(`权限不足! ${portal.name} 需要 Lv.${portal.level}`, 'combat');
        }
        return;
      }
    }

    const facilities = ctx.facilities;
    if (!facilities) return;

    const machine = facilities.getNearby914(this.pos, CONFIG.TILE_SIZE * 2.5);

    // 2. SCP-914 进料舱
    if (machine && !machine.processing) {
      const distIntake = Vec2.dist(this.pos, machine.intakePos);
      if (distIntake < CONFIG.TILE_SIZE * 1.2) {
        const ok = facilities.activate914(machine, ctx);
        if (ok) {
          ctx.game.logEvent('SCP-914 开始加工...', 'info');
          return;
        }
      }
    }

    // 3. SCP-914 面板
    if (machine) {
      const distPanel = Vec2.dist(this.pos, machine.panelPos);
      if (distPanel < CONFIG.TILE_SIZE * 1.5) {
        if (machine.processing) {
          ctx.game.logEvent('SCP-914 正在加工中...', 'info');
          return;
        }
        facilities.cycle914Mode(machine);
        ctx.game.logEvent(`SCP-914 模式: ${machine.mode}`, 'info');
        return;
      }
    }

    // 4. 门禁
    const door = facilities.getNearbyDoor(this.pos);
    if (door) {
      if (door.open) {
        ctx.game.logEvent(`${door.name} 已开启`, 'info');
        return;
      }
      const ok = facilities.tryOpenDoor(door, this.keycardLevel, ctx);
      if (ok) {
        ctx.game.logEvent(`${door.name} 已解锁 [卡Lv.${this._cardDisplay(this.keycardLevel)}]`, 'info');
      } else {
        ctx.game.logEvent(`权限不足! ${door.name} 需要 Lv.${door.level}`, 'combat');
      }
      return;
    }

    // 5. 尸体: 捡钥匙卡
    this._tryPickupKeycard(ctx);
  }

  _cardDisplay(level) {
    if (level === 0) return 'Omni';
    return level;
  }

  _tryPickupKeycard(ctx) {
    for (const e of ctx.allEntities) {
      if (!e.dead || e.faction === this.faction) continue;
      if (e.isSCP) continue;
      const npcCard = e.typeId ? this._npcCardFromType(e.typeId) : null;
      if (!npcCard) continue;
      const d = Vec2.dist(this.pos, e.pos);
      if (d < this.pickupRange) {
        const current = this.keycardLevel === 0 ? 99 : this.keycardLevel;
        if (npcCard > current) {
          this.keycardLevel = npcCard;
          ctx.game.logEvent(`捡到了 ${KEYCARDS[npcCard].name}`, 'info');
          return;
        }
      }
    }
  }

  _npcCardFromType(typeId) {
    switch (typeId) {
      case 'guard':       return 3;
      case 'scientist':   return 2;
      case 'mtf_private': return 4;
      case 'mtf_sergeant':return 5;
      case 'ci_soldier':  return 3;
      case 'goc_soldier': return 4;
      default:            return null;
    }
  }

  // ============================================================
  // 受击
  // ============================================================
  takeDamage(amount, damageType, attacker, ctx) {
    if (this.dead) return;

    // SCP-714 被动减伤
    if (this.inventory.some(i => i.itemId === 'scp714') && damageType !== 'touch_kill' && damageType !== 'touch_plague' && damageType !== 'pounce') {
      amount *= 0.6;
    }

    let actualDamage = amount;
    if (this.role === 'scp173') {
      ctx.game.logEvent('子弹打在 SCP-173 上弹开了', 'info');
      return;
    }

    if (this.armor && damageType !== 'touch_kill' && damageType !== 'touch_plague' && damageType !== 'pounce') {
      actualDamage = amount * (1 - this.armor);
    }

    this.hp -= actualDamage;
    this.flashTimer = 0.15;

    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      ctx.game.onPlayerDeath(attacker);
    }
  }

  get isPlayer() { return true; }
}
