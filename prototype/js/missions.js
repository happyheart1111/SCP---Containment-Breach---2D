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
      case 'scientist':
        return [
          { name: '收集', zone: 'LCZ', desc: '进入各区域收集SCP文档 (3份)' },
          { name: '汇合', zone: 'EZ',  desc: '等待MTF救援, 向地表推进' },
          { name: '撤离', zone: 'SZ',  desc: '带着文档逃出设施' },
        ];
      case 'mtf':
        return [
          { name: '进入', zone: 'SZ', desc: '从地表进入设施, 突破到EZ' },
          { name: '清剿', zone: 'HCZ', desc: '收容/消灭3个SCP (173/049/939)' },
          { name: '撤离', zone: 'SZ',  desc: '完成任务后返回地表' },
        ];
      case 'goc':
        return [
          { name: '潜入', zone: 'SZ', desc: '从地表潜入设施, 定位SCP' },
          { name: '猎杀', zone: 'HCZ', desc: '用能量武器摧毁2个SCP' },
          { name: '撤离', zone: 'SZ',  desc: '窃取样本后撤往直升机' },
        ];
      case 'ci':
        return [
          { name: '渗透', zone: 'SZ', desc: '从地表渗透设施' },
          { name: '接应', zone: 'LCZ', desc: '找到D级人员, 清除基金会阻碍' },
          { name: '撤离', zone: 'SZ',  desc: '护送D级撤离点' },
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
          { level: 'P1', text: '拾取武器', done: false },
          { level: 'P2', text: '被MTF招募转职', done: false },
        ];
      case 'scientist':
        return [
          { level: 'P0', text: '收集3份SCP文档并逃离', done: false },
          { level: 'P1', text: '保持存活等待MTF救援', done: false },
          { level: 'P2', text: '与D级合作利用资源', done: false },
        ];
      case 'mtf':
        return [
          { level: 'P0', text: '收容/消灭3个SCP (173/049/939)', done: false },
          { level: 'P1', text: '保护2名科学家NPC存活', done: false },
          { level: 'P2', text: '救援并招募D级', done: false },
        ];
      case 'goc':
        return [
          { level: 'P0', text: '用能量武器摧毁2个SCP', done: false },
          { level: 'P1', text: '窃取1个SCP物品样本', done: false },
          { level: 'P2', text: '在不被MTF攻击下撤离', done: false },
        ];
      case 'ci':
        return [
          { level: 'P0', text: '击杀3名基金会人员(MTF/警卫/科学家)', done: false },
          { level: 'P1', text: '接应2名D级人员', done: false },
          { level: 'P2', text: '利用SCP分散基金会注意力', done: false },
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
      case 'dclass':    this._checkDClass(player, ctx);    break;
      case 'scientist': this._checkScientist(player, ctx); break;
      case 'mtf':       this._checkMTF(player, ctx);       break;
      case 'goc':       this._checkGOC(player, ctx);       break;
      case 'ci':        this._checkCI(player, ctx);        break;
      case 'scp173':    this._checkSCP173(player, ctx);    break;
    }
  }

  // 玩家跨图传送时推进阶段
  onLevelChanged(levelId) {
    if (!this.active || this.completed) return;
    const stageIdx = this.stages.findIndex(s => s.zone === levelId);
    if (stageIdx > this.stage) {
      this.stage = stageIdx;
      this.game.onStageAdvance(this.stages[this.stage]);
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
      case 'scientist':
        this.objectives[0].done = (player.docCount >= 3 && player.reachedExit) || false;
        this.objectives[1].done = !player.dead;
        break;
      case 'goc':
        this.objectives[0].done = player.scpKills >= 2;
        this.objectives[1].done = player.scpKills >= 1; // 击杀SCP即"获得样本"
        this.objectives[2].done = !player.dead;
        break;
      case 'ci':
        this.objectives[0].done = player.foundationKills >= 3;
        this.objectives[1].done = player.dclassEscorted >= 2;
        break;
      case 'scp173':
        this.objectives[0].done = player.killCount >= 5;
        this.objectives[1].done = player.killCount >= 3; // 简化
        break;
    }
  }

  _aliveScientists(ctx) {
    let count = 0;
    const entities = ctx.world ? ctx.world.entities : ctx.allEntities;
    for (const e of entities) {
      if (e.faction === 'SCIENTIST' && !e.dead) count++;
    }
    return count;
  }

  // ============================================================
  // D级: 按区域推进阶段, 到达地表出口胜利
  // ============================================================
  _checkDClass(player, ctx) {
    // 到达地表出口 (SZ 地图上的 EXIT tile)
    if (player.levelId === 'SZ') {
      const szMap = ctx.world.getLevel('SZ');
      const exit = szMap.exitPoints['SZ'];
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
  }

  // ============================================================
  // 科学家: 收集3份文档 + 到达地表出口
  // ============================================================
  _checkScientist(player, ctx) {
    // 到达地表出口: 需集齐文档
    if (player.levelId === 'SZ') {
      const szMap = ctx.world.getLevel('SZ');
      const exit = szMap.exitPoints['SZ'];
      if (exit) {
        const ex = exit.col * CONFIG.TILE_SIZE;
        const ey = exit.row * CONFIG.TILE_SIZE;
        if (player.pos.x >= ex - CONFIG.TILE_SIZE && player.pos.x <= ex + CONFIG.TILE_SIZE * 2 &&
            player.pos.y >= ey - CONFIG.TILE_SIZE && player.pos.y <= ey + CONFIG.TILE_SIZE * 2) {
          player.reachedExit = true;
          if (player.docCount >= 3) {
            this.completed = true;
            this.result = 'win';
            this.resultReason = '你带着3份SCP文档逃出了设施!';
            this.game.onMissionEnd('win', this.resultReason);
          } else {
            this.game.logEvent(`文档不足! 需要 ${3 - player.docCount} 份 (已收集 ${player.docCount}/3)`, 'combat');
          }
        }
      }
    }
  }

  // ============================================================
  // GOC: 摧毁2个SCP (能量武器击杀)
  // ============================================================
  _checkGOC(player, ctx) {
    if (player.scpKills >= 2) {
      this.completed = true;
      this.result = 'win';
      this.resultReason = '2个SCP已被摧毁, 异常威胁清除!';
      this.game.onMissionEnd('win', this.resultReason);
    }
  }

  // ============================================================
  // CI: 击杀3名基金会人员 + 接应2名D级
  // ============================================================
  _checkCI(player, ctx) {
    if (player.foundationKills >= 3 && player.dclassEscorted >= 2) {
      this.completed = true;
      this.result = 'win';
      this.resultReason = '基金会势力被瓦解, D级人员已获救!';
      this.game.onMissionEnd('win', this.resultReason);
    }
  }

  // 通用: 按所在区域推进阶段 (多地图: 用 levelId)
  _advanceStageByZone(player, ctx) {
    const levelId = player.levelId;
    if (!levelId) return;
    const stageIdx = this.stages.findIndex(s => s.zone === levelId);
    if (stageIdx > this.stage) {
      this.stage = stageIdx;
      this.game.onStageAdvance(this.stages[this.stage]);
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
    const p = this.game.player;
    if (!p) return 0;
    switch (this.role) {
      case 'dclass': {
        // 进度 = 到达的区域 (LCZ→EZ→HCZ→SZ)
        const order = { LCZ: 10, EZ: 40, HCZ: 70, SZ: 100 };
        return order[p.levelId] || 0;
      }
      case 'scientist': return Math.round((p.docCount / 3 + (p.reachedExit ? 0.2 : 0)) * 100);
      case 'mtf':     return Math.round(p.containedCount / 3 * 100);
      case 'goc':     return Math.round(p.scpKills / 2 * 100);
      case 'ci':      return Math.round((p.foundationKills / 3 * 0.6 + p.dclassEscorted / 2 * 0.4) * 100);
      case 'scp173':  return Math.round(p.killCount / 5 * 100);
      default: return 0;
    }
  }
}
