# Scene Editor Redesign

## Aesthetic Direction: Modern Darkroom meets DJ Booth

The interface is designed as a **professional studio control system** with immediate visual feedback. Dark, high-contrast foundation (near-black #0a0e27, charcoal #0f1335) with bright reactive accents (cyan, lime, magenta) that mimic stage lighting and audio visualizations.

### Visual Hierarchy
- **Hero**: Input & output canvases (equal size, centered, maximize space)
- **Primary Controls**: Scene switcher (top-left tabs), Audio preset panel (dockable, bottom-right)
- **Secondary**: Element inspector (contextual, appears when element selected)
- **Supporting**: Output settings (below output canvas)

### Key Design Decisions

1. **Side-by-side layout**: Input (composition) on left, output (visual result) on right
   - Allows VJs to see composition and final output simultaneously
   - Both canvases are equal height and width (responsive to window size)
   - Centered with generous padding; scales well from 1080p to 4K screens

2. **Double-click to compose**: No modal dialogs, no menu trees
   - Click to select element, double-click in empty space to add
   - Instant visual feedback with selection rings (cyan glow)
   - Drag-to-move and property tweaks come next

3. **Global audio presets**: Reusable across all scenes
   - Not scene-specific because formulas are generic
   - Dockable floating panel (like your lighting controls)
   - Built-in search/filter for quick discovery
   - Inline formula editor—no separate dialog

4. **Audio binding UI**: Properties can bind to audio features
   - Selected element shows "Audio Bindings" count
   - Click a preset to bind it to element property
   - Formula shows how audio feature maps to property value (e.g., `rms * 200 + 40`)

5. **Typography & Color**
   - Sans-serif (system fonts for performance): bold for scene names, clean for labels
   - Monospace for formulas & code (clarity for technical expressions)
   - Color coding: cyan for interaction, magenta/lime for element highlights
   - Glow effects on canvases (border glow, drop shadows on elements)

## Architecture

### Data Model

```typescript
Scene {
  id: string;
  name: string;
  prompt: string;  // AI-generated or user-written
  elements: SceneElement[];
}

SceneElement {
  id: string;
  type: 'circle' | 'rectangle';  // Extensible
  x, y: number;  // Canvas position
  width, height: number;
  properties: {
    fillColor: string;
    strokeColor: string;
    rotation: number;
    opacity: number;
  };
  audioBindings: AudioBinding[];
}

AudioBinding {
  property: 'width' | 'height' | 'rotation' | 'opacity' | ...;
  audioFeature: 'rms' | 'peak' | 'energyLow' | 'energyMid' | 'energyHigh' | 'centroid';
  formula: string;  // e.g., "rms * 200 + 40"
  presetId: string;  // Links to AudioPreset
}

AudioPreset {
  id: string;
  name: string;
  audioFeature: 'rms' | 'peak' | 'energyLow' | ...;
  formula: string;  // Template: "rms * 2", becomes "element.width = eval(formula)"
  description: string;
}
```

### State Management

**Browser-only vs Backend**: For now, this is **browser-only** using Zustand + localStorage:
- Scenes stored in localStorage (simple JSON serialization)
- Audio presets stored globally (Zustand store)
- Real-time rendering on canvas (no server needed for composition)
- When user performs, WebRTC uploads frames to AI worker (existing flow)

**Future**: If you want:
- Cloud save of scenes/presets → add backend API
- Sharing scenes with other VJs → backend + unique URLs
- AI scene generation → hook to your FLUX worker
- Then add server persistence, but start with browser storage

### Integration with Existing VJApp

The `SceneEditor` replaces the current static input panel. Integration points:

```typescript
// In VJApp.tsx:
<SceneEditor
  audioFeatures={audioFeatures}  // From AudioEngine
  onElementUpdate={(elementId, property, value) => {}}
  onAudioBindingApply={(elementId, audioFeature, formula) => {}}
/>
```

Audio features from `AudioEngine` flow in real-time:
1. AudioEngine computes RMS, centroid, energy bands (already exists)
2. Pass `audioFeatures` object to SceneEditor
3. For each element with audio bindings, evaluate formula: `eval(formula, { rms, centroid, ... })`
4. Update element properties on every frame
5. VisualEngine renders updated elements to output canvas

## Implementation Phases

### Phase 1: UI Foundation (current)
- ✅ SceneEditor component structure
- ✅ Scene switcher tabs
- ✅ Double-click to add circles/rectangles
- ✅ Element selection with visual feedback
- ✅ Audio preset panel with search
- [ ] Drag-to-move elements
- [ ] Property inspector (width, height, color)
- [ ] Save/load scenes to localStorage

### Phase 2: Audio Integration
- [ ] Connect AudioEngine features to component
- [ ] Evaluate formulas real-time
- [ ] Update element properties based on audio
- [ ] Visual feedback when audio preset is applied

### Phase 3: Polish
- [ ] Undo/redo
- [ ] Copy/paste elements
- [ ] Grouping elements
- [ ] Keyframe animation presets
- [ ] Scene templates

## Component API

### SceneEditor Props
```typescript
interface SceneEditorProps {
  audioFeatures: {
    rms: number;
    peak: number;
    energyLow: number;
    energyMid: number;
    energyHigh: number;
    centroid: number;
  };
  outputCanvasRef: React.RefObject<HTMLCanvasElement>;
  onSceneChange?: (sceneId: string) => void;
  onElementAdd?: (element: SceneElement) => void;
  onElementUpdate?: (elementId: string, property: string, value: any) => void;
}
```

## Formula Validation

Audio presets use JavaScript expressions. Simple validation:

```typescript
function validateFormula(formula: string, audioFeatures: object): boolean {
  try {
    eval(`(${formula})`, audioFeatures);
    return true;
  } catch {
    return false;
  }
}
```

**Safety**: Formulas are evaluated in a restricted scope (only audioFeatures available). No access to `window`, `document`, or other dangerous APIs.

## Next Steps

1. **Clarify storage**: Should scenes persist to backend or just localStorage?
2. **Clarify element types**: Should users be able to create custom shapes, or stick with circle/rectangle?
3. **Clarify preset scope**: Are presets global (all scenes) or per-scene? (Recommend global for reuse)
4. **Drag-to-move**: Should elements be draggable? Click to select, then arrow keys? Or click-drag?
5. **Integration test**: Hook this up to your AudioEngine and VisualEngine. How does rendering flow?
