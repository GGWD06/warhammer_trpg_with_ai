import fs from 'fs';
import path from 'path';
import { QuestService } from './QuestService';
import assert from 'assert';
import { QuestProgress } from '@ai-trpg/shared';

const testRoomId = 'test_room_' + Date.now();
const testDataDir = path.join(process.cwd(), 'data');
const testFilePath = path.join(testDataDir, `quests_${testRoomId}.json`);

function runTests() {
  console.log('Running QuestService Tests...');
  const questService = new QuestService();

  // Test 1: Load non-existent file should return empty object
  const emptyQuests = questService.loadQuests(testRoomId);
  assert.deepStrictEqual(emptyQuests, {}, 'Should return empty object if file does not exist');
  console.log('Test 1 Passed: Empty load');

  // Test 2: Save and Load consistency
  const sampleQuests: Record<string, QuestProgress> = {
    'main_01': {
      quest_id: 'main_01',
      title: 'Investigate',
      status: 'in_progress',
      progress_description: 'Looking around'
    }
  };
  
  questService.saveQuests(testRoomId, sampleQuests);
  
  const loadedQuests = questService.loadQuests(testRoomId);
  assert.deepStrictEqual(loadedQuests, sampleQuests, 'Loaded quests should match saved quests exactly');
  console.log('Test 2 Passed: Save and Load consistency');

  // Test 3: Atomic write check (Verify file exists and no tmp file left)
  assert.strictEqual(fs.existsSync(testFilePath), true, 'JSON file should exist');
  assert.strictEqual(fs.existsSync(`${testFilePath}.tmp`), false, 'Temp file should be removed');
  console.log('Test 3 Passed: Atomic write files check');

  // Cleanup
  if (fs.existsSync(testFilePath)) {
    fs.unlinkSync(testFilePath);
  }
  console.log('All QuestService tests passed!');
}

runTests();
