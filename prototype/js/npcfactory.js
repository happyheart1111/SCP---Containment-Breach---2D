// ============================================================
// npcfactory.js — NPC 创建工厂 (多地图版)
// ============================================================

class NPCFactory {
  static create(typeId, world, levelId, idCounter) {
    const def = NPC_TYPES[typeId];
    if (!def) return null;
    const map = world.getLevel(levelId);
    if (!map) return null;

    const tile = map.getRandomWalkableTile(levelId);
    if (!tile) return null;

    const worldPos = map.tileToWorld(tile.col, tile.row);
    const npc = new NPC(typeId, worldPos.x, worldPos.y, idCounter);
    npc.levelId = levelId;
    return npc;
  }

  static createAt(typeId, world, levelId, col, row, idCounter) {
    const def = NPC_TYPES[typeId];
    if (!def) return null;
    const map = world.getLevel(levelId);
    if (!map) return null;

    const worldPos = map.tileToWorld(col, row);
    const npc = new NPC(typeId, worldPos.x, worldPos.y, idCounter);
    npc.levelId = levelId;
    return npc;
  }

  static createZombie(pos, levelId, idCounter) {
    const npc = new NPC('zombie', pos.x, pos.y, idCounter);
    npc.levelId = levelId;
    return npc;
  }

  // 按波次生成
  static createInitialSpawns(world) {
    const npcs = [];
    let id = 0;
    for (const spawn of INITIAL_SPAWNS) {
      for (let i = 0; i < spawn.count; i++) {
        const npc = this.create(spawn.type, world, spawn.zone, id++);
        if (npc) npcs.push(npc);
      }
    }
    return npcs;
  }
}
