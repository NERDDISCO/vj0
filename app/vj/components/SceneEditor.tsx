'use client';

import { useState, useRef, useCallback } from 'react';
import { Search, Plus, Trash2, Settings, Zap } from 'lucide-react';

interface SceneElement {
  id: string;
  type: 'circle' | 'rectangle';
  x: number;
  y: number;
  width: number;
  height: number;
  properties: {
    fillColor: string;
    strokeColor: string;
    rotation: number;
    opacity: number;
  };
  audioBindings: Array<{
    property: string;
    audioFeature: string;
    formula: string;
    presetId: string;
  }>;
}

interface Scene {
  id: string;
  name: string;
  prompt: string;
  elements: SceneElement[];
}

interface AudioPreset {
  id: string;
  name: string;
  formula: string;
  audioFeature: 'rms' | 'peak' | 'energyLow' | 'energyMid' | 'energyHigh' | 'centroid';
  description: string;
}

const SCENES: Scene[] = [
  {
    id: 'scene-1',
    name: 'Untitled Scene',
    prompt: 'A responsive visual landscape',
    elements: [
      {
        id: 'elem-1',
        type: 'circle',
        x: 100,
        y: 150,
        width: 80,
        height: 80,
        properties: {
          fillColor: '#00ffff',
          strokeColor: '#ffffff',
          rotation: 0,
          opacity: 0.9,
        },
        audioBindings: [
          {
            property: 'width',
            audioFeature: 'rms',
            formula: 'rms * 200 + 40',
            presetId: 'preset-1',
          },
        ],
      },
      {
        id: 'elem-2',
        type: 'rectangle',
        x: 300,
        y: 200,
        width: 120,
        height: 60,
        properties: {
          fillColor: '#ff00ff',
          strokeColor: '#00ff00',
          rotation: 0,
          opacity: 0.7,
        },
        audioBindings: [
          {
            property: 'rotation',
            audioFeature: 'centroid',
            formula: 'centroid * 360',
            presetId: 'preset-2',
          },
        ],
      },
    ],
  },
];

const AUDIO_PRESETS: AudioPreset[] = [
  {
    id: 'preset-1',
    name: 'RMS Scale',
    audioFeature: 'rms',
    formula: 'clamp(rms, 0, 1)',
    description: 'Direct RMS volume to size',
  },
  {
    id: 'preset-2',
    name: 'Centroid Rotate',
    audioFeature: 'centroid',
    formula: 'centroid * 360',
    description: 'Spectral center drives rotation',
  },
  {
    id: 'preset-3',
    name: 'Energy Pulse',
    audioFeature: 'energyMid',
    formula: 'Math.sin(energyMid * Math.PI) * 2',
    description: 'Mid-band energy with sine curve',
  },
];

