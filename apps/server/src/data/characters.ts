import { CharacterCard } from '@ai-trpg/shared';

export const PRESET_CHARACTERS: CharacterCard[] = [
  {
    character_id: "c001",
    name: "格罗姆",
    callsign: "铁砧",
    origin: "帝国近卫军老兵",
    attributes: { MIG: 2, REF: 1, AWA: 1, WIL: 1, TAC: 2, INF: -1 },
    hp_track: ["健康", "健康", "健康", "健康"],
    fear: 0,
    corruption: 0,
    inventory: ["军用链剑（精良）", "激光枪（常规）", "急救绷带 x2"],
    milestones: 0
  },
  {
    character_id: "c002",
    name: "维克丝",
    callsign: "回路",
    origin: "机械神教技师",
    attributes: { MIG: 0, REF: 1, AWA: 2, WIL: 0, TAC: 2, INF: -2 },
    hp_track: ["健康", "健康", "健康", "健康"],
    fear: 0,
    corruption: 0,
    inventory: ["机械义肢工具组", "电磁手炮（常规）", "便携式扫描仪"],
    milestones: 0
  },
  {
    character_id: "c003",
    name: "塞拉芬",
    callsign: "静默",
    origin: "帝国传教士/忏悔者",
    attributes: { MIG: -1, REF: 0, AWA: 1, WIL: 3, TAC: 0, INF: 2 },
    hp_track: ["健康", "健康", "健康", "健康"],
    fear: 0,
    corruption: 0,
    inventory: ["动力棍（常规，经过祝圣）", "圣像挂坠", "审讯用具"],
    milestones: 0
  },
  {
    character_id: "c004",
    name: "雷恩",
    callsign: "无声",
    origin: "密探/刺客出身",
    attributes: { MIG: 0, REF: 3, AWA: 2, WIL: -1, TAC: 0, INF: 0 },
    hp_track: ["健康", "健康", "健康", "健康"],
    fear: 0,
    corruption: 0,
    inventory: ["消音手炮（精良）", "潜行斗篷", "撬锁工具组"],
    milestones: 0
  }
];
