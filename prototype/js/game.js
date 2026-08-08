// ============================================================
// game.js — 主游戏循环 + 输入处理 + HUD 更新
// ============================================================

class Game {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.paused = false;
    this.timeScale = 1;
    this.gameTime = 0;
    this.lastFrameTime = 0;
    this.fps = 0;
    this.fpsAccum = 0;
    this.fpsFrames = 0;
    this.maxLogEntries = 30;

    this._initSystems();
    this._initUI();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  _initSystems() {
    // 地图
    this.map = MapGenerator.generate();
    // 寻路器
    this.pathfinder = new Pathfinder(
      this._buildPathfindingGrid(),
      CONFIG.MAP_COLS,
      CONFIG.MAP_ROWS
    );
    // 感知
    this.perception = new PerceptionSystem(this.map);
    // 战斗
    this.combat = new CombatSystem();
    // AI
    this.ai = new AISystem(this.map, this.combat, this.perception);
    // 渲染
    this.renderer = new Renderer(this.canvas, this.map);

    // 初始化 NPC
    this.ai.initialize();

    this.logEvent('设施收容失效 — 仿真启动', 'info');
    this.logEvent(`生成 ${this.ai.entities.length} 个初始实体`, 'info');
  }

  // 构建寻路用网格 (0=可走, 1=墙)
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

  _initUI() {
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
    document.getElementById('btn-restart').onclick = () => this._restart();
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

  _updateButtonStates() {
    const pauseBtn = document.getElementById('btn-pause');
    pauseBtn.textContent = this.paused ? '▶' : '⏸';
    pauseBtn.classList.toggle('toggle-on', !this.paused);

    ['1x', '2x', '4x'].forEach(s => {
      const btn = document.getElementById(`btn-${s}`);
      btn.classList.toggle('toggle-on', this.timeScale === parseInt(s));
    });
  }

  _restart() {
    this.map = MapGenerator.generate();
    this.pathfinder = new Pathfinder(
      this._buildPathfindingGrid(),
      CONFIG.MAP_COLS, CONFIG.MAP_ROWS
    );
    this.perception = new PerceptionSystem(this.map);
    this.combat = new CombatSystem();
    this.ai = new AISystem(this.map, this.combat, this.perception);
    this.renderer.setMap(this.map);
    this.ai.initialize();
    this.gameTime = 0;
    this.logEvent('— 仿真重置 —', 'info');
    this.logEvent(`生成 ${this.ai.entities.length} 个初始实体`, 'info');
  }

  logEvent(text, type = 'info') {
    const log = document.getElementById('event-log');
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
    if (killer) {
      this.logEvent(`${killer.name} → ${victim.name}`, 'death');
    } else {
      this.logEvent(`${victim.name} 死亡`, 'death');
    }
  }

  _formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  _updateHUD() {
    document.getElementById('hud-time').textContent = this._formatTime(this.gameTime);
    document.getElementById('hud-phase').textContent = this.ai.currentPhase;
    document.getElementById('hud-npcs').textContent = this.ai.getAliveNPCs().length;
    document.getElementById('hud-fps').textContent = Math.round(this.fps);

    // 阵营列表
    const stats = this.ai.getFactionStats();
    const list = document.getElementById('faction-list');
    list.innerHTML = '';

    // 按阵营顺序显示, 只显示有实体的
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
  }

  _loop(timestamp) {
    const rawDt = this.lastFrameTime ? (timestamp - this.lastFrameTime) / 1000 : 0;
    this.lastFrameTime = timestamp;

    // FPS 计算
    this.fpsAccum += rawDt;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    const dt = this.paused ? 0 : Math.min(rawDt, 0.05) * this.timeScale;

    if (dt > 0) {
      this.gameTime += dt;
      this.ai.update(dt, this);
    }

    this.renderer.render(this.ai, this.combat, this.perception, this.gameTime);
    this._updateHUD();

    requestAnimationFrame(this._loop);
  }
}

// ============================================================
// 启动
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  new Game();
});
