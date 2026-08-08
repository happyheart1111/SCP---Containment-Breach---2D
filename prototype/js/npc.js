// ============================================================
// npc.js — NPC 实体 + AI 行为状态机
// ============================================================

class NPC {
  constructor(typeId, spawnX, spawnY, id) {
    const def = NPC_TYPES[typeId];
    if (!def) throw new Error(`Unknown NPC type: ${typeId}`);

    this.id = id;
    this.typeId = typeId;
    this.def = def;
    this.name = def.name;
    this.faction = def.faction;
    this.factionInfo = FACTIONS[def.faction];

    // 位置和移动
    this.pos = new Vec2(spawnX, spawnY);
    this.vel = new Vec2(0, 0);
    this.facing = Math.random() * Math.PI * 2;
    this.speed = def.speed;

    // 属性
    this.hp = def.hp;
    this.maxHp = def.hp;
    this.armor = def.armor;
    this.radius = def.radius;
    this.color = def.color;
    this.isSCP = def.isSCP || false;

    // 武器
    this.weapon = def.weapon;
    this.weaponDef = WEAPONS[def.weapon];
    this.ammo = def.ammo;
    this.maxAmmo = def.ammo;
    this.fireRate = def.fireRate;
    this.fireCooldown = 0;

    // 感知
    this.visionRange = def.visionRange;
    this.visionAngle = def.visionAngle;
    this.hearRange = def.hearRange;
    this.isSoundHunter = def.behavior === 'ambush';

    // AI 状态
    this.dead = false;
    this.behavior = def.behavior;
    this.targetPriority = def.targetPriority;
    this.retreatThreshold = def.retreatThreshold;

    // 感知结果
    this.lastSeenTarget = null;   // { entity, pos, time }
    this.lastHeardNoise = null;
    this.identifyTimer = 0;       // 识别目标阵营的时间
    this.identifiedTarget = null; // 已识别的目标

    // 寻路
    this.path = null;
    this.pathIndex = 0;
    this.pathTimer = 0;
    this.patrolTarget = null;
    this.doorCooldown = 0; // 开门后停留时间

    // 状态
    this.fsm = new FSM('patrol', {});
    this._initFSM();

    // 声音
    this.lastNoiseTime = 0;
    this.movingFast = false; // 奔跑?

    // 效果
    this.flashTimer = 0; // 受击闪烁
    this.attackAnimTimer = 0;
  }

  _initFSM() {
    this.fsm.addState('patrol', {
      enter: (ctx) => { this.identifyTimer = 0; this.identifiedTarget = null; },
      update: (dt, ctx) => this._statePatrol(dt, ctx),
    });
    this.fsm.addState('alert', {
      enter: (ctx) => { this.identifyTimer = 0; },
      update: (dt, ctx) => this._stateAlert(dt, ctx),
    });
    this.fsm.addState('engage', {
      enter: (ctx) => {},
      update: (dt, ctx) => this._stateEngage(dt, ctx),
    });
    this.fsm.addState('flee', {
      enter: (ctx) => {},
      update: (dt, ctx) => this._stateFlee(dt, ctx),
    });
    this.fsm.addState('dead', {
      enter: (ctx) => {},
      update: () => {},
    });
  }

  // ============================================================
  // 主更新
  // ============================================================
  update(dt, ctx) {
    if (this.dead) return;

    this.fireCooldown -= dt;
    this.flashTimer = Math.max(0, this.flashTimer - dt);
    this.attackAnimTimer = Math.max(0, this.attackAnimTimer - dt);
    this.pathTimer -= dt;

    // 感知更新
    this._updatePerception(dt, ctx);

    // FSM 更新
    this.fsm.update(dt, ctx);

    // 发出移动声音
    if (this.vel.magSq > 100 && this.fsm.state !== 'dead') {
      const now = ctx.gameTime;
      if (now - this.lastNoiseTime > 0.3) {
        this.lastNoiseTime = now;
        const noiseRadius = this.movingFast ? CONFIG.HEAR_RUN : CONFIG.HEAR_WALK;
        ctx.perception.emitNoise(this.pos, noiseRadius, 1, this);
      }
    }

    // 更新朝向
    if (this.vel.magSq > 1) {
      this.facing = this.vel.angle();
    }
  }

