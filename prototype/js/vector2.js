// ============================================================
// vector2.js — 2D 向量数学
// ============================================================

class Vec2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }

  static fromAngle(angle, len = 1) { return new Vec2(Math.cos(angle) * len, Math.sin(angle) * len); }
  static dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  static distSq(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }
  static angle(a, b) { return Math.atan2(b.y - a.y, b.x - a.x); }
  static lerp(a, b, t) { return new Vec2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t); }

  clone() { return new Vec2(this.x, this.y); }
  add(v) { this.x += v.x; this.y += v.y; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; return this; }
  mul(s) { this.x *= s; this.y *= s; return this; }
  div(s) { if (s !== 0) { this.x /= s; this.y /= s; } return this; }

  get mag() { return Math.hypot(this.x, this.y); }
  get magSq() { return this.x * this.x + this.y * this.y; }

  normalize() {
    const m = this.mag;
    if (m > 0) { this.x /= m; this.y /= m; }
    return this;
  }

  setMag(m) { return this.normalize().mul(m); }
  limit(max) { if (this.magSq > max * max) this.setMag(max); return this; }

  angle() { return Math.atan2(this.y, this.x); }

  // 判断点是否在扇形视野内
  static inVisionCone(observerPos, observerFacing, targetPos, halfAngle, range) {
    const dir = Vec2.sub2(targetPos, observerPos);
    const dist = dir.mag;
    if (dist > range) return false;
    if (dist < 1) return true; // 太近, 视为可见
    const angleDiff = Math.abs(Vec2.angleDiff2(observerFacing, dir.angle()));
    return angleDiff <= halfAngle;
  }

  static sub2(a, b) { return new Vec2(a.x - b.x, a.y - b.y); }

  static angleDiff2(a, b) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  // 线段与线段相交检测 (用于视线阻挡判断)
  static segmentIntersect(p1, p2, p3, p4) {
    const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
    const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
    const denom = d1x * d2y - d1y * d2x;
    if (Math.abs(denom) < 1e-10) return false;
    const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
    const s = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
    return t >= 0 && t <= 1 && s >= 0 && s <= 1;
  }
}
