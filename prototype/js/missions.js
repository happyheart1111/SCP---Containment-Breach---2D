// ============================================================
// missions.js — 角色任务系统 (阶段追踪 + 完成/失败判定)
// 任务定义参考 GDD 第11节 (RXSEND任务优先级 + SCP:SL转职)
// ============================================================

class MissionSystem {
  constructor(game) {
    this.game = game;
    this.role = null;
    this.active = false;
    this.completed = false;
    this.stage = 0;
    this.stages = [];
    this.objectives = []; // P0/P1/P2 目标列表
    this.result = null;   // 'win' | 'lose' | null
    this.resultReason = '';
  }

  start(role) {
    this.role = role;
    this.active = true;
    this.completed = false;
    this.stage = 0;
    this.result = null;
    this.resultReason = '';
    this.stages = this._defineStages(role);
    this.objectives = this._defineObjectives(role);
  }

  // ============================================================
  // 阶段定义
  // ============================================================
  _defineStages(role) {
    switch (role) {
      case 'dclass':
        return [
          { name: '觉醒', zone: 'LCZ', desc: '在LCZ中找到武器或钥匙卡, 准备突破' },
          { name: '突破', zone: 'HCZ', desc: '穿越重收容区, 避开SCP, 到达EZ' },
          { name: '逃离', zone: 'SZ',  desc: '到达地表出口, 逃出升天!' },
        ];
      case 'mtf':
        return [
          { name: '进入', zone: 'SZ', desc: '从地表进入设施, 突破到EZ' },
          { name: '清剿', zone: 'HCZ', desc: '收容/消灭3个SCP (173/049/939)' },
          { name: '撤离', zone: 'SZ',  desc: '完成任务后返回地表' },
        ];
      case 'scp173':
        return [
          { name: '潜行', zone: 'HCZ', desc: '利用未被注视的间隙接近人类' },
          { name: '瞬杀', zone: 'HCZ', desc: '接触人类秒杀, 制造尸体' },
          { name: '压制', zone: 'LCZ', desc: '追杀剩余人类, 达成击杀目标' },
        ];
      default:
        return [];
    }
  }

  // ============================================================
  // 目标定义 (P0首要 / P1次要 / P2隐藏)
  // ============================================================
  _defineObjectives(role) {
    switch (role) {
      case 'dclass':
        return [
          { level: 'P0', text: '到达地表出口逃离设施', done: false },
          { level: 'P1', text: '拾取武器(手枪)', done: false },
          { level: 'P2', text: '被MTF招募转职', done: false },
        ];
      case 'mtf':
        return [
          { level: 'P0', text: '收容/消灭3个SCP (173/049/939)', done: false },
          { level: 'P1', text: '保护2名科学家NPC存活', done: false },
          { level: 'P2', text: '救援并招募D级', done: false },
        ];
      case 'scp173':
        return [
          { level: 'P0', text: '击杀5名人类 (80%设施人口)', done: false },
          { level: 'P1', text: '优先猎杀武装目标(MTF/警卫)', done: false },
          { level: 'P2', text: '在核弹倒计时中存活', done: false },
        ];
      default:
        return [];
    }
  }

  // ============================================================
  // 每帧更新
  // ============================================================
  update(dt, ctx) {
    if (!this.active || this.completed) return;

    const player = ctx.player;
    if (!player || player.dead) return;

    this._updateObjectives(ctx);

    switch (this.role) {
      case 'dclass':  this._checkDClass(player, ctx);  break;
      case 'mtf':     this._checkMTF(player, ctx);     break;
      case 'scp173':  this._checkSCP173(player, ctx);  break;
    }
  }

