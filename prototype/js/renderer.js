// ============================================================
// renderer.js — Canvas 渲染器 (多地图版)
// 只渲染当前地图 (世界切换), 支持传送点/物品
// ============================================================

class Renderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.map = world ? world.getLevel(world.currentLevelId) : null;
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.followZoom = 1.6;   // 跟随模式缩放 (角色居中, 地图滚动)
    this.followZoomMin = 0.8;
    this.followZoomMax = 3.0;
    this._camX = null;
    this._camY = null;
    this._camLevel = null;
    this.showVision = true;
    this.showHearing = true;
    this.showPaths = false;
    this.showLabels = true;

    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  // 缩放控制 (玩家可见控制: 滚轮/按钮)
  zoomIn() {
    this.followZoom = Math.min(this.followZoomMax, this.followZoom + 0.2);
    this._camX = null; this._camY = null; // 立即重定位
  }

  zoomOut() {
    this.followZoom = Math.max(this.followZoomMin, this.followZoom - 0.2);
    this._camX = null; this._camY = null;
  }

  resetZoom() {
    this.followZoom = 1.6;
    this._camX = null; this._camY = null;
  }

  setWorld(world) {
    this.world = world;
    this.map = world ? world.getLevel(world.currentLevelId) : null;
  }

  setMap(map) { this.map = map; }

  _resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    const map = this.map || { cols: 40, rows: 30 };
    const mapW = map.cols * CONFIG.TILE_SIZE;
    const mapH = map.rows * CONFIG.TILE_SIZE;
    const scaleX = this.canvas.width / mapW;
    const scaleY = this.canvas.height / mapH;
    this.camera.zoom = Math.min(scaleX, scaleY) * 0.95;
  }

  worldToScreen(x, y) {
    const map = this.map || { cols: 40, rows: 30 };
    const mapW = map.cols * CONFIG.TILE_SIZE;
    const mapH = map.rows * CONFIG.TILE_SIZE;
    const offsetX = (this.canvas.width - mapW * this.camera.zoom) / 2;
    const offsetY = (this.canvas.height - mapH * this.camera.zoom) / 2;
    return { x: offsetX + x * this.camera.zoom, y: offsetY + y * this.camera.zoom };
  }

  render(aiSystem, combat, perception, facilities, gameTime) {
    const ctx = this.ctx;
    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // 当前渲染地图: 优先玩家所在图, 否则世界当前图
    let levelId = this.world ? this.world.currentLevelId : (this.map ? this.map.levelId : 'LCZ');
    if (this.game && this.game.player) {
      levelId = this.game.player.levelId;
    }
    const map = this.world ? this.world.getLevel(levelId) : this.map;
    if (!map) return;
    // 地图切换时重置平滑相机
    if (this._camLevel !== levelId) {
      this._camLevel = levelId;
      this._camX = null;
      this._camY = null;
    }
    this.map = map;

    const ts = CONFIG.TILE_SIZE;
    const mapW = map.cols * ts;
    const mapH = map.rows * ts;

    let offX = (this.canvas.width - mapW * this.camera.zoom) / 2;
    let offY = (this.canvas.height - mapH * this.camera.zoom) / 2;

    if (this.followTarget && !this.followTarget.dead) {
      // 玩家视角跟随角色: 角色固定在屏幕中心, 移动时地图滚动
      const followZoom = this.followZoom || 1.6;
      // 平滑跟随 (相机朝目标位置缓动)
      const targetX = this.canvas.width / 2 - this.followTarget.pos.x * followZoom;
      const targetY = this.canvas.height / 2 - this.followTarget.pos.y * followZoom;
      // 钳制到地图范围
      const clampX = Math.min(0, Math.max(this.canvas.width - mapW * followZoom, targetX));
      const clampY = Math.min(0, Math.max(this.canvas.height - mapH * followZoom, targetY));

      if (this._camX === null || this._camY === null) {
        this._camX = clampX;
        this._camY = clampY;
      }
      // 平滑插值 (0.12 每帧, 视觉上角色不动地图动)
      this._camX += (clampX - this._camX) * 0.12;
      this._camY += (clampY - this._camY) * 0.12;

      offX = this._camX;
      offY = this._camY;
      ctx.save();
      ctx.translate(offX, offY);
      ctx.scale(followZoom, followZoom);
    } else {
      ctx.save();
      ctx.translate(offX, offY);
      ctx.scale(this.camera.zoom, this.camera.zoom);
    }

    // ---- 1. 地图 ----
    this._drawMap(ctx, map);

    // ---- 2. 视野锥 ----
    if (this.showVision) {
      for (const npc of aiSystem.entitiesIn(map.levelId)) {
        if (npc.dead || npc.visionRange <= 0) continue;
        this._drawVisionCone(ctx, npc);
      }
    }

    // ---- 3. 听觉 ----
    if (this.showHearing) {
      for (const npc of aiSystem.entitiesIn(map.levelId)) {
        if (npc.dead) continue;
        if (npc.isSoundHunter || npc.hearRange > 200) {
          this._drawHearingRange(ctx, npc);
        }
      }
    }

    // ---- 4. 路径 ----
    if (this.showPaths) {
      for (const npc of aiSystem.entitiesIn(map.levelId)) {
        if (npc.dead || !npc.path) continue;
        this._drawPath(ctx, npc, map);
      }
    }

    // ---- 5. 声音事件 ----
    for (const noise of perception.noiseEvents) {
      ctx.beginPath();
      ctx.arc(noise.x, noise.y, noise.radius * (1 - noise.age / noise.ttl) * 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,100,${0.3 * (1 - noise.age / noise.ttl)})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // ---- 6. 子弹 (仅当前地图) ----
    for (const b of combat.bullets) {
      if (b.levelId !== map.levelId) continue;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.02, b.y - b.vy * 0.02);
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = b.color;
      ctx.fill();
    }

    // ---- 6b. 设施 ----
    if (facilities) {
      this._drawFacilities(ctx, facilities, gameTime, map);
    }

    // ---- 6c. 传送点 ----
    if (this.world) {
      this._drawPortals(ctx, map, gameTime);
    }

    // ---- 6d. 物品 ----
    if (this.game && this.game.items) {
      this._drawItems(ctx, map);
    }

    // ---- 7. NPC ----
    for (const npc of aiSystem.entitiesIn(map.levelId)) {
      if (npc.isPlayer) continue;
      this._drawNPC(ctx, npc);
    }

    // ---- 7b. 玩家 ----
    if (this.game && this.game.player && this.game.state === 'playing' &&
        this.game.player.levelId === map.levelId) {
      this._drawPlayer(ctx, this.game.player, aiSystem, gameTime);
    }

    // ---- 8. 伤害数字 ----
    for (const dn of combat.damageNumbers) {
      const alpha = 1 - dn.age;
      ctx.font = 'bold 14px Consolas';
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(${dn.color === '#ff6644' ? '255,102,68' : '255,170,0'},${alpha})`;
      ctx.fillText(dn.value > 0 ? `-${dn.value}` : 'BLOCK', dn.x, dn.y);
    }

    ctx.restore();
  }

  _drawMap(ctx, map) {
    const ts = CONFIG.TILE_SIZE;
    const levelId = map.levelId;

    for (let r = 0; r < map.rows; r++) {
      for (let c = 0; c < map.cols; c++) {
        const tile = map.grid[r][c];
        const x = c * ts;
        const y = r * ts;

        switch (tile) {
          case TILE.WALL:
            ctx.fillStyle = levelId === 'SZ' ? '#1a1a1e' : '#16161c';
            ctx.fillRect(x, y, ts, ts);
            break;
          case TILE.ROOM_FLOOR:
            ctx.fillStyle = this._zoneFloorColor(levelId);
            ctx.fillRect(x, y, ts, ts);
            ctx.strokeStyle = 'rgba(255,255,255,0.03)';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(x + 0.5, y + 0.5, ts - 1, ts - 1);
            break;
          case TILE.CORRIDOR:
            ctx.fillStyle = this._zoneCorridorColor(levelId);
            ctx.fillRect(x, y, ts, ts);
            break;
          case TILE.DOOR:
            ctx.fillStyle = '#3a3a2a';
            ctx.fillRect(x, y, ts, ts);
            ctx.fillStyle = '#6a6a3a';
            ctx.fillRect(x + ts * 0.3, y + ts * 0.2, ts * 0.4, ts * 0.6);
            break;
          case TILE.PORTAL:
            ctx.fillStyle = levelId === 'SZ' ? '#1a1a1e' : '#16161c';
            ctx.fillRect(x, y, ts, ts);
            break;
          case TILE.EXIT:
            ctx.fillStyle = '#2a4a2a';
            ctx.fillRect(x, y, ts, ts);
            ctx.fillStyle = '#00ff66';
            ctx.font = `${ts * 0.5}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText('EXIT', x + ts / 2, y + ts * 0.65);
            break;
          case TILE.SPAWN:
            ctx.fillStyle = '#2a2a3a';
            ctx.fillRect(x, y, ts, ts);
            ctx.fillStyle = '#6666ff';
            ctx.font = `${ts * 0.4}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText('S', x + ts / 2, y + ts * 0.65);
            break;
        }
      }
    }

    // 区域标签
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    const lvl = LEVELS[levelId];
    if (lvl) {
      ctx.fillText(lvl.name, map.cols * ts / 2, 2 * ts);
    }
  }

  _zoneFloorColor(levelId) {
    switch (levelId) {
      case 'LCZ': return '#1a2818';
      case 'HCZ': return '#281818';
      case 'EZ':  return '#181828';
      case 'SZ':  return '#282818';
      default:    return '#1a1a1a';
    }
  }

  _zoneCorridorColor(levelId) {
    switch (levelId) {
      case 'LCZ': return '#152218';
      case 'HCZ': return '#221515';
      case 'EZ':  return '#151522';
      case 'SZ':  return '#1f1f10';
      default:    return '#151515';
    }
  }

  // ============================================================
  // 传送点渲染 (电梯/检查点)
  // ============================================================
  _drawPortals(ctx, map, gameTime) {
    const ts = CONFIG.TILE_SIZE;
    const portals = this.world.getPortalsIn(map.levelId);

    for (const p of portals) {
      const x = p.pos.x, y = p.pos.y;

      if (p.type === 'elevator') {
        // 电梯: 双扇门 + 指示灯
        ctx.fillStyle = '#2a2a3a';
        ctx.fillRect(x - ts * 0.5, y - ts * 0.6, ts, ts * 1.2);
        ctx.strokeStyle = '#445566';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - ts * 0.5, y - ts * 0.6, ts, ts * 1.2);

        // 门缝
        ctx.strokeStyle = 'rgba(0,200,255,0.4)';
        ctx.beginPath();
        ctx.moveTo(x, y - ts * 0.5);
        ctx.lineTo(x, y + ts * 0.5);
        ctx.stroke();

        // 指示灯 (脉冲)
        const pulse = 0.5 + 0.5 * Math.sin(gameTime * 3 + p.id.length);
        ctx.fillStyle = `rgba(0,255,136,${0.4 + pulse * 0.5})`;
        ctx.beginPath();
        ctx.arc(x, y - ts * 0.75, 3, 0, Math.PI * 2);
        ctx.fill();

        // 标签
        ctx.fillStyle = '#66ccff';
        ctx.font = 'bold 9px Consolas';
        ctx.textAlign = 'center';
        ctx.fillText('ELEV', x, y - ts * 0.9);
        ctx.font = '8px sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText(`→ ${LEVEL_NAMES[p.targetLevelId]}`, x, y + ts * 0.85);
      } else {
        // 检查点: 门 + 锁
        ctx.fillStyle = '#2a2a3a';
        ctx.fillRect(x - ts * 0.5, y - ts * 0.5, ts, ts);
        ctx.strokeStyle = 'rgba(255,170,0,0.6)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - ts * 0.5, y - ts * 0.5, ts, ts);

        // 等级
        ctx.fillStyle = p.level >= 5 ? '#ff44aa' : '#ffaa00';
        ctx.font = 'bold 10px Consolas';
        ctx.textAlign = 'center';
        ctx.fillText('Lv.' + p.level, x, y - 3);

        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '8px sans-serif';
        ctx.fillText(`→ ${LEVEL_NAMES[p.targetLevelId]}`, x, y + ts * 0.6);
      }
    }
  }

  // ============================================================
  // 物品渲染
  // ============================================================
  _drawItems(ctx, map) {
    const items = this.game.items;
    if (!items || !items.items) return;
    const ts = CONFIG.TILE_SIZE;

    for (const item of items.items) {
      if (item.taken || item.levelId !== map.levelId) continue;
      const x = item.pos.x, y = item.pos.y;
      const def = item.def;
      const color = def.color || '#ffffff';

      // 发光底座
      ctx.fillStyle = color + '22';
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fill();

      // 物品图标 (圆)
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff60';
      ctx.lineWidth = 1;
      ctx.stroke();

      // SCP 物品特殊标记
      if (def.category === 'consumable' && def.id.startsWith('scp')) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 7px Consolas';
        ctx.textAlign = 'center';
        ctx.fillText('SCP', x, y + 2);
      } else if (def.category === 'weapon') {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 8px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('W', x, y + 3);
      } else if (def.category === 'keycard') {
        ctx.fillStyle = '#222';
        ctx.font = 'bold 8px Consolas';
        ctx.textAlign = 'center';
        ctx.fillText(def.cardLevel, x, y + 3);
      }
    }
  }

  // ============================================================
  // 原有渲染方法 (NPC/玩家/设施) — 适配 map 参数
  // ============================================================
  _drawVisionCone(ctx, npc) {
    if (npc.visionAngle >= Math.PI * 2) return;
    const halfAngle = npc.visionAngle / 2;
    const segments = 12;
    ctx.beginPath();
    ctx.moveTo(npc.pos.x, npc.pos.y);
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const angle = npc.facing - halfAngle + npc.visionAngle * t;
      ctx.lineTo(npc.pos.x + Math.cos(angle) * npc.visionRange, npc.pos.y + Math.sin(angle) * npc.visionRange);
    }
    ctx.closePath();
    const c = npc.factionInfo.color;
    ctx.fillStyle = c + '15';
    ctx.fill();
    ctx.strokeStyle = c + '30';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  _drawHearingRange(ctx, npc) {
    ctx.beginPath();
    ctx.arc(npc.pos.x, npc.pos.y, npc.hearRange, 0, Math.PI * 2);
    ctx.strokeStyle = npc.factionInfo.color + '10';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  _drawPath(ctx, npc, map) {
    if (!npc.path || npc.path.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(npc.pos.x, npc.pos.y);
    for (let i = npc.pathIndex; i < npc.path.length; i++) {
      const node = npc.path[i];
      const w = map.tileToWorld(node.col, node.row);
      ctx.lineTo(w.x, w.y);
    }
    ctx.strokeStyle = npc.factionInfo.color + '40';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  _drawNPC(ctx, npc) {
    if (npc.dead) {
      ctx.strokeStyle = '#444';
      ctx.lineWidth = 2;
      const r = npc.radius;
      ctx.beginPath();
      ctx.moveTo(npc.pos.x - r * 0.6, npc.pos.y - r * 0.6);
      ctx.lineTo(npc.pos.x + r * 0.6, npc.pos.y + r * 0.6);
      ctx.moveTo(npc.pos.x + r * 0.6, npc.pos.y - r * 0.6);
      ctx.lineTo(npc.pos.x - r * 0.6, npc.pos.y + r * 0.6);
      ctx.stroke();
      return;
    }

    const c = npc.factionInfo.color;

    if (npc.flashTimer > 0) {
      ctx.beginPath();
      ctx.arc(npc.pos.x, npc.pos.y, npc.radius + 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff40';
      ctx.fill();
    }

    if (npc.attackAnimTimer > 0) {
      ctx.beginPath();
      ctx.arc(npc.pos.x, npc.pos.y, npc.radius + 6, 0, Math.PI * 2);
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(npc.pos.x, npc.pos.y, npc.radius, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();

    ctx.strokeStyle = npc.fsm.state === 'engage' ? '#ff4444' :
                      npc.fsm.state === 'alert'  ? '#ffaa00' :
                      npc.fsm.state === 'flee'   ? '#ffff00' : '#00000060';
    ctx.lineWidth = npc.fsm.state === 'engage' ? 2.5 : 1.5;
    ctx.stroke();

    const fx = npc.pos.x + Math.cos(npc.facing) * (npc.radius + 4);
    const fy = npc.pos.y + Math.sin(npc.facing) * (npc.radius + 4);
    ctx.beginPath();
    ctx.moveTo(npc.pos.x, npc.pos.y);
    ctx.lineTo(fx, fy);
    ctx.strokeStyle = '#ffffff80';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (npc.isSCP) {
      ctx.beginPath();
      ctx.arc(npc.pos.x, npc.pos.y, npc.radius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff3344';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (this.showLabels) {
      ctx.font = '9px Consolas';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffffcc';
      ctx.fillText(npc.name, npc.pos.x, npc.pos.y - npc.radius - 5);

      const hpW = npc.radius * 2.5;
      const hpH = 3;
      const hpX = npc.pos.x - hpW / 2;
      const hpY = npc.pos.y + npc.radius + 4;
      ctx.fillStyle = '#333';
      ctx.fillRect(hpX, hpY, hpW, hpH);
      ctx.fillStyle = npc.hp / npc.maxHp > 0.5 ? '#00ff66' :
                      npc.hp / npc.maxHp > 0.25 ? '#ffaa00' : '#ff3344';
      ctx.fillRect(hpX, hpY, hpW * (npc.hp / npc.maxHp), hpH);

      if (npc.fsm.state !== 'patrol') {
        ctx.font = '8px Consolas';
        ctx.fillStyle = npc.fsm.state === 'engage' ? '#ff4444' :
                        npc.fsm.state === 'alert'  ? '#ffaa00' :
                        npc.fsm.state === 'flee'   ? '#ffff00' : '#888';
        ctx.fillText(npc.fsm.state.toUpperCase(), npc.pos.x, hpY + 12);
      }
    }
  }

  _drawPlayer(ctx, player, aiSystem, gameTime) {
    const c = player.color;

    // 隐形效果
    const invisible = player.buffs && player.buffs['invisible'] && player.buffs['invisible'].time > 0;
    const alpha = invisible ? 0.3 : 1;

    if (player.flashTimer > 0) {
      ctx.beginPath();
      ctx.arc(player.pos.x, player.pos.y, player.radius + 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff60';
      ctx.fill();
    }

    if (player.role === 'scp173') {
      // 眨眼视觉反馈: 眨眼中显示金色脉冲光环
      if (player.blinking) {
        const pulse = 0.5 + 0.5 * Math.sin(gameTime * 20);
        ctx.beginPath();
        ctx.arc(player.pos.x, player.pos.y, player.radius + 10, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,204,0,${0.4 + pulse * 0.5})`;
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.beginPath();
      ctx.arc(player.pos.x, player.pos.y, player.radius + 8, 0, Math.PI * 2);
      ctx.strokeStyle = player.watched ? '#ff3344' : '#00ff88';
      ctx.lineWidth = 2.5;
      ctx.setLineDash(player.watched ? [6, 3] : [2, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(player.pos.x, player.pos.y, player.radius, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 朝向指示器 (鼠标方向)
    const fx = player.pos.x + Math.cos(player.facing) * (player.radius + 5);
    const fy = player.pos.y + Math.sin(player.facing) * (player.radius + 5);
    ctx.beginPath();
    ctx.moveTo(player.pos.x, player.pos.y);
    ctx.lineTo(fx, fy);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (player.weapon && player.role !== 'scp173' && this.game && this.game.mouseWorld) {
      const mw = this.game.mouseWorld;
      const dx = mw.x - player.pos.x;
      const dy = mw.y - player.pos.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = dx / len, ny = dy / len;

      ctx.beginPath();
      ctx.moveTo(player.pos.x + nx * (player.radius + 4), player.pos.y + ny * (player.radius + 4));
      ctx.lineTo(player.pos.x + nx * 200, player.pos.y + ny * 200);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(mw.x, mw.y, 5, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff3344';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    if (this.showLabels) {
      ctx.font = 'bold 10px Consolas';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      const ROLE_NAMES = { dclass: 'D级', scientist: '科学家', mtf: 'MTF', goc: 'GOC', ci: 'CI', scp173: 'SCP-173' };
      const roleName = ROLE_NAMES[player.role] || player.role;
      ctx.fillText(`你 (${roleName})`, player.pos.x, player.pos.y - player.radius - 8);

      const hpW = player.radius * 3;
      const hpH = 4;
      const hpX = player.pos.x - hpW / 2;
      const hpY = player.pos.y + player.radius + 6;
      ctx.fillStyle = '#333';
      ctx.fillRect(hpX, hpY, hpW, hpH);
      ctx.fillStyle = player.hp / player.maxHp > 0.5 ? '#00ff88' :
                      player.hp / player.maxHp > 0.25 ? '#ffaa00' : '#ff3344';
      ctx.fillRect(hpX, hpY, hpW * Math.max(0, player.hp / player.maxHp), hpH);
    }

    if (player.role === 'scp173') {
      ctx.font = 'bold 12px Consolas';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff3344';
      ctx.fillText(`☠ ${player.killCount}/5`, player.pos.x, player.pos.y - player.radius - 20);
    }
  }

  _drawFacilities(ctx, facilities, gameTime, map) {
    // 门禁
    for (const door of facilities.doors) {
      const w = map.tileToWorld(door.col, door.row);
      const x = w.x, y = w.y;
      const ts = CONFIG.TILE_SIZE;

      if (door.open) {
        ctx.fillStyle = 'rgba(0,255,136,0.15)';
        ctx.fillRect(x - ts / 2, y - ts / 2, ts, ts);
        ctx.strokeStyle = 'rgba(0,255,136,0.4)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - ts / 2, y - ts / 2, ts, ts);
      } else {
        ctx.fillStyle = '#2a2a3a';
        ctx.fillRect(x - ts / 2, y - ts / 2, ts, ts);
        ctx.strokeStyle = 'rgba(255,51,68,0.6)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - ts / 2, y - ts / 2, ts, ts);

        ctx.fillStyle = '#ff5566';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🔒', x, y - 2);

        ctx.fillStyle = door.level >= 5 ? '#ff44aa' : '#ffaa00';
        ctx.font = 'bold 9px Consolas';
        ctx.fillText('Lv.' + door.level, x, y + ts * 0.35);
      }
    }

    // SCP-914
    for (const m of facilities.machines914) {
      const ts2 = CONFIG.TILE_SIZE;
      this._draw914Booth(ctx, m.intakePos, 'INTAKE', '进料');
      this._draw914Booth(ctx, m.outputPos, 'OUTPUT', '出料');

      ctx.fillStyle = '#3a2a1a';
      ctx.strokeStyle = '#8a6a3a';
      ctx.lineWidth = 2;
      ctx.fillRect(m.panelPos.x - ts2 * 0.9, m.panelPos.y - ts2 * 0.7, ts2 * 1.8, ts2 * 1.4);
      ctx.strokeRect(m.panelPos.x - ts2 * 0.9, m.panelPos.y - ts2 * 0.7, ts2 * 1.8, ts2 * 1.4);

      ctx.save();
      ctx.translate(m.panelPos.x, m.panelPos.y - ts2 * 0.5);
      ctx.rotate(m.processing ? gameTime * 3 : gameTime * 0.5);
      ctx.strokeStyle = '#b08a4a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -8); ctx.lineTo(0, 8);
      ctx.moveTo(-8, 0); ctx.lineTo(8, 0);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = m.processing ? '#ffaa00' : '#00ccff';
      ctx.font = 'bold 11px Consolas';
      ctx.textAlign = 'center';
      ctx.fillText(m.mode, m.panelPos.x, m.panelPos.y + ts2 * 0.5);

      ctx.fillStyle = '#aa8866';
      ctx.font = '8px sans-serif';
      ctx.fillText('SCP-914', m.panelPos.x, m.panelPos.y - ts2 * 0.9);

      if (m.processing) {
        ctx.fillStyle = '#ffaa00';
        ctx.font = '10px Consolas';
        ctx.fillText('加工中...', m.panelPos.x, m.panelPos.y + ts2 * 0.8);
      }

      if (m.lastResult && m.resultTimer > 0) {
        ctx.fillStyle = '#00ff88';
        ctx.font = 'bold 11px Consolas';
        ctx.fillText(m.lastResult, m.panelPos.x, m.panelPos.y + ts2 * 1.1);
      }
    }

    // 特斯拉电门
    for (const gate of facilities.teslaGates) {
      const ts3 = CONFIG.TILE_SIZE;
      const x = gate.pos.x, y = gate.pos.y;

      ctx.fillStyle = '#1a1a2a';
      ctx.fillRect(x - ts3 * 0.5, y - ts3 * 0.3, ts3, ts3 * 0.6);

      ctx.fillStyle = '#334';
      ctx.fillRect(x - ts3 * 0.45, y - ts3 * 0.5, ts3 * 0.2, ts3);
      ctx.fillRect(x + ts3 * 0.25, y - ts3 * 0.5, ts3 * 0.2, ts3);

      ctx.fillStyle = gate.state === 'discharging' ? '#88ffff' :
                      gate.state === 'charging' ? '#4488ff' : '#555577';
      ctx.beginPath();
      ctx.arc(x - ts3 * 0.35, y - ts3 * 0.5, 3, 0, Math.PI * 2);
      ctx.arc(x + ts3 * 0.35, y - ts3 * 0.5, 3, 0, Math.PI * 2);
      ctx.fill();

      if (gate.state === 'charging') {
        const pulse = 0.4 + 0.6 * Math.sin(gameTime * 20);
        ctx.strokeStyle = `rgba(68,136,255,${0.3 + pulse * 0.4})`;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(x - ts3 * 0.6, y - ts3 * 0.6, ts3 * 1.2, ts3 * 1.2);
        ctx.setLineDash([]);
      }

      if (gate.state === 'discharging') {
        ctx.strokeStyle = 'rgba(120,220,255,0.9)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 8; i++) {
          const fx = x + (Math.random() - 0.5) * ts3 * 1.2;
          const fy = y + (Math.random() - 0.5) * ts3 * 1.2;
          ctx.beginPath();
          ctx.moveTo(x - ts3 * 0.35, y);
          ctx.lineTo(fx, fy);
          ctx.stroke();
        }

        for (const p of gate.arcParticles) {
          ctx.fillStyle = `rgba(120,220,255,${Math.max(0, p.life / p.maxLife)})`;
          ctx.beginPath();
          ctx.arc(p.x + p.dx * (1 - p.life / p.maxLife), p.y + p.dy * (1 - p.life / p.maxLife), 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  _draw914Booth(ctx, pos, label, labelCn) {
    const ts = CONFIG.TILE_SIZE;
    ctx.fillStyle = '#2a241a';
    ctx.strokeStyle = '#6a5a3a';
    ctx.lineWidth = 1;
    ctx.fillRect(pos.x - ts * 0.6, pos.y - ts * 0.6, ts * 1.2, ts * 1.2);
    ctx.strokeRect(pos.x - ts * 0.6, pos.y - ts * 0.6, ts * 1.2, ts * 1.2);

    ctx.fillStyle = '#8a7a5a';
    ctx.font = 'bold 8px Consolas';
    ctx.textAlign = 'center';
    ctx.fillText(label, pos.x, pos.y + 3);
  }
}
