// brew.js — 纯函数模块：配方 -> {汤色, 茶名, 功效文案, 汤色名}
// 不依赖任何渲染/DOM/Canvas API。

export const HERBS = {
  chrysanthemum: {
    id: "chrysanthemum",
    name: "菊花",
    nature: "甘、微寒",
    effect: "清肝明目",
    theory: "传统理论：疏散风热、清肝明目",
    temperature: -1,
    portionG: 1,
    softLimitG: 4,
    caution: "偏寒凉；平素怕冷、易腹泻者不宜多饮。",
    hue: 46, sat: 68, light: 76, tintWeight: 1, // 蜜色
    floats: true,
  },
  goji: {
    id: "goji",
    name: "枸杞",
    nature: "甘、平",
    effect: "滋补肝肾",
    theory: "传统理论：滋补肝肾、益精明目",
    temperature: 0,
    portionG: 1,
    softLimitG: 6,
    caution: "含天然糖分；正在控糖或服药者应结合个人情况。",
    hue: 18, sat: 68, light: 60, tintWeight: 1.3, // 暖橙红（果脯色），染色力较强
    floats: false,
  },
  mint: {
    id: "mint",
    name: "薄荷",
    nature: "辛、凉",
    effect: "疏风清咽",
    theory: "传统理论：疏散风热、清利头目",
    temperature: -2,
    portionG: 0.5,
    softLimitG: 2,
    caution: "芳香偏凉；反流不适、畏寒者宜少量。",
    hue: 145, sat: 32, light: 82, tintWeight: 0.5, // 极浅青绿，染色力弱
    floats: "half",
  },
  rose: {
    id: "rose",
    name: "玫瑰",
    nature: "甘微苦、温",
    effect: "疏肝解郁",
    theory: "传统理论：行气解郁、和血",
    temperature: 1,
    portionG: 1,
    softLimitG: 4,
    caution: "孕期、经量较多或正在服药者，饮用前宜咨询专业人士。",
    hue: 338, sat: 48, light: 80, tintWeight: 0.9, // 桃汤粉
    floats: true,
  },
  licorice: {
    id: "licorice",
    name: "甘草",
    nature: "甘、平",
    effect: "调和诸药",
    theory: "传统理论：补脾益气、调和诸药",
    temperature: 0,
    portionG: 1,
    softLimitG: 3,
    caution: "不宜长期或大量饮用；高血压、水肿、低钾或正在服药者尤其谨慎。",
    hue: 44, sat: 58, light: 64, tintWeight: 0.8, // 糖色
    floats: false,
  },
  hawthorn: {
    id: "hawthorn", name: "山楂", nature: "酸甘、微温", effect: "消食化积",
    theory: "传统理论：消食健胃、行气散瘀", temperature: 1,
    portionG: 1.5, softLimitG: 6,
    caution: "酸味较强；胃酸反流、空腹或孕期不宜多饮。",
    hue: 8, sat: 55, light: 66, tintWeight: 1.2, floats: false,
  },
  jujube: {
    id: "jujube", name: "大枣", nature: "甘、温", effect: "补中益气",
    theory: "传统理论：补中益气、养血安神", temperature: 2,
    portionG: 2, softLimitG: 8,
    caution: "甘甜；控糖人群应计入整体糖摄入。",
    hue: 14, sat: 52, light: 55, tintWeight: 1.3, floats: false,
  },
  tangerine: {
    id: "tangerine", name: "陈皮", nature: "辛苦、温", effect: "理气健脾",
    theory: "传统理论：理气健脾、燥湿化痰", temperature: 1,
    portionG: 1, softLimitG: 4,
    caution: "偏温燥；口干、阴虚燥咳者宜少量。",
    hue: 30, sat: 62, light: 61, tintWeight: 1.1, floats: true,
  },
  mulberry: {
    id: "mulberry", name: "桑椹", nature: "甘酸、寒", effect: "滋阴生津",
    theory: "传统理论：滋阴补血、生津润燥", temperature: -1,
    portionG: 2, softLimitG: 8,
    caution: "偏寒且含天然糖分；易腹泻、控糖者宜少量。",
    hue: 330, sat: 38, light: 48, tintWeight: 1.4, floats: false,
  },
  ginger: {
    id: "ginger", name: "生姜", nature: "辛、微温", effect: "温中散寒",
    theory: "传统理论：解表散寒、温中止呕", temperature: 2,
    portionG: 1, softLimitG: 4,
    caution: "辛温；口干咽痛、易上火或胃部刺激者宜少量。",
    hue: 42, sat: 48, light: 70, tintWeight: 0.8, floats: false,
  },
};

export const HERB_ORDER = [
  "chrysanthemum", "goji", "mint", "rose", "licorice",
  "hawthorn", "jujube", "tangerine", "mulberry", "ginger",
];