  // ============================================================
  // 感知
  // ============================================================
  _updatePerception(dt, ctx) {
    const visibleTargets = ctx.allEntities.filter(e => e !== this && !e.dead);

    // 视觉
    const vision = PerceptionSystem.checkVision(this, visibleTargets, ctx.map);

    // 听觉
    const hearing = PerceptionSystem.checkHearing(this, ctx.perception.noiseEvents);

    if (vision) {
      // 看到目标
      if (this.lastSeenTarget && this.lastSeenTarget.entity === vision.entity) {
        // 持续看到同一目标, 累计识别时间
        this.identifyTimer += dt;
        this.lastSeenTarget.pos = vision.entity.pos.clone();
        this.lastSeenTarget.time = ctx.gameTime;
        this.lastSeenTarget.dist = vision.dist;

        if (this.identifyTimer >= CONFIG.IDENTIFY_TIME) {
          this.identifiedTarget = vision.entity;
        }
      } else {
        // 新目标
        this.identifyTimer = 0;
        this.identifiedTarget = null;
        this.lastSeenTarget = {
          entity: vision.entity,
          pos: vision.entity.pos.clone(),
          time: ctx.gameTime,
          dist: vision.dist,
        };
      }
    } else {
      // 没看到, 识别计时器缓慢衰减
      this.identifyTimer = Math.max(0, this.identifyTimer - dt * 0.5);
    }

    // 听觉
    if (hearing) {
      this.lastHeardNoise = {
        pos: new Vec2(hearing.noise.x, hearing.noise.y),
        time: ctx.gameTime,
      };
    }
  }

  // ============================================================
  // 状态: 巡逻
  // ============================================================
  _statePatrol(dt, ctx) {
    // 检查是否发现敌对目标
    if (this.identifiedTarget && this._isTargetHostile(this.identifiedTarget)) {
      this.fsm.changeState('engage', ctx);
      return;
    }

    // 如果有未识别的视觉目标, 先警戒
    if (this.lastSeenTarget && !this.identifiedTarget && this.identifyTimer > 0) {
      const target = this.lastSeenTarget.entity;
      if (target && !target.dead) {
        // 先检查是否同阵营——如果是, 不需要警戒
        if (!this._isTargetHostile(target) && !this._isTargetHostile_checkUnknown(target)) {
          // 友军或中立, 忽略
        } else {
          this.fsm.changeState('alert', ctx);
          return;
        }
      }
    }

    // SCP-939 靠声音: 如果听到声音, 转警戒
    if (this.isSoundHunter && this.lastHeardNoise) {
      const age = ctx.gameTime - this.lastHeardNoise.time;
      if (age < 2.0) {
        this.fsm.changeState('alert', ctx);
        return;
      }
    }

    // HP 过低 -> 撤退
    if (this.hp <= this.retreatThreshold && this.retreatThreshold > 0) {
      this.fsm.changeState('flee', ctx);
      return;
    }

    // 行为模式
    switch (this.behavior) {
      case 'guard':
        this._behaviorGuard(dt, ctx);
        break;
      case 'sweep':
      case 'sweep_aggressive':
        this._behaviorSweep(dt, ctx);
        break;
      case 'raid':
        this._behaviorRaid(dt, ctx);
        break;
      case 'hunt_scp':
        this._behaviorHuntSCP(dt, ctx);
        break;
      case 'scp_173':
        this._behaviorSCP173(dt, ctx);
        break;
      case 'scp_049':
        this._behaviorSCP049(dt, ctx);
        break;
      case 'ambush':
        this._behaviorAmbush(dt, ctx);
        break;
      case 'zombie':
        this._behaviorZombie(dt, ctx);
        break;
      default:
        this._behaviorWander(dt, ctx);
    }
  }

