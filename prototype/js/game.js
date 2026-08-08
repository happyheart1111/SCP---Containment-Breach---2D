// ============================================================
// game.js — 主游戏循环 + 状态机 + 输入 + HUD
// 状态: menu → playing → gameover
// ============================================================

class Game {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.state = 'menu'; // 'menu' | 'playing' | 'gameover'
    this.paused = false;
    this.timeScale = 1;
    this.gameTime = 0;
    this.lastFrameTime = 0;
    this.fps = 0;
    this.fpsAccum = 0;
    this.fpsFrames = 0;
    this.maxLogEntries = 30;

    // 玩家输入
    this.keys = {};
    this.mouseDown = false;
    this.mouseWorld = new Vec2(0, 0);

    // 玩家引用 (由角色选择创建)
    this.player = null;

    // 摄像头
    this.cameraFollow = false;

    this._initSystems();
    this._initUI();
    this._initInput();

    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  _initSystems() {
    // 地图
    this.map = MapGenerator.generate();
    // 寻路器 (AI用)
    this.pathfinder = new Pathfinder(
      this._buildPathfindingGrid(),
      CONFIG.MAP_COLS, CONFIG.MAP_ROWS
    );
    // 感知
    this.perception = new PerceptionSystem(this.map);
    // 战斗
    this.combat = new CombatSystem();
    // AI
    this.ai = new AISystem(this.map, this.combat, this.perception);
    // 设施 (钥匙卡门禁/914/特斯拉电门)
    this.facilities = new FacilitySystem(this.map);
    // 任务
    this.missions = new MissionSystem(this);
    // 渲染
    this.renderer = new Renderer(this.canvas, this.map);
    this.renderer.game = this;

    // 初始化 AI (观察模式或玩家进入后)
    this.ai.initialize();
  }

  _buildPathfindingGrid() {
    const grid = [];
    for (let r = 0; r < this.map.rows; r++) {
      grid[r] = [];
      for (let c = 0; c < this.map.cols; c++) {
        grid[r][c] = this.map.isWalkable(c, r) ? 0 : 1;
      }
    }
    return grid;
  }

  // ============================================================
  // 角色选择
  // ============================================================
  startGame(role) {
    this._restartWorld();

    // 出生点 (D级/科学家选安全点, 其余按区域)
    let spawnZone = 'LCZ';
    if (role === 'mtf' || role === 'goc' || role === 'ci') spawnZone = 'SZ';
    if (role === 'scp173') spawnZone = 'HCZ';

    let tile = null;
    if (role === 'dclass' || role === 'scientist') {
      tile = this._findSafeSpawn(spawnZone);
    } else {
      tile = this.map.getRandomWalkableTile(spawnZone);
    }
    if (!tile) { this.logEvent('找不到出生点!', 'info'); return; }

    const spawnPos = new Vec2(
      tile.col * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2,
      tile.row * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2
    );

    this.player = new Player(role, spawnPos);
    this.player.input = this; // 共享输入

    // 玩家加入AI实体列表 (AI能看到/攻击玩家)
    this.ai.entities.push(this.player);

    // 任务开始
    this.missions.start(role);

    this.state = 'playing';
    this.gameTime = 0;
    this.cameraFollow = true;
    this.renderer.followTarget = this.player;

    // 设置渲染器显示
    this.renderer.showVision = role === 'scp173';
    this.renderer.showLabels = role !== 'scp173';
    this.renderer.showHearing = false;

    this.logEvent(`你选择了: ${this._roleName(role)}`, 'spawn');
    this.logEvent(this.missions.stages[0].desc, 'info');

    // 隐藏菜单
    document.getElementById('role-menu').classList.add('hidden');
    document.getElementById('gameover-screen').classList.add('hidden');
  }

  _roleName(role) {
    return {
      dclass: 'D级人员', scientist: '科学家', mtf: 'MTF特遣队',
      goc: 'GOC特工', ci: '混沌分裂者', scp173: 'SCP-173'
    }[role] || role;
  }

