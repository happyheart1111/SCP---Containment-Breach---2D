// ============================================================
// player.js — 玩家实体 (D级 / MTF / SCP-173 三种模式)
// 玩家被 AI 感知系统当作普通实体处理, 阵营关系决定敌我
// ============================================================

class Player {
  constructor(role, spawnPos) {
    this.role = role; // 'dclass' | 'mtf' | 'scp173'
    this.name = role === 'dclass' ? 'D级人员(玩家)' :
                role === 'mtf'    ? 'MTF特遣队(玩家)' : 'SCP-173(玩家)';
    this.pos = spawnPos.clone();
    this.vel = new Vec2(0, 0);
    this.facing = 0;

    this.dead = false;
    this.radius = 10;
    this.hp = 100;
    this.maxHp = 100;
    this.flashTimer = 0;

    // 阵营按角色设置
    this.faction = role === 'dclass' ? 'DCLASS' :
                   role === 'mtf'    ? 'FOUNDATION' : 'SCP';
    this.factionInfo = FACTIONS[this.faction];
    this.color = this.factionInfo.color;
    this.isSCP = role === 'scp173';

    // 移动
    this.speed = role === 'scp173' ? 260 : 120;
    this.moveInput = { up: false, down: false, left: false, right: false };

    // 武器 (MTF / D级拾取)
    this.weapon = null;
    this.ammo = 0;
    this.fireCooldown = 0;
    this.pickupRange = 45;   // 拾取/互动距离

    // SCP-173 专用
    this.watched = false;     // 是否被AI注视
    this.blinkCooldown = 0;   // 瞬移冷却
    this.killCount = 0;       // 击杀数

    // MTF 专用
    this.containedCount = 0;  // 收容进度

    // 转职状态 (D级)
    this.recruited = false;   // 被MTF招募

    // 输入引用 (由 game 注入)
    this.input = null;
    this.mouseWorld = new Vec2(0, 0);

    // 角色属性
    this._initRole();
  }

