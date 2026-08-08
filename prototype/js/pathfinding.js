// ============================================================
// pathfinding.js — A* 寻路 (网格)
// ============================================================

class Pathfinder {
  constructor(grid, cols, rows) {
    this.grid = grid;     // 2D array: 0=walkable, 1=wall
    this.cols = cols;
    this.rows = rows;
  }

  setGrid(grid) { this.grid = grid; }

  isWalkable(col, row) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return false;
    return this.grid[row][col] === 0;
  }

  // A* 寻路, 返回 tile 坐标数组 或 null
  findPath(startCol, startRow, endCol, endRow) {
    if (!this.isWalkable(endCol, endRow)) return null;
    if (startCol === endCol && startRow === endRow) return [{ col: startCol, row: startRow }];

    const open = [];
    const closed = new Set();
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();

    const key = (c, r) => `${c},${r}`;
    const heuristic = (c1, r1, c2, r2) => Math.abs(c1 - c2) + Math.abs(r1 - r2);

    const startKey = key(startCol, startRow);
    gScore.set(startKey, 0);
    fScore.set(startKey, heuristic(startCol, startRow, endCol, endRow));
    open.push({ col: startCol, row: startRow, f: fScore.get(startKey) });

    const dirs = [
      [0, -1], [0, 1], [-1, 0], [1, 0],
      [-1, -1], [1, -1], [-1, 1], [1, 1] // 对角线
    ];

    let iterations = 0;
    const MAX_ITER = 2000;

    while (open.length > 0 && iterations < MAX_ITER) {
      iterations++;

      // 取 f 最小的节点
      open.sort((a, b) => a.f - b.f);
      const current = open.shift();
      const cKey = key(current.col, current.row);

      if (current.col === endCol && current.row === endRow) {
        // 重建路径
        const path = [];
        let ck = cKey;
        while (ck) {
          const [c, r] = ck.split(',').map(Number);
          path.unshift({ col: c, row: r });
          ck = cameFrom.get(ck);
        }
        return path;
      }

      closed.add(cKey);

      for (const [dc, dr] of dirs) {
        const nc = current.col + dc;
        const nr = current.row + dr;
        const nKey = key(nc, nr);

        if (closed.has(nKey)) continue;
        if (!this.isWalkable(nc, nr)) continue;

        // 对角线不能穿墙角
        if (dc !== 0 && dr !== 0) {
          if (!this.isWalkable(current.col + dc, current.row) || !this.isWalkable(current.col, current.row + dr))
            continue;
        }

        const moveCost = (dc !== 0 && dr !== 0) ? 1.414 : 1;
        const tentativeG = gScore.get(cKey) + moveCost;

        if (!gScore.has(nKey) || tentativeG < gScore.get(nKey)) {
          cameFrom.set(nKey, cKey);
          gScore.set(nKey, tentativeG);
          const f = tentativeG + heuristic(nc, nr, endCol, endRow);
          fScore.set(nKey, f);

          const existing = open.find(n => n.col === nc && n.row === nr);
          if (existing) {
            existing.f = f;
          } else {
            open.push({ col: nc, row: nr, f });
          }
        }
      }
    }

    return null; // 无路径
  }

  // 简化路径: 去掉同方向的中间点
  simplifyPath(path) {
    if (!path || path.length <= 2) return path;
    const result = [path[0]];
    for (let i = 1; i < path.length - 1; i++) {
      const prev = path[i - 1];
      const curr = path[i];
      const next = path[i + 1];
      const dir1 = { x: curr.col - prev.col, y: curr.row - prev.row };
      const dir2 = { x: next.col - curr.col, y: next.row - curr.row };
      if (dir1.x !== dir2.x || dir1.y !== dir2.y) {
        result.push(curr);
      }
    }
    result.push(path[path.length - 1]);
    return result;
  }
}