  // ============================================================
  // 状态: 警戒 (发现异常但未确认敌我)
  // ============================================================
  _stateAlert(dt, ctx) {
    // 如果识别完成且是敌对, 转交战
    if (this.identifiedTarget && this._isTargetHostile(this.identifiedTarget)) {
      this.fsm.changeState('engage', ctx);
      return;
    }

    // 朝最后看到的位置移动
    if (this.lastSeenTarget) {
      const age = ctx.gameTime - this.lastSeenTarget.time;
      if (age > 3.0) {
        // 太久了, 回巡逻
        this.lastSeenTarget = null;
        this.identifiedTarget = null;
        this.fsm.changeState('patrol', ctx);
        return;
      }

      // 朝目标方向看
      const targetAngle = Vec2.angle(this.pos, this.lastSeenTarget.pos);
      this.facing = targetAngle;

      // 如果目标还在视野里, 保持警戒
      const dist = Vec2.dist(this.pos, this.lastSeenTarget.entity?.pos || this.lastSeenTarget.pos);
      if (dist > 50) {
        this._moveTowards(this.lastSeenTarget.pos, dt, ctx);
      }
    } else if (this.lastHeardNoise) {
      const age = ctx.gameTime - this.lastHeardNoise.time;
      if (age > 2.0) {
        this.fsm.changeState('patrol', ctx);
        return;
      }
      this._moveTowards(this.lastHeardNoise.pos, dt, ctx);
    } else {
      this.fsm.changeState('patrol', ctx);
    }
  }

  // ============================================================
  // 状态: 交战
  // ============================================================
  _stateEngage(dt, ctx) {
    // 如果目标死了或丢失太久
    if (!this.identifiedTarget || this.identifiedTarget.dead) {
      this.identifiedTarget = null;
      this.lastSeenTarget = null;
      this.fsm.changeState('alert', ctx);
      return;
    }

    // 目标不再是敌对 (如 D级被招募转职) → 解除交战
    if (!this._isTargetHostile(this.identifiedTarget)) {
      this.identifiedTarget = null;
      this.lastSeenTarget = null;
      this.fsm.changeState('patrol', ctx);
      return;
    }

    // HP 过低 -> 撤退 (SCP 和僵尸不撤退)
    if (this.hp <= this.retreatThreshold && this.retreatThreshold > 0 && !this.isSCP) {
      this.fsm.changeState('flee', ctx);
      return;
    }

    const target = this.identifiedTarget;
    const dist = Vec2.dist(this.pos, target.pos);

    // 朝目标
    this.facing = Vec2.angle(this.pos, target.pos);

    // 检查目标是否还在视野内
    const stillVisible = !PerceptionSystem._lineBlocked(this.pos, target.pos, ctx.map) && dist < this.visionRange;

    if (stillVisible) {
      this.lastSeenTarget = { entity: target, pos: target.pos.clone(), time: ctx.gameTime, dist };
    } else {
      // 目标消失, 朝最后位置移动
      const age = ctx.gameTime - (this.lastSeenTarget?.time || 0);
      if (age > 5.0) {
        this.fsm.changeState('patrol', ctx);
        return;
      }
      this._moveTowards(this.lastSeenTarget.pos, dt, ctx);
      return;
    }

    // SCP 特殊行为
    if (this.isSCP) {
      this._scpCombatBehavior(dt, ctx, target, dist);
      return;
    }

    // 人类战斗行为
    const weaponRange = this.weaponDef.range;

    if (dist > weaponRange * 0.8) {
      // 太远, 追击
      this._moveTowards(target.pos, dt, ctx);
    } else if (dist < weaponRange * 0.3 && !this.weaponDef.melee) {
      // 太近, 后退保持距离 (除非近战)
      this._moveAway(target.pos, dt, ctx);
    } else {
      // 在射程内, 射击
      this.vel.x *= 0.8; this.vel.y *= 0.8; // 减速
      this._tryShoot(ctx, target, dist);
    }
  }

  // ============================================================
  // 状态: 撤退
  // ============================================================
  _stateFlee(dt, ctx) {
    // 找最近的友军或出口
    if (this.hp > this.maxHp * 0.6) {
      this.fsm.changeState('patrol', ctx);
      return;
    }

    // 远离最近的敌对目标
    let nearestEnemy = null;
    let nearestDist = Infinity;
    for (const e of ctx.allEntities) {
      if (e === this || e.dead) continue;
      if (!isHostile(this.faction, e.faction)) continue;
      const d = Vec2.dist(this.pos, e.pos);
      if (d < nearestDist) { nearestDist = d; nearestEnemy = e; }
    }

    if (nearestEnemy && nearestDist < 300) {
      this._moveAway(nearestEnemy.pos, dt, ctx);
    } else {
      this.fsm.changeState('patrol', ctx);
    }
  }

  // ============================================================
  // 行为模式实现
  // ============================================================

