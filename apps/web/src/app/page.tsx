'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();
  const [modules, setModules] = useState<any[]>([]);
  const [selectedModule, setSelectedModule] = useState<string>('');
  const [campaignMode, setCampaignMode] = useState('single');
  const [combatMode, setCombatMode] = useState('narrative');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('http://localhost:3001/api/modules')
      .then(res => res.json())
      .then(data => {
        setModules(data);
        if (data.length > 0) setSelectedModule(data[0].module_id);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load modules:', err);
        setLoading(false);
      });
  }, []);

  const createRoom = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module_id: selectedModule,
          campaign_mode: campaignMode,
          combat_mode: combatMode,
        })
      });
      const data = await res.json();
      if (data.room_id) {
        router.push(`/room/${data.room_id}`);
      }
    } catch (err) {
      console.error('Failed to create room:', err);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-200 flex flex-col items-center p-12 font-sans">
      <div className="w-full max-w-3xl">
        <header className="mb-12 border-b border-amber-900/50 pb-6 text-center">
          <h1 className="text-4xl font-bold text-amber-500 tracking-wider mb-2">WARHAMMER 40K</h1>
          <p className="text-slate-400 text-lg uppercase tracking-widest font-mono">审判庭数据终端 // 角色扮演引擎</p>
        </header>

        <section className="bg-slate-900 border border-slate-800 p-8 shadow-2xl rounded-sm">
          <h2 className="text-2xl font-semibold mb-6 text-slate-100 flex items-center">
            <span className="w-2 h-6 bg-amber-600 mr-3 block"></span>
            创建新会话
          </h2>

          {loading ? (
            <p className="text-slate-500 animate-pulse font-mono">正在加载数据...</p>
          ) : (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2 uppercase tracking-wide">选择模组</label>
                <select 
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded p-3 focus:border-amber-500 outline-none transition-colors"
                  value={selectedModule}
                  onChange={(e) => setSelectedModule(e.target.value)}
                >
                  {modules.map(m => (
                    <option key={m.module_id} value={m.module_id}>
                      {m.title} (人数: {m.recommended_party_size} | {m.difficulty})
                    </option>
                  ))}
                </select>
                {modules.find(m => m.module_id === selectedModule)?.content_warnings?.length > 0 && (
                  <p className="mt-2 text-xs text-red-400/80 font-mono">
                    警告: {modules.find(m => m.module_id === selectedModule)?.content_warnings.join(', ')}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2 uppercase tracking-wide">战役模式</label>
                  <select 
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded p-3 focus:border-amber-500 outline-none"
                    value={campaignMode}
                    onChange={(e) => setCampaignMode(e.target.value)}
                  >
                    <option value="single">短团 (单次会话)</option>
                    <option value="persistent">长团 (持续战役)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2 uppercase tracking-wide">战斗规则</label>
                  <select 
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded p-3 focus:border-amber-500 outline-none"
                    value={combatMode}
                    onChange={(e) => setCombatMode(e.target.value)}
                  >
                    <option value="narrative">叙事 (心智剧场)</option>
                    <option value="tactical" disabled>战术网格 (未解锁)</option>
                  </select>
                </div>
              </div>

              <div className="pt-6 mt-6 border-t border-slate-800 flex justify-end">
                <button 
                  onClick={createRoom}
                  className="bg-amber-700 hover:bg-amber-600 text-white font-bold py-3 px-8 rounded shadow-lg shadow-amber-900/20 transition-all active:scale-95 uppercase tracking-wider"
                >
                  建立连接
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