export const RECIPE_BOOK = [
  { name: "杞菊明目茶", counts: { goji: 3, chrysanthemum: 2 }, note: "平和微凉，花果清甜。" },
  { name: "玫瑰陈皮饮", counts: { rose: 2, tangerine: 1 }, note: "微温芳香，适合慢慢啜饮。" },
  { name: "山楂大枣饮", counts: { hawthorn: 2, jujube: 1 }, note: "酸甘相合，饭后风味更舒展。" },
  { name: "薄荷桑椹饮", counts: { mint: 1, mulberry: 2 }, note: "偏凉，清润果香。" },
];

export function analyzeFormula(herbIds, waterMl = 400) {
  const counts = {};
  for (const id of herbIds) if (HERBS[id]) counts[id] = (counts[id] || 0) + 1;
  const entries = Object.entries(counts).map(([id, count]) => {
    const herb = HERBS[id];
    return { ...herb, count, grams: count * herb.portionG };
  });
  const totalG = entries.reduce((sum, item) => sum + item.grams, 0);
  const temperatureScore = entries.reduce((sum, item) => sum + item.temperature * item.grams, 0) / Math.max(1, totalG);
  const natureLabel = temperatureScore <= -1.1 ? "偏凉" : temperatureScore < -0.25 ? "微凉" : temperatureScore <= 0.25 ? "平和" : temperatureScore < 1.1 ? "微温" : "偏温";
  const overLimit = entries.filter((item) => item.grams > item.softLimitG);
  const densityLimit = waterMl / 40; // 产品内的保守体验阈值：400ml 对应 10g
  const messages = [];
  if (!entries.length) messages.push("选几味草木，方笺会随投放实时变化。");
  else if (overLimit.length) messages.push(`${overLimit.map((h) => h.name).join("、")}已超过本体验设置的单杯参考量。`);
  else if (totalG > densityLimit) messages.push(`这杯约 ${totalG.toFixed(1)}g，400ml 中滋味与负担都偏浓。`);
  else messages.push(`${natureLabel}，约 ${totalG.toFixed(1)}g / ${waterMl}ml；在本体验的温和范围内。`);

  if (entries.some((h) => h.id === "licorice") && counts.licorice >= 3) {
    messages.push("甘草用量已高：高血压、水肿、低钾或服药者不宜自行饮用。 ");
  }
  if (Math.abs(temperatureScore) >= 1.1) {
    messages.push(temperatureScore < 0 ? "寒凉之味集中，畏寒、易腹泻者需留意。" : "温热之味集中，口干咽痛或易上火者需留意。");
  }
  if (entries.length >= 5) messages.push("味数较多，理论判断与实际口感都会更不确定。 ");

  const level = overLimit.length || totalG > densityLimit ? "caution" : entries.length ? "balanced" : "empty";
  const theory = entries.slice(0, 3).map((h) => h.effect).join("、") + (entries.length ? "。" : "");
  return { counts, entries, totalG, natureLabel, temperatureScore, level, theory, messages };
}

// 内置具名组合（配方以排序后的 herb id 数组 key 表示）
const NAMED_RECIPES = {
  "chrysanthemum": {
    name: "菊花清饮",
    note: "清清淡淡，像一场秋日午后的小睡。",
  },
  "chrysanthemum,goji": {
    name: "杞菊明目茶",
    note: "金黄里透着一点暖橙，看久了眼睛都舒服些。",
  },
  "mint,rose": {
    name: "疏风解语饮",
    note: "薄荷的凉撞上玫瑰的暖，像一句欲言又止的话。",
  },
  "chrysanthemum,goji,licorice": {
    name: "杞菊和茶",
    note: "多了一味甘草，脾气都被熨帖圆润了。",
  },
  "goji,rose": {
    name: "红颜饮",
    note: "橙红与粉紫交融，暖意里带点少女心事。",
  },
  "chrysanthemum,mint": {
    name: "清凉菊叶饮",
    note: "花香打底，一缕凉薄从喉头漫开。",
  },
  "licorice,rose": {
    name: "和玫饮",
    note: "玫瑰的浓被甘草悄悄拉住，不至太烈。",
  },
  "chrysanthemum,goji,licorice,mint,rose": {
    name: "五味调和饮",
    note: "五味俱全，谁也不抢谁的风头，像一屋子安静的老友。",
  },
};

function sortedKey(herbIds) {
  return [...new Set(herbIds)].sort().join(",");
}

// 汤色名映射：按 HSL 区间（先按明度分出极浅/极深，再按色相细分，覆盖全区间无空隙）
function colorName(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  if (l >= 88) return "月白";
  if (l <= 25) return "琥珀";
  if (hue >= 20 && hue < 55) return "秋香";
  if (hue >= 55 && hue < 90) return "蜜蜡";
  if (hue >= 90 && hue < 170) return "天水碧";
  if (hue >= 170 && hue < 260) return "青黛";
  if (hue >= 260 && hue < 330) return "藕荷";
  return "胭脂"; // 330..360 或 0..20
}