  _behaviorGuard(dt, ctx) {
    // 在出生区域附近巡逻
    if (!this.patrolTarget || Vec2.dist(this.pos, this.patrolTarget) < 40) {
      const tile = ctx.map.getRandomWalkableTile('EZ');
      if (tile) this.patrolTarget = new Vec2(
        tile.col * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2,
        tile.row * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2
      );
    }
    if (this.patrolTarget) this._moveTowards(this.patrolTarget, dt, ctx);
  }

  _behaviorSweep(dt, ctx) {
    // 从 SZ 向 LCZ 推进
    if (!this.patrolTarget || Vec2.dist(this.pos, this.patrolTarget) < 40) {
      const zone = Math.random() < 0.5 ? 'EZ' : 'HCZ';
      const tile = ctx.map.getRandomWalkableTile(zone);
      if (tile) this.patrolTarget = new Vec2(
        tile.col * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2,
        tile.row * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2
      );
    }
    if (this.patrolTarget) this._moveTowards(this.patrolTarget, dt, ctx);
  }

  _behaviorRaid(dt, ctx) {
    // CI: 寻找 D 级, 穿越设施
    if (!this.patrolTarget || Vec2.dist(this.pos, this.patrolTarget) < 40) {
      const zones = ['EZ', 'LCZ'];
      const zone = zones[Math.floor(Math.random() * zones.length)];
      const tile = ctx.map.getRandomWalkableTile(zone);
      if (tile) this.patrolTarget = new Vec2(
        tile.col * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2,
        tile.row * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2
      );
    }
    if (this.patrolTarget) this._moveTowards(this.patrolTarget, dt, ctx);
  }

  _behaviorHuntSCP(dt, ctx) {
    // GOC: 主动寻找 SCP
    // 优先朝最近的 SCP 移动
    let nearestSCP = null;
    let nearestDist = Infinity;
    for (const e of ctx.allEntities) {
      if (e === this || e.dead || !e.isSCP) continue;
      const d = Vec2.dist(this.pos, e.pos);
      if (d < nearestDist) { nearestDist = d; nearestSCP = e; }
    }

    if (nearestSCP && nearestDist < 800) {
      this._moveTowards(nearestSCP.pos, dt, ctx);
    } else {
      this._behaviorWander(dt, ctx);
    }
  }

  _behaviorSCP173(dt, ctx) {
    // 173: 检查是否被注视
    const beingWatched = this._isBeingWatched(ctx);

    if (beingWatched) {
      // 被注视, 冻结
      this.vel.x = 0; this.vel.y = 0;
      this.speed = 0;
    } else {
      // 未被注视, 高速移动到最近人类
      this.speed = 200; // 高速
      let nearest = null;
      let nearestDist = Infinity;
      for (const e of ctx.allEntities) {
        if (e === this || e.dead || e.faction === 'SCP' || e.faction === 'ZOMBIE') continue;
        const d = Vec2.dist(this.pos, e.pos);
        if (d < nearestDist) { nearestDist = d; nearest = e; }
      }
      if (nearest && nearestDist < 320) {
        this._moveTowards(nearest.pos, dt, ctx);
        // 接触即死
        if (nearestDist < this.radius + nearest.radius + 5) {
          ctx.combat.dealDamage(nearest, 9999, this, 'touch_kill', ctx);
        }
      } else {
        this._behaviorWander(dt, ctx);
      }
    }
  }

  _behaviorSCP049(dt, ctx) {
    // 049: 缓慢追击, 接触致死, 复活尸体
    let nearest = null;
    let nearestDist = Infinity;
    for (const e of ctx.allEntities) {
      if (e === this || e.dead || e.faction === 'SCP' || e.faction === 'ZOMBIE') continue;
      const d = Vec2.dist(this.pos, e.pos);
      if (d < nearestDist) { nearestDist = d; nearest = e; }
    }

    if (nearest && nearestDist < 500) {
      this._moveTowards(nearest.pos, dt, ctx);
      if (nearestDist < this.radius + nearest.radius + 5) {
        ctx.combat.dealDamage(nearest, 9999, this, 'touch_plague', ctx);
        // 复活为僵尸 (延迟)
        ctx.combat.scheduleZombie(nearest, this, ctx);
      }
    } else {
      this._behaviorWander(dt, ctx);
    }
  }

