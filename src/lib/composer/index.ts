/**
 * Public surface for the composer. UI imports go through here.
 */

export type {
  AudioFeatureKey,
  AudioPreset,
  Element,
  ElementKind,
  ElementProperties,
  ImagePlacement,
  PropertyBinding,
  PropertyKey,
  Scene,
} from "./types";
export {
  AUDIO_FEATURE_KEYS,
  NUMERIC_PROPERTY_KEYS,
  KIND_ONLY_PROPERTY_KEYS,
  PROPERTY_META,
  shortenFeatures,
} from "./types";

export {
  compileFormula,
  dryRunFormula,
  type CompiledFormula,
  type FormulaInput,
} from "./formula";

export {
  renderElement,
  renderScene,
  resolveElementProperties,
  purgeElementCache,
  collectOverlayItems,
  renderOverlayItems,
  type OverlayItem,
} from "./render";

export {
  useSceneStore,
  selectActiveScene,
  selectSelectedElement,
} from "./scene-store";

export {
  SCENE_TEMPLATES,
  getSceneTemplate,
  type SceneTemplate,
} from "./scene-templates";

export {
  usePresetStore,
  presetIsValid,
  buildPresetMap,
  groupPresetsByFeature,
} from "./preset-store";

export {
  useUiStore,
  type DrawerMode,
} from "./ui-store";
