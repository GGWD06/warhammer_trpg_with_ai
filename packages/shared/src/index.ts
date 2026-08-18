// 40K 轻量跑团规则基础属性
export interface WH40kAttributes {
  MIG: number; // 体魄
  REF: number; // 反应
  AWA: number; // 洞察
  WIL: number; // 意志
  TAC: number; // 战术
  INF: number; // 威仪
}

// 创伤轨道状态
export type HpTrackStatus = '健康' | '轻伤' | '重伤' | '濒死' | '阵亡';

// 角色卡核心接口
export interface CharacterCard {
  character_id: string;
  name: string;
  callsign?: string;
  origin: string; // 出身
  attributes: WH40kAttributes;
  hp_track: HpTrackStatus[];
  fear: number; // 恐惧值 (0-3)
  corruption: number; // 堕落值
  inventory: string[];
  milestones: number;
}

// 意图/聊天消息
export interface PlayerIntention {
  message_id: string;
  room_id: string;
  character_id: string;
  character_name: string;
  content: string;
  timestamp: number;
  type: 'action' | 'chat'; // action: 会被收集进意图队列处理的动作，chat: 纯聊天
}

// AI 返回的状态更新指令
export interface StateUpdateCommand {
  type: 'hp_change' | 'fear_change' | 'corruption_change' | 'item_gain' | 'item_loss' | 'custom_status' | 'quest_update';
  character_id?: string; // 对于 quest_update 可选
  quest_id?: string; // 用于 quest_update，必须是预定义的 id
  delta?: number; // 用于数值增减
  value?: any; // 用于具体的状态或物品变更
  reason?: string; // 变更原因，方便向前端展示播报
}

// 支线/主线任务进度
export interface QuestProgress {
  quest_id: string;
  title: string;
  status: 'not_started' | 'in_progress' | 'completed' | 'failed';
  progress_description: string;
}

// 房间状态
export interface RoomState {
  room_id: string;
  campaign_mode: 'single' | 'persistent';
  combat_mode: 'narrative' | 'tactical';
  module_id: string;
  characters: Record<string, CharacterCard>; // char_id -> card
  current_scene?: string; // 当前所处场景
  quests?: Record<string, QuestProgress>; // quest_id -> QuestProgress
}

// 场景节点
export interface SceneNode {
  id: string;
  name: string;
  description: string;
  trigger_condition?: string;
  connections: string[]; // 其他场景的 ID
}

export interface PredefinedQuest {
  id: string;
  title: string;
  description: string;
}

// 模组定义
export interface ModuleData {
  module_id: string;
  title: string;
  recommended_party_size: string;
  difficulty: string;
  content_warnings: string[];
  background: string;
  core_secret: string; // 仅 DM(AI) 可见
  scenes: SceneNode[];
  npcs: Record<string, string>; // name -> description
  predefined_quests?: PredefinedQuest[];
}