  // D级出生点: LCZ 中离所有 SCP 最远的可通行 tile
  _findSafeSpawn(zone) {
    const scps = this.ai.entities.filter(e => e.isSCP && !e.dead);
    let best = null;
    let bestDist = -1;

    for (let r = 0; r < this.map.rows; r++) {
      for (let c = 0; c < this.map.cols; c++) {
        if (!this.map.isWalkable(c, r)) continue;
        if (this.map.zoneMap[r][c] !== zone) continue;

        const wx = c * CONFIG.TILE_SIZE;
        const wy = r * CONFIG.TILE_SIZE;
        let minDist = Infinity;
        for (const scp of scps) {
          const d = Math.hypot(scp.pos.x - wx, scp.pos.y - wy);
          if (d < minDist) minDist = d;
        }
        if (minDist > bestDist) {
          bestDist = minDist;
          best = { col: c, row: r };
        }
      }
    }
    return best;
  }

  _restartWorld() {
    this.map = MapGenerator.generate();
    this.pathfinder = new Pathfinder(this._buildPathfindingGrid(), CONFIG.MAP_COLS, CONFIG.MAP_ROWS);
    this.perception = new PerceptionSystem(this.map);
    this.combat = new CombatSystem();
    this.ai = new AISystem(this.map, this.combat, this.perception);
    this.facilities = new FacilitySystem(this.map);
    this.missions = new MissionSystem(this);
    this.renderer.setMap(this.map);
    this.ai.initialize();
  }

  // ============================================================
  // 事件回调 (由 NPC/Player/MissionSystem 调用)
  // ============================================================
  logEvent(text, type = 'info') {
    const log = document.getElementById('event-log');
    if (!log) return;
    const time = this._formatTime(this.gameTime);
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.textContent = `[${time}] ${text}`;
    log.appendChild(entry);

    while (log.children.length > this.maxLogEntries) {
      log.removeChild(log.firstChild);
    }
    log.scrollTop = log.scrollHeight;
  }

  onNPCDeath(victim, killer) {
    if (victim === this.player) return; // 玩家死亡走 onPlayerDeath
    this.logEvent(`${killer ? killer.name : '未知'} → ${victim.name}`, 'death');

    // MTF 目标: 设施内 SCP 被消灭即计入收容进度
    // (AI MTF 也会击杀 SCP — 活着的世界里玩家不是唯一演员)
    if (this.player && this.player.role === 'mtf' && victim.isSCP) {
      this.player.containedCount = Math.min(3, this.player.containedCount + 1);
      this.logEvent(`SCP 收容进度: ${this.player.containedCount}/3`, 'info');
      this.perception.emitNoise(victim.pos, 500, 3, victim);
    }

    // GOC 目标: 玩家用能量武器击杀 SCP 计入摧毁数
    if (this.player && this.player.role === 'goc' && victim.isSCP && killer === this.player) {
      this.player.scpKills = Math.min(2, this.player.scpKills + 1);
      this.logEvent(`SCP 摧毁进度: ${this.player.scpKills}/2`, 'info');
      this.perception.emitNoise(victim.pos, 600, 3, victim);
    }

    // CI 目标: 击杀基金会人员 (MTF/守卫/科学家)
    if (this.player && this.player.role === 'ci' && killer === this.player) {
      if (victim.faction === 'FOUNDATION' || victim.faction === 'SCIENTIST') {
        this.player.foundationKills = Math.min(3, this.player.foundationKills + 1);
        this.logEvent(`基金会人员清除: ${this.player.foundationKills}/3`, 'info');
      }
    }

    // SCP 猎杀计数
    if (this.player && this.player.role === 'scp173' && killer === this.player) {
      this.player.killCount++;
    }
  }

  onPlayerKill(victim) {
    // SCP-173 击杀
    this.player.killCount++;
    this.logEvent(`击杀: ${victim.name} (${this.player.killCount}/5)`, 'death');
  }

  onPlayerDeath(killer) {
    if (this.state !== 'playing') return;
    this.logEvent(`你被 ${killer ? killer.name : '未知'} 杀死了`, 'death');
    this.missions.onPlayerDied(killer);
  }

  onPlayerRecruited(recruiter) {
    this.logEvent(`你被 ${recruiter.name} 招募, 转职为 MTF 新兵!`, 'spawn');
    this.logEvent('新目标: 协助收容SCP', 'info');
  }

  onStageAdvance(stage) {
    this.logEvent(`任务推进: 【${stage.name}】${stage.desc}`, 'info');
  }

  onSCPContained(scpName) {
    if (this.player && this.player.role === 'mtf') {
      this.player.containedCount++;
      this.logEvent(`SCP 收容: ${scpName} (${this.player.containedCount}/3)`, 'spawn');
    }
  }