export default function SceneEditor() {
  const [scenes, setScenes] = useState<Scene[]>(SCENES);
  const [activeSceneId, setActiveSceneId] = useState(SCENES[0].id);
  const [audioPresets, setAudioPresets] = useState<AudioPreset[]>(AUDIO_PRESETS);
  const [selectedElement, setSelectedElement] = useState<string | null>(null);
  const [showAudioPresetPanel, setShowAudioPresetPanel] = useState(true);
  const [presetSearch, setPresetSearch] = useState('');
  const [newPresetForm, setNewPresetForm] = useState({
    name: '',
    audioFeature: 'rms' as const,
    formula: '',
  });
  const inputCanvasRef = useRef<HTMLDivElement>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement>(null);

  const activeScene = scenes.find((s) => s.id === activeSceneId);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Single click to select element
      const rect = inputCanvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Check if clicking on an element
      const element = activeScene?.elements.find(
        (el) =>
          x >= el.x &&
          x <= el.x + el.width &&
          y >= el.y &&
          y <= el.y + el.height
      );

      if (element) {
        setSelectedElement(element.id);
      } else {
        setSelectedElement(null);
      }
    },
    [activeScene]
  );

  const handleCanvasDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Double-click to add element
      if (!activeScene) return;

      const rect = inputCanvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const newElement: SceneElement = {
        id: `elem-${Date.now()}`,
        type: Math.random() > 0.5 ? 'circle' : 'rectangle',
        x,
        y,
        width: 80,
        height: 80,
        properties: {
          fillColor: '#00ffff',
          strokeColor: '#ffffff',
          rotation: 0,
          opacity: 0.9,
        },
        audioBindings: [],
      };

      setScenes(
        scenes.map((s) =>
          s.id === activeSceneId
            ? { ...s, elements: [...s.elements, newElement] }
            : s
        )
      );
      setSelectedElement(newElement.id);
    },
    [activeScene, activeSceneId, scenes]
  );

  const handleDeleteElement = useCallback(() => {
    if (!selectedElement || !activeScene) return;

    setScenes(
      scenes.map((s) =>
        s.id === activeSceneId
          ? {
              ...s,
              elements: s.elements.filter((el) => el.id !== selectedElement),
            }
          : s
      )
    );
    setSelectedElement(null);
  }, [selectedElement, activeScene, activeSceneId, scenes]);

  const handleAddPreset = useCallback(() => {
    if (!newPresetForm.name || !newPresetForm.formula) return;

    const preset: AudioPreset = {
      id: `preset-${Date.now()}`,
      name: newPresetForm.name,
      audioFeature: newPresetForm.audioFeature,
      formula: newPresetForm.formula,
      description: '',
    };

    setAudioPresets([...audioPresets, preset]);
    setNewPresetForm({ name: '', audioFeature: 'rms', formula: '' });
  }, [newPresetForm, audioPresets]);

  const filteredPresets = audioPresets.filter(
    (p) =>
      p.name.toLowerCase().includes(presetSearch.toLowerCase()) ||
      p.formula.toLowerCase().includes(presetSearch.toLowerCase())
  );

  return (
    <div className="h-screen w-full bg-[#0a0e27] text-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-[#1a2451] bg-[#0f1335] px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Scene Editor
            </h1>
            <div className="h-8 w-px bg-[#1a2451]" />

            {/* Scene Tabs */}
            <div className="flex gap-2">
              {scenes.map((scene) => (
                <button
                  key={scene.id}
                  onClick={() => {
                    setActiveSceneId(scene.id);
                    setSelectedElement(null);
                  }}
                  className={`px-3 py-1 rounded text-sm font-medium transition ${
                    activeSceneId === scene.id
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'text-[#888] hover:text-white hover:bg-[#1a2451]'
                  }`}
                >
                  {scene.name}
                </button>
              ))}
              <button className="px-3 py-1 text-[#666] hover:text-cyan-300 transition">
                <Plus size={16} />
              </button>
            </div>
          </div>

          <button
            onClick={() => setShowAudioPresetPanel(!showAudioPresetPanel)}
            className="flex items-center gap-2 px-4 py-2 rounded bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 transition border border-cyan-500/30"
          >
            <Zap size={16} />
            Audio Presets
          </button>
        </div>

        {/* Scene Prompt Input */}
        {activeScene && (
          <div className="mt-4">
            <label className="text-xs text-[#888] uppercase tracking-wider">
              Scene Prompt
            </label>
            <input
              type="text"
              value={activeScene.prompt}
              onChange={(e) =>
                setScenes(
                  scenes.map((s) =>
                    s.id === activeSceneId ? { ...s, prompt: e.target.value } : s
                  )
                )
              }
              className="mt-1 w-full bg-[#1a2451] border border-[#2a3561] rounded px-3 py-2 text-sm text-white placeholder-[#666] focus:outline-none focus:border-cyan-500/50"
              placeholder="Describe what you want to create..."
            />
          </div>
        )}
      </div>

      {/* Main Canvas Area */}
      <div className="flex-1 flex gap-4 p-6 overflow-hidden">
        {/* Input Column */}
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          <div className="flex-1 flex flex-col">
            <label className="text-xs text-[#888] uppercase tracking-wider mb-2">
              Composition Canvas
            </label>
            <div
              ref={inputCanvasRef}
              onClick={handleCanvasClick}
              onDoubleClick={handleCanvasDoubleClick}
              className="flex-1 relative rounded-lg bg-[#0f1335] border-2 border-[#1a2451] cursor-crosshair overflow-hidden group"
            >
              {/* Canvas Grid Background */}
              <div className="absolute inset-0 opacity-5">
                <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <pattern
                      id="grid"
                      width="40"
                      height="40"
                      patternUnits="userSpaceOnUse"
                    >
                      <path
                        d="M 40 0 L 0 0 0 40"
                        fill="none"
                        stroke="white"
                        strokeWidth="0.5"
                      />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#grid)" />
                </svg>
              </div>

              {/* Elements */}
              {activeScene?.elements.map((element) => (
                <div
                  key={element.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedElement(element.id);
                  }}
                  className={`absolute transition-all ${
                    selectedElement === element.id ? 'ring-2 ring-cyan-400' : ''
                  }`}
                  style={{
                    left: `${element.x}px`,
                    top: `${element.y}px`,
                    width: `${element.width}px`,
                    height: `${element.height}px`,
                  }}
                >
                  {element.type === 'circle' ? (
                    <svg
                      width={element.width}
                      height={element.height}
                      className="drop-shadow-lg"
                    >
                      <circle
                        cx={element.width / 2}
                        cy={element.height / 2}
                        r={Math.min(element.width, element.height) / 2}
                        fill={element.properties.fillColor}
                        stroke={element.properties.strokeColor}
                        strokeWidth="2"
                        opacity={element.properties.opacity}
                      />
                    </svg>
                  ) : (
                    <div
                      style={{
                        width: '100%',
                        height: '100%',
                        backgroundColor: element.properties.fillColor,
                        border: `2px solid ${element.properties.strokeColor}`,
                        opacity: element.properties.opacity,
                        transform: `rotate(${element.properties.rotation}deg)`,
                      }}
                      className="drop-shadow-lg"
                    />
                  )}
                </div>
              ))}

              {/* Double-click hint */}
              {!activeScene?.elements.length && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-center">
                    <p className="text-[#666] text-sm mb-2">
                      Double-click to add an element
                    </p>
                    <p className="text-[#444] text-xs">
                      Circles • Rectangles • Audio-reactive
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Element Inspector */}
          {selectedElement && activeScene && (
            <div className="bg-[#0f1335] border border-[#1a2451] rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-cyan-300">
                  Element Inspector
                </h3>
                <button
                  onClick={handleDeleteElement}
                  className="text-[#666] hover:text-red-400 transition"
                >
                  <Trash2 size={16} />
                </button>
              </div>

              {(() => {
                const elem = activeScene.elements.find(
                  (e) => e.id === selectedElement
                );
                if (!elem) return null;

                return (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-[#888] uppercase tracking-wider">
                        Type
                      </label>
                      <p className="text-sm text-white mt-1 capitalize">
                        {elem.type}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-[#888] uppercase tracking-wider">
                          Width
                        </label>
                        <input
                          type="number"
                          value={elem.width}
                          onChange={(e) => {
                            // Handle width change
                          }}
                          className="mt-1 w-full bg-[#1a2451] border border-[#2a3561] rounded px-2 py-1 text-sm text-white"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-[#888] uppercase tracking-wider">
                          Height
                        </label>
                        <input
                          type="number"
                          value={elem.height}
                          onChange={(e) => {
                            // Handle height change
                          }}
                          className="mt-1 w-full bg-[#1a2451] border border-[#2a3561] rounded px-2 py-1 text-sm text-white"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-[#888] uppercase tracking-wider">
                        Fill Color
                      </label>
                      <div className="flex gap-2 mt-1">
                        <input
                          type="color"
                          value={elem.properties.fillColor}
                          className="h-8 w-12 rounded cursor-pointer"
                        />
                        <input
                          type="text"
                          value={elem.properties.fillColor}
                          className="flex-1 bg-[#1a2451] border border-[#2a3561] rounded px-2 py-1 text-sm text-white font-mono"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-[#888] uppercase tracking-wider">
                        Audio Bindings ({elem.audioBindings.length})
                      </label>
                      <p className="text-xs text-[#666] mt-1">
                        Click a preset below to bind it to this element
                      </p>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* Output Column */}
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          <div className="flex-1 flex flex-col">
            <label className="text-xs text-[#888] uppercase tracking-wider mb-2">
              Output Canvas
            </label>
            <canvas
              ref={outputCanvasRef}
              className="flex-1 rounded-lg bg-black border-2 border-[#1a2451] cursor-default"
            />
          </div>

          {/* Output Controls */}
          <div className="bg-[#0f1335] border border-[#1a2451] rounded-lg p-4">
            <h3 className="text-xs font-bold text-[#888] uppercase tracking-wider mb-3">
              Output Settings
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[#888] uppercase tracking-wider">
                  Resolution
                </label>
                <select className="mt-1 w-full bg-[#1a2451] border border-[#2a3561] rounded px-3 py-2 text-sm text-white">
                  <option>1920 × 1080</option>
                  <option>1280 × 720</option>
                  <option>640 × 480</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-[#888] uppercase tracking-wider">
                  FPS
                </label>
                <select className="mt-1 w-full bg-[#1a2451] border border-[#2a3561] rounded px-3 py-2 text-sm text-white">
                  <option>60</option>
                  <option>30</option>
                  <option>24</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Audio Preset Panel - Floating */}
      {showAudioPresetPanel && (
        <div className="fixed bottom-6 right-6 w-96 max-h-96 bg-[#0f1335] border-2 border-[#1a2451] rounded-lg shadow-2xl flex flex-col overflow-hidden z-50">
          <div className="border-b border-[#1a2451] bg-[#0a0e27] px-4 py-3">
            <h2 className="text-sm font-bold text-cyan-300 mb-3">
              Global Audio Presets
            </h2>

            {/* Preset Search */}
            <div className="relative">
              <Search
                size={16}
                className="absolute left-2 top-2.5 text-[#666]"
              />
              <input
                type="text"
                placeholder="Search presets..."
                value={presetSearch}
                onChange={(e) => setPresetSearch(e.target.value)}
                className="w-full bg-[#1a2451] border border-[#2a3561] rounded pl-8 pr-3 py-2 text-xs text-white placeholder-[#666] focus:outline-none focus:border-cyan-500/50"
              />
            </div>
          </div>

          {/* Preset List */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {filteredPresets.length > 0 ? (
              filteredPresets.map((preset) => (
                <div
                  key={preset.id}
                  className="p-2 rounded bg-[#1a2451] hover:bg-[#2a3561] cursor-pointer transition group"
                >
                  <p className="text-xs font-medium text-cyan-300 group-hover:text-cyan-200">
                    {preset.name}
                  </p>
                  <p className="text-xs text-[#666] font-mono mt-1">
                    {preset.formula}
                  </p>
                  <p className="text-xs text-[#555] mt-1">{preset.description}</p>
                </div>
              ))
            ) : (
              <p className="text-xs text-[#666] text-center py-4">
                No presets found
              </p>
            )}
          </div>

          {/* Add Preset Form */}
          <div className="border-t border-[#1a2451] bg-[#0a0e27] px-4 py-3">
            <h3 className="text-xs font-bold text-[#888] uppercase tracking-wider mb-2">
              Create Preset
            </h3>
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Name..."
                value={newPresetForm.name}
                onChange={(e) =>
                  setNewPresetForm({
                    ...newPresetForm,
                    name: e.target.value,
                  })
                }
                className="w-full bg-[#1a2451] border border-[#2a3561] rounded px-2 py-1 text-xs text-white placeholder-[#666] focus:outline-none focus:border-cyan-500/50"
              />

              <select
                value={newPresetForm.audioFeature}
                onChange={(e) =>
                  setNewPresetForm({
                    ...newPresetForm,
                    audioFeature: e.target.value as any,
                  })
                }
                className="w-full bg-[#1a2451] border border-[#2a3561] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-cyan-500/50"
              >
                <option value="rms">RMS (Volume)</option>
                <option value="peak">Peak</option>
                <option value="energyLow">Energy Low</option>
                <option value="energyMid">Energy Mid</option>
                <option value="energyHigh">Energy High</option>
                <option value="centroid">Centroid</option>
              </select>

              <input
                type="text"
                placeholder="Formula (e.g., rms * 200)"
                value={newPresetForm.formula}
                onChange={(e) =>
                  setNewPresetForm({
                    ...newPresetForm,
                    formula: e.target.value,
                  })
                }
                className="w-full bg-[#1a2451] border border-[#2a3561] rounded px-2 py-1 text-xs text-white placeholder-[#666] font-mono focus:outline-none focus:border-cyan-500/50"
              />

              <button
                onClick={handleAddPreset}
                className="w-full px-3 py-2 rounded bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 transition border border-cyan-500/30 text-xs font-medium"
              >
                Add Preset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
