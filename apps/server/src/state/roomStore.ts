import fs from 'fs';
import path from 'path';
import { RoomState } from '@ai-trpg/shared';

export interface ServerRoomState extends RoomState {
  history?: { role: 'system' | 'user' | 'assistant', content: string }[];
  summary?: string;
}

const DATA_DIR = path.join(process.cwd(), 'data', 'rooms');

export class RoomStore {
  public memoryRooms: Record<string, ServerRoomState> = {};

  constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private getFilePath(roomId: string): string {
    return path.join(DATA_DIR, `room_${roomId}.json`);
  }

  public loadRoomStates(): void {
    try {
      const files = fs.readdirSync(DATA_DIR);
      let count = 0;
      for (const file of files) {
        if (file.endsWith('.json') && file.startsWith('room_')) {
          const filePath = path.join(DATA_DIR, file);
          const data = fs.readFileSync(filePath, 'utf-8');
          const roomState = JSON.parse(data) as ServerRoomState;
          this.memoryRooms[roomState.room_id] = roomState;
          count++;
        }
      }
      console.log(`Loaded ${count} rooms from storage.`);
    } catch (error) {
      if ((error as any).code !== 'ENOENT') {
        console.error('Failed to load room states:', error);
      }
    }
  }

  public saveRoomState(roomId: string): void {
    const room = this.memoryRooms[roomId];
    if (!room) return;
    
    const filePath = this.getFilePath(roomId);
    const tempPath = `${filePath}.tmp`;
    
    try {
      fs.writeFileSync(tempPath, JSON.stringify(room, null, 2), 'utf-8');
      fs.renameSync(tempPath, filePath); // Atomic write
    } catch (error) {
      console.error(`Failed to save room state for ${roomId}:`, error);
    }
  }

  public getPublicRoomState(roomId: string): RoomState | null {
    const room = this.memoryRooms[roomId];
    if (!room) return null;
    const { history, summary, ...publicRoom } = room;
    return publicRoom;
  }
}

export const roomStore = new RoomStore();
