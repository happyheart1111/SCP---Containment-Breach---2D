// ============================================================
// aisystem.js — AI 管理器: 波次调度 + NPC 更新 + 事件
// ============================================================

class AISystem {
  constructor(map, combat, perception) {
    this.map = map;
    this.combat = combat;
    this.perception = perception;
    this.entities = [];
    this.gameTime = 0;        // 游戏内时间(秒)
    this.realTime = 0;        // 真实时间(秒, 受倍速影响)
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
    const npcs = NPCFactory.createInitialSpawns(this.map);
    for (const npc of npcs) {
      this.entities.push(npc);
    }
    this._updatePhase();
  }

  // 手动生成 NPC
  spawnNPC(typeId, zone) {
    const npc = NPCFactory.create(typeId, this.map, zone, this.nextId++);
    if (npc) {
      this.entities.push(npc);
      return npc;
    }
    return null;
  }

  // 更新
  update(dt, game) {
    this.realTime += dt;
    this.gameTime += dt;

    // 波次生成
    this._checkWaves(game);

    // 感知系统更新
    this.perception.update(dt);

    // 构建 context (传给 NPC)
    const ctx = {
      map: this.map,
      allEntities: this.entities,
      perception: this.perception,
      combat: this.combat,
      gameTime: this.gameTime,
      game: game,
    };

    // 更新所有 NPC (玩家由 game 单独更新)
    for (const npc of this.entities) {
      if (npc.isPlayer) continue;
      npc.update(dt, ctx);
    }

    // 更新战斗系统
    this.combat.update(dt, ctx);

    // 清理死尸体 (保留 10 秒供 049 复活)
    this._cleanupDead(dt);

    // 更新阶段
    this._updatePhase();
  }

  _checkWaves(game) {
    for (const wave of WAVES) {
      const t = wave.time;
      // 在时间点前后 1 秒内检查
      if (this.gameTime >= t && !this.spawnedWaves.has(t)) {
        this.spawnedWaves.add(t);

        // 生成波次 NPC
        const waveSpawns = WAVE_SPAWNS[t];
        if (waveSpawns) {
          for (const spawn of waveSpawns) {
            for (let i = 0; i < spawn.count; i++) {
              const npc = NPCFactory.create(spawn.type, this.map, spawn.zone, this.nextId++);
              if (npc) {
                this.entities.push(npc);
              }
            }
          }
        }

        game.logEvent(wave.event, 'spawn');
      }
    }
  }

  _cleanupDead(dt) {
    // 死亡的 NPC 保留 10 秒 (供 049 复活), 然后移除
    // 但只移除非 SCP 的尸体, SCP 死亡是重大事件
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (e.dead) {
        // 不在这里移除, 让渲染器显示尸体
        // 但从 AI 更新中排除 (NPC.update 已经检查 dead)
      }
    }
  }

  _updatePhase() {
    let phase = 'SCP DOMINANT';
    for (const wave of WAVES) {
      if (this.gameTime >= wave.time) {
        phase = wave.phase;
      }
    }
    this.currentPhase = phase;
  }

  // 统计各阵营存活数量
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
