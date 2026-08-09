// ============================================================
// combatsystem.js — 战斗系统 (子弹 + 伤害解算)
// ============================================================

class CombatSystem {
  constructor() {
    this.bullets = [];
    this.pendingZombies = []; // { pos, timer, source }
    this.damageNumbers = [];  // { x, y, value, age, color }
  }

  spawnBullet(bullet) {
    this.bullets.push(bullet);
  }

  scheduleZombie(victim, source) {
    // 049 复活: 1.5秒后在尸体位置生成僵尸 (带地图)
    this.pendingZombies.push({
      pos: victim.pos.clone(),
      levelId: victim.levelId,
      timer: 1.5,
      source: source,
    });
  }

  spawnDamageNumber(x, y, value, color) {
    this.damageNumbers.push({ x, y, value: Math.round(value), age: 0, color });
  }

  dealDamage(target, amount, attacker, damageType, ctx) {
    if (!target || target.dead) return;

    target.takeDamage(amount, damageType, attacker, ctx);

    // 显示伤害数字
    const color = target.isSCP ? '#ff6644' : '#ffaa00';
    this.spawnDamageNumber(target.pos.x, target.pos.y - 20, amount, color);

    // 记录战斗事件
    if (target.dead) {
      const killerName = attacker ? attacker.name : '设施';
      ctx.game.logEvent(
        `${killerName} 击杀了 ${target.name}`,
        'death'
      );
    }
  }

  update(dt, aiSystem, game) {
    // 更新子弹
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      const moveX = b.vx * dt;
      const moveY = b.vy * dt;
      b.x += moveX;
      b.y += moveY;
      b.traveled += Math.hypot(moveX, moveY);

      // 超出射程
      if (b.traveled > b.range) {
        this.bullets.splice(i, 1);
        continue;
      }

      // 子弹所属地图
      const map = aiSystem.world.getLevel(b.levelId);
      if (!map) { this.bullets.splice(i, 1); continue; }

      // 撞墙
      const tile = map.worldToTile(b.x, b.y);
      if (map.isWall(tile.col, tile.row)) {
        this.bullets.splice(i, 1);
        continue;
      }

      // 撞实体 (仅同图实体)
      const levelEntities = aiSystem.entitiesIn(b.levelId);
      let hit = false;
      for (const e of levelEntities) {
        if (e === b.source || e.dead) continue;
        if (!isHostile(b.faction, e.faction) && !isAlly(b.faction, e.faction) && b.faction !== e.faction) {
          const r = getRelation(b.faction, e.faction);
          if (r !== 'enemy') continue;
        } else if (isAlly(b.faction, e.faction)) {
          continue;
        }

        const d = Math.hypot(b.x - e.pos.x, b.y - e.pos.y);
        if (d < e.radius + 3) {
          let damage = b.damage;
          if (e.isSCP && b.scpDamage > 0) {
            damage = b.scpDamage;
          } else if (e.isSCP) {
            damage = 0;
          }

          if (damage > 0) {
            const ctx = aiSystem.ctxFor(e, game);
            this.dealDamage(e, damage, b.source, 'bullet', ctx);
          } else {
            this.spawnDamageNumber(e.pos.x, e.pos.y - 20, 0, '#666');
          }

          this.bullets.splice(i, 1);
          hit = true;
          break;
        }
      }

      if (hit) continue;
    }

    // 更新待生成僵尸
    for (let i = this.pendingZombies.length - 1; i >= 0; i--) {
      const pz = this.pendingZombies[i];
      pz.timer -= dt;
      if (pz.timer <= 0) {
        const zombie = NPCFactory.createZombie(pz.pos, pz.levelId, 50000 + i);
        aiSystem.entities.push(zombie);
        game.logEvent(`SCP-049 复活了 049-2 僵尸`, 'spawn');
        this.pendingZombies.splice(i, 1);
      }
    }

    // 更新伤害数字
    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const dn = this.damageNumbers[i];
      dn.age += dt;
      dn.y -= 30 * dt;
      if (dn.age > 1.0) {
        this.damageNumbers.splice(i, 1);
      }
    }
  }

  reset() {
    this.bullets = [];
    this.pendingZombies = [];
    this.damageNumbers = [];
  }
}
