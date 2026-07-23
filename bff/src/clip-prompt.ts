// 图生视频运镜 prompt 编译(归一层职责):把前端分解的运镜参数合成一条已编译 prompt,server 收成品。
// 最小忠实端口自 xchangeai-workbench/server/promptBuilder.js —— 保真护栏置顶 + 焦点/运镜(互斥)+ 光照。
// 项目级上下文(预设/故事线/tags/comment)不属单 clip 服务层,留后续步骤。

/** 房产保真护栏:i2v 的像素级指令(禁改建筑/家具/人物/文字/水印,单镜到底)。永远置顶。 */
export const PROPERTY_FIDELITY_GUARDRAIL = [
  'Preserve the visible property exactly as photographed.',
  'Keep the original architecture, geometry, layout, materials, furniture, decor, landscaping, lighting, shadows, weather, and staging unchanged.',
  'Animate only visibly supported motion and use a restrained, physically plausible camera path that does not reveal unseen space.',
  'Do not add, remove, remodel, restage, relight, or invent people, animals, vehicles, furniture, text, logos, fire, steam, landscaping, architectural details, or property features.',
  'Maintain straight architectural lines, stable geometry, natural perspective, consistent exposure, and one continuous silent shot without cuts, captions, overlays, or audio cues.',
].join(' ');

export const DEFAULT_SHOT_DIRECTION =
  'Create one continuous, restrained real estate listing shot from the visible source photo.';

export type CameraMove =
  | 'auto'
  | 'slowPushIn'
  | 'slowPullBack'
  | 'panLeft'
  | 'panRight'
  | 'tiltUp'
  | 'tiltDown'
  | 'staticHold';
export type LightTransition = 'none' | 'dayToNight' | 'nightToDay' | 'dayToDusk';

const CAMERA_MOVES = new Set<string>(['slowPushIn', 'slowPullBack', 'panLeft', 'panRight', 'tiltUp', 'tiltDown', 'staticHold']);
const LIGHT_TRANSITIONS = new Set<string>(['dayToNight', 'nightToDay', 'dayToDusk']);

const LIGHT_TRANSITION_INSTRUCTIONS: Record<string, string> = {
  dayToNight:
    'Lighting transition: Over this continuous shot, gradually change the lighting from bright daytime to night. Soften and cool daylight, deepen shadows, and introduce warm interior or exterior night glow as appropriate to the space. Keep architecture, furniture, decor, and staging unchanged — only time-of-day lighting and shadows may change.',
  nightToDay:
    'Lighting transition: Over this continuous shot, gradually change the lighting from night to bright daytime. Lift darkness, warm into natural daylight, and soften night shadows while keeping architecture, furniture, decor, and staging unchanged — only time-of-day lighting and shadows may change.',
  dayToDusk:
    'Lighting transition: Over this continuous shot, gradually change the lighting from daytime to dusk. Lower the sun, warm the sky and interiors with golden-hour tones, and lengthen soft shadows while keeping architecture, furniture, decor, and staging unchanged — only time-of-day lighting and shadows may change.',
};

const LIGHT_TRANSITION_EXCEPTION =
  'Exception for this shot: an intentional time-of-day lighting transition is requested below. Architecture, furniture, decor, and staging stay unchanged; only lighting and shadows may shift with the time of day.';

const normalizeFocusSubject = (value: string | undefined): string | null => {
  const subject = String(value ?? '').replace(/\s+/g, ' ').trim();
  return subject ? subject.slice(0, 120) : null;
};

const buildFocusInstruction = (focusSubject: string | undefined, cameraMove: string | undefined): string | null => {
  const subject = normalizeFocusSubject(focusSubject);
  if (!subject) return null;
  const movement: Record<string, string> = {
    slowPushIn: 'Move the camera slowly toward it.',
    slowPullBack: 'Move the camera slowly back from it.',
    panLeft: 'Pan the camera left while keeping it as the visual anchor.',
    panRight: 'Pan the camera right while keeping it as the visual anchor.',
    tiltUp: 'Tilt the camera up while keeping it as the visual anchor.',
    tiltDown: 'Tilt the camera down while keeping it as the visual anchor.',
    staticHold: 'Hold a stable composition on it.',
  };
  const move = (cameraMove && movement[cameraMove]) || 'Keep it as the stable compositional anchor.';
  return `Visual center: ${subject}. Keep it as the primary visual focus. ${move}`;
};

const buildCameraMoveInstruction = (cameraMove: string | undefined): string | null => {
  if (!cameraMove || !CAMERA_MOVES.has(cameraMove)) return null;
  const movement: Record<string, string> = {
    slowPushIn: 'Camera path: use a slow, steady push toward the primary visible subject.',
    slowPullBack: 'Camera path: use a slow, steady pull-back that reveals the visible space.',
    panLeft: 'Camera path: use a slow, restrained pan left across the primary visible subject.',
    panRight: 'Camera path: use a slow, restrained pan right across the primary visible subject.',
    tiltUp: 'Camera path: use a gentle tilt upward while preserving straight architectural lines.',
    tiltDown: 'Camera path: use a gentle tilt downward while preserving straight architectural lines.',
    staticHold: 'Camera path: hold a locked, stable frame on the primary visible subject.',
  };
  return movement[cameraMove] ?? null;
};

const buildLightTransitionInstruction = (lightTransition: string | undefined): string | null => {
  const key = lightTransition && LIGHT_TRANSITIONS.has(lightTransition) ? lightTransition : null;
  if (!key) return null;
  return `${LIGHT_TRANSITION_EXCEPTION}\n${LIGHT_TRANSITION_INSTRUCTIONS[key]}`;
};

export type ClipPromptInput = {
  promptBody?: string;
  cameraMove?: CameraMove;
  focusSubject?: string;
  lightTransition?: LightTransition;
};

/** 合成一条已编译的图生视频 prompt。护栏置顶,焦点与运镜互斥,光照其后,正文兜底。 */
export const compileClipPrompt = (input: ClipPromptInput): string => {
  const effectiveBody = (input.promptBody ?? '').trim() || DEFAULT_SHOT_DIRECTION;
  const focus = buildFocusInstruction(input.focusSubject, input.cameraMove);
  const camera = focus ? null : buildCameraMoveInstruction(input.cameraMove);
  const light = buildLightTransitionInstruction(input.lightTransition);
  return [PROPERTY_FIDELITY_GUARDRAIL, focus, camera, light, effectiveBody].filter(Boolean).join('\n\n');
};
