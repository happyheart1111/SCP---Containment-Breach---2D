// ============================================================
// npc.js — NPC 实体 + AI 行为状态机 (多地图版)
// 支持跨地图巡逻: 通过传送点(检查点/电梯)移动到目标区域
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
    this.levelId = def.spawnZone || 'LCZ'; // 工厂会覆盖

    this.pos = new Vec2(spawnX, spawnY);
    this.vel = new Vec2(0, 0);
    this.facing = Math.random() * Math.PI * 2;
    this.speed = def.speed;

    this.hp = def.hp;
    this.maxHp = def.hp;
    this.armor = def.armor;
    this.radius = def.radius;
    this.color = def.color;
    this.isSCP = def.isSCP || false;

    this.weapon = def.weapon;
    this.weaponDef = WEAPONS[def.weapon];
    this.ammo = def.ammo;
    this.maxAmmo = def.ammo;
    this.fireRate = def.fireRate;
    this.fireCooldown = 0;

    this.visionRange = def.visionRange;
    this.visionAngle = def.visionAngle;
    this.hearRange = def.hearRange;
    this.isSoundHunter = def.behavior === 'ambush';

    this.dead = false;
    this.behavior = def.behavior;
    this.targetPriority = def.targetPriority;
    this.retreatThreshold = def.retreatThreshold;

    this.lastSeenTarget = null;
    this.lastHeardNoise = null;
    this.identifyTimer = 0;
    this.identifiedTarget = null;

    this.path = null;
    this.pathIndex = 0;
    this.pathTimer = 0;
    this.patrolTarget = null;
    this.patrolZone = null;    // 目标区域 (可能跨图)
    this.doorCooldown = 0;
    this.teleportCooldown = 0;

    this.fsm = new FSM('patrol', {});
    this._initFSM();

    this.lastNoiseTime = 0;
    this.movingFast = false;
    this.flashTimer = 0;
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

  update(dt, ctx) {
    if (this.dead) return;

    this.fireCooldown -= dt;
    this.flashTimer = Math.max(0, this.flashTimer - dt);
    this.attackAnimTimer = Math.max(0, this.attackAnimTimer - dt);
    this.pathTimer -= dt;
    this.teleportCooldown = Math.max(0, this.teleportCooldown - dt);

    this._updatePerception(dt, ctx);
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

    // 跨图传送: 当 patrolZone 不在当前地图时走向传送点
    if (this.patrolZone && this.patrolZone !== this.levelId && this.teleportCooldown <= 0) {
      this._handleCrossLevel(dt, ctx);
    }
  }

  // ============================================================
  // 跨图移动: 走向通往目标区域的传送点 (A* 寻路)
  // ============================================================
  _handleCrossLevel(dt, ctx) {
    const world = ctx.world;
    const portal = world.nextPortalFor(this.levelId, this.patrolZone);
    if (!portal) { this.patrolZone = this.levelId; return; }

    const d = Vec2.dist(this.pos, portal.pos);
    if (d < CONFIG.TILE_SIZE * 1.4) {
      // 到达传送点
      const card = this._portalCardLevel();
      if (world.tryUsePortal(portal, card)) {
        world.teleport(this, portal);
        this.patrolTarget = null;
        this.path = null;
        this.pathIndex = 0;
        ctx.game.logEvent(`${this.name} 通过 ${portal.name} 进入${LEVEL_NAMES[portal.targetLevelId]}`, 'info');
      } else {
        // 卡权限不足: 放弃跨图
        this.patrolZone = this.levelId;
      }
    } else {
      this._moveTowardsPath(portal.pos, dt, ctx);
    }
  }

  // ============================================================
  // A* 寻路移动 (长距离/跨图), 直线移动兜底
  // ============================================================
  _moveTowardsPath(targetPos, dt, ctx) {
    if (ctx.pathfinder) {
      // 路径重算
      if (!this.path || this.pathIndex >= this.path.length || this.pathTimer <= 0) {
        const start = ctx.map.worldToTile(this.pos.x, this.pos.y);
        const end = ctx.map.worldToTile(targetPos.x, targetPos.y);
        if (start.col !== end.col || start.row !== end.row) {
          const p = ctx.pathfinder.findPath(start.col, start.row, end.col, end.row);
          this.path = p || null;
          this.pathIndex = 0;
        } else {
          this.path = null;
        }
        this.pathTimer = CONFIG.PATH_RECALC_INTERVAL;
      }

      if (this.path && this.path.length > 1) {
        // 沿路径移动
        const node = this.path[this.pathIndex];
        const wp = ctx.map.tileToWorld(node.col, node.row);
        const d = Vec2.dist(this.pos, new Vec2(wp.x, wp.y));
        if (d < 8 || (this.pathIndex < this.path.length - 1 && d < CONFIG.TILE_SIZE * 0.6)) {
          this.pathIndex++;
          if (this.pathIndex < this.path.length) {
            const n2 = this.path[this.pathIndex];
            const w2 = ctx.map.tileToWorld(n2.col, n2.row);
            this._moveTowards(new Vec2(w2.x, w2.y), dt, ctx);
            return;
          }
        }
        this._moveTowards(new Vec2(wp.x, wp.y), dt, ctx);
        return;
      }
    }
    // 无寻路器或路径失败: 直线移动
    this._moveTowards(targetPos, dt, ctx);
  }

  _portalCardLevel() {
    if (this.isSCP || this.faction === 'ZOMBIE' || this.faction === 'WILD') return 0; // SCP全通
    switch (this.typeId) {
      case 'guard':       return 3;
      case 'scientist':   return 2;
      case 'mtf_private': return 4;
      case 'mtf_sergeant':return 4;
      case 'ci_soldier':  return 3;
      case 'goc_soldier': return 4;
      case 'dclass':      return null; // D级无卡, 只能坐电梯
      default:            return null;
    }
  }

  // ============================================================
  // 感知
  // ============================================================
  _updatePerception(dt, ctx) {
    const visibleTargets = ctx.allEntities.filter(e => e !== this && !e.dead);
    const vision = PerceptionSystem.checkVision(this, visibleTargets, ctx.map);
    const hearing = PerceptionSystem.checkHearing(this, ctx.perception.noiseEvents);

    if (vision) {
      if (this.lastSeenTarget && this.lastSeenTarget.entity === vision.entity) {
        this.identifyTimer += dt;
        this.lastSeenTarget.pos = vision.entity.pos.clone();
        this.lastSeenTarget.time = ctx.gameTime;
        this.lastSeenTarget.dist = vision.dist;
        if (this.identifyTimer >= CONFIG.IDENTIFY_TIME) {
          this.identifiedTarget = vision.entity;
        }
      } else {
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
      this.identifyTimer = Math.max(0, this.identifyTimer - dt * 0.5);
    }

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
    if (this.identifiedTarget && this._isTargetHostile(this.identifiedTarget)) {
      this.fsm.changeState('engage', ctx);
      return;
    }

    if (this.lastSeenTarget && !this.identifiedTarget && this.identifyTimer > 0) {
      const target = this.lastSeenTarget.entity;
      if (target && !target.dead) {
        if (!this._isTargetHostile(target) && !this._isTargetHostile_checkUnknown(target)) {
          // 友军或中立
        } else {
          this.fsm.changeState('alert', ctx);
          return;
        }
      }
    }

    if (this.isSoundHunter && this.lastHeardNoise) {
      const age = ctx.gameTime - this.lastHeardNoise.time;
      if (age < 2.0) {
        this.fsm.changeState('alert', ctx);
        return;
      }
    }

    if (this.hp <= this.retreatThreshold && this.retreatThreshold > 0) {
      this.fsm.changeState('flee', ctx);
      return;
    }

    switch (this.behavior) {
      case 'civilian':    this._behaviorCivilian(dt, ctx); break;
      case 'guard':       this._behaviorGuard(dt, ctx); break;
      case 'sweep':
      case 'sweep_aggressive': this._behaviorSweep(dt, ctx); break;
      case 'raid':        this._behaviorRaid(dt, ctx); break;
      case 'hunt_scp':    this._behaviorHuntSCP(dt, ctx); break;
      case 'scp_173':     this._behaviorSCP173(dt, ctx); break;
      case 'scp_049':     this._behaviorSCP049(dt, ctx); break;
      case 'ambush':      this._behaviorAmbush(dt, ctx); break;
      case 'zombie':      this._behaviorZombie(dt, ctx); break;
      default:            this._behaviorWander(dt, ctx);
    }
  }

  // ============================================================
  // 状态: 警戒
  // ============================================================
  _stateAlert(dt, ctx) {
    if (this.identifiedTarget && this._isTargetHostile(this.identifiedTarget)) {
      this.fsm.changeState('engage', ctx);
      return;
    }

    if (this.lastSeenTarget) {
      const age = ctx.gameTime - this.lastSeenTarget.time;
      if (age > 3.0) {
        this.lastSeenTarget = null;
        this.identifiedTarget = null;
        this.fsm.changeState('patrol', ctx);
        return;
      }
      const targetAngle = Vec2.angle(this.pos, this.lastSeenTarget.pos);
      this.facing = targetAngle;
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
    if (!this.identifiedTarget || this.identifiedTarget.dead) {
      this.identifiedTarget = null;
      this.lastSeenTarget = null;
      this.fsm.changeState('alert', ctx);
      return;
    }

    if (!this._isTargetHostile(this.identifiedTarget)) {
      this.identifiedTarget = null;
      this.lastSeenTarget = null;
      this.fsm.changeState('patrol', ctx);
      return;
    }

    if (this.hp <= this.retreatThreshold && this.retreatThreshold > 0 && !this.isSCP) {
      this.fsm.changeState('flee', ctx);
      return;
    }

    const target = this.identifiedTarget;
    const dist = Vec2.dist(this.pos, target.pos);

    // 目标跨图了 → 放弃追击
    if (target.levelId !== this.levelId) {
      this.identifiedTarget = null;
      this.lastSeenTarget = null;
      this.fsm.changeState('patrol', ctx);
      return;
    }

    this.facing = Vec2.angle(this.pos, target.pos);
    const stillVisible = !PerceptionSystem._lineBlocked(this.pos, target.pos, ctx.map) && dist < this.visionRange;

    if (stillVisible) {
      this.lastSeenTarget = { entity: target, pos: target.pos.clone(), time: ctx.gameTime, dist };
    } else {
      const age = ctx.gameTime - (this.lastSeenTarget?.time || 0);
      if (age > 5.0) {
        this.fsm.changeState('patrol', ctx);
        return;
      }
      this._moveTowards(this.lastSeenTarget.pos, dt, ctx);
      return;
    }

    if (this.isSCP) {
      this._scpCombatBehavior(dt, ctx, target, dist);
      return;
    }

    if (!this.weaponDef) {
      this.fsm.changeState('flee', ctx);
      return;
    }

    const weaponRange = this.weaponDef.range;
    if (dist > weaponRange * 0.8) {
      this._moveTowards(target.pos, dt, ctx);
    } else if (dist < weaponRange * 0.3 && !this.weaponDef.melee) {
      this._moveAway(target.pos, dt, ctx);
    } else {
      this.vel.x *= 0.8; this.vel.y *= 0.8;
      this._tryShoot(ctx, target, dist);
    }
  }

  // ============================================================
  // 状态: 撤退
  // ============================================================
  _stateFlee(dt, ctx) {
    if (this.hp > this.maxHp * 0.6) {
      this.fsm.changeState('patrol', ctx);
      return;
    }

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

  // 平民: 朝地表(出口)方向逃
  _behaviorCivilian(dt, ctx) {
    let nearestThreat = null;
    let nearestDist = Infinity;
    for (const e of ctx.allEntities) {
      if (e === this || e.dead) continue;
      if (e.faction !== 'SCP' && e.faction !== 'ZOMBIE' && e.faction !== 'WILD') continue;
      const d = Vec2.dist(this.pos, e.pos);
      if (d < 180 && d < nearestDist) { nearestDist = d; nearestThreat = e; }
    }

    // 威胁逃跑优先
    if (nearestThreat) {
      this._moveAway(nearestThreat.pos, dt, ctx);
      return;
    }

    // 目标区域: 地表 (通过传送链)
    this.patrolZone = this.patrolZone || 'SZ';

    if (this.levelId === 'SZ') {
      // 已到地表: 走向出口
      const exit = ctx.map.exitPoints[this.levelId];
      if (exit) {
        const ex = exit.col * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
        const ey = exit.row * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
        if (Vec2.dist(this.pos, new Vec2(ex, ey)) > 40) {
          this._moveTowardsPath(new Vec2(ex, ey), dt, ctx);
        }
      } else {
        this._behaviorWander(dt, ctx);
      }
      return;
    }

    // 未到地表: 走向通往 SZ 的传送点 (跨图逻辑在 update 中处理)
    const portal = ctx.world.nextPortalFor(this.levelId, 'SZ');
    if (portal) this._moveTowardsPath(portal.pos, dt, ctx);
    else this._behaviorWander(dt, ctx);
  }

  _behaviorGuard(dt, ctx) {
    // 守卫: 在本区域巡逻 (不跨图)
    this.patrolZone = this.levelId;
    if (!this.patrolTarget || Vec2.dist(this.pos, this.patrolTarget) < 40) {
      const tile = ctx.map.getRandomWalkableTile(this.levelId);
      if (tile) this.patrolTarget = new Vec2(
        tile.col * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2,
        tile.row * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2
      );
    }
    if (this.patrolTarget) this._moveTowards(this.patrolTarget, dt, ctx);
  }

  // MTF: 从 SZ 向 HCZ/LCZ 推进扫荡
  _behaviorSweep(dt, ctx) {
    this.patrolZone = this.patrolZone || 'HCZ';
    if (this.levelId === this.patrolZone) {
      if (!this.patrolTarget || Vec2.dist(this.pos, this.patrolTarget) < 40) {
        const tile = ctx.map.getRandomWalkableTile(this.levelId);
        if (tile) this.patrolTarget = new Vec2(
          tile.col * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2,
          tile.row * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2
        );
      }
      if (this.patrolTarget) this._moveTowardsPath(this.patrolTarget, dt, ctx);
    }
    // 否则跨图 (update 处理)
  }

  // CI: 从 SZ 向 LCZ 推进找 D级
  _behaviorRaid(dt, ctx) {
    this.patrolZone = this.patrolZone || 'LCZ';
    if (this.levelId === this.patrolZone) {
      if (!this.patrolTarget || Vec2.dist(this.pos, this.patrolTarget) < 40) {
        const tile = ctx.map.getRandomWalkableTile(this.levelId);
        if (tile) this.patrolTarget = new Vec2(
          tile.col * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2,
          tile.row * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2
        );
      }
      if (this.patrolTarget) this._moveTowardsPath(this.patrolTarget, dt, ctx);
    }
  }

  // GOC: 主动猎杀 SCP (跨图追踪)
  _behaviorHuntSCP(dt, ctx) {
    let nearestSCP = null;
    let nearestDist = Infinity;
    for (const e of ctx.world.entities) {
      if (e === this || e.dead || !e.isSCP) continue;
      const d = Vec2.dist(this.pos, e.pos);
      if (d < nearestDist) { nearestDist = d; nearestSCP = e; }
    }

    if (nearestSCP) {
      if (nearestSCP.levelId !== this.levelId) {
        this.patrolZone = nearestSCP.levelId;
        // 跨图
      } else if (nearestDist < 800) {
        this._moveTowards(nearestSCP.pos, dt, ctx);
      } else {
        this._behaviorWander(dt, ctx);
      }
    } else {
      this._behaviorWander(dt, ctx);
    }
  }

  _behaviorSCP173(dt, ctx) {
    const beingWatched = this._isBeingWatched(ctx);
    if (beingWatched) {
      this.vel.x = 0; this.vel.y = 0;
      this.speed = 0;
    } else {
      this.speed = 200;
      let nearest = null;
      let nearestDist = Infinity;
      for (const e of ctx.world.entities) {
        if (e === this || e.dead || e.faction === 'SCP' || e.faction === 'ZOMBIE') continue;
        const d = Vec2.dist(this.pos, e.pos);
        if (d < nearestDist) { nearestDist = d; nearest = e; }
      }
      if (nearest) {
        if (nearest.levelId !== this.levelId) {
          this.patrolZone = nearest.levelId;
        } else if (nearestDist < 320) {
          this._moveTowards(nearest.pos, dt, ctx);
          if (nearestDist < this.radius + nearest.radius + 5) {
            ctx.combat.dealDamage(nearest, 9999, this, 'touch_kill', ctx);
          }
        } else {
          this._behaviorWander(dt, ctx);
        }
      } else {
        this._behaviorWander(dt, ctx);
      }
    }
  }

  _behaviorSCP049(dt, ctx) {
    let nearest = null;
    let nearestDist = Infinity;
    for (const e of ctx.world.entities) {
      if (e === this || e.dead || e.faction === 'SCP' || e.faction === 'ZOMBIE') continue;
      const d = Vec2.dist(this.pos, e.pos);
      if (d < nearestDist) { nearestDist = d; nearest = e; }
    }

    if (nearest) {
      if (nearest.levelId !== this.levelId) {
        this.patrolZone = nearest.levelId;
      } else if (nearestDist < 500) {
        this._moveTowards(nearest.pos, dt, ctx);
        if (nearestDist < this.radius + nearest.radius + 5) {
          ctx.combat.dealDamage(nearest, 9999, this, 'touch_plague', ctx);
          ctx.combat.scheduleZombie(nearest, this, ctx);
        }
      } else {
        this._behaviorWander(dt, ctx);
      }
    } else {
      this._behaviorWander(dt, ctx);
    }
  }

  _behaviorAmbush(dt, ctx) {
    if (this.lastHeardNoise) {
      const age = ctx.gameTime - this.lastHeardNoise.time;
      if (age < 3.0) {
        this._moveTowards(this.lastHeardNoise.pos, dt, ctx);
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
    this.vel.x *= 0.9; this.vel.y *= 0.9;
  }

  _behaviorZombie(dt, ctx) {
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
      const tile = ctx.map.getRandomWalkableTile(this.levelId);
      if (tile) this.patrolTarget = new Vec2(
        tile.col * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2,
        tile.row * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2
      );
    }
    if (this.patrolTarget) this._moveTowardsPath(this.patrolTarget, dt, ctx);
  }

  _scpCombatBehavior(dt, ctx, target, dist) {
    if (this.typeId === 'scp_173') { this._behaviorSCP173(dt, ctx); return; }
    if (this.typeId === 'scp_049') { this._behaviorSCP049(dt, ctx); return; }
    if (this.typeId === 'scp_939') { this._behaviorAmbush(dt, ctx); return; }
  }

  // ============================================================
  // 辅助: 是否被注视 (173 用)
  // ============================================================
  _isBeingWatched(ctx) {
    for (const e of ctx.allEntities) {
      if (e === this || e.dead) continue;
      if (e.faction === 'SCP' || e.faction === 'ZOMBIE') continue;
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
      if (dist < CONFIG.MELEE_RANGE) {
        ctx.combat.dealDamage(target, wdef.damage, this, this.weapon, ctx);
      }
      return;
    }

    const spread = (Math.random() - 0.5) * wdef.spread * 2;
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
        levelId: this.levelId,
      });
    }
    ctx.perception.emitNoise(this.pos, CONFIG.HEAR_GUNSHOT, 2, this);
  }

  _isTargetHostile(target) {
    if (!target) return false;
    return isHostile(this.faction, target.faction);
  }

  _isTargetHostile_checkUnknown(target) {
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
      ctx.perception.emitNoise(this.pos, CONFIG.HEAR_RUN, 1.5, this);
    } else {
      if (this.fsm.state === 'patrol' || this.fsm.state === 'alert') {
        if (attacker) {
          this.lastSeenTarget = {
            entity: attacker,
            pos: attacker.pos.clone(),
            time: ctx.gameTime,
            dist: Vec2.dist(this.pos, attacker.pos),
          };
          this.identifiedTarget = attacker;
          if (this.weaponDef) {
            this.fsm.changeState('engage', ctx);
          } else {
            this.fsm.changeState('flee', ctx);
          }
        }
      }
    }
  }
}
