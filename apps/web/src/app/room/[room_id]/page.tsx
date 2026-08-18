'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import { CharacterCard, RoomState, PlayerIntention } from '@ai-trpg/shared';
import { io, Socket } from 'socket.io-client';

export default function RoomPage() {
  const params = useParams();
  const roomId = params.room_id as string;
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [templates, setTemplates] = useState<CharacterCard[]>([]);
  const [myCharacterId, setMyCharacterId] = useState<string | null>(null);
  
  const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001';
  
  const [socket, setSocket] = useState<Socket | null>(null);
  const [chatLog, setChatLog] = useState<PlayerIntention[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 0. 尝试恢复身份
    const savedChar = localStorage.getItem(`trpg_char_${roomId}`);
    if (savedChar) {
      setMyCharacterId(savedChar);
    }

    // 1. 获取房间状态
    fetch(`${SERVER_URL}/api/rooms/${roomId}`)
      .then(res => res.json())
      .then(data => {
        if (!data.error) setRoomState(data);
      });

    // 2. 获取可选角色模板
    fetch(`${SERVER_URL}/api/templates/characters`)
      .then(res => res.json())
      .then(data => setTemplates(data));

    // 3. 建立 WebSocket 连接
    const newSocket = io(SERVER_URL);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      newSocket.emit('join_room', roomId);
    });

    newSocket.on('room_state_sync', (state: RoomState) => {
      setRoomState(state);
    });

    newSocket.on('chat_broadcast', (msg: PlayerIntention) => {
      setChatLog(prev => [...prev, msg]);
    });

    newSocket.on('system_message', (msg: { content: string }) => {
      setChatLog(prev => [...prev, { 
        message_id: Math.random().toString(), 
        room_id: roomId, 
        character_id: 'sys', 
        character_name: 'SYSTEM', 
        content: msg.content, 
        timestamp: Date.now(), 
        type: 'chat' 
      } as PlayerIntention]);
    });

    newSocket.on('narrative_broadcast', (msg: { content: string, timestamp: number }) => {
      setChatLog(prev => [...prev, { 
        message_id: Math.random().toString(), 
        room_id: roomId, 
        character_id: 'dm', 
        character_name: 'DM (AI)', 
        content: msg.content, 
        timestamp: msg.timestamp, 
        type: 'chat' 
      } as PlayerIntention]);
    });

    newSocket.on('system_state', (state: { processing: boolean }) => {
      setIsProcessing(state.processing);
    });

    return () => {
      newSocket.disconnect();
    };
  }, [roomId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatLog]);

  const joinRoomAs = async (templateId: string) => {
    try {
      const res = await fetch(`${SERVER_URL}/api/rooms/${roomId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ character_template_id: templateId })
      });
      const data = await res.json();
      if (data.success) {
        setMyCharacterId(templateId);
        localStorage.setItem(`trpg_char_${roomId}`, templateId);
        // Refresh room state to see myself
        const stateRes = await fetch(`${SERVER_URL}/api/rooms/${roomId}`);
        const stateData = await stateRes.json();
        setRoomState(stateData);
      } else {
        alert(data.error);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const sendMessage = () => {
    if (!inputValue.trim() || !socket || !myCharacterId || !roomState) return;

    const char = roomState.characters[myCharacterId];
    const intention: PlayerIntention = {
      message_id: Math.random().toString(36).substring(7),
      room_id: roomId,
      character_id: myCharacterId,
      character_name: char.name,
      content: inputValue,
      timestamp: Date.now(),
      type: 'action'
    };

    socket.emit('player_intention', intention);
    setIsProcessing(true);
    setInputValue('');
  };

  if (!roomState) return <div className="p-8 text-white font-mono animate-pulse">Establishing Vox-Link to Room {roomId}...</div>;

  const isPlayerReady = myCharacterId !== null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col font-sans selection:bg-amber-900/50 selection:text-amber-200">
      <header className="bg-slate-900 border-b border-amber-900/30 p-4 flex justify-between items-center shadow-lg shadow-black/50">
        <h1 className="text-xl font-bold text-amber-500 tracking-wider">ROOM: {roomId}</h1>
        <span className="text-sm font-mono text-amber-700/80 uppercase tracking-widest bg-amber-950/30 px-3 py-1 rounded">Zone: {roomState.current_scene}</span>
      </header>

      <main className="flex-1 p-6 flex justify-center items-start">
        {!isPlayerReady ? (
          <div className="w-full max-w-4xl">
            <h2 className="text-2xl mb-8 text-amber-600 border-b border-amber-900/30 pb-3 flex items-center">
              <span className="w-2 h-6 bg-amber-600 mr-3 block"></span>
              Awaiting Operative Assignment
            </h2>
            <div className="grid grid-cols-2 gap-6">
              {templates.map(tpl => {
                const isTaken = Object.values(roomState.characters).some(c => c.character_id === tpl.character_id);
                return (
                  <div 
                    key={tpl.character_id} 
                    className={`group p-6 border rounded shadow-lg transition-all duration-300 ${isTaken ? 'border-slate-800 opacity-40 bg-slate-900/30 cursor-not-allowed' : 'border-slate-700 bg-slate-900/80 hover:border-amber-500/80 hover:bg-slate-900 cursor-pointer hover:-translate-y-1'}`} 
                    onClick={() => !isTaken && joinRoomAs(tpl.character_id)}
                  >
                    <h3 className="text-xl font-bold text-amber-400 mb-1">{tpl.name} <span className="text-slate-500 text-sm font-mono tracking-widest font-normal ml-2">"{tpl.callsign}"</span></h3>
                    <p className="text-sm text-slate-400 mb-5 pb-4 border-b border-slate-800">{tpl.origin}</p>
                    
                    <div className="grid grid-cols-3 gap-2 text-xs font-mono mb-6">
                      <span className="bg-slate-950/50 px-2 py-1.5 rounded border border-slate-800 text-center">MIG: {tpl.attributes.MIG}</span>
                      <span className="bg-slate-950/50 px-2 py-1.5 rounded border border-slate-800 text-center">REF: {tpl.attributes.REF}</span>
                      <span className="bg-slate-950/50 px-2 py-1.5 rounded border border-slate-800 text-center text-amber-600">WIL: {tpl.attributes.WIL}</span>
                    </div>
                    
                    {isTaken ? (
                      <span className="text-red-900 text-sm font-bold uppercase tracking-widest block text-center bg-red-950/20 py-2 rounded">Assigned</span>
                    ) : (
                      <span className="text-amber-700 text-sm uppercase tracking-widest group-hover:text-amber-400 block text-center transition-colors">Select Operative →</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="w-full max-w-6xl flex gap-6 h-[calc(100vh-8rem)]">
            {/* 左侧角色卡简栏 */}
            <aside className="w-80 bg-slate-900/80 border border-slate-800 p-5 rounded shadow-xl flex flex-col overflow-y-auto">
              <h3 className="text-sm font-bold text-amber-600 border-b border-amber-900/30 pb-3 mb-4 tracking-widest uppercase flex items-center">
                 <span className="w-1.5 h-4 bg-amber-600 mr-2 block"></span>
                 Operative Status
              </h3>
              
              {roomState.characters[myCharacterId] && (
                <div className="flex-1">
                  <div className="text-2xl text-slate-100 font-serif mb-1">{roomState.characters[myCharacterId].name}</div>
                  <div className="text-xs text-amber-700/80 uppercase tracking-wider mb-6 pb-4 border-b border-slate-800">{roomState.characters[myCharacterId].origin}</div>
                  
                  <div className="grid grid-cols-2 gap-3 text-sm font-mono mb-8">
                    <div className="bg-slate-950 p-3 border border-slate-800 rounded flex flex-col items-center justify-center relative overflow-hidden">
                       <span className="text-[10px] text-slate-500 mb-1">MIG</span>
                       <span className="text-xl text-slate-300">{roomState.characters[myCharacterId].attributes.MIG}</span>
                    </div>
                    <div className="bg-slate-950 p-3 border border-slate-800 rounded flex flex-col items-center justify-center relative overflow-hidden">
                       <span className="text-[10px] text-slate-500 mb-1">REF</span>
                       <span className="text-xl text-slate-300">{roomState.characters[myCharacterId].attributes.REF}</span>
                    </div>
                    <div className="bg-slate-950 p-3 border border-slate-800 rounded flex flex-col items-center justify-center relative overflow-hidden">
                       <span className="text-[10px] text-slate-500 mb-1">AWA</span>
                       <span className="text-xl text-slate-300">{roomState.characters[myCharacterId].attributes.AWA}</span>
                    </div>
                    <div className="bg-slate-950 p-3 border border-slate-800 rounded flex flex-col items-center justify-center relative overflow-hidden">
                       <span className="text-[10px] text-amber-700/80 mb-1">WIL</span>
                       <span className="text-xl text-amber-500">{roomState.characters[myCharacterId].attributes.WIL}</span>
                    </div>
                  </div>
                  
                  <div className="mb-6">
                    <div className="flex justify-between items-center mb-2">
                       <h4 className="text-xs text-slate-500 uppercase tracking-widest">Trauma Track</h4>
                       <span className="text-[10px] text-slate-600 font-mono">0/{roomState.characters[myCharacterId].hp_track.length}</span>
                    </div>
                    <div className="flex gap-1.5 h-3">
                      {roomState.characters[myCharacterId].hp_track.map((status, i) => (
                        <div key={i} className={`flex-1 rounded-sm ${status === '健康' ? 'bg-emerald-800/80 border border-emerald-900' : status === '轻伤' ? 'bg-amber-600 border border-amber-700' : 'bg-red-900 border border-red-800'}`}></div>
                      ))}
                    </div>
                    
                    <div className="flex justify-between items-center mb-2 mt-4">
                       <h4 className="text-xs text-slate-500 uppercase tracking-widest">Fear Level</h4>
                       <span className="text-[10px] text-slate-600 font-mono">{roomState.characters[myCharacterId].fear || 0}/3</span>
                    </div>
                    <div className="flex gap-1.5 h-3">
                      {[1, 2, 3].map((level) => (
                        <div key={level} className={`flex-1 rounded-sm ${(roomState.characters[myCharacterId].fear || 0) >= level ? 'bg-purple-600 border border-purple-500 shadow-[0_0_8px_rgba(147,51,234,0.5)]' : 'bg-slate-900 border border-slate-800'}`}></div>
                      ))}
                    </div>

                    <div className="flex justify-between items-center mb-2 mt-4">
                       <h4 className="text-xs text-slate-500 uppercase tracking-widest">Corruption</h4>
                       <span className="text-[10px] text-red-500 font-mono font-bold">{roomState.characters[myCharacterId].corruption || 0}</span>
                    </div>
                  </div>

                  <div className="mb-6">
                     <h4 className="text-xs text-slate-500 uppercase tracking-widest mb-3 border-b border-slate-800 pb-2">Inventory</h4>
                     <ul className="space-y-2">
                       {roomState.characters[myCharacterId].inventory.map((item, idx) => (
                          <li key={idx} className="text-xs text-slate-400 bg-slate-950/50 p-2 rounded border border-slate-800 font-mono">
                             {item}
                          </li>
                       ))}
                     </ul>
                  </div>

                  {roomState.quests && Object.keys(roomState.quests).length > 0 && (
                    <div className="mb-6">
                      <h4 className="text-xs text-slate-500 uppercase tracking-widest mb-3 border-b border-slate-800 pb-2">Active Directives</h4>
                      <ul className="space-y-3">
                        {Object.values(roomState.quests).map((quest, idx) => (
                           <li key={idx} className="bg-slate-950/50 p-3 rounded border border-slate-800 relative overflow-hidden">
                              <div className={`absolute left-0 top-0 bottom-0 w-1 ${quest.status === 'completed' ? 'bg-emerald-600' : quest.status === 'failed' ? 'bg-red-900' : 'bg-amber-600'}`}></div>
                              <div className="pl-2">
                                <div className="flex justify-between items-start mb-1">
                                  <h5 className="text-sm font-bold text-slate-300">{quest.title}</h5>
                                  <span className={`text-[10px] uppercase tracking-wider font-mono ${quest.status === 'completed' ? 'text-emerald-500' : quest.status === 'failed' ? 'text-red-700' : 'text-amber-500'}`}>{quest.status.replace('_', ' ')}</span>
                                </div>
                                <p className="text-xs text-slate-400 font-mono leading-relaxed">{quest.progress_description}</p>
                              </div>
                           </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </aside>

            {/* 右侧聊天区 */}
            <section className="flex-1 bg-slate-900/80 border border-slate-800 rounded shadow-xl flex flex-col overflow-hidden">
              <div className="flex-1 p-6 overflow-y-auto font-serif text-slate-300 flex flex-col">
                 <div className="text-center mb-8">
                   <p className="inline-block text-amber-700/60 text-xs tracking-[0.2em] uppercase font-mono border-b border-amber-900/30 pb-2">
                     -- Encrypted Comm Link Established --
                   </p>
                 </div>
                 {chatLog.map((msg, i) => {
                    const isMine = msg.character_id === myCharacterId;
                    const isDM = msg.character_name === 'DM (AI)';
                    const isSystem = msg.character_name === 'SYSTEM' || msg.character_name === 'DICE_SYSTEM';

                    return (
                      <div key={i} className={`mb-4 flex ${isMine ? 'justify-end' : 'justify-start'} ${isDM ? 'w-full' : ''}`}>
                        <div className={`
                          p-3 rounded max-w-[85%] 
                          ${isMine ? 'bg-amber-900/20 border border-amber-700/50' : ''}
                          ${isDM ? 'w-full max-w-full bg-slate-950 border-l-2 border-red-800 p-5 shadow-lg shadow-red-900/10' : ''}
                          ${(!isMine && !isDM && !isSystem) ? 'bg-slate-800/50 border border-slate-700' : ''}
                          ${isSystem ? 'bg-transparent border-none p-1 text-slate-500 font-mono text-xs' : ''}
                        `}>
                          <div className={`font-bold text-xs mb-1.5 ${isMine ? 'text-amber-500 text-right' : isDM ? 'text-red-500 uppercase tracking-widest' : isSystem ? 'text-slate-500' : 'text-slate-400'}`}>
                            {msg.character_name}
                          </div>
                          <div className={`${isSystem ? 'text-slate-500' : isDM ? 'text-slate-300 leading-loose' : 'text-slate-200'}`}>
                            {msg.content.split('\n').map((line, idx) => <span key={idx}>{line}<br/></span>)}
                          </div>
                        </div>
                      </div>
                    );
                 })}
                 {isProcessing && (
                    <div className="flex justify-start mb-4">
                       <div className="p-3 bg-slate-950 border border-slate-800 rounded flex items-center space-x-3">
                          <div className="text-amber-600 font-bold text-xs uppercase tracking-widest">SYSTEM</div>
                          <div className="flex space-x-1">
                             <div className="w-1.5 h-1.5 bg-amber-600 rounded-full animate-pulse"></div>
                             <div className="w-1.5 h-1.5 bg-amber-600 rounded-full animate-pulse delay-75"></div>
                             <div className="w-1.5 h-1.5 bg-amber-600 rounded-full animate-pulse delay-150"></div>
                          </div>
                          <span className="text-xs font-mono text-slate-500 tracking-widest uppercase ml-2">Establishing Vox-Link to Machine Spirit...</span>
                       </div>
                    </div>
                 )}
                 <div ref={chatEndRef} />
              </div>
              
              <div className="p-4 bg-slate-950 border-t border-slate-800">
                <div className="relative">
                  <input 
                    type="text" 
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') sendMessage(); }}
                    placeholder="Declare your action or transmit message..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-sm py-4 pl-4 pr-12 text-slate-200 outline-none focus:border-amber-600 transition-colors placeholder-slate-600 font-mono text-sm shadow-inner"
                  />
                  <button onClick={sendMessage} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-amber-500 transition-colors">
                     <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                  </button>
                </div>
                <div className="mt-2 text-right">
                   <span className="text-[10px] text-slate-600 font-mono uppercase tracking-wider">Shift+Enter for newline / Enter to send</span>
                </div>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
