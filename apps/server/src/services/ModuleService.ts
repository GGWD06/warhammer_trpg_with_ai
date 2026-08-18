import fs from 'fs';
import path from 'path';

export interface ModuleRawData {
  module_id: string;
  title: string;
  recommended_party_size: string;
  difficulty: string;
  content_warnings: string[];
  full_content: string; // MVP 阶段将整个 Markdown 文本留给 Prompt 使用
  predefined_quests?: any[];
}

export class ModuleService {
  private modules: Map<string, ModuleRawData> = new Map();

  constructor() {
    this.loadModules();
  }

  private loadModules() {
    try {
      // 从根目录直接读取模组文件
      // 注意 cwd 是在 apps/server
      const modulePath = path.resolve(process.cwd(), '../../战役模组-沉船的低语.md');
      
      if (fs.existsSync(modulePath)) {
        const content = fs.readFileSync(modulePath, 'utf-8');
        // 提取 JSON 块
        const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
        let metadata: any = {};
        if (jsonMatch && jsonMatch[1]) {
          metadata = JSON.parse(jsonMatch[1]);
        }

        const moduleData: ModuleRawData = {
          module_id: metadata.module_id || 'm_whispers_of_the_derelict',
          title: metadata.title || '沉船的低语',
          recommended_party_size: metadata.recommended_party_size || '3-4',
          difficulty: metadata.difficulty || 'hardcore',
          content_warnings: metadata.content_warnings || [],
          full_content: content, // 保留所有文本用于 Prompt
          predefined_quests: metadata.predefined_quests || []
        };

        this.modules.set(moduleData.module_id, moduleData);
        console.log(`[ModuleService] Loaded: ${moduleData.title} (${moduleData.module_id})`);
      } else {
        console.warn(`[ModuleService] Warning: Module file not found at ${modulePath}`);
      }
    } catch (err) {
      console.error('[ModuleService] Failed to load modules:', err);
    }
  }

  public getModule(moduleId: string): ModuleRawData | undefined {
    return this.modules.get(moduleId);
  }

  public getAllModules(): ModuleRawData[] {
    return Array.from(this.modules.values());
  }
}

export const moduleService = new ModuleService();
