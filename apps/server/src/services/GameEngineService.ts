import { Server } from 'socket.io';
import { PlayerIntention, RoomState, StateUpdateCommand } from '@ai-trpg/shared';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { moduleService } from './ModuleService';
import { roomStore } from '../state/roomStore';
import { questService } from './QuestService';

dotenv.config();

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY || 'sk-or-placeholder',
  defaultHeaders: {
    'HTTP-Referer': 'http://localhost:3000',
    'X-Title': 'Warhammer 40K TRPG',
  }
});

const BATCH_WINDOW_MS = 4000; // 动态防抖窗口设为4秒

export class GameEngineService {
  private io: Server;
  // 意图缓冲队列：roomId -> PlayerIntention[]
  private intentQueues: Map<string, PlayerIntention[]> = new Map();
  // 定时器：roomId -> Timeout
  private processingTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(io: Server) {
    this.io = io;
  }

  public pushIntention(intention: PlayerIntention) {
    const roomId = intention.room_id;
    if (!this.intentQueues.has(roomId)) {
      this.intentQueues.set(roomId, []);
    }
    
    this.intentQueues.get(roomId)!.push(intention);
    
    // 防抖逻辑：如果已经有定时器，清除它
    if (this.processingTimers.has(roomId)) {
      clearTimeout(this.processingTimers.get(roomId)!);
    } else {
      // 第一次收到意图时，通知前端开始处理
      this.io.to(roomId).emit('system_state', { processing: true });
    }
    
    // 重新启动倒计时
    const timer = setTimeout(() => {
      this.processBatch(roomId);
    }, BATCH_WINDOW_MS);
    this.processingTimers.set(roomId, timer);
  }

  private async processBatch(roomId: string) {
    // 清除定时器并取出队列
    this.processingTimers.delete(roomId);
    const intentions = this.intentQueues.get(roomId) || [];
    this.intentQueues.set(roomId, []); // 清空队列

    if (intentions.length === 0) return;

    const room = roomStore.memoryRooms[roomId];
    if (!room) return;

    try {
      this.io.to(roomId).emit('system_state', { processing: true }); // 确保状态
      
      // TODO: 完整的两段式请求架构
      // 阶段一：解析意图，判断是否需要检定
      const evaluationResult = await this.evaluateIntentions(room, intentions);
      
      // 中间阶段：如果在阶段一判断需要骰子检定，服务器先进行暗中代投
      let diceResultsStr = '';
      if (evaluationResult.requires_rolls && evaluationResult.rolls && evaluationResult.rolls.length > 0) {
        diceResultsStr = "The system has rolled the dice for the characters:\n";
        for (const roll of evaluationResult.rolls) {
           const char = room.characters[roll.character_id];
           if (char) {
             const statVal = char.attributes[roll.stat as keyof typeof char.attributes] || 0;
             // 简易 2d6
             const d1 = Math.floor(Math.random() * 6) + 1;
             const d2 = Math.floor(Math.random() * 6) + 1;
             const total = d1 + d2 + statVal;
             
             let degree = 'Failure (Miss)';
             if (total >= 10) degree = 'Full Success (Hit)';
             else if (total >= 7) degree = 'Partial Success (Mixed)';
             
             const resultMsg = `[${char.name}] rolled 2d6 + ${roll.stat}(${statVal}) = ${d1}+${d2}+${statVal} = ${total} (${degree}) for action: ${roll.reason}`;
             diceResultsStr += resultMsg + '\n';
             
             // 广播骰子结果给玩家
             this.io.to(roomId).emit('chat_broadcast', {
               message_id: Math.random().toString(),
               room_id: roomId,
               character_id: 'sys',
               character_name: 'DICE_SYSTEM',
               content: resultMsg,
               timestamp: Date.now(),
               type: 'chat'
             });
           }
        }
      }

      // 阶段二：根据判定结果（或纯叙事）生成故事和状态更新
      const finalResult = await this.generateNarration(room, intentions, diceResultsStr);

      // 发送叙事到房间
      this.io.to(roomId).emit('narrative_broadcast', {
        content: finalResult.narration,
        timestamp: Date.now()
      });
      
      this.io.to(roomId).emit('system_state', { processing: false });

      // 应用状态更新
      if (finalResult.state_updates && finalResult.state_updates.length > 0) {
        this.applyStateUpdates(room, finalResult.state_updates);
        this.io.to(roomId).emit('room_state_sync', room);
      }
      
    } catch (err) {
      console.error('Batch processing failed:', err);
      this.io.to(roomId).emit('system_message', { content: '[SYSTEM ERROR] Machine Spirit disruption detected. Please re-transmit.' });
      this.io.to(roomId).emit('system_state', { processing: false });
    }
  }

