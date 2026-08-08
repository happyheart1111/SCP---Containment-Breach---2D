// ============================================================
// perception.js — AI 感知系统 (视觉 + 听觉)
// ============================================================

class PerceptionSystem {
  constructor(map) {
    this.map = map;
    this.noiseEvents = []; // 当前活跃的声音事件
  }

  // 发出声音事件
  emitNoise(pos, radius, intensity, source) {
    this.noiseEvents.push({
      x: pos.x, y: pos.y,
      radius, intensity,
      source,
      age: 0,
      ttl: 0.5, // 声音持续 0.5 秒
    });
  }

  update(dt) {
    for (let i = this.noiseEvents.length - 1; i >= 0; i--) {
      this.noiseEvents[i].age += dt;
      if (this.noiseEvents[i].age >= this.noiseEvents[i].ttl) {
        this.noiseEvents.splice(i, 1);
      }
    }
  }

  // 视觉检测: 某实体能否看到目标实体
  // 返回 { entity, dist, identified } 或 null
  static checkVision(observer, targets, map) {
    if (observer.visionRange <= 0) return null; // 无视觉

    const halfAngle = observer.visionAngle / 2;
    let closest = null;
    let closestDist = Infinity;

    for (const target of targets) {
      if (target === observer) continue;
      if (target.dead) continue;

      const dist = Vec2.dist(observer.pos, target.pos);
      if (dist > observer.visionRange) continue;
      if (dist >= closestDist) continue;

      // 视野锥检测
      if (observer.visionAngle < Math.PI * 2) {
        const facingAngle = observer.facing;
        const targetAngle = Vec2.angle(observer.pos, target.pos);
        const angleDiff = Math.abs(Vec2.angleDiff2(facingAngle, targetAngle));
        if (angleDiff > halfAngle) continue;
      }

      // 视线阻挡检测 (Bresenham 简化版)
      if (this._lineBlocked(observer.pos, target.pos, map)) continue;

      if (dist < closestDist) {
        closestDist = dist;
        closest = target;
      }
    }

    if (!closest) return null;

    return { entity: closest, dist: closestDist };
  }

  // 听觉检测: 某实体能否听到声音
  static checkHearing(observer, noiseEvents) {
    if (observer.hearRange <= 0) return null;

    let closest = null;
    let closestDist = Infinity;

    for (const noise of noiseEvents) {
      const dist = Math.hypot(noise.x - observer.pos.x, noise.y - observer.pos.y);
      if (dist > noise.radius) continue; // 声音传不到
      if (dist > observer.hearRange) continue; // 听不到

      // 939 靠声音, 可以听到更远
      const effectiveRange = observer.isSoundHunter ? observer.hearRange : observer.hearRange;
      if (dist > effectiveRange) continue;

      if (dist < closestDist) {
        closestDist = dist;
        closest = noise;
      }
    }

    if (!closest) return null;
    return { noise: closest, dist: closestDist };
  }

  // 视线是否被墙阻挡 (DDA 光线投射)
  static _lineBlocked(posA, posB, map) {
    const { col: c0, row: r0 } = map.worldToTile(posA.x, posA.y);
    const { col: c1, row: r1 } = map.worldToTile(posB.x, posB.y);

    const dc = Math.abs(c1 - c0);
    const dr = Math.abs(r1 - r0);
    const sc = c0 < c1 ? 1 : -1;
    const sr = r0 < r1 ? 1 : -1;
    let err = dc - dr;
    let c = c0, r = r0;

    const maxSteps = dc + dr + 2;
    let steps = 0;

    while (steps < maxSteps) {
      steps++;
      if (map.blocksSight(c, r)) return true;
      if (c === c1 && r === r1) break;
      const e2 = 2 * err;
      if (e2 > -dr) { err -= dr; c += sc; }
      if (e2 < dc) { err += dc; r += sr; }
    }
    return false;
  }

  // 清除过期声音
  clear() { this.noiseEvents = []; }
}