/**
 * 混合多味草药的汤色贡献（简易加权 HSL 混合，环形均值处理色相）
 * @param {string[]} herbIds
 * @param {number} steepProgress 0..1 浸泡进度，影响饱和度/明度趋势
 */
export function mixColor(herbIds, steepProgress = 1) {
  if (!herbIds || herbIds.length === 0) {
    return { h: 45, s: 10, l: 92 }; // 清水
  }
  const herbs = herbIds.map((id) => HERBS[id]).filter(Boolean);
  if (herbs.length === 0) return { h: 45, s: 10, l: 92 };

  // 色相混合：以染色力(tintWeight)最强的一味为参照色相，其余色相展开到参照 ±180° 内，
  // 再按 tintWeight 加权平均。（纯环形向量平均在两色相接近对角时会退化到无意义的中点，
  // 比如青绿+粉紫会混出不该出现的蓝色；用染色力锚定参照色相更符合"颜料混合"直觉。）
  const dominant = herbs.reduce((a, b) => (b.tintWeight > a.tintWeight ? b : a));
  const refHue = dominant.hue;
  let sHue = 0, sSat = 0, sLight = 0, sWeight = 0;
  for (const h of herbs) {
    const w = h.tintWeight || 1;
    let diff = h.hue - refHue;
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;
    sHue += (refHue + diff) * w;
    sSat += h.sat * w;
    sLight += h.light * w;
    sWeight += w;
  }
  let hue = sHue / sWeight;
  hue = ((hue % 360) + 360) % 360;
  const avgSat = sSat / sWeight;
  const avgLight = sLight / sWeight;

  const p = Math.max(0, Math.min(1, steepProgress));
  // 浸泡越久，颜色越深越浓（明度下降，饱和度上升），从清水趋向目标色
  const startL = 92, startS = 8;
  const s = startS + (avgSat - startS) * p;
  const l = startL + (avgLight - 8 - startL) * p; // 轻压暗即可，保持蜜色/琥珀的透亮
  return { h: hue, s: Math.max(5, Math.min(90, s)), l: Math.max(38, Math.min(94, l)) };
}

/**
 * 生成茶签内容
 * @param {string[]} herbIds 草药 id 数组（可重复，表示投放份数，不影响命名，只影响颜色权重可能后续扩展）
 */
export function nameTea(herbIds) {
  const uniqueIds = [...new Set(herbIds)];
  if (uniqueIds.length === 0) {
    return {
      name: "白水一盏",
      note: "什么也没放，也是一种清净。",
      effectText: "清心。",
      colorName: "月白",
    };
  }

  const key = sortedKey(uniqueIds);
  const herbs = uniqueIds.map((id) => HERBS[id]).filter(Boolean);
  const color = mixColor(uniqueIds, 1);
  const cName = colorName(color.h, color.s, color.l);

  const named = NAMED_RECIPES[key];
  let name, note;
  if (named) {
    name = named.name;
    note = named.note;
  } else {
    // 模板兜底：〔主料名〕〔意象〕饮，茶名控制在 6 字以内，不罗列全部药名
    const main = herbs[0];
    const rest = herbs.slice(1);
    if (rest.length === 0) {
      name = `${main.name}清饮`;
      note = `一味${main.name}，简简单单，也是心意。`;
    } else if (rest.length === 1) {
      name = `${main.name}${rest[0].name}饮`;
      note = `${main.name}与${rest[0].name}相遇，说不清是谁成就了谁，但喝着挺好。`;
    } else if (rest.length === 2) {
      name = `${main.name}三和饮`;
      note = `以${main.name}为主，三味相和，各自安好。`;
    } else {
      // 四味及以上：用意象雅名
      name = `${main.name}百草饮`;
      note = `百味入一盏，热闹也安静。`;
    }
    if (uniqueIds.includes("licorice") && main.id !== "licorice") {
      name = name.replace(/饮$/, "和");
    }
  }

  // 功效句：四味以上不再罗列全部，取前两味 + 收束语，避免溢出茶签
  let effectText;
  if (herbs.length <= 3) {
    effectText = herbs.map((h) => h.effect).join("、") + "。";
  } else {
    effectText = `${herbs[0].effect}、${herbs[1].effect}，诸味相和。`;
  }

  return { name, note, effectText, colorName: cName, color };
}

/**
 * 完整配方求值：输入草药、注水量(0..1)、浸泡时间(秒) -> 完整状态
 */
export function brew({ herbIds = [], waterLevel = 0, steepSeconds = 0, fullSteepSeconds = 22 }) {
  const progress = fullSteepSeconds > 0 ? Math.min(1, steepSeconds / fullSteepSeconds) : 0;
  const color = mixColor(herbIds, waterLevel > 0 ? progress : 0);
  const result = herbIds.length > 0 && progress >= 1 ? nameTea(herbIds) : null;
  return { color, progress, result };
}