  _behaviorAmbush(dt, ctx) {
    // 939: 靠声音定位, 伏击
    if (this.lastHeardNoise) {
      const age = ctx.gameTime - this.lastHeardNoise.time;
      if (age < 3.0) {
        this._moveTowards(this.lastHeardNoise.pos, dt, ctx);
        // 检查附近人类
        for (const e of ctx.allEntities) {
          if (e === this || e.dead || e.faction === 'SCP' || e.faction === 'WILD' || e.faction === 'ZOMBIE') continue;
          const d = Vec2.dist(this.pos, e.pos);
          if (d < this.radius + e.radius + 10) {
            ctx.combat.dealDamage(e, 120, this, 'pounce', ctx);
            this.attackAnimTimer = 0.5;
          }
        }
        return;
      }
    }
    // 无声音时静止或慢速移动
    this.vel.x *= 0.9; this.vel.y *= 0.9;
  }

  _behaviorZombie(dt, ctx) {
    // 僵尸: 缓慢追击最近人类
    let nearest = null;
    let nearestDist = Infinity;
    for (const e of ctx.allEntities) {
      if (e === this || e.dead || e.faction === 'SCP' || e.faction === 'ZOMBIE' || e.faction === 'WILD') continue;
      const d = Vec2.dist(this.pos, e.pos);
      if (d < nearestDist) { nearestDist = d; nearest = e; }
    }

    if (nearest && nearestDist < 400) {
      this._moveTowards(nearest.pos, dt, ctx);
      if (nearestDist < this.radius + nearest.radius + 5) {
        if (this.fireCooldown <= 0) {
          ctx.combat.dealDamage(nearest, 15, this, 'melee', ctx);
          this.fireCooldown = 1.0;
        }
      }
    } else {
      this._behaviorWander(dt, ctx);
    }
  }

  _behaviorWander(dt, ctx) {
    if (!this.patrolTarget || Vec2.dist(this.pos, this.patrolTarget) < 40) {
      const tile = ctx.map.getRandomWalkableTile(this._currentZone(ctx));
      if (tile) this.patrolTarget = new Vec2(
        tile.col * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2,
        tile.row * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2
      );
    }
    if (this.patrolTarget) this._moveTowards(this.patrolTarget, dt, ctx);
  }

  _currentZone(ctx) {
    const tile = ctx.map.worldToTile(this.pos.x, this.pos.y);
    return ctx.map.getZone(tile.col, tile.row) || 'EZ';
  }

  // ============================================================
  // SCP 战斗行为
  // ============================================================
  _scpCombatBehavior(dt, ctx, target, dist) {
    // SCP-173
    if (this.typeId === 'scp_173') {
      this._behaviorSCP173(dt, ctx);
      return;
    }

    // SCP-049
    if (this.typeId === 'scp_049') {
      this._behaviorSCP049(dt, ctx);
      return;
    }

    // SCP-939
    if (this.typeId === 'scp_939') {
      this._behaviorAmbush(dt, ctx);
      return;
    }
  }

  // ============================================================
  // 辅助: 检查是否被注视 (173 用)
  // ============================================================
  _isBeingWatched(ctx) {
    for (const e of ctx.allEntities) {
      if (e === this || e.dead) continue;
      if (e.faction === 'SCP' || e.faction === 'ZOMBIE') continue;
      if (e.visionRange <= 0) continue;

      const d = Vec2.dist(this.pos, e.pos);
      if (d > e.visionRange) continue;

      // 检查视野锥
      if (e.visionAngle < Math.PI * 2) {
        const angleToMe = Vec2.angle(e.pos, this.pos);
        const diff = Math.abs(Vec2.angleDiff2(e.facing, angleToMe));
        if (diff > e.visionAngle / 2) continue;
      }

      // 视线未被墙阻挡
      if (PerceptionSystem._lineBlocked(e.pos, this.pos, ctx.map)) continue;

      return true; // 被看到了
    }
    return false;
  }

  // ============================================================
  // 辅助: 移动
  // ============================================================
  _moveTowards(targetPos, dt, ctx) {
    const dir = Vec2.sub2(targetPos, this.pos).normalize();
    this.vel.x = dir.x * this.speed;
    this.vel.y = dir.y * this.speed;

    this._applyMovement(dt, ctx);
  }

  _moveAway(targetPos, dt, ctx) {
    const dir = Vec2.sub2(this.pos, targetPos).normalize();
    this.vel.x = dir.x * this.speed * 0.8;
    this.vel.y = dir.y * this.speed * 0.8;

    this._applyMovement(dt, ctx);
  }

