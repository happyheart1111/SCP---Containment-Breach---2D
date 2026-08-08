// ============================================================
// npcfactory.js — NPC 创建工厂
// ============================================================

class NPCFactory {
  static create(typeId, map, zone, idCounter) {
    const def = NPC_TYPES[typeId];
    if (!def) return null;

    // 找到 zone 的可通行 tile
    const tile = map.getRandomWalkableTile(zone);
    if (!tile) return null;

    const worldPos = map.tileToWorld(tile.col, tile.row);
    return new NPC(typeId, worldPos.x, worldPos.y, idCounter);
  }

  static createAt(typeId, map, col, row, idCounter) {
    const def = NPC_TYPES[typeId];
    if (!def) return null;

    const worldPos = map.tileToWorld(col, row);
    return new NPC(typeId, worldPos.x, worldPos.y, idCounter);
  }

  static createZombie(pos, idCounter) {
    const npc = new NPC('zombie', pos.x, pos.y, idCounter);
    return npc;
  }

  // 按波次生成
  static createInitialSpawns(map) {
    const npcs = [];
    let id = 0;

    for (const spawn of INITIAL_SPAWNS) {
      for (let i = 0; i < spawn.count; i++) {
        const npc = this.create(spawn.type, map, spawn.zone, id++);
        if (npc) npcs.push(npc);
      }
    }

    return npcs;
  }

  static createWaveSpawns(map, gameTime) {
    const npcs = [];
    let id = 10000 + Math.floor(gameTime);

    const wave = WAVE_SPAWNS[gameTime];
    if (!wave) return npcs;

    for (const spawn of wave) {
      for (let i = 0; i < spawn.count; i++) {
        const npc = this.create(spawn.type, map, spawn.zone, id++);
        if (npc) npcs.push(npc);
      }
    }

    return npcs;
  }
}