  // ============================================================
  // 目标状态更新
  // ============================================================
  _updateObjectives(ctx) {
    const player = ctx.player;
    if (!player) return;

    switch (this.role) {
      case 'dclass':
        this.objectives[0].done = player.reachedExit || false;
        this.objectives[1].done = !!player.weapon;
        this.objectives[2].done = player.recruited || false;
        break;
      case 'mtf':
        this.objectives[0].done = player.containedCount >= 3;
        this.objectives[1].done = this._aliveScientists(ctx) >= 2;
        this.objectives[2].done = false; // 原型未实现招募NPC
        break;
      case 'scp173':
        this.objectives[0].done = player.killCount >= 5;
        this.objectives[1].done = player.killCount >= 3; // 简化
        break;
    }
  }

  _aliveScientists(ctx) {
    let count = 0;
    for (const e of ctx.allEntities) {
      if (e.faction === 'SCIENTIST' && !e.dead) count++;
    }
    return count;
  }

  // ============================================================
  // D级: 按区域推进阶段, 到达出口胜利
  // ============================================================
  _checkDClass(player, ctx) {
    const tile = ctx.map.worldToTile(player.pos.x, player.pos.y);
    const zone = ctx.map.getZone(tile.col, tile.row);

    // 阶段推进
    if (zone) {
      const stageIdx = this.stages.findIndex(s => s.zone === zone);
      if (stageIdx > this.stage && zone !== 'LCZ') {
        // 只有向前推进才更新 (LCZ→HCZ→EZ→SZ)
        if (zone === 'HCZ' || zone === 'EZ' || zone === 'SZ') {
          this.stage = Math.max(this.stage, stageIdx);
          this.game.onStageAdvance(this.stages[this.stage]);
        }
      }
    }

    // 到达出口
    const exit = ctx.map.exitPoints['SZ'];
    if (exit) {
      const ex = exit.col * CONFIG.TILE_SIZE;
      const ey = exit.row * CONFIG.TILE_SIZE;
      if (player.pos.x >= ex - CONFIG.TILE_SIZE && player.pos.x <= ex + CONFIG.TILE_SIZE * 2 &&
          player.pos.y >= ey - CONFIG.TILE_SIZE && player.pos.y <= ey + CONFIG.TILE_SIZE * 2) {
        player.reachedExit = true;
        this.completed = true;
        this.result = 'win';
        this.resultReason = '你逃出了设施!';
        this.game.onMissionEnd('win', this.resultReason);
      }
    }
  }

  // ============================================================
  // MTF: 收容计数推进
  // ============================================================
  _checkMTF(player, ctx) {
    // 收容进度由 game.onSCPContained 更新
    if (player.containedCount >= 3) {
      this.completed = true;
      this.result = 'win';
      this.resultReason = '所有目标SCP已收容, 设施安全!';
      this.game.onMissionEnd('win', this.resultReason);
    }
  }

  // ============================================================
  // SCP-173: 击杀计数推进
  // ============================================================
  _checkSCP173(player, ctx) {
    if (player.killCount >= 5) {
      this.completed = true;
      this.result = 'win';
      this.resultReason = '你猎杀了足够的猎物, 人类陷入恐慌!';
      this.game.onMissionEnd('win', this.resultReason);
    }
  }

  // ============================================================
  // 死亡判定 (由 game 调用)
  // ============================================================
  onPlayerDied(killer) {
    if (this.completed) return;
    this.completed = true;
    this.result = 'lose';
    this.resultReason = killer ? `你被 ${killer.name} 杀死了` : '你死了';
    this.game.onMissionEnd('lose', this.resultReason);
  }

  // ============================================================
  // HUD 数据
  // ============================================================
  getHudData() {
    return {
      role: this.role,
      stage: this.stage,
      stages: this.stages,
      objectives: this.objectives,
      progress: this._getProgress(),
    };
  }

  _getProgress() {
    switch (this.role) {
      case 'dclass':  return this.game.player ? Math.round(this.game.player.pos.x / (CONFIG.MAP_COLS * CONFIG.TILE_SIZE) * 100) : 0;
      case 'mtf':     return this.game.player ? Math.round(this.game.player.containedCount / 3 * 100) : 0;
      case 'scp173':  return this.game.player ? Math.round(this.game.player.killCount / 5 * 100) : 0;
      default: return 0;
    }
  }
}
