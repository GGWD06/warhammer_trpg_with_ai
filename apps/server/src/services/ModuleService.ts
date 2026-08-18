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
      const modulesDir = path.resolve(process.cwd(), 'data/modules');
      
      if (!fs.existsSync(modulesDir)) {
        console.warn(`[ModuleService] Warning: Modules directory not found at ${modulesDir}`);
        return;
      }

      const files = fs.readdirSync(modulesDir);
      let loadedCount = 0;

      for (const file of files) {
        if (!file.endsWith('.md')) continue;

        const modulePath = path.join(modulesDir, file);
        const content = fs.readFileSync(modulePath, 'utf-8');
        // 提取 JSON 块
        const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
        let metadata: any = {};
        if (jsonMatch && jsonMatch[1]) {
          try {
            metadata = JSON.parse(jsonMatch[1]);
          } catch (e) {
            console.error(`[ModuleService] Failed to parse JSON in ${file}:`, e);
            continue;
          }
        }

        const moduleData: ModuleRawData = {
          module_id: metadata.module_id || `m_${file.replace('.md', '')}`,
          title: metadata.title || file.replace('.md', ''),
          recommended_party_size: metadata.recommended_party_size || '3-4',
          difficulty: metadata.difficulty || 'hardcore',
          content_warnings: metadata.content_warnings || [],
          full_content: content,
          predefined_quests: metadata.predefined_quests || []
        };

        this.modules.set(moduleData.module_id, moduleData);
        console.log(`[ModuleService] Loaded: ${moduleData.title} (${moduleData.module_id}) from ${file}`);
        loadedCount++;
      }
      console.log(`[ModuleService] Total modules loaded: ${loadedCount}`);
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
