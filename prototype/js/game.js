// ============================================================
// game.js — 主游戏循环 + 状态机 + 输入 + HUD (v1.0.0 多地图版)
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

    // 背包/控制面板状态
    this.inventoryOpen = false;
    this.selectedInvIndex = -1;
    this.controlsCollapsed = false;

    this.cameraFollow = false;

    this._initWorld();
    this._initUI();
    this._initInput();

    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  // ============================================================
  // 世界初始化 (多地图)
  // ============================================================
  _initWorld() {
    this.world = new GameWorld().generate();
    this.map = this.world.getLevel('LCZ');
    this.perception = new PerceptionSystem();
    this.combat = new CombatSystem();
    this.ai = new AISystem(this.world, this.combat, this.perception);
    this.items = new ItemSystem(this.world);
    this.world.items = this.items;
    this.missions = new MissionSystem(this);
    this.renderer = new Renderer(this.canvas, this.world);
    this.renderer.game = this;
    this.ai.initialize();
  }

  // 获取当前地图 (随玩家)
  get currentMap() {
    if (this.player) {
      return this.world.getLevel(this.player.levelId);
    }
    return this.world.getLevel(this.world.currentLevelId);
  }

  // ============================================================
  // 角色选择
  // ============================================================
  startGame(role) {
    this._restartWorld();

    // 出生地图
    let spawnLevel = 'LCZ';
    if (role === 'mtf' || role === 'goc' || role === 'ci') spawnLevel = 'SZ';
    if (role === 'scp173') spawnLevel = 'HCZ';

    const map = this.world.getLevel(spawnLevel);
    let tile = null;
    if (role === 'dclass' || role === 'scientist') {
      tile = this._findSafeSpawn(spawnLevel);
    } else {
      tile = map.getRandomWalkableTile(spawnLevel);
    }
    if (!tile) { this.logEvent('找不到出生点!', 'info'); return; }

    const spawnPos = new Vec2(
      tile.col * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2,
      tile.row * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2
    );

    this.player = new Player(role, spawnPos, spawnLevel);
    this.player.input = this;
    this.player.mouseWorld = this.mouseWorld;
    this.player.game = this;
    // 初始朝向: 指向玩家右侧 (避免出生时朝向 (0,0))
    this.mouseWorld.x = spawnPos.x + 100;
    this.mouseWorld.y = spawnPos.y;

    // 玩家加入AI实体列表
    this.ai.entities.push(this.player);

    this.world.currentLevelId = spawnLevel;
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
    this.logEvent(`出生区域: ${LEVEL_NAMES[spawnLevel]}`, 'info');

    // 隐藏菜单
    document.getElementById('role-menu').classList.add('hidden');
    document.getElementById('start-menu').classList.add('hidden');
    document.getElementById('gameover-screen').classList.add('hidden');
    this.inventoryOpen = false;
    this._setInventoryPanel(false);
  }

  _roleName(role) {
    return {
      dclass: 'D级人员', scientist: '科学家', mtf: 'MTF特遣队',
      goc: 'GOC特工', ci: '混沌分裂者', scp173: 'SCP-173'
    }[role] || role;
  }

  // 观察模式: 不选角色, 直接观看 AI 阵营自主交战
  startObserve() {
    this._restartWorld();
    this.player = null;
    this.state = 'playing';
    this.gameTime = 0;
    this.cameraFollow = false;
    this.renderer.followTarget = null;
    this.renderer.showLabels = true;
    this.renderer.showVision = false;
    this.inventoryOpen = false;
    this._setInventoryPanel(false);
    document.getElementById('start-menu').classList.add('hidden');
    document.getElementById('role-menu').classList.add('hidden');
    document.getElementById('gameover-screen').classList.add('hidden');
    this.logEvent('观察模式: 设施已生成, AI 阵营自主交战', 'spawn');
    this.logEvent('提示: 这是无玩家的纯仿真, 观察波次推进与阵营博弈', 'info');
  }

  // D级出生点: 离所有 SCP 最远的可通行 tile
  _findSafeSpawn(levelId) {
    const map = this.world.getLevel(levelId);
    const scps = this.ai.entities.filter(e => e.isSCP && !e.dead && e.levelId === levelId);
    let best = null;
    let bestDist = -1;

    for (let r = 0; r < map.rows; r++) {
      for (let c = 0; c < map.cols; c++) {
        if (!map.isWalkable(c, r)) continue;
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
    this.world = new GameWorld().generate();
    this.map = this.world.getLevel('LCZ');
    this.perception = new PerceptionSystem();
    this.combat = new CombatSystem();
    this.ai = new AISystem(this.world, this.combat, this.perception);
    this.items = new ItemSystem(this.world);
    this.world.items = this.items;
    this.missions = new MissionSystem(this);
    this.renderer.setWorld(this.world);
    this.renderer.followTarget = null;
    this.ai.initialize();
  }

  // ============================================================
  // 事件回调
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

  // 玩家跨图传送回调
  onLevelChange(newLevelId) {
    this.world.currentLevelId = newLevelId;
    this.missions.onLevelChanged(newLevelId);
  }

  onNPCDeath(victim, killer) {
    if (victim === this.player) return;
    this.logEvent(`${killer ? killer.name : '未知'} → ${victim.name}`, 'death');

    if (this.player && this.player.role === 'mtf' && victim.isSCP) {
      this.player.containedCount = Math.min(3, this.player.containedCount + 1);
      this.logEvent(`SCP 收容进度: ${this.player.containedCount}/3`, 'info');
      this.perception.emitNoise(victim.pos, 500, 3, victim);
    }

    if (this.player && this.player.role === 'goc' && victim.isSCP && killer === this.player) {
      this.player.scpKills = Math.min(2, this.player.scpKills + 1);
      this.logEvent(`SCP 摧毁进度: ${this.player.scpKills}/2`, 'info');
      this.perception.emitNoise(victim.pos, 600, 3, victim);
    }

    if (this.player && this.player.role === 'ci' && killer === this.player) {
      if (victim.faction === 'FOUNDATION' || victim.faction === 'SCIENTIST') {
        this.player.foundationKills = Math.min(3, this.player.foundationKills + 1);
        this.logEvent(`基金会人员清除: ${this.player.foundationKills}/3`, 'info');
      }
    }

    if (this.player && this.player.role === 'scp173' && killer === this.player) {
      this.player.killCount++;
    }
  }

  onPlayerKill(victim) {
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

    const stats = this.ai.getFactionStats();
    const statLine = document.getElementById('gameover-stats');
    statLine.textContent = `击杀 ${this.player ? this.player.killCount : 0} | SCP收容 ${this.player ? this.player.containedCount : 0}/3 | 设施存活 ${this.ai.getAliveNPCs().length} 单位`;

    screen.classList.remove('hidden');
  }

  // ============================================================
  // 输入
  // ============================================================
  _initInput() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;

      // 数字键使用物品 (1-6)
      if (this.state === 'playing' && this.player && !this.player.dead) {
        const numMap = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5 };
        if (numMap[e.code] !== undefined) {
          const ctx = this._getCtx();
          this.player.tryUseInventory(numMap[e.code], ctx);
          this.selectedInvIndex = -1;
        }
      }

      // Tab: 背包开/关
      if (e.code === 'Tab' && this.state === 'playing' && this.player && !this.player.dead) {
        e.preventDefault();
        this.inventoryOpen = !this.inventoryOpen;
        this.selectedInvIndex = -1;
        this._setInventoryPanel(this.inventoryOpen);
        return;
      }

      if (this.state === 'gameover' && e.code === 'Enter') {
        this._showMenu();
      }
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
      const map = this.currentMap;
      const ts = CONFIG.TILE_SIZE;
      const mapW = map.cols * ts;
      const mapH = map.rows * ts;

      // 跟随模式用 followZoom, 否则用 camera.zoom
      const r = this.renderer;
      let zoom, offX, offY;
      if (this.cameraFollow && this.player && !this.player.dead) {
        zoom = r.followZoom || 1.6;
        offX = this.canvas.width / 2 - this.player.pos.x * zoom;
        offY = this.canvas.height / 2 - this.player.pos.y * zoom;
        offX = Math.min(0, Math.max(this.canvas.width - mapW * zoom, offX));
        offY = Math.min(0, Math.max(this.canvas.height - mapH * zoom, offY));
      } else {
        zoom = r.camera.zoom;
        offX = (this.canvas.width - mapW * zoom) / 2;
        offY = (this.canvas.height - mapH * zoom) / 2;
      }

      this.mouseWorld.x = (sx - offX) / zoom;
      this.mouseWorld.y = (sy - offY) / zoom;
    });

    // 滚轮缩放 (玩家可见控制)
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.deltaY < 0) this.renderer.zoomIn();
      else this.renderer.zoomOut();
    }, { passive: false });
  }

  // ============================================================
  // UI 初始化 (健壮版: 单个元素缺失不影响整体)
  // ============================================================
  _initUI() {
    const bind = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.onclick = fn;
    };

    // 角色选择按钮
    bind('btn-role-dclass', () => this.startGame('dclass'));
    bind('btn-role-scientist', () => this.startGame('scientist'));
    bind('btn-role-mtf', () => this.startGame('mtf'));
    bind('btn-role-goc', () => this.startGame('goc'));
    bind('btn-role-ci', () => this.startGame('ci'));
    bind('btn-role-scp173', () => this.startGame('scp173'));
    bind('btn-menu-again', () => this._showRoleMenu());
    bind('btn-menu-restart', () => this._showMenu());

    // 开始菜单
    bind('btn-start-play', () => this._showRoleMenu());
    bind('btn-start-observe', () => this.startObserve());

    // 控制面板折叠
    bind('btn-controls-toggle', () => {
      this.controlsCollapsed = !this.controlsCollapsed;
      const ctrl = document.getElementById('hud-controls');
      if (ctrl) ctrl.classList.toggle('collapsed', this.controlsCollapsed);
    });

    // 背包格子点击 (使用物品)
    const grid = document.getElementById('inv-grid');
    if (grid) {
      grid.addEventListener('click', (e) => {
        const slot = e.target.closest('.inv-slot');
        if (!slot || !this.player) return;
        const idx = parseInt(slot.dataset.idx || '-1', 10);
        if (idx >= 0 && idx < this.player.inventory.length) {
          const ctx = this._getCtx();
          this.player.tryUseInventory(idx, ctx);
          this.selectedInvIndex = -1;
          this._renderInventoryPanel();
        }
      });
      // 悬停选中查看详情
      grid.addEventListener('mouseover', (e) => {
        const slot = e.target.closest('.inv-slot');
        if (!slot || !this.player) return;
        const idx = parseInt(slot.dataset.idx || '-1', 10);
        if (idx >= 0 && idx < this.player.inventory.length && idx !== this.selectedInvIndex) {
          this.selectedInvIndex = idx;
          this._renderInventoryPanel();
        }
      });
    }

    // 速度控制
    bind('btn-pause', () => {
      this.paused = !this.paused;
      this._updateButtonStates();
    });
    bind('btn-1x', () => { this.timeScale = 1; this._updateButtonStates(); });
    bind('btn-2x', () => { this.timeScale = 2; this._updateButtonStates(); });
    bind('btn-4x', () => { this.timeScale = 4; this._updateButtonStates(); });

    // 显示切换
    const toggle = (prop) => (e) => {
      this.renderer[prop] = !this.renderer[prop];
      if (e && e.target) {
        e.target.classList.toggle('toggle-on');
        e.target.classList.toggle('toggle-off');
      }
    };
    bind('btn-vision', toggle('showVision'));
    bind('btn-hearing', toggle('showHearing'));
    bind('btn-paths', toggle('showPaths'));
    bind('btn-labels', toggle('showLabels'));

    // 镜头控制 (玩家可见控制: 缩放)
    bind('btn-zoom-in', () => this.renderer.zoomIn());
    bind('btn-zoom-out', () => this.renderer.zoomOut());
    bind('btn-zoom-reset', () => this.renderer.resetZoom());

    // 操作
    bind('btn-restart', () => this._showMenu());
    bind('btn-spawn-mtf', () => {
      const npc = this.ai.spawnNPC('mtf_private', this.currentMap.levelId);
      if (npc) this.logEvent(`手动生成: ${npc.name}`, 'spawn');
    });
    bind('btn-spawn-ci', () => {
      const npc = this.ai.spawnNPC('ci_soldier', this.currentMap.levelId);
      if (npc) this.logEvent(`手动生成: ${npc.name}`, 'spawn');
    });
    bind('btn-spawn-scp', () => {
      const types = ['scp_173', 'scp_049', 'scp_939'];
      const t = types[Math.floor(Math.random() * types.length)];
      const npc = this.ai.spawnNPC(t, this.currentMap.levelId);
      if (npc) this.logEvent(`手动生成: ${npc.name}`, 'spawn');
    });

    this._updateButtonStates();
  }

  _showMenu() {
    // 返回开始菜单 (主菜单)
    this.state = 'menu';
    this.cameraFollow = false;
    this.inventoryOpen = false;
    this._setInventoryPanel(false);
    document.getElementById('start-menu').classList.remove('hidden');
    document.getElementById('role-menu').classList.add('hidden');
    document.getElementById('gameover-screen').classList.add('hidden');
  }

  _showRoleMenu() {
    // 开始菜单 → 角色选择
    this.state = 'menu';
    this.cameraFollow = false;
    this.inventoryOpen = false;
    this._setInventoryPanel(false);
    document.getElementById('start-menu').classList.add('hidden');
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
    const el = (id) => document.getElementById(id) || {
      textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} },
      appendChild() {}, removeChild() {}, scrollTop: 0, scrollHeight: 0, children: [],
    };
    el('hud-time').textContent = this._formatTime(this.gameTime);
    el('hud-phase').textContent = this.ai.currentPhase;
    el('hud-npcs').textContent = this.ai.getAliveNPCs().length;
    el('hud-fps').textContent = Math.round(this.fps);

    // 当前区域显示
    el('hud-level').textContent = this.currentMap ? LEVEL_NAMES[this.currentMap.levelId] : '';

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

      const hpBar = el('player-hp-bar');
      hpBar.style.width = `${Math.max(0, this.player.hp / this.player.maxHp * 100)}%`;
      hpBar.style.background = this.player.hp / this.player.maxHp > 0.5 ? '#00ff88' :
                               this.player.hp / this.player.maxHp > 0.25 ? '#ffaa00' : '#ff3344';
      el('player-hp-text').textContent = `${Math.ceil(this.player.hp)}/${this.player.maxHp}`;

      if (this.player.weapon) {
        const wname = WEAPONS[this.player.weapon].name;
        el('player-ammo').textContent = `${wname} ${this.player.ammo >= 0 ? this.player.ammo : '∞'}`;
      } else {
        el('player-ammo').textContent = '徒手 — 寻找武器';
      }

      const keycardEl = el('player-keycard');
      if (this.player.keycardLevel > 0) {
        const card = KEYCARDS[this.player.keycardLevel];
        keycardEl.textContent = card ? `${card.name} (${card.role})` : '万能钥匙卡';
        keycardEl.style.color = card ? card.color : '#fff';
        keycardEl.classList.remove('hidden');
      } else {
        keycardEl.classList.add('hidden');
      }

      const modeEl = el('player-914-mode');
      const nearby914 = this.world.getFacilities(this.player.levelId).getNearby914(this.player.pos, CONFIG.TILE_SIZE * 2.5);
      if (nearby914) {
        modeEl.textContent = `SCP-914 [${nearby914.mode}] — E切换模式 / 进料舱内E激活`;
        modeEl.classList.remove('hidden');
      } else {
        modeEl.classList.add('hidden');
      }

      // 传送点提示
      const portalEl = el('player-portal-hint');
      const portal = this.world.getNearbyPortal(this.player.pos, this.player.levelId);
      if (portal) {
        const need = portal.type === 'elevator' ? '无限制' : `Lv.${portal.level}`;
        portalEl.textContent = `[E] ${portal.name} → ${LEVEL_NAMES[portal.targetLevelId]} (${need})`;
        portalEl.classList.remove('hidden');
      } else {
        portalEl.classList.add('hidden');
      }

      // 物品栏
      this._renderInventory(el);

      // 角色名
      el('player-role').textContent = this._roleName(this.player.role) +
        (this.player.recruited ? ' (MTF新兵)' : '');

      const watchWarn = el('scp-watch-warning');
      if (this.player.role === 'scp173') {
        if (this.player.blinking) {
          watchWarn.classList.remove('hidden');
          watchWarn.textContent = '👁 眨眼! 可移动';
          watchWarn.style.color = '#ffcc00';
        } else {
          watchWarn.classList.toggle('hidden', !this.player.watched);
          watchWarn.textContent = this.player.watched ? '⚠ 被注视 — 冻结!' : '';
          watchWarn.style.color = '#ff3344';
        }
      } else {
        watchWarn.classList.add('hidden');
      }

      this._renderMissionPanel();
    } else {
      playerHUD.classList.add('hidden');
    }
  }

  _renderInventory(el) {
    // 背包面板: 仅在打开时渲染
    if (this.inventoryOpen) {
      this._renderInventoryPanel();
    }
  }

  // ============================================================
  // 背包面板 (Tab 开关)
  // ============================================================
  _setInventoryPanel(open) {
    const panel = document.getElementById('inventory-panel');
    if (!panel) return;
    panel.classList.toggle('hidden', !open);
  }

  _renderInventoryPanel() {
    const panel = document.getElementById('inventory-panel');
    if (!panel) return;
    const player = this.player;
    if (!player) return;

    const countEl = document.getElementById('inv-count');
    if (countEl) countEl.textContent = `${player.inventory.length}/${player.maxInventory}`;

    const grid = document.getElementById('inv-grid');
    if (!grid) return;
    grid.innerHTML = '';

    // 6 格固定槽位
    for (let i = 0; i < player.maxInventory; i++) {
      const slot = document.createElement('div');
      slot.className = 'inv-slot';
      slot.dataset.idx = String(i);

      if (i < player.inventory.length) {
        const item = player.inventory[i];
        const def = item.def;
        const shortName = def.name.length > 8 ? def.name.slice(0, 8) + '…' : def.name;
        const iconChar = def.category === 'consumable' ? (def.heal ? '✚' : def.buff === 'sprint' ? '⚡' : '◈') : '◆';
        slot.innerHTML = `
          <span class="slot-num">${i + 1}</span>
          <span class="slot-icon" style="background:${def.color}">${iconChar}</span>
          <span class="slot-name">${shortName}</span>
        `;
        if (i === this.selectedInvIndex) slot.classList.add('selected');
        slot.title = def.name + ': ' + def.desc;
      } else {
        slot.classList.add('empty');
        slot.innerHTML = `<span class="slot-num">${i + 1}</span><span class="slot-name">空</span>`;
      }
      grid.appendChild(slot);
    }

    // 详情
    const detail = document.getElementById('inv-detail');
    if (detail) {
      if (this.selectedInvIndex >= 0 && this.selectedInvIndex < player.inventory.length) {
        const item = player.inventory[this.selectedInvIndex];
        detail.classList.remove('hidden');
        detail.innerHTML = `
          <div class="detail-name" style="color:${item.def.color}">${item.def.name}</div>
          <div class="detail-desc">${item.def.desc || ''}</div>
          <div class="detail-use">点击使用 · 或按数字键 ${this.selectedInvIndex + 1}</div>
        `;
      } else {
        detail.classList.add('hidden');
        detail.innerHTML = '';
      }
    }
  }

  // 选中背包格子 (鼠标悬停/点击)
  selectInventoryIndex(idx) {
    this.selectedInvIndex = idx;
  }

  _renderMissionPanel() {
    const panel = document.getElementById('mission-panel');
    if (!this.missions.active) return;
    panel.classList.remove('hidden');

    const data = this.missions.getHudData();
    const stageLine = document.getElementById('mission-stage');
    const stage = data.stages[data.stage];
    stageLine.innerHTML = `<span style="color:#00ccff">阶段 ${data.stage + 1}/${data.stages.length}</span> — ${stage ? stage.name : ''}: ${stage ? stage.desc : ''}`;

    const bar = document.getElementById('mission-bar');
    bar.style.width = `${Math.min(100, data.progress)}%`;

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

  // 构建共享 ctx (随玩家当前地图)
  _getCtx() {
    const levelId = this.player ? this.player.levelId : this.world.currentLevelId;
    return {
      world: this.world,
      map: this.world.getLevel(levelId),
      allEntities: this.ai.entitiesIn(levelId),
      perception: this.perception,
      combat: this.combat,
      facilities: this.world.getFacilities(levelId),
      pathfinder: this.world.getPathfinder(levelId),
      gameTime: this.gameTime,
      game: this,
      levelId,
      player: this.player,
      items: this.items,
    };
  }

  // 渲染
  renderGame() {
    const levelId = this.player ? this.player.levelId : this.world.currentLevelId;
    this.renderer.render(this.ai, this.combat, this.perception, this.world.getFacilities(levelId), this.gameTime);
  }

  // ============================================================
  // 主循环
  // ============================================================
  _loop(timestamp) {
    const rawDt = this.lastFrameTime ? (timestamp - this.lastFrameTime) / 1000 : 0;
    this.lastFrameTime = timestamp;

    this.fpsAccum += rawDt;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    const dt = this.paused ? 0 : Math.min(rawDt, 0.05) * this.timeScale;

    try {
      if (dt > 0 && this.state !== 'menu') {
        this.gameTime += dt;
        this.ai.update(dt, this);
        this.items.update(dt);

        // 各地图设施更新
        for (const levelId of LEVEL_ORDER) {
          const fac = this.world.getFacilities(levelId);
          const ctxFac = this.ai.ctxFor({ levelId }, this);
          ctxFac.allEntities = this.ai.entitiesIn(levelId);
          ctxFac.map = this.world.getLevel(levelId);
          fac.update(dt, ctxFac);

          // AI NPC 门禁处理
          for (const npc of this.ai.entitiesIn(levelId)) {
            if (npc.isPlayer || npc.dead) continue;
            fac.handleNPCDoor(npc, ctxFac);
          }
        }

        // 玩家更新
        if (this.player && !this.player.dead) {
          const ctx = this._getCtx();
          this.player.update(dt, ctx);
          this.missions.update(dt, ctx);
        }
      }

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
  // URL hash 自动开始 (便于测试: #mtf 或 #dclass)
  const role = (location.hash || '').replace('#', '').toLowerCase();
  if (['dclass', 'scientist', 'mtf', 'goc', 'ci', 'scp173'].includes(role)) {
    setTimeout(() => window.game.startGame(role), 100);
  }
});
