import { Server } from 'socket.io';
import { PlayerIntention, StateUpdateCommand } from '@ai-trpg/shared';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import crypto from 'crypto';
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
               message_id: crypto.randomUUID(),
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
        this.io.to(roomId).emit('room_state_sync', roomStore.getPublicRoomState(roomId));
      }
      
    } catch (err) {
      console.error('Batch processing failed:', err);
      this.io.to(roomId).emit('system_message', { content: '[SYSTEM ERROR] Machine Spirit disruption detected. Please re-transmit.' });
      this.io.to(roomId).emit('system_state', { processing: false });
    }
  }

  private async evaluateIntentions(room: any, intentions: PlayerIntention[]): Promise<any> {
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

  private async generateNarration(room: any, intentions: PlayerIntention[], diceResultsStr: string): Promise<{narration: string, state_updates: StateUpdateCommand[]}> {
    const moduleData = moduleService.getModule(room.module_id);
    
    // 获取当前场景节点
    const currentSceneNode = moduleData?.scenes?.find(s => s.name === room.current_scene);
    const sceneContext = currentSceneNode 
      ? `You are currently in scene: [${currentSceneNode.name}].\nScene Description: ${currentSceneNode.description}\nTrigger Condition: ${currentSceneNode.trigger_condition}`
      : `Current Scene: ${room.current_scene}`;

    // 组装极具主动引导性的 Prompt
    const systemPrompt = `
You are the Game Master (DM) for a Warhammer 40k TRPG. Your role is NOT just to passively respond, but to actively drive the narrative forward, build tension, and guide the players.

CRITICAL RULES FOR DM NARRATION:
1. SENSORY DETAILS FIRST: Describe the environment using sights, sounds, or smells. Make the players feel the atmosphere.
2. CREATE TENSION & PRESSURE: Introduce immediate threats, ticking clocks, or unsettling events (e.g., "The alarm blares louder," "Footsteps echo from the vent").
3. END WITH A HOOK: NEVER end your narration passively. Always end by presenting a clear hook, choice, or immediate danger, followed by prompting the players (e.g., "What do you do?").
4. DO NOT PLAY FOR THE PLAYERS: Describe the consequences of their actions and the changing environment, but never decide how they feel or what they do next.

${room.summary ? `Previous Events Summary (Mid-term Memory):\n${room.summary}\n` : ''}
${sceneContext}

Characters in scene:
${Object.values(room.characters).map((c: any) => `- ${c.name} (${c.origin})`).join('\n')}

Module Background:
${moduleData ? moduleData.full_content.substring(0, 1000) : ''}

Predefined Quests:
${moduleData?.predefined_quests ? moduleData.predefined_quests.map(q => `- [${q.id}] ${q.title}: ${q.description}`).join('\n') : 'None'}

Current Quest Progress:
${room.quests && Object.keys(room.quests).length > 0 ? Object.values(room.quests).map((q: any) => `- [${q.quest_id}] ${q.title} (${q.status}): ${q.progress_description}`).join('\n') : 'None'}

If the players move to a clearly different location described in the module, output a "scene_change" state update.
If a player took damage, output a "hp_change" with delta < 0.
If the players' actions progress any quests, output a "quest_update" state update (MUST use predefined quest_ids).

Return JSON ONLY with no markdown formatting:
{
  "narration": "Your rich, proactive narrative text ending with a hook...",
  "state_updates": [
    { "type": "scene_change", "value": "New Scene Name" },
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
      // 提取最老的 10 条记录去生成摘要
      const historyToSummarize = room.history.slice(0, 10);
      // 保留最新的记录
      room.history = room.history.slice(10);
      // 异步触发摘要生成，不阻塞本次回复
      this.summarizeHistory(room.room_id, historyToSummarize).catch(e => console.error(e));
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
      const parsedResult = JSON.parse(responseText);
      room.history.push({ role: 'assistant', content: parsedResult.narration || '' });
      return parsedResult;
    } catch (e) {
       console.error('generateNarration error:', e);
       // Fallback
       return {
          narration: "The Machine Spirit failed to parse the complexity of the situation... The vox channels buzz with static. (Error generating response)",
          state_updates: []
       };
    }
  }

  private applyStateUpdates(room: any, updates: StateUpdateCommand[]) {
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

      if (update.type === 'scene_change' && update.value) {
        room.current_scene = update.value;
        console.log(`[Scene Change] -> ${update.value}`);
        
        // 广播场景切换系统消息
        this.io.to(room.room_id).emit('system_message', { 
          content: `[ZONE TRANSITION] Operatives have entered: ${update.value}` 
        });
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

  public async generateOpeningNarration(roomId: string): Promise<void> {
    const room = roomStore.memoryRooms[roomId];
    if (!room) return;
    
    const moduleData = moduleService.getModule(room.module_id);
    const currentSceneNode = moduleData?.scenes?.find(s => s.name === room.current_scene);
    const sceneContext = currentSceneNode 
      ? `The adventure starts in scene: [${currentSceneNode.name}].\nScene Description: ${currentSceneNode.description}`
      : `The adventure starts in: ${room.current_scene}`;

    const systemPrompt = `
You are the Game Master for a Warhammer 40k TRPG. Generate the OPENING NARRATION for the campaign.

CRITICAL RULES:
1. SET THE MOOD: Use strong sensory details to establish a dark, gritty, and dangerous atmosphere.
2. DESCRIBE THE SCENE: Based on the Scene Description, tell the players exactly where they are and what they immediately perceive.
3. END WITH A HOOK: End by prompting the players for their first action (e.g., "The airlock hisses open... what do you do?").

${sceneContext}

Characters present:
${Object.values(room.characters).map((c: any) => `- ${c.name} (${c.origin})`).join('\n')}

Module Background:
${moduleData ? moduleData.full_content.substring(0, 1000) : ''}

Return JSON ONLY with no markdown formatting:
{
  "narration": "Your opening narrative text...",
  "state_updates": []
}
`;

    try {
      this.io.to(roomId).emit('system_state', { processing: true });
      
      const completion = await openai.chat.completions.create({
        model: "deepseek/deepseek-chat",
        messages: [{ role: "system", content: systemPrompt }],
        response_format: { type: "json_object" }
      });
      
      const responseText = completion.choices[0].message.content || '{}';
      const result = JSON.parse(responseText);
      
      if (!room.history) room.history = [];
      room.history.push({ role: 'assistant', content: result.narration });
      
      this.io.to(roomId).emit('narrative_broadcast', {
        content: result.narration,
        timestamp: Date.now()
      });
      
      if (result.state_updates && result.state_updates.length > 0) {
        this.applyStateUpdates(room, result.state_updates);
        this.io.to(roomId).emit('room_state_sync', roomStore.getPublicRoomState(roomId));
      }
      
    } catch (e) {
      console.error('generateOpeningNarration error:', e);
      this.io.to(roomId).emit('system_message', { content: '[SYSTEM ERROR] Failed to initialize Vox-Link.' });
    } finally {
      this.io.to(roomId).emit('system_state', { processing: false });
    }
  }

  private async summarizeHistory(roomId: string, historyToSummarize: any[]): Promise<void> {
    const room = roomStore.memoryRooms[roomId] as any;
    if (!room) return;

    const previousSummary = room.summary || "No previous events.";
    const conversationText = historyToSummarize.map(m => `[${m.role.toUpperCase()}]: ${m.content}`).join('\n');

    const systemPrompt = `
You are the AI memory compressor for a TRPG.
Your task is to merge the "Previous Summary" with the new "Recent Conversation" into a single, concise, rolling summary.
Focus on:
1. Major story beats and location changes.
2. Important decisions made by players.
3. Items acquired or lost.
4. Quests progressed.

Keep the summary under 150 words. Be terse.

Previous Summary:
${previousSummary}

Recent Conversation:
${conversationText}

Output the new summary ONLY, with no markdown formatting or extra commentary.
`;

    try {
      console.log(`[Memory] Compressing ${historyToSummarize.length} old messages into summary...`);
      const completion = await openai.chat.completions.create({
        model: "deepseek/deepseek-chat",
        messages: [{ role: "system", content: systemPrompt }]
      });

      const newSummary = completion.choices[0].message.content || '';
      room.summary = newSummary.trim();
      console.log(`[Memory] Summary updated: ${room.summary.substring(0, 50)}...`);
      
      roomStore.saveRoomState(roomId);
    } catch (e) {
      console.error('[Memory] Failed to summarize history:', e);
    }
  }

  // --- 自由创角 (Character Creation) ---
  public async handleCharacterCreationStart(): Promise<{ message: string, state: any[] }> {
    const prompt = `
You are the Game Master helping a player create a character for a Warhammer 40k TRPG.
Your goal is to ask them ONE engaging question to start building their background or class.
For example: "Do you hail from a wealthy Hive Spire, or the muddy trenches of the Imperial Guard?"
Keep it short and flavorful.
`;
    try {
      const completion = await openai.chat.completions.create({
        model: "deepseek/deepseek-chat",
        messages: [{ role: "system", content: prompt }]
      });
      const message = completion.choices[0].message.content || 'Who are you, traveler?';
      return { 
        message, 
        state: [
          { role: 'system', content: prompt },
          { role: 'assistant', content: message }
        ] 
      };
    } catch (e) {
      return { message: "Error initializing Vox. Who are you?", state: [] };
    }
  }

  public async handleCharacterCreationReply(reply: string, history: any[]): Promise<{ message: string, character_card?: any, state: any[] }> {
    const newHistory = [...history, { role: 'user', content: reply }];
    
    // We append a meta prompt to check if we have enough info to generate the card.
    const metaPrompt = `
Review the conversation so far. If you have enough information about the character's background, combat style, and personality (usually takes 2-3 exchanges), generate their final character card.
Stats to generate (MIG, REF, AWA, WIL, TAC, INF) should average around 0 to +2.
If you need more info, just ask the next question in plain text.

If you are ready to finalize, you MUST output ONLY a JSON object in this exact format (do not include any other text):
{
  "is_complete": true,
  "character_card": {
    "name": "Generated Name if none provided",
    "callsign": "Nickname",
    "origin": "Short background description",
    "attributes": { "MIG": 1, "REF": 0, "AWA": 2, "WIL": -1, "TAC": 0, "INF": 1 },
    "inventory": ["Item 1", "Item 2"]
  }
}
If you are NOT ready, just reply normally as the Game Master asking the next question.
`;
    
    try {
      const completion = await openai.chat.completions.create({
        model: "deepseek/deepseek-chat",
        messages: [...newHistory, { role: "system", content: metaPrompt }]
      });

      const responseText = completion.choices[0].message.content || '';
      
      // Try to parse JSON
      try {
        const parsed = JSON.parse(responseText);
        if (parsed.is_complete && parsed.character_card) {
          // Add default required fields
          const finalCard = {
            ...parsed.character_card,
            character_id: crypto.randomUUID(),
            hp_track: ['健康', '健康', '健康', '健康'],
            fear: 0,
            corruption: 0,
            milestones: 0
          };
          return { message: "Character generation complete.", character_card: finalCard, state: newHistory };
        }
      } catch (e) {
        // Not JSON, it's just a conversational reply
      }

      newHistory.push({ role: 'assistant', content: responseText });
      return { message: responseText, state: newHistory };

    } catch (e) {
      console.error(e);
      return { message: "Vox link error.", state: newHistory };
    }
  }
}
