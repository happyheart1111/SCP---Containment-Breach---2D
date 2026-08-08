// ============================================================
// config.js — 全局配置：阵营关系、NPC定义、常量
// ============================================================

const CONFIG = {

  // ---- 渲染 ----
  TILE_SIZE: 28,           // 每格像素
  MAP_COLS: 64,            // 地图列数
  MAP_ROWS: 40,            // 地图行数
  FPS_TARGET: 60,

  // ---- 时间 ----
  GAME_DURATION: 1800,     // 30分钟 = 1800秒
  TIME_SCALE_DEFAULT: 1,   // 1x = 实时

  // ---- 感知 ----
  VISION_RANGE: 250,       // 视野距离 (像素)
  VISION_ANGLE: Math.PI * 2 / 3, // 120度视野锥
  HEAR_WALK: 100,          // 行走噪音半径
  HEAR_RUN: 200,           // 奔跑噪音半径
  HEAR_GUNSHOT: 400,       // 枪声半径
  IDENTIFY_TIME: 0.5,      // 识别阵营时间(秒)

  // ---- 战斗 ----
  BULLET_SPEED: 600,       // 子弹速度 px/s
  FIRE_RATE: 0.15,         // 射速间隔(秒)
  MELEE_RANGE: 35,         // 近战距离

  // ---- 寻路 ----
  PATH_RECALC_INTERVAL: 1.0, // 路径重算间隔(秒)
};

// ============================================================
// 阵营定义
// ============================================================
const FACTIONS = {
  DCLASS:    { id: 'DCLASS',    name: 'D级人员',   color: '#ff9933', short: 'D' },
  SCIENTIST: { id: 'SCIENTIST', name: '科学家',     color: '#44ddff', short: 'SCI' },
  FOUNDATION:{ id: 'FOUNDATION',name: '基金会',     color: '#4488ff', short: 'MTF' },
  GOC:       { id: 'GOC',       name: 'GOC',       color: '#aa44ff', short: 'GOC' },
  CI:        { id: 'CI',        name: '混沌分裂者', color: '#44ff44', short: 'CI' },
  SCP:       { id: 'SCP',       name: 'SCP',       color: '#ff3344', short: 'SCP' },
  ZOMBIE:    { id: 'ZOMBIE',    name: '049-2',     color: '#669944', short: 'Z' },
  WILD:      { id: 'WILD',      name: '野生SCP',   color: '#cc66ff', short: '939' },
};

// ============================================================
// 阵营关系矩阵 — relation[from][to] = 'ally' | 'enemy' | 'neutral'
// ============================================================
const FACTION_RELATIONS = {
  DCLASS:     { SCIENTIST: 'neutral', FOUNDATION: 'enemy', GOC: 'neutral', CI: 'ally',    SCP: 'enemy',   ZOMBIE: 'enemy', WILD: 'enemy' },
  SCIENTIST:  { DCLASS: 'neutral',    FOUNDATION: 'ally',    GOC: 'neutral', CI: 'enemy',   SCP: 'enemy',   ZOMBIE: 'enemy', WILD: 'enemy' },
  // FOUNDATION(MTF/守卫) 处决D级 (SCP:SL设定); 科学家仍中立——可被D级利用
  FOUNDATION: { DCLASS: 'enemy',      SCIENTIST: 'ally',     GOC: 'tense',   CI: 'enemy',   SCP: 'enemy',   ZOMBIE: 'enemy', WILD: 'enemy' },
  GOC:        { DCLASS: 'neutral',    SCIENTIST: 'neutral',  FOUNDATION: 'tense', CI: 'enemy', SCP: 'enemy', ZOMBIE: 'enemy', WILD: 'enemy' },
  CI:         { DCLASS: 'ally',       SCIENTIST: 'enemy',    FOUNDATION: 'enemy', GOC: 'enemy', SCP: 'neutral', ZOMBIE: 'enemy', WILD: 'neutral' },
  SCP:        { DCLASS: 'enemy',      SCIENTIST: 'enemy',    FOUNDATION: 'enemy', GOC: 'enemy', CI: 'neutral', ZOMBIE: 'ally',  WILD: 'ally' },
  ZOMBIE:     { DCLASS: 'enemy',      SCIENTIST: 'enemy',    FOUNDATION: 'enemy', GOC: 'enemy', CI: 'enemy',   SCP: 'ally',     WILD: 'neutral' },
  WILD:       { DCLASS: 'enemy',      SCIENTIST: 'enemy',    FOUNDATION: 'enemy', GOC: 'enemy', CI: 'neutral', ZOMBIE: 'neutral', SCP: 'ally' },
};

// 'tense' 当作 neutral 处理但不主动援助
function getRelation(fromFaction, toFaction) {
  if (fromFaction === toFaction) return 'ally';
  const r = FACTION_RELATIONS[fromFaction];
  if (!r) return 'neutral';
  return r[toFaction] || 'neutral';
}

function isHostile(fromFaction, toFaction) {
  return getRelation(fromFaction, toFaction) === 'enemy';
}

function isAlly(fromFaction, toFaction) {
  return getRelation(fromFaction, toFaction) === 'ally';
}

