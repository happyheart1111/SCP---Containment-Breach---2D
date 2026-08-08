// ============================================================
// renderer.js — Canvas 渲染器
// ============================================================

class Renderer {
  constructor(canvas, map) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = map;
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.showVision = true;
    this.showHearing = true;
    this.showPaths = false;
    this.showLabels = true;

    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  setMap(map) { this.map = map; }

  _resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    // 缩放使整个地图可见
    const mapW = CONFIG.MAP_COLS * CONFIG.TILE_SIZE;
    const mapH = CONFIG.MAP_ROWS * CONFIG.TILE_SIZE;
    const scaleX = this.canvas.width / mapW;
    const scaleY = this.canvas.height / mapH;
    this.camera.zoom = Math.min(scaleX, scaleY) * 0.95;
  }

  worldToScreen(x, y) {
    const mapW = CONFIG.MAP_COLS * CONFIG.TILE_SIZE;
    const mapH = CONFIG.MAP_ROWS * CONFIG.TILE_SIZE;
    const offsetX = (this.canvas.width - mapW * this.camera.zoom) / 2;
    const offsetY = (this.canvas.height - mapH * this.camera.zoom) / 2;
    return {
      x: offsetX + x * this.camera.zoom,
      y: offsetY + y * this.camera.zoom,
    };
  }

  render(aiSystem, combat, perception, gameTime) {
    const ctx = this.ctx;
    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    if (!this.map) return;

    const ts = CONFIG.TILE_SIZE;
    const z = this.camera.zoom;

    // 计算 offset
    const mapW = CONFIG.MAP_COLS * ts;
    const mapH = CONFIG.MAP_ROWS * ts;

    // 跟随模式: 玩家居中, 放大视角
    let offX = (this.canvas.width - mapW * z) / 2;
    let offY = (this.canvas.height - mapH * z) / 2;

    if (this.followTarget && !this.followTarget.dead) {
      const followZoom = 1.6;
      offX = this.canvas.width / 2 - this.followTarget.pos.x * followZoom;
      offY = this.canvas.height / 2 - this.followTarget.pos.y * followZoom;
      // 钳制到地图范围
      offX = Math.min(0, Math.max(this.canvas.width - mapW * followZoom, offX));
      offY = Math.min(0, Math.max(this.canvas.height - mapH * followZoom, offY));
      ctx.save();
      ctx.translate(offX, offY);
      ctx.scale(followZoom, followZoom);
    } else {
      ctx.save();
      ctx.translate(offX, offY);
      ctx.scale(z, z);
    }

    // ---- 1. 绘制地图 ----
    this._drawMap(ctx);

    // ---- 2. 绘制视野锥 ----
    if (this.showVision) {
      for (const npc of aiSystem.entities) {
        if (npc.dead) continue;
        if (npc.visionRange <= 0) continue;
        this._drawVisionCone(ctx, npc);
      }
    }

    // ---- 3. 绘制听觉范围 (仅声音猎手) ----
    if (this.showHearing) {
      for (const npc of aiSystem.entities) {
        if (npc.dead) continue;
        if (npc.isSoundHunter || npc.hearRange > 200) {
          this._drawHearingRange(ctx, npc);
        }
      }
    }

    // ---- 4. 绘制路径 ----
    if (this.showPaths) {
      for (const npc of aiSystem.entities) {
        if (npc.dead || !npc.path) continue;
        this._drawPath(ctx, npc);
      }
    }

    // ---- 5. 绘制声音事件 ----
    for (const noise of perception.noiseEvents) {
      ctx.beginPath();
      ctx.arc(noise.x, noise.y, noise.radius * (1 - noise.age / noise.ttl) * 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,100,${0.3 * (1 - noise.age / noise.ttl)})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // ---- 6. 绘制子弹 ----
    for (const b of combat.bullets) {
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.02, b.y - b.vy * 0.02);
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 2;
      ctx.stroke();

      // 子弹头
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = b.color;
      ctx.fill();
    }

    // ---- 7. 绘制 NPC (跳过玩家) ----
    for (const npc of aiSystem.entities) {
      if (npc.isPlayer) continue;
      this._drawNPC(ctx, npc);
    }

    // ---- 7b. 绘制玩家 ----
    if (this.game && this.game.player && this.game.state === 'playing') {
      this._drawPlayer(ctx, this.game.player, aiSystem);
    }

    // ---- 8. 绘制伤害数字 ----
    for (const dn of combat.damageNumbers) {
      const alpha = 1 - dn.age;
      ctx.font = 'bold 14px Consolas';
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(${dn.color === '#ff6644' ? '255,102,68' : '255,170,0'},${alpha})`;
      ctx.fillText(dn.value > 0 ? `-${dn.value}` : 'BLOCK', dn.x, dn.y);
    }

    ctx.restore();
  }

  _drawMap(ctx) {
    const ts = CONFIG.TILE_SIZE;

    for (let r = 0; r < this.map.rows; r++) {
      for (let c = 0; c < this.map.cols; c++) {
        const tile = this.map.grid[r][c];
        const zone = this.map.zoneMap[r][c];
        const x = c * ts;
        const y = r * ts;

        switch (tile) {
          case TILE.WALL:
            // 墙壁颜色根据 zone 变化
            ctx.fillStyle = zone ? '#1a1a22' : '#0a0a0e';
            ctx.fillRect(x, y, ts, ts);
            break;
          case TILE.ROOM_FLOOR:
            ctx.fillStyle = this._zoneFloorColor(zone);
            ctx.fillRect(x, y, ts, ts);
            // 房间地板纹理
            ctx.strokeStyle = 'rgba(255,255,255,0.03)';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(x + 0.5, y + 0.5, ts - 1, ts - 1);
            break;
          case TILE.CORRIDOR:
            ctx.fillStyle = this._zoneCorridorColor(zone);
            ctx.fillRect(x, y, ts, ts);
            break;
          case TILE.DOOR:
          case TILE.ZONE_BORDER:
            ctx.fillStyle = '#3a3a2a';
            ctx.fillRect(x, y, ts, ts);
            ctx.fillStyle = '#6a6a3a';
            ctx.fillRect(x + ts * 0.3, y + ts * 0.2, ts * 0.4, ts * 0.6);
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
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    const zones = [
      { name: 'LCZ', x: 16 * ts, y: 3 * ts },
      { name: 'HCZ', x: 48 * ts, y: 3 * ts },
      { name: 'EZ',  x: 16 * ts, y: 23 * ts },
      { name: 'SZ',  x: 48 * ts, y: 23 * ts },
    ];
    for (const z of zones) {
      ctx.fillText(z.name, z.x, z.y);
    }
  }

  _zoneFloorColor(zone) {
    switch (zone) {
      case 'LCZ': return '#1a2818';
      case 'HCZ': return '#281818';
      case 'EZ':  return '#181828';
      case 'SZ':  return '#282818';
      default:    return '#1a1a1a';
    }
  }

  _zoneCorridorColor(zone) {
    switch (zone) {
      case 'LCZ': return '#152218';
      case 'HCZ': return '#221515';
      case 'EZ':  return '#151522';
      case 'SZ':  return '#222215';
      default:    return '#151515';
    }
  }

  _drawVisionCone(ctx, npc) {
    if (npc.visionAngle >= Math.PI * 2) return; // 全向视野不画锥

    const halfAngle = npc.visionAngle / 2;
    const segments = 12;

    ctx.beginPath();
    ctx.moveTo(npc.pos.x, npc.pos.y);
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const angle = npc.facing - halfAngle + npc.visionAngle * t;
      const x = npc.pos.x + Math.cos(angle) * npc.visionRange;
      const y = npc.pos.y + Math.sin(angle) * npc.visionRange;
      ctx.lineTo(x, y);
    }
    ctx.closePath();

    // 阵营颜色
    const c = npc.factionInfo.color;
    ctx.fillStyle = c + '15'; // 透明度
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

  _drawPath(ctx, npc) {
    if (!npc.path || npc.path.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(npc.pos.x, npc.pos.y);
    for (let i = npc.pathIndex; i < npc.path.length; i++) {
      const node = npc.path[i];
      const w = this.map.tileToWorld(node.col, node.row);
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
      // 尸体: 暗色 X
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

    // 受击闪烁
    if (npc.flashTimer > 0) {
      ctx.beginPath();
      ctx.arc(npc.pos.x, npc.pos.y, npc.radius + 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff40';
      ctx.fill();
    }

    // 攻击动画
    if (npc.attackAnimTimer > 0) {
      ctx.beginPath();
      ctx.arc(npc.pos.x, npc.pos.y, npc.radius + 6, 0, Math.PI * 2);
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 身体
    ctx.beginPath();
    ctx.arc(npc.pos.x, npc.pos.y, npc.radius, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();

    // 边框
    ctx.strokeStyle = npc.fsm.state === 'engage' ? '#ff4444' :
                      npc.fsm.state === 'alert'  ? '#ffaa00' :
                      npc.fsm.state === 'flee'   ? '#ffff00' : '#00000060';
    ctx.lineWidth = npc.fsm.state === 'engage' ? 2.5 : 1.5;
    ctx.stroke();

    // 朝向指示器
    const fx = npc.pos.x + Math.cos(npc.facing) * (npc.radius + 4);
    const fy = npc.pos.y + Math.sin(npc.facing) * (npc.radius + 4);
    ctx.beginPath();
    ctx.moveTo(npc.pos.x, npc.pos.y);
    ctx.lineTo(fx, fy);
    ctx.strokeStyle = '#ffffff80';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // SCP 标记
    if (npc.isSCP) {
      ctx.beginPath();
      ctx.arc(npc.pos.x, npc.pos.y, npc.radius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff3344';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 标签
    if (this.showLabels) {
      ctx.font = '9px Consolas';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffffcc';
      const label = npc.name;
      ctx.fillText(label, npc.pos.x, npc.pos.y - npc.radius - 5);

      // HP 条
      const hpW = npc.radius * 2.5;
      const hpH = 3;
      const hpX = npc.pos.x - hpW / 2;
      const hpY = npc.pos.y + npc.radius + 4;
      ctx.fillStyle = '#333';
      ctx.fillRect(hpX, hpY, hpW, hpH);
      ctx.fillStyle = npc.hp / npc.maxHp > 0.5 ? '#00ff66' :
                      npc.hp / npc.maxHp > 0.25 ? '#ffaa00' : '#ff3344';
      ctx.fillRect(hpX, hpY, hpW * (npc.hp / npc.maxHp), hpH);

      // 状态标签
      if (npc.fsm.state !== 'patrol') {
        ctx.font = '8px Consolas';
        ctx.fillStyle = npc.fsm.state === 'engage' ? '#ff4444' :
                        npc.fsm.state === 'alert'  ? '#ffaa00' :
                        npc.fsm.state === 'flee'   ? '#ffff00' : '#888';
        ctx.fillText(npc.fsm.state.toUpperCase(), npc.pos.x, hpY + 12);
      }
    }
  }

  // ============================================================
  // 玩家渲染
  // ============================================================
  _drawPlayer(ctx, player, aiSystem) {
    const c = player.color;

    // 受击闪烁
    if (player.flashTimer > 0) {
      ctx.beginPath();
      ctx.arc(player.pos.x, player.pos.y, player.radius + 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff60';
      ctx.fill();
    }

    // SCP-173: 注视警告光环
    if (player.role === 'scp173') {
      ctx.beginPath();
      ctx.arc(player.pos.x, player.pos.y, player.radius + 8, 0, Math.PI * 2);
      ctx.strokeStyle = player.watched ? '#ff3344' : '#00ff88';
      ctx.lineWidth = 2.5;
      ctx.setLineDash(player.watched ? [6, 3] : [2, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 身体
    ctx.beginPath();
    ctx.arc(player.pos.x, player.pos.y, player.radius, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();

    // 白色玩家描边
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // 朝向指示器
    const fx = player.pos.x + Math.cos(player.facing) * (player.radius + 5);
    const fy = player.pos.y + Math.sin(player.facing) * (player.radius + 5);
    ctx.beginPath();
    ctx.moveTo(player.pos.x, player.pos.y);
    ctx.lineTo(fx, fy);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // MTF: 鼠标瞄准线
    if (player.role === 'mtf' && this.game && this.game.mouseWorld) {
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

      // 准星
      ctx.beginPath();
      ctx.arc(mw.x, mw.y, 5, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff3344';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 标签
    if (this.showLabels) {
      ctx.font = 'bold 10px Consolas';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      const roleName = player.role === 'dclass' ? 'D级' :
                       player.role === 'mtf' ? 'MTF' : 'SCP-173';
      ctx.fillText(`你 (${roleName})`, player.pos.x, player.pos.y - player.radius - 8);

      // HP 条
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

    // 173: 显示击杀进度
    if (player.role === 'scp173') {
      ctx.font = 'bold 12px Consolas';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff3344';
      ctx.fillText(`☠ ${player.killCount}/5`, player.pos.x, player.pos.y - player.radius - 20);
    }
  }
}