  private async evaluateIntentions(room: RoomState, intentions: PlayerIntention[]): Promise<any> {
    const systemPrompt = `
You are the Rule Arbiter for a Warhammer 40k PbtA TRPG.
Review the following player intentions. Determine if ANY of their actions trigger a risky move that requires a dice roll based on standard narrative TRPG rules (e.g. attacking, dodging, investigating under pressure).
Available stats: MIG, REF, AWA, WIL, TAC, INF.

Players' actions:
${intentions.map(i => `[${i.character_name} - ${i.character_id}]: ${i.content}`).join('\n')}

Output ONLY a JSON object in this format:
{
  "requires_rolls": boolean,
  "rolls": [
    { "character_id": "string", "stat": "MIG|REF|AWA|WIL|TAC|INF", "reason": "brief description of what they are testing" }
  ]
}
`;
    
    try {
      const completion = await openai.chat.completions.create({
        model: "deepseek/deepseek-chat",
        messages: [{ role: "system", content: systemPrompt }],
        response_format: { type: "json_object" }
      });
      return JSON.parse(completion.choices[0].message.content || '{}');
    } catch (e) {
      console.error('evaluateIntentions error:', e);
      return { requires_rolls: false, rolls: [] }; // Fallback to narrative only
    }
  }

  private async generateNarration(room: RoomState, intentions: PlayerIntention[], diceResultsStr: string): Promise<{narration: string, state_updates: StateUpdateCommand[]}> {
    const moduleData = moduleService.getModule(room.module_id);
    
    // 组装简单的 Prompt
    const systemPrompt = `
You are the Game Master for a Warhammer 40k TRPG.
Current Scene: ${room.current_scene}
Characters in scene:
${Object.values(room.characters).map(c => `- ${c.name} (${c.origin})`).join('\n')}

Module Background:
${moduleData ? moduleData.full_content.substring(0, 1500) : ''}

Predefined Quests:
${moduleData?.predefined_quests ? moduleData.predefined_quests.map(q => `- [${q.id}] ${q.title}: ${q.description}`).join('\n') : 'None'}

Current Quest Progress:
${room.quests && Object.keys(room.quests).length > 0 ? Object.values(room.quests).map(q => `- [${q.quest_id}] ${q.title} (${q.status}): ${q.progress_description}`).join('\n') : 'None'}

Please provide a narrative response and state updates. 
If a player took damage, output a "hp_change" with delta < 0.
If the players' actions progress any quests, output a "quest_update" state update. You MUST use one of the predefined quest_ids above. Do not invent your own quest_ids. 

Return JSON ONLY with no markdown formatting:
{
  "narration": "Your rich narrative text here...",
  "state_updates": [
    { "type": "hp_change", "character_id": "...", "delta": -1, "reason": "Took a hit" },
    { "type": "quest_update", "quest_id": "main_01_investigate_cargo", "value": { "status": "in_progress", "progress_description": "Found a key" } }
  ]
}
`;

    if (!room.history) {
      room.history = [];
    }

    const currentActionContent = `Players have declared the following actions:\n${intentions.map(i => `[${i.character_name}]: ${i.content}`).join('\n')}\n${diceResultsStr ? `\n--- DICE RESULTS ---\n${diceResultsStr}\nUse these exact results to narrate the outcome. Do not invent your own dice results.\n` : ''}`;
    
    room.history.push({ role: 'user', content: currentActionContent });

    if (room.history.length > 20) {
      room.history = room.history.slice(room.history.length - 20);
    }

    const messages: any[] = [
      { role: "system", content: systemPrompt },
      ...room.history
    ];

    try {
      const completion = await openai.chat.completions.create({
        model: "deepseek/deepseek-chat", // 使用 DeepSeek V4 (或可用模型)
        messages: messages,
        response_format: { type: "json_object" }
      });

      const responseText = completion.choices[0].message.content || '{}';
      room.history.push({ role: 'assistant', content: responseText });
      return JSON.parse(responseText);
    } catch (e) {
       console.error('generateNarration error:', e);
       // Fallback
       return {
          narration: "The Machine Spirit failed to parse the complexity of the situation... The vox channels buzz with static. (Error generating response)",
          state_updates: []
       };
    }
  }