// ============================================================
// NPC 类型定义
// ============================================================
const NPC_TYPES = {

  // ---- 人类 NPC ----
  guard: {
    name: '设施警卫', faction: 'FOUNDATION',
    hp: 100, armor: 0.15, speed: 90,
    weapon: 'pistol', ammo: 12, fireRate: 0.4,
    visionRange: 230, visionAngle: CONFIG.VISION_ANGLE,
    hearRange: CONFIG.HEAR_WALK,
    behavior: 'guard',  // 保护科学家, 攻击D级, 拖延SCP
    targetPriority: ['SCP', 'CI', 'DCLASS'],
    retreatThreshold: 30, // HP<30 撤退
    color: '#888899', radius: 9,
    spawnTime: 0, spawnZone: 'EZ',
  },

  mtf_private: {
    name: 'MTF列兵', faction: 'FOUNDATION',
    hp: 150, armor: 0.30, speed: 95,
    weapon: 'rifle', ammo: 30, fireRate: 0.15,
    visionRange: 260, visionAngle: CONFIG.VISION_ANGLE,
    hearRange: CONFIG.HEAR_RUN,
    behavior: 'sweep', // 收容SCP, 攻击CI
    targetPriority: ['SCP', 'CI', 'ZOMBIE', 'WILD'],
    retreatThreshold: 40,
    color: '#4488ff', radius: 10,
    spawnTime: 900, spawnZone: 'SZ', // 15分钟
  },

  mtf_sergeant: {
    name: 'MTF中士', faction: 'FOUNDATION',
    hp: 170, armor: 0.30, speed: 90,
    weapon: 'shotgun', ammo: 6, fireRate: 0.8,
    visionRange: 250, visionAngle: CONFIG.VISION_ANGLE,
    hearRange: CONFIG.HEAR_RUN,
    behavior: 'sweep_aggressive',
    targetPriority: ['SCP', 'CI', 'ZOMBIE', 'WILD'],
    retreatThreshold: 30,
    color: '#3366dd', radius: 11,
    spawnTime: 900, spawnZone: 'SZ',
  },

  ci_soldier: {
    name: 'CI士兵', faction: 'CI',
    hp: 130, armor: 0.20, speed: 95,
    weapon: 'rifle', ammo: 30, fireRate: 0.15,
    visionRange: 250, visionAngle: CONFIG.VISION_ANGLE,
    hearRange: CONFIG.HEAR_RUN,
    behavior: 'raid', // 寻找D级, 攻击MTF
    targetPriority: ['FOUNDATION', 'GOC', 'SCIENTIST'],
    retreatThreshold: 35,
    color: '#44ff44', radius: 10,
    spawnTime: 600, spawnZone: 'SZ', // 10分钟
  },

  goc_soldier: {
    name: 'GOC特工', faction: 'GOC',
    hp: 120, armor: 0.15, speed: 100,
    weapon: 'energy', ammo: 20, fireRate: 0.3,
    visionRange: 280, visionAngle: CONFIG.VISION_ANGLE,
    hearRange: CONFIG.HEAR_RUN,
    behavior: 'hunt_scp', // 消灭SCP, 无视其他人类
    targetPriority: ['SCP', 'WILD', 'ZOMBIE'],
    retreatThreshold: 30,
    color: '#aa44ff', radius: 10,
    spawnTime: 1200, spawnZone: 'SZ', // 20分钟
  },

  // ---- SCP NPC ----
  scp_173: {
    name: 'SCP-173', faction: 'SCP',
    hp: 500, armor: 1.0, speed: 0, // 被注视时0
    weapon: 'touch_kill', ammo: -1, fireRate: 0.5,
    visionRange: 300, visionAngle: Math.PI * 2, // 全向视野
    hearRange: CONFIG.HEAR_RUN,
    behavior: 'scp_173', // 眨眼瞬移
    targetPriority: ['DCLASS', 'SCIENTIST', 'FOUNDATION', 'CI', 'GOC'],
    retreatThreshold: 0, // 永不撤退
    color: '#ff3344', radius: 12,
    spawnTime: 0, spawnZone: 'LCZ',
    isSCP: true,
  },

  scp_049: {
    name: 'SCP-049', faction: 'SCP',
    hp: 400, armor: 1.0, speed: 55, // 不可杀, 缓慢
    weapon: 'touch_plague', ammo: -1, fireRate: 1.0,
    visionRange: 240, visionAngle: CONFIG.VISION_ANGLE,
    hearRange: CONFIG.HEAR_RUN,
    behavior: 'scp_049', // 接触致死+制造僵尸
    targetPriority: ['DCLASS', 'SCIENTIST', 'FOUNDATION', 'CI', 'GOC'],
    retreatThreshold: 0,
    color: '#dd2233', radius: 12,
    spawnTime: 0, spawnZone: 'HCZ',
    isSCP: true,
  },

  scp_939: {
    name: 'SCP-939', faction: 'WILD',
    hp: 300, armor: 0, speed: 85,
    weapon: 'pounce', ammo: -1, fireRate: 2.0,
    visionRange: 0, // 无视觉, 靠声音
    visionAngle: 0,
    hearRange: 500, // 超强听觉
    behavior: 'ambush', // 伏击型
    targetPriority: ['DCLASS', 'SCIENTIST', 'FOUNDATION', 'CI', 'GOC'],
    retreatThreshold: 50,
    color: '#cc66ff', radius: 11,
    spawnTime: 0, spawnZone: 'HCZ',
    isSCP: true,
  },

  zombie: {
    name: '049-2', faction: 'ZOMBIE',
    hp: 60, armor: 0, speed: 45,
    weapon: 'melee', ammo: -1, fireRate: 1.0,
    visionRange: 180, visionAngle: CONFIG.VISION_ANGLE,
    hearRange: CONFIG.HEAR_RUN,
    behavior: 'zombie', // 缓慢追击最近人类
    targetPriority: ['DCLASS', 'SCIENTIST', 'FOUNDATION', 'CI', 'GOC'],
    retreatThreshold: 0,
    color: '#669944', radius: 8,
    spawnTime: -1, spawnZone: 'HCZ', // 由049制造
  },
};

