import fs from 'fs';
import path from 'path';
import { QuestProgress } from '@ai-trpg/shared';

const DATA_DIR = path.join(process.cwd(), 'data');

export class QuestService {
  constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private getFilePath(roomId: string): string {
    return path.join(DATA_DIR, `quests_${roomId}.json`);
  }

  public loadQuests(roomId: string): Record<string, QuestProgress> {
    const filePath = this.getFilePath(roomId);
    if (!fs.existsSync(filePath)) {
      return {};
    }
    
    try {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    } catch (err) {
      console.error(`Failed to load quests for room ${roomId}:`, err);
      return {};
    }
  }

  public saveQuests(roomId: string, quests: Record<string, QuestProgress>): void {
    const filePath = this.getFilePath(roomId);
    const tempPath = `${filePath}.tmp`;
    
    try {
      fs.writeFileSync(tempPath, JSON.stringify(quests, null, 2), 'utf-8');
      fs.renameSync(tempPath, filePath); // Atomic write
    } catch (err) {
      console.error(`Failed to save quests for room ${roomId}:`, err);
    }
  }
}

export const questService = new QuestService();