  private applyStateUpdates(room: RoomState, updates: StateUpdateCommand[]) {
    let questsUpdated = false;

    // MVP 简单状态应用逻辑
    for (const update of updates) {
      if (update.type === 'quest_update') {
        try {
          const questId = update.quest_id;
          const moduleData = moduleService.getModule(room.module_id);
          const predefinedQuests = moduleData?.predefined_quests || [];
          
          if (!questId || !predefinedQuests.find(q => q.id === questId)) {
            console.warn(`[State Update] Invalid or hallucinated quest_id ignored: ${questId}`);
            continue;
          }
          
          if (!room.quests) room.quests = {};
          
          const title = predefinedQuests.find(q => q.id === questId)?.title || 'Unknown Quest';
          
          room.quests[questId] = {
            quest_id: questId,
            title: title,
            status: update.value?.status || 'in_progress',
            progress_description: update.value?.progress_description || ''
          };
          
          questsUpdated = true;
          console.log(`[Quest] Updated quest ${questId} -> ${update.value?.status}`);
        } catch (err) {
          console.error('[State Update] Failed to process quest_update:', err);
        }
        continue;
      }

      const char = update.character_id ? room.characters[update.character_id] : null;
      if (!char) continue;
      
      switch (update.type) {
        case 'hp_change':
           if (update.delta && update.delta < 0) {
              const order = ['健康', '轻伤', '重伤', '濒死'];
              const idx = char.hp_track.findLastIndex(s => order.includes(s) && s === '健康');
              if (idx !== -1) char.hp_track[idx] = '轻伤';
              else {
                 const woundIdx = char.hp_track.findLastIndex(s => s === '轻伤');
                 if (woundIdx !== -1) char.hp_track[woundIdx] = '重伤';
                 else {
                    const criticalIdx = char.hp_track.findLastIndex(s => s === '重伤');
                    if (criticalIdx !== -1) char.hp_track[criticalIdx] = '濒死';
                 }
              }
           } else if (update.delta && update.delta > 0) {
              // Simple healing
              const idx = char.hp_track.findIndex(s => s !== '健康' && s !== '阵亡');
              if (idx !== -1) char.hp_track[idx] = '健康';
           }
           break;
        case 'fear_change':
           char.fear = Math.max(0, Math.min(3, char.fear + (update.delta ?? 0)));
           break;
        case 'corruption_change':
           char.corruption = Math.max(0, char.corruption + (update.delta ?? 0));
           break;
        case 'item_gain':
           if (update.value) char.inventory.push(update.value);
           break;
        case 'item_loss':
           if (update.value) {
              const itemIdx = char.inventory.findIndex(i => i === update.value);
              if (itemIdx !== -1) char.inventory.splice(itemIdx, 1);
           }
           break;
      }
    }

    // Persist room state after updates
    roomStore.saveRoomState(room.room_id);

    if (questsUpdated && room.quests) {
      questService.saveQuests(room.room_id, room.quests);
    }
  }
}