// ============================================================
// 武器定义
// ============================================================
const WEAPONS = {
  pistol:   { name: '手枪',       damage: 25, range: 350, bulletSpeed: 500,  spread: 0.05, scpDamage: 0,   knockback: 0,   color: '#ffcc00' },
  rifle:    { name: '突击步枪',   damage: 30, range: 450, bulletSpeed: 700,  spread: 0.03, scpDamage: 0,   knockback: 0,   color: '#ffaa00' },
  shotgun:  { name: '霰弹枪',     damage: 50, range: 200, bulletSpeed: 450,  spread: 0.15, scpDamage: 0,   knockback: 0,   color: '#ff8800', pellets: 5 },
  energy:   { name: '能量武器',   damage: 15, range: 400, bulletSpeed: 800,  spread: 0.02, scpDamage: 40,  knockback: 0,   color: '#cc88ff' }, // 对SCP 2x, 对人类 0.5x
  touch_kill:   { name: '秒杀',   damage: 9999, range: 20, bulletSpeed: 0,   spread: 0,    scpDamage: 0,   knockback: 0,   color: '#ff0000', melee: true },
  touch_plague: { name: '瘟疫接触', damage: 9999, range: 22, bulletSpeed: 0,  spread: 0,    scpDamage: 0,   knockback: 0,   color: '#ff0000', melee: true },
  pounce:   { name: '飞扑',       damage: 120, range: 60, bulletSpeed: 0,    spread: 0,    scpDamage: 0,   knockback: 0,   color: '#cc66ff', melee: true },
  melee:    { name: '近战',       damage: 15,  range: 30, bulletSpeed: 0,    spread: 0,    scpDamage: 0,   knockback: 0,   color: '#88aa00', melee: true },
};

// ============================================================
// 波次时间线
// ============================================================
const WAVES = [
  { time: 0,    event: '收容失效：SCP突破收容，设施警卫就位', phase: 'SCP DOMINANT' },
  { time: 300,  event: 'SCP-079激活：开始骇门、断电', phase: 'SCP ENHANCED' },
  { time: 600,  event: '混沌分裂者增援到达 (2名CI士兵)', phase: 'CI INTERVENTION' },
  { time: 900,  event: 'MTF增援到达 (2列兵+1中士)', phase: 'MTF COUNTERATTACK' },
  { time: 1200, event: 'GOC介入 (1名GOC特工)', phase: 'THREE-WAY WAR' },
  { time: 1500, event: '核弹可用 (90秒倒计时)', phase: 'ENDGAME' },
];

// ============================================================
// 地图区域定义
// ============================================================
const ZONES = {
  LCZ: { name: 'Light Containment',  color: '#1a2a1a', x: 0,  y: 0,  cols: 32, rows: 20, keycardLevel: 1 },
  HCZ: { name: 'Heavy Containment',  color: '#2a1a1a', x: 32, y: 0,  cols: 32, rows: 20, keycardLevel: 3 },
  EZ:  { name: 'Entrance Zone',      color: '#1a1a2a', x: 0,  y: 20, cols: 32, rows: 20, keycardLevel: 4 },
  SZ:  { name: 'Surface Zone',       color: '#2a2a1a', x: 32, y: 20, cols: 32, rows: 20, keycardLevel: 5 },
};

// ============================================================
// 初始 NPC 生成列表 (波次0)
// ============================================================
const INITIAL_SPAWNS = [
  { type: 'guard',      count: 2, zone: 'EZ'  },
  { type: 'scp_173',    count: 1, zone: 'LCZ' },
  { type: 'scp_049',    count: 1, zone: 'HCZ' },
  { type: 'scp_939',    count: 2, zone: 'HCZ' },
];

const WAVE_SPAWNS = {
  600:  [ { type: 'ci_soldier', count: 2, zone: 'SZ' } ],
  900:  [ { type: 'mtf_private', count: 2, zone: 'SZ' }, { type: 'mtf_sergeant', count: 1, zone: 'SZ' } ],
  1200: [ { type: 'goc_soldier', count: 1, zone: 'SZ' } ],
};
