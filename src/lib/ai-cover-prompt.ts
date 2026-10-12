import { randomInt } from 'node:crypto';
import type { AiConfig } from './ai-config';
import { completeSiteText } from './pi-ai';

export const COVER_CATEGORIES = ['动漫', '风景', '人物', '插画'] as const;
export type CoverCategory = (typeof COVER_CATEGORIES)[number];

const directions: Record<CoverCategory, { ideas: readonly string[]; styles: readonly string[] }> = {
  动漫: {
    ideas: ['云端旅行', '海边小镇的日常', '雨后城市探险', '森林里的奇幻邂逅', '星空下的旅途', '复古列车上的片刻', '空中花园', '冬日街角'],
    styles: ['细腻的动画电影背景与赛璐璐角色', '柔和手绘动漫与水彩背景', '复古动画质感与清晰线稿', '明快的现代动漫画面'],
  },
  风景: {
    ideas: ['高山湖泊', '海岸与灯塔', '沙漠与绿洲', '层叠梯田', '古老村落', '林间溪流', '雪山与冰川', '火山地貌'],
    styles: ['自然风光摄影', '细腻的写实风景油画', '通透的风景水彩', '电影感的环境概念艺术'],
  },
  人物: {
    ideas: ['旅行者停下脚步', '工匠专注创作', '音乐家排练', '花园中的园丁', '窗边阅读的人', '街头散步的人', '户外写生的画家', '观星者仰望天空'],
    styles: ['自然的环境人像摄影', '电影剧照般的人物肖像', '细腻的写实人物油画', '柔和的编辑人像摄影'],
  },
  插画: {
    ideas: ['植物与微型世界', '漂浮的岛屿', '动物经营的小店', '季节更迭', '梦中的城市', '海洋生物的旅程', '日常物件变成奇幻建筑', '星球与花园'],
    styles: ['有纸张纹理的水粉插画', '细腻的彩铅插画', '层叠纸雕插画', '丝网印刷质感插画', '清晰的几何矢量插画', '透明水彩与墨线插画'],
  },
};
const compositions = ['主体位于左侧三分线，右侧保留环境空间', '主体位于右侧三分线，左侧以环境衬托', '用前景、中景、远景形成纵深', '用斜向引导线连接主体与背景', '用自然框景突出视觉中心', '简洁居中构图，周围有充足留白'];
const lighting = ['清晨柔光', '午后漫射光', '夕阳侧逆光', '阴天柔和光线', '蓝调时刻与局部暖光', '明亮柔和的环境光'];
const palettes = ['湖蓝、沙色与少量珊瑚橙', '森林绿、米白与暖棕', '靛蓝、淡紫与暖金', '低饱和青绿与桃粉', '赭石、奶油白与深青', '冰蓝、银灰与少量暖黄'];
const moods = ['宁静而有呼吸感', '轻快而富有生机', '带有探索感', '温暖而有生活气息', '梦幻而含蓄', '辽阔而有诗意'];

/** Only visual choices enter this brief; it never accepts article data. */
export function chooseCoverDirection(pickIndex: (max: number) => number = randomInt) {
  const pick = <T,>(values: readonly T[]): T => values[pickIndex(values.length)]!;
  const category = pick(COVER_CATEGORIES);
  const direction = directions[category];
  return {
    category,
    brief: [
      `范围：${category}`,
      `灵感起点：${pick(direction.ideas)}`,
      `画法：${pick(direction.styles)}`,
      `构图：${pick(compositions)}`,
      `光线：${pick(lighting)}`,
      `色彩：${pick(palettes)}`,
      `氛围：${pick(moods)}`,
    ].join('\n'),
  };
}

export async function generateRandomCoverPrompt(config: AiConfig, signal: AbortSignal) {
  signal.throwIfAborted();
  const { category, brief } = chooseCoverDirection();
  const text = (await completeSiteText(config, {
    systemPrompt: '你是图像提示词创作者。根据随机视觉方向，创作一幅原创、完整且自洽的画面。自行发明具体主体、动作或状态、场景、环境细节、视角、构图、光线、色彩与材质；灵感起点不是固定模板，必须扩展出新的具体细节，并协调相互冲突的光线或色彩。动漫使用原创角色，人物使用虚构成年人物，风景以环境为主体，插画强调绘画表现。画面用于横向3:2封面，缩略图中主体清晰。只输出一段可直接用于生图的英文提示词，约90至140词且不超过1600字符。不要解释、Markdown、标题、文字、标志或水印。',
    messages: [{ role: 'user', content: brief, timestamp: Date.now() }],
  }, { signal, maxTokens: 700 })).trim();
  signal.throwIfAborted();
  // Reject unusable output before an image request; never truncate a scene mid-sentence.
  if (text.length < 80 || text.length > 1600) throw new Error('AI 未返回完整且长度合适的封面提示词，请重新生成');
  return {
    category,
    prompt: `Horizontal cover image, landscape aspect ratio 3:2. ${text}\nClear focal subject, balanced composition. No text, lettering, logos or watermarks.`,
  };
}
