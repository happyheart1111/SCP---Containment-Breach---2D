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

    // SCP-173 眨眼机制 (SCP原设定: 周期性眨眼, 眨眼瞬间可移动)
    this.blinkTimer = 2 + Math.random() * 3;   // 眨眼倒计时
    this.blinking = false;                     // 眨眼中 (可无视注视移动)
    this.blinkRemain = 0;                      // 眨眼剩余时间
    this.blinkDuration = 0.6;                  // 眨眼持续
    this.blinkInterval = 5 + Math.random() * 3; // 眨眼间隔
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

    // SCP-939 特殊感知 (SCP:SL设定): 无视觉, 但能感知极近猎物 (150px内)
    let nearPrey = null;
    let nearDist = Infinity;
    if (this.isSoundHunter) {
      for (const e of visibleTargets) {
        if (e.faction === 'SCP' || e.faction === 'ZOMBIE' || e.faction === 'WILD') continue;
        const d = Vec2.dist(this.pos, e.pos);
        if (d < 150 && d < nearDist) { nearDist = d; nearPrey = e; }
      }
    }

    if (vision || nearPrey) {
      const target = vision ? vision.entity : nearPrey;
      const tdist = vision ? vision.dist : nearDist;
      if (this.lastSeenTarget && this.lastSeenTarget.entity === target) {
        this.identifyTimer += dt;
        this.lastSeenTarget.pos = target.pos.clone();
        this.lastSeenTarget.time = ctx.gameTime;
        this.lastSeenTarget.dist = tdist;
        if (this.identifyTimer >= CONFIG.IDENTIFY_TIME) {
          this.identifiedTarget = target;
        }
      } else {
        this.identifyTimer = 0;
        this.identifiedTarget = null;
        this.lastSeenTarget = {
          entity: target,
          pos: target.pos.clone(),
          time: ctx.gameTime,
          dist: tdist,
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
    // 声音猎手(939)无视觉: 锁定目标后始终视为可见 (SCP:SL设定)
    const stillVisible = this.isSoundHunter
      ? true
      : (!PerceptionSystem._lineBlocked(this.pos, target.pos, ctx.map) && dist < this.visionRange);

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

  // ============================================================
  // SCP-173: 眨眼瞬移猎杀 (SCP原设定)
  // - 周期性眨眼: 眨眼瞬间即使被注视也能移动 (SCP:CB核心机制)
  // - 目标优先级: 优先猎杀武装目标 (威胁更大)
  // - 近距离直线扑杀, 远距离A*绕行
  // ============================================================
  _behaviorSCP173(dt, ctx, engageTarget) {
    // 眨眼计时 (SCP原设定: 周期眨眼, 眨眼瞬间无视注视)
    this.blinkTimer -= dt;
    if (this.blinking) {
      this.blinkRemain -= dt;
      if (this.blinkRemain <= 0) {
        this.blinking = false;
        this.blinkTimer = this.blinkInterval + Math.random() * 2;
      }
    } else if (this.blinkTimer <= 0) {
      this.blinking = true;
      this.blinkRemain = this.blinkDuration;
    }

    const beingWatched = !this.blinking && this._isBeingWatched(ctx);

    if (beingWatched) {
      // 被注视且未眨眼: 冻结
      this.vel.x = 0; this.vel.y = 0;
      this.speed = 0;
    } else {
      this.speed = 210;
      // 目标选择: 优先交战目标, 否则武装人类, 否则最近
      let best = null;
      let bestScore = -Infinity;
      if (engageTarget && !engageTarget.dead && engageTarget.levelId === this.levelId) {
        best = engageTarget;
        bestScore = Infinity;
      } else {
        for (const e of ctx.world.entities) {
          if (e === this || e.dead || e.isSCP) continue;
          const d = Vec2.dist(this.pos, e.pos);
          let score = 0;
          // 距离权重
          score += Math.max(0, 400 - d);
          // 武装目标权重 (有武器威胁大, 优先猎杀)
          if (e.weapon && WEAPONS[e.weapon] && !WEAPONS[e.weapon].melee) score += 300;
          // 正在交战的目标权重低 (可能在被队友打)
          if (e.fsm && e.fsm.state === 'engage') score -= 150;
          if (score > bestScore) { bestScore = score; best = e; }
        }
      }

      if (best) {
        const dist = Vec2.dist(this.pos, best.pos);
        if (best.levelId !== this.levelId) {
          this.patrolZone = best.levelId;
        } else if (dist < 320) {
          // 近距离: 直线扑杀 (接触即死)
          this._moveTowards(best.pos, dt, ctx);
          if (dist < this.radius + best.radius + 5) {
            ctx.combat.dealDamage(best, 9999, this, 'touch_kill', ctx);
            this.attackAnimTimer = 0.3;
          }
        } else {
          // 远距离: A* 绕行接近 (避免卡墙)
          this._moveTowardsPath(best.pos, dt, ctx);
        }
      } else {
        this._behaviorWander(dt, ctx);
      }
    }
  }

  // ============================================================
  // SCP-049: 瘟疫医生猎杀 (制造僵尸军团)
  // - 目标选择: 优先无武器平民 (更容易杀死并复活)
  // - 已有僵尸随行时: 专注找新目标扩展军团
  // ============================================================
  _behaviorSCP049(dt, ctx, engageTarget) {
    let best = null;
    let bestScore = -Infinity;
    if (engageTarget && !engageTarget.dead && engageTarget.levelId === this.levelId) {
      best = engageTarget;
      bestScore = Infinity;
    } else {
      for (const e of ctx.world.entities) {
        if (e === this || e.dead || e.isSCP) continue;
        const d = Vec2.dist(this.pos, e.pos);
        let score = Math.max(0, 500 - d);
        // 无武器平民优先 (制造僵尸)
        if (!e.weapon || !WEAPONS[e.weapon]) score += 200;
        // 已被僵尸纠缠的目标降低 (避免抢怪)
        if (e.fsm && e.fsm.state === 'engage') score -= 100;
        if (score > bestScore) { bestScore = score; best = e; }
      }
    }

    if (best) {
      const dist = Vec2.dist(this.pos, best.pos);
      if (best.levelId !== this.levelId) {
        this.patrolZone = best.levelId;
      } else if (dist < 450) {
        // 锁定目标: 近距离冲刺扑杀 (SCP:SL 049 冲撞)
        this.speed = dist < 250 ? 130 : 55;
        this._moveTowardsPath(best.pos, dt, ctx);
        if (dist < this.radius + best.radius + 5) {
          ctx.combat.dealDamage(best, 9999, this, 'touch_plague', ctx);
          ctx.combat.scheduleZombie(best, this, ctx);
          this.attackAnimTimer = 0.5;
          // 杀死后短暂停顿观察 (仪式感)
          this.fireCooldown = 1.0;
        }
      } else {
        this._behaviorWander(dt, ctx);
      }
    } else {
      this._behaviorWander(dt, ctx);
    }
  }

  // ============================================================
  // SCP-939: 声音猎手伏击 (SCP:SL原设定)
  // 潜行靠近声音源 → 静止等待 → 猎物接近时扑击
  // 参考 SCP:SL: 939 无视觉, 靠声音定位 + 极近猎物感知
  // ============================================================
  _behaviorAmbush(dt, ctx) {
    // 附近可扑击猎物? (感知范围, 无论有无声音)
    let prey = null;
    let preyDist = Infinity;
    for (const e of ctx.allEntities) {
      if (e === this || e.dead || e.faction === 'SCP' || e.faction === 'WILD' || e.faction === 'ZOMBIE') continue;
      const d = Vec2.dist(this.pos, e.pos);
      // 感知范围: 120 (极近猎物凭感知发现, SCP:SL设定)
      if (d < 120 && d < preyDist) { preyDist = d; prey = e; }
    }

    // 有猎物在感知范围: 扑击/追击
    if (prey) {
      this.speed = 95;
      this._moveTowardsPath(prey.pos, dt, ctx);
      if (preyDist < this.radius + prey.radius + 8) {
        ctx.combat.dealDamage(prey, 120, this, 'pounce', ctx);
        this.attackAnimTimer = 0.5;
        this.fireCooldown = 1.5; // 扑击后短暂停顿
      }
      return;
    }

    // 听到声音: 潜行接近 (低速度, 减少暴露)
    if (this.lastHeardNoise) {
      const age = ctx.gameTime - this.lastHeardNoise.time;
      if (age < 4.0) {
        this.speed = 55; // 潜行速度
        const distToNoise = Vec2.dist(this.pos, this.lastHeardNoise.pos);
        if (distToNoise > 70) {
          this._moveTowardsPath(this.lastHeardNoise.pos, dt, ctx);
        } else {
          // 已接近声音源: 静止埋伏等待
          this.vel.x *= 0.85; this.vel.y *= 0.85;
        }
        return;
      }
    }

    // 无声音无猎物: 缓慢游荡
    this.speed = 40;
    this._behaviorWander(dt, ctx);
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
    if (this.typeId === 'scp_173') { this._behaviorSCP173(dt, ctx, target); return; }
    if (this.typeId === 'scp_049') { this._behaviorSCP049(dt, ctx, target); return; }
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
