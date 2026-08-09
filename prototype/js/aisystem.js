// ============================================================
// aisystem.js — AI 管理器: 波次调度 + NPC 更新 (多地图版)
// 实体按 levelId 分布在各自地图, 感知/交互仅限同图
// ============================================================

class AISystem {
  constructor(world, combat, perception) {
    this.world = world;
    this.combat = combat;
    this.perception = perception;
    this.entities = world.entities;  // 与 world 共享实体数组
    this.gameTime = 0;
    this.realTime = 0;
    this.currentPhase = '';
    this.spawnedWaves = new Set();
    this.nextId = 1;
  }

  reset() {
    this.entities = [];
    this.gameTime = 0;
    this.realTime = 0;
    this.spawnedWaves.clear();
    this.currentPhase = '';
    this.perception.clear();
    this.combat.reset();
  }

  // 初始化所有 NPC
  initialize() {
    this.reset();
    const npcs = NPCFactory.createInitialSpawns(this.world);
    for (const npc of npcs) {
      this.entities.push(npc);
    }
    this._updatePhase();
  }

  // 手动生成 NPC (到指定地图)
  spawnNPC(typeId, levelId) {
    const npc = NPCFactory.create(typeId, this.world, levelId, this.nextId++);
    if (npc) {
      this.entities.push(npc);
      return npc;
    }
    return null;
  }

  // 获取某地图的所有实体 (含尸体)
  entitiesIn(levelId) {
    return this.entities.filter(e => e.levelId === levelId);
  }

  // 获取某地图的存活实体
  aliveIn(levelId) {
    return this.entities.filter(e => !e.dead && e.levelId === levelId);
  }

  // 为某实体构建更新上下文 (地图随实体)
  ctxFor(entity, game) {
    return {
      world: this.world,
      map: this.world.getLevel(entity.levelId),
      allEntities: this.entitiesIn(entity.levelId),
      perception: this.perception,
      combat: this.combat,
      facilities: this.world.getFacilities(entity.levelId),
      pathfinder: this.world.getPathfinder(entity.levelId),
      gameTime: this.gameTime,
      game: game,
      levelId: entity.levelId,
      player: game.player,
    };
  }

  // 更新
  update(dt, game) {
    this.realTime += dt;
    this.gameTime += dt;

    this._checkWaves(game);
    this.perception.update(dt);

    // 更新所有 NPC (玩家由 game 单独更新)
    for (const npc of this.entities) {
      if (npc.isPlayer || npc.dead) continue;
      const ctx = this.ctxFor(npc, game);
      npc.update(dt, ctx);
    }

    // 战斗系统 (子弹碰撞按子弹所属地图)
    this.combat.update(dt, this, game);

    // 清理 (尸体保留 10 秒供 049 复活)
    this._cleanupDead(dt);

    this._updatePhase();
  }

  _checkWaves(game) {
    for (const wave of WAVES) {
      const t = wave.time;
      if (this.gameTime >= t && !this.spawnedWaves.has(t)) {
        this.spawnedWaves.add(t);

        const waveSpawns = WAVE_SPAWNS[t];
        if (waveSpawns) {
          for (const spawn of waveSpawns) {
            for (let i = 0; i < spawn.count; i++) {
              const npc = NPCFactory.create(spawn.type, this.world, spawn.zone, this.nextId++);
              if (npc) this.entities.push(npc);
            }
          }
        }

        game.logEvent(wave.event, 'spawn');
      }
    }
  }

  _cleanupDead(dt) {
    // 尸体由渲染器显示, 保留不清理 (049 复活)
  }

  _updatePhase() {
    let phase = 'SCP DOMINANT';
    for (const wave of WAVES) {
      if (this.gameTime >= wave.time) phase = wave.phase;
    }
    this.currentPhase = phase;
  }

  // 统计各阵营存活数量 (全地图)
  getFactionStats() {
    const stats = {};
    for (const f of Object.values(FACTIONS)) {
      stats[f.id] = { alive: 0, dead: 0, total: 0 };
    }
    for (const e of this.entities) {
      if (!stats[e.faction]) continue;
      stats[e.faction].total++;
      if (e.dead) stats[e.faction].dead++;
      else stats[e.faction].alive++;
    }
    return stats;
  }

  getAliveNPCs() {
    return this.entities.filter(e => !e.dead);
  }
}