  onMissionEnd(result, reason) {
    this.state = 'gameover';
    const screen = document.getElementById('gameover-screen');
    const title = document.getElementById('gameover-title');
    const sub = document.getElementById('gameover-sub');

    if (result === 'win') {
      title.textContent = '任务完成';
      title.style.color = '#00ff88';
    } else {
      title.textContent = '任务失败';
      title.style.color = '#ff3344';
    }
    sub.textContent = reason;

    // 统计
    const stats = this.ai.getFactionStats();
    const statLine = document.getElementById('gameover-stats');
    statLine.textContent = `击杀 ${this.player ? this.player.killCount : 0} | SCP收容 ${this.player ? this.player.containedCount : 0}/3 | 设施存活 ${this.ai.getAliveNPCs().length} 单位`;

    screen.classList.remove('hidden');
  }

  // ============================================================
  // 输入
  // ============================================================
  _initInput() {
    // 键盘
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      // 回车重新开始 (gameover 时)
      if (this.state === 'gameover' && e.code === 'Enter') {
        this._showMenu();
      }
      // E 键交互 (开门/914)
      if (e.code === 'KeyE' && this.state === 'playing' && this.player && !this.player.dead) {
        const ctx = this._getCtx();
        this.player.tryInteract(ctx);
      }
      e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    // 鼠标
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseDown = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    window.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      // 转换到世界坐标 (考虑渲染器的缩放和偏移)
      const r = this.renderer;
      const ts = CONFIG.TILE_SIZE;
      const mapW = CONFIG.MAP_COLS * ts;
      const mapH = CONFIG.MAP_ROWS * ts;
      const offX = (r.canvas.width - mapW * r.camera.zoom) / 2;
      const offY = (r.canvas.height - mapH * r.camera.zoom) / 2;
      this.mouseWorld.x = (sx - offX) / r.camera.zoom;
      this.mouseWorld.y = (sy - offY) / r.camera.zoom;
    });
  }

  // ============================================================
  // UI 初始化
  // ============================================================
  _initUI() {
    // 角色选择按钮
    document.getElementById('btn-role-dclass').onclick = () => this.startGame('dclass');
    document.getElementById('btn-role-scientist').onclick = () => this.startGame('scientist');
    document.getElementById('btn-role-mtf').onclick = () => this.startGame('mtf');
    document.getElementById('btn-role-goc').onclick = () => this.startGame('goc');
    document.getElementById('btn-role-ci').onclick = () => this.startGame('ci');
    document.getElementById('btn-role-scp173').onclick = () => this.startGame('scp173');
    document.getElementById('btn-menu-again').onclick = () => this._showMenu();
    document.getElementById('btn-menu-restart').onclick = () => this._showMenu();

    // 速度控制
    document.getElementById('btn-pause').onclick = () => {
      this.paused = !this.paused;
      this._updateButtonStates();
    };
    document.getElementById('btn-1x').onclick = () => { this.timeScale = 1; this._updateButtonStates(); };
    document.getElementById('btn-2x').onclick = () => { this.timeScale = 2; this._updateButtonStates(); };
    document.getElementById('btn-4x').onclick = () => { this.timeScale = 4; this._updateButtonStates(); };

    // 显示切换
    document.getElementById('btn-vision').onclick = (e) => {
      this.renderer.showVision = !this.renderer.showVision;
      e.target.classList.toggle('toggle-on');
      e.target.classList.toggle('toggle-off');
    };
    document.getElementById('btn-hearing').onclick = (e) => {
      this.renderer.showHearing = !this.renderer.showHearing;
      e.target.classList.toggle('toggle-on');
      e.target.classList.toggle('toggle-off');
    };
    document.getElementById('btn-paths').onclick = (e) => {
      this.renderer.showPaths = !this.renderer.showPaths;
      e.target.classList.toggle('toggle-on');
      e.target.classList.toggle('toggle-off');
    };
    document.getElementById('btn-labels').onclick = (e) => {
      this.renderer.showLabels = !this.renderer.showLabels;
      e.target.classList.toggle('toggle-on');
      e.target.classList.toggle('toggle-off');
    };

    // 操作
    document.getElementById('btn-restart').onclick = () => this._showMenu();
    document.getElementById('btn-spawn-mtf').onclick = () => {
      const npc = this.ai.spawnNPC('mtf_private', 'SZ');
      if (npc) this.logEvent(`手动生成: ${npc.name}`, 'spawn');
    };
    document.getElementById('btn-spawn-ci').onclick = () => {
      const npc = this.ai.spawnNPC('ci_soldier', 'SZ');
      if (npc) this.logEvent(`手动生成: ${npc.name}`, 'spawn');
    };
    document.getElementById('btn-spawn-scp').onclick = () => {
      const types = ['scp_173', 'scp_049', 'scp_939'];
      const t = types[Math.floor(Math.random() * types.length)];
      const npc = this.ai.spawnNPC(t, 'HCZ');
      if (npc) this.logEvent(`手动生成: ${npc.name}`, 'spawn');
    };

    this._updateButtonStates();
  }

  _showMenu() {
    this.state = 'menu';
    this.cameraFollow = false;
    document.getElementById('role-menu').classList.remove('hidden');
    document.getElementById('gameover-screen').classList.add('hidden');
  }

  _updateButtonStates() {
    const pauseBtn = document.getElementById('btn-pause');
    if (!pauseBtn) return;
    pauseBtn.textContent = this.paused ? '▶' : '⏸';
    pauseBtn.classList.toggle('toggle-on', !this.paused);

    ['1x', '2x', '4x'].forEach(s => {
      const btn = document.getElementById(`btn-${s}`);
      if (btn) btn.classList.toggle('toggle-on', this.timeScale === parseInt(s));
    });
  }

  _formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // ============================================================
  // HUD 更新
  // ============================================================
  _updateHUD() {
    // 安全取元素: 缺失时返回 no-op 占位, 防止 HUD 错误杀死渲染循环
    const el = (id) => document.getElementById(id) || {
      textContent: '',
      innerHTML: '',
      style: {},
      classList: { add() {}, remove() {}, toggle() {} },
      appendChild() {}, removeChild() {}, scrollTop: 0, scrollHeight: 0, children: [],
    };
    el('hud-time').textContent = this._formatTime(this.gameTime);
    el('hud-phase').textContent = this.ai.currentPhase;
    el('hud-npcs').textContent = this.ai.getAliveNPCs().length;
    el('hud-fps').textContent = Math.round(this.fps);

    // 阵营统计
    const stats = this.ai.getFactionStats();
    const list = el('faction-list');
    list.innerHTML = '';

    const order = ['SCP', 'WILD', 'ZOMBIE', 'FOUNDATION', 'CI', 'GOC', 'SCIENTIST', 'DCLASS'];
    for (const fId of order) {
      const stat = stats[fId];
      if (!stat || stat.total === 0) continue;
      const f = FACTIONS[fId];
      const card = document.createElement('div');
      card.className = 'faction-card';
      card.style.borderLeftColor = f.color;
      card.innerHTML = `
        <span class="fname" style="color:${f.color}">${f.name}</span>
        <span>
          <span class="falive">${stat.alive}</span>
          <span style="color:#555">/</span>
          <span class="fdead">${stat.dead}</span>
        </span>
      `;
      list.appendChild(card);
    }

    // 玩家 HUD
    const playerHUD = el('player-hud');
    if (this.player && this.state === 'playing' && !this.player.dead) {
      playerHUD.classList.remove('hidden');

      // HP
      const hpBar = el('player-hp-bar');
      hpBar.style.width = `${Math.max(0, this.player.hp / this.player.maxHp * 100)}%`;
      hpBar.style.background = this.player.hp / this.player.maxHp > 0.5 ? '#00ff88' :
                               this.player.hp / this.player.maxHp > 0.25 ? '#ffaa00' : '#ff3344';
      el('player-hp-text').textContent = `${Math.ceil(this.player.hp)}/${this.player.maxHp}`;

      // 弹药
      if (this.player.weapon) {
        const wname = WEAPONS[this.player.weapon].name;
        el('player-ammo').textContent = `${wname} ${this.player.ammo >= 0 ? this.player.ammo : '∞'}`;
      } else {
        el('player-ammo').textContent = '徒手 — 寻找武器';
      }

      // 钥匙卡显示
      const keycardEl = el('player-keycard');
      if (this.player.keycardLevel > 0) {
        const card = KEYCARDS[this.player.keycardLevel];
        keycardEl.textContent = card ? `${card.name} (${card.role})` : '万能钥匙卡';
        keycardEl.style.color = card ? card.color : '#fff';
        keycardEl.classList.remove('hidden');
      } else {
        keycardEl.classList.add('hidden');
      }

      // SCP-914 模式提示
      const modeEl = el('player-914-mode');
      const nearby914 = this.facilities.getNearby914(this.player.pos, CONFIG.TILE_SIZE * 2.5);
      if (nearby914) {
        modeEl.textContent = `SCP-914 [${nearby914.mode}] — E切换模式 / 进料舱内E激活`;
        modeEl.classList.remove('hidden');
      } else {
        modeEl.classList.add('hidden');
      }

      // 角色名
      el('player-role').textContent = this._roleName(this.player.role) +
        (this.player.recruited ? ' (MTF新兵)' : '');

      // 173 注视警告
      const watchWarn = el('scp-watch-warning');
      if (this.player.role === 'scp173') {
        watchWarn.classList.toggle('hidden', !this.player.watched);
        watchWarn.textContent = this.player.watched ? '⚠ 被注视 — 冻结!' : '';
      } else {
        watchWarn.classList.add('hidden');
      }

      // 任务面板
      this._renderMissionPanel();
    } else {
      playerHUD.classList.add('hidden');
    }
  }

  _renderMissionPanel() {
    const panel = document.getElementById('mission-panel');
    if (!this.missions.active) return;

    const data = this.missions.getHudData();

    // 阶段进度
    const stageLine = document.getElementById('mission-stage');
    const stage = data.stages[data.stage];
    stageLine.innerHTML = `<span style="color:#00ccff">阶段 ${data.stage + 1}/${data.stages.length}</span> — ${stage ? stage.name : ''}: ${stage ? stage.desc : ''}`;

    // 进度条
    const bar = document.getElementById('mission-bar');
    bar.style.width = `${Math.min(100, data.progress)}%`;

    // 目标列表
    const objList = document.getElementById('mission-objectives');
    objList.innerHTML = '';
    for (const obj of data.objectives) {
      const div = document.createElement('div');
      div.className = 'mission-obj' + (obj.done ? ' done' : '');
      const color = obj.level === 'P0' ? '#ffaa00' : obj.level === 'P1' ? '#44ddff' : '#aa44ff';
      div.innerHTML = `<span class="obj-level" style="color:${color}">${obj.level}</span> ${obj.done ? '✔' : '○'} ${obj.text}`;
      objList.appendChild(div);
    }
  }

  // 构建共享 ctx (玩家/AI/设施共用)
  _getCtx() {
    return {
      map: this.map,
      allEntities: this.ai.entities,
      perception: this.perception,
      combat: this.combat,
      facilities: this.facilities,
      gameTime: this.gameTime,
      game: this,
      player: this.player,
    };
  }

  // 渲染
  renderGame() {
    this.renderer.render(this.ai, this.combat, this.perception, this.facilities, this.gameTime);
  }

  // ============================================================
  // 主循环
  // ============================================================
  _loop(timestamp) {
    const rawDt = this.lastFrameTime ? (timestamp - this.lastFrameTime) / 1000 : 0;
    this.lastFrameTime = timestamp;

    // FPS
    this.fpsAccum += rawDt;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    const dt = this.paused ? 0 : Math.min(rawDt, 0.05) * this.timeScale;

    // 帧错误保护: 任何异常不得杀死渲染循环
    try {
      if (dt > 0 && this.state !== 'menu') {
        this.gameTime += dt;
        this.ai.update(dt, this);

        // AI NPC 门禁处理 (有卡自动开门)
        const ctxFac = this._getCtx();
        for (const npc of this.ai.entities) {
          if (npc.isPlayer || npc.dead) continue;
          this.facilities.handleNPCDoor(npc, ctxFac);
        }

        // 设施系统更新 (特斯拉电门/914)
        this.facilities.update(dt, ctxFac);

        // 玩家更新
        if (this.player && !this.player.dead) {
          const ctx = this._getCtx();
          this.player.update(dt, ctx);
          this.missions.update(dt, ctx);
        }
      }

      // 渲染
      this.renderGame();
      this._updateHUD();
    } catch (e) {
      if (this._lastFrameError !== e.message) {
        this._lastFrameError = e.message;
        console.error('[FrameError]', e.message);
      }
    }

    requestAnimationFrame(this._loop);
  }
}

// ============================================================
// 启动
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  window.game = new Game();
});