  _initRole() {
    switch (this.role) {
      case 'dclass':
        this.weapon = null; // 无武器, 需拾取
        this.ammo = 0;
        break;
      case 'mtf':
        this.weapon = 'rifle';
        this.ammo = 30;
        this.hp = 150;
        this.maxHp = 150;
        this.armor = 0.30;
        this.speed = 120;
        break;
      case 'scp173':
        this.weapon = 'touch_kill';
        this.ammo = -1;
        this.hp = 500;
        this.maxHp = 500;
        this.armor = 1.0;
        this.speed = 260;
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

    switch (this.role) {
      case 'dclass':  this._updateDClass(dt, ctx);  break;
      case 'mtf':     this._updateMTF(dt, ctx);     break;
      case 'scp173':  this._updateSCP173(dt, ctx);  break;
    }
  }

  // ============================================================
  // D级: 拾荒逃亡
  // ============================================================
  _updateDClass(dt, ctx) {
    this._handleMovement(dt, ctx);

    // 拾取武器 (铁管/手枪从尸体, 原型: 靠近敌对尸体自动拾取)
    this._tryPickupWeapon(ctx);

    // 转职: 接触MTF NPC
    this._tryRecruit(ctx);

    // 有武器后可射击
    if (this.weapon && this.input.mouseDown) {
      this._tryShoot(dt, ctx);
    }
  }

  // ============================================================
  // MTF: 射击战斗
  // ============================================================
  _updateMTF(dt, ctx) {
    this._handleMovement(dt, ctx);

    // 鼠标瞄准
    this.facing = Vec2.angle(this.pos, this.mouseWorld);

    // 左键射击
    if (this.input.mouseDown) {
      this._tryShoot(dt, ctx);
    }
  }

  // ============================================================
  // 通用射击 (MTF / 拾取武器的D级)
  // ============================================================
  _tryShoot(dt, ctx) {
    if (!this.weapon || this.ammo <= 0 || this.fireCooldown > 0) return;

    this.fireCooldown = 0.15;
    this.ammo--;

    const wdef = WEAPONS[this.weapon];
    if (wdef.melee) return;

    const spread = (Math.random() - 0.5) * wdef.spread * 2;
    const angle = this.facing + spread;
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
      });
    }

    // 枪声吸引SCP
    ctx.perception.emitNoise(this.pos, CONFIG.HEAR_GUNSHOT, 2, this);

    if (this.ammo === 0) {
      ctx.game.logEvent('弹药耗尽!', 'info');
    }
  }

  // ============================================================
  // SCP-173: 眨眼瞬移猎杀
  // ============================================================
  _updateSCP173(dt, ctx) {
    // 检查是否被注视 (复用AI感知逻辑)
    this.watched = this._isWatched(ctx);

    if (this.watched) {
      // 被注视: 冻结
      this.vel.x = 0;
      this.vel.y = 0;
    } else {
      // 未被注视: 高速移动 (点击瞬移, 或WASD高速)
      this.speed = 260;
      this._handleMovement(dt, ctx);
    }

    // 接触秒杀
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
  // 移动处理 (WASD)
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

    // 移动 + 碰撞 (复用NPC碰撞逻辑)
    const newX = this.pos.x + this.vel.x * dt;
    const newY = this.pos.y + this.vel.y * dt;

    const tileX = ctx.map.worldToTile(newX + Math.sign(this.vel.x || 1) * this.radius, this.pos.y);
    if (!ctx.map.isWall(tileX.col, tileX.row)) {
      this.pos.x = newX;
    }

    const tileY = ctx.map.worldToTile(this.pos.x, newY + Math.sign(this.vel.y || 1) * this.radius);
    if (!ctx.map.isWall(tileY.col, tileY.row)) {
      this.pos.y = newY;
    }

    this.pos.x = Math.max(this.radius, Math.min(ctx.map.cols * CONFIG.TILE_SIZE - this.radius, this.pos.x));
    this.pos.y = Math.max(this.radius, Math.min(ctx.map.rows * CONFIG.TILE_SIZE - this.radius, this.pos.y));

    // 移动噪音
    if (this.vel.magSq > 100) {
      ctx.perception.emitNoise(this.pos, CONFIG.HEAR_WALK, 1, this);
    }

    if (this.role !== 'scp173') {
      this.facing = Math.atan2(this.vel.y, this.vel.x);
    }
  }

  // ============================================================
  // D级: 拾取武器 (靠近有枪的敌对尸体)
  // ============================================================
  _tryPickupWeapon(ctx) {
    if (this.weapon) return;

    for (const e of ctx.allEntities) {
      if (!e.dead || e.faction === this.faction) continue;
      if (e.weapon && WEAPONS[e.weapon] && !WEAPONS[e.weapon].melee) {
        const d = Vec2.dist(this.pos, e.pos);
        if (d < this.pickupRange) {
          this.weapon = e.weapon;
          this.ammo = Math.max(6, Math.floor(e.maxAmmo * 0.4));
          ctx.game.logEvent(`拾取了 ${WEAPONS[this.weapon].name} (${this.ammo}发)`, 'info');
          return;
        }
      }
    }
  }

  // ============================================================
  // D级: 转职 — 接触MTF NPC被招募
  // ============================================================
  _tryRecruit(ctx) {
    if (this.recruited) return;

    for (const e of ctx.allEntities) {
      if (e.dead || e.faction !== 'FOUNDATION') continue;
      if (e.typeId !== 'mtf_private' && e.typeId !== 'mtf_sergeant') continue;

      const d = Vec2.dist(this.pos, e.pos);
      if (d < this.pickupRange) {
        // 被招募
        this.recruited = true;
        this.faction = 'FOUNDATION';
        this.factionInfo = FACTIONS.FOUNDATION;
        this.color = '#4488ff';
        this.weapon = 'rifle';
        this.ammo = 30;
        this.hp = Math.min(150, this.hp + 50);
        this.maxHp = 150;
        this.speed = 120;

        ctx.game.onPlayerRecruited(e);
        return;
      }
    }
  }

  // ============================================================
  // SCP-173: 是否被注视
  // ============================================================
  _isWatched(ctx) {
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
  // 受击
  // ============================================================
  takeDamage(amount, damageType, attacker, ctx) {
    if (this.dead) return;

    let actualDamage = amount;
    if (this.role === 'scp173') {
      // 173 免疫所有子弹
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

  // 供射击系统使用 (子弹来源判断)
  get isPlayer() { return true; }
}