  _applyMovement(dt, ctx) {
    const newX = this.pos.x + this.vel.x * dt;
    const newY = this.pos.y + this.vel.y * dt;

    // 碰撞检测: 分轴检测 (含钥匙卡门禁阻挡)
    const tileX = ctx.map.worldToTile(newX + Math.sign(this.vel.x) * this.radius, this.pos.y);
    if (!ctx.map.isWall(tileX.col, tileX.row) && !ctx.map.isDoorBlocked(tileX.col, tileX.row, ctx.facilities)) {
      this.pos.x = newX;
    } else {
      this.vel.x = 0;
    }

    const tileY = ctx.map.worldToTile(this.pos.x, newY + Math.sign(this.vel.y) * this.radius);
    if (!ctx.map.isWall(tileY.col, tileY.row) && !ctx.map.isDoorBlocked(tileY.col, tileY.row, ctx.facilities)) {
      this.pos.y = newY;
    } else {
      this.vel.y = 0;
    }

    // 边界
    this.pos.x = Math.max(this.radius, Math.min(ctx.map.cols * CONFIG.TILE_SIZE - this.radius, this.pos.x));
    this.pos.y = Math.max(this.radius, Math.min(ctx.map.rows * CONFIG.TILE_SIZE - this.radius, this.pos.y));
  }

  // ============================================================
  // 辅助: 射击
  // ============================================================
  _tryShoot(ctx, target, dist) {
    if (this.fireCooldown > 0) return;
    if (this.ammo === 0) return;
    if (this.ammo > 0) this.ammo--;

    this.fireCooldown = this.fireRate;
    this.attackAnimTimer = 0.15;

    const wdef = this.weaponDef;

    if (wdef.melee) {
      // 近战
      if (dist < CONFIG.MELEE_RANGE) {
        ctx.combat.dealDamage(target, wdef.damage, this, this.weapon, ctx);
      }
      return;
    }

    // 远程: 创建子弹
    const spread = (Math.random() - 0.5) * wdef.spread * 2;
    const angle = Vec2.angle(this.pos, target.pos) + spread;
    const pellets = wdef.pellets || 1;

    for (let i = 0; i < pellets; i++) {
      const pSpread = pellets > 1 ? (Math.random() - 0.5) * wdef.spread * 2 : spread;
      const pAngle = Vec2.angle(this.pos, target.pos) + pSpread;

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

    // 枪声
    ctx.perception.emitNoise(this.pos, CONFIG.HEAR_GUNSHOT, 2, this);
  }

  // ============================================================
  // 辅助: 判断目标是否敌对
  // ============================================================
  _isTargetHostile(target) {
    if (!target) return false;
    return isHostile(this.faction, target.faction);
  }

  _isTargetHostile_checkUnknown(target) {
    // 在识别前, 敌对和紧张关系触发警戒, 中立不触发
    if (!target) return false;
    const r = getRelation(this.faction, target.faction);
    return r === 'enemy' || r === 'tense';
  }

  // ============================================================
  // 受到伤害
  // ============================================================
  takeDamage(amount, damageType, attacker, ctx) {
    if (this.dead) return;

    let actualDamage = amount;

    // 护甲减免 (只对物理伤害)
    if (damageType !== 'touch_kill' && damageType !== 'touch_plague' && damageType !== 'pounce') {
      actualDamage = amount * (1 - this.armor);
    }

    this.hp -= actualDamage;
    this.flashTimer = 0.15;

    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.fsm.changeState('dead', ctx);

      ctx.game.onNPCDeath(this, attacker);

      // 死亡声音
      ctx.perception.emitNoise(this.pos, CONFIG.HEAR_RUN, 1.5, this);
    } else {
      // 受到攻击时, 如果在巡逻, 转警戒
      if (this.fsm.state === 'patrol' || this.fsm.state === 'alert') {
        if (attacker) {
          this.lastSeenTarget = {
            entity: attacker,
            pos: attacker.pos.clone(),
            time: ctx.gameTime,
            dist: Vec2.dist(this.pos, attacker.pos),
          };
          this.identifiedTarget = attacker; // 被打 = 立即识别
          this.fsm.changeState('engage', ctx);
        }
      }
    }
  }
}
