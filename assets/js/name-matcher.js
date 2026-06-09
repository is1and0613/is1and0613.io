// assets/js/name-matcher.js — 模糊匹配引擎

/**
 * 计算 Levenshtein 编辑距离
 */
function levenshteinDistance(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * 四级模糊匹配：精确 → 包含 → 编辑距离 → 首尾一致
 * @param {string} input 用户输入
 * @param {string[]} candidates 候选姓名列表
 * @param {number} threshold 编辑距离阈值，默认 2
 * @returns {Array<{name, score, matchType}>}
 */
function fuzzyMatchName(input, candidates, threshold = 2) {
  if (!input || input.length < 2) return [];

  const results = [];

  for (const name of candidates) {
    // Level 1: 精确匹配
    if (input === name) {
      results.push({ name, score: 0, matchType: 'exact' });
      continue;
    }

    // Level 2: 包含匹配
    if (name.includes(input) && input.length >= 2) {
      results.push({ name, score: 1, matchType: 'contains' });
      continue;
    }
    if (input.includes(name) && name.length >= 2) {
      results.push({ name, score: 1, matchType: 'contains' });
      continue;
    }

    // Level 3: 编辑距离
    const dist = levenshteinDistance(input, name);
    if (dist <= threshold) {
      results.push({ name, score: dist + 1, matchType: 'edit-distance' });
      continue;
    }

    // Level 4: 首尾一致
    if (name[0] === input[0] && name[name.length - 1] === input[input.length - 1] && Math.abs(name.length - input.length) <= 2) {
      results.push({ name, score: 3, matchType: 'first-last' });
    }
  }

  return results.sort((a, b) => a.score - b.score);
}

/**
 * 文本清洗（七阶段）：OCR 纠错、去宿舍编号、去班级前缀、去落款日期等
 * @param {string} rawText
 * @returns {string}
 */
function cleanInputText(rawText) {
  let cleaned = rawText;
  let hasStudioMarker = false;
  let studioType = '';

  // ===== 阶段1: OCR常见错误修正映射 =====
  const ocrCorrections = {
    '据警务': '数据警务',
    '据警': '数据警',
    '全安': '网安',
    '像安': '网安',
    '阿sier': '阿sir',
    '阿Sier': '阿sir',
    '阿SIR': '阿sir',
    '啊sir': '阿sir',
    '啊SIR': '阿sir',
    'sir': '阿sir',
    'Sir': '阿sir',
    '自媒体': '阿sir',
    '自媒体工作室': '阿sir',
    '预备阿sir': '阿sir',
    '预备阿Sir': '阿sir',
  };

  for (const [wrong, correct] of Object.entries(ocrCorrections)) {
    cleaned = cleaned.replace(new RegExp(wrong, 'g'), correct);
  }

  // ===== 阶段2: 检测事由标记 =====
  if (/数据分析工作室|数分工作室/i.test(rawText)) {
    hasStudioMarker = true; studioType = '数分';
  } else if (/数据实战工作室|数实战工作室/i.test(rawText)) {
    hasStudioMarker = true; studioType = '数实战';
  } else if (/网安工作室/i.test(rawText)) {
    hasStudioMarker = true; studioType = '网安';
  } else if (/舆情工作室/i.test(rawText)) {
    hasStudioMarker = true; studioType = '舆情';
  } else if (/网管工作室/i.test(rawText)) {
    hasStudioMarker = true; studioType = '网管';
  } else if (/阿\s*[sS][iI][rR]|阿sir|阿Sir|预备阿sir|自媒体工作室/i.test(rawText)) {
    hasStudioMarker = true; studioType = '阿sir';
  } else if (/数分|数据分析/i.test(rawText) && !studioType) {
    hasStudioMarker = true; studioType = '数分';
  } else if (/网安\b(?!全)/i.test(rawText) && !studioType) {
    hasStudioMarker = true; studioType = '网安';
  } else if (/工作室/i.test(rawText) && !studioType) {
    hasStudioMarker = true; studioType = '工作室';
  }

  // ===== 阶段3: 严格提取人员列表区域 =====
  let personnelContent = '';
  const startPatterns = [
    /(?:具体)?\s*人员\s*[如]?[下]?[：:\n]\s*([\s\S]*?)(?=\d{4}\s*年|落款|签名|日期|$)/i,
    /(?:名单|人员)[：:\n]\s*([\s\S]*?)(?=\d{4}\s*年|落款|签名|日期|$)/i,
    /(?:以下|下列)[是为]?\s*(?:人员|名单|同学|学生)[：:\n]\s*([\s\S]*?)(?=\d{4}\s*年|落款|签名|日期|$)/i,
  ];

  for (const pattern of startPatterns) {
    const match = cleaned.match(pattern);
    if (match && match[1]) {
      personnelContent = match[1];
      break;
    }
  }

  if (!personnelContent) {
    const classNamePattern = /(?:[一-龥]{2,6}\d{4}|[一-龥]{2,4}[:：])\s*[一-龥]{2,4}(?:[,，、\s][一-龥]{2,4})*/g;
    const matches = cleaned.match(classNamePattern);
    if (matches) {
      personnelContent = matches.join('\n');
    }
  }

  if (personnelContent.trim()) {
    cleaned = personnelContent;
  }

  // ===== 阶段4: 去除无关内容 =====
  const descriptionsToRemove = [
    /由于[^\n]*?备赛[^\n]*?(?=\n|$)/gi,
    /[由因]于[^\n]*?(?:原因|理由)[^\n]*?(?=\n|$)/gi,
    /(?:申请|恳请|望请)[^\n]*?(?:批准|同意|准许)[^\n]*?(?=\n|$)/gi,
    /(?:参加|参与)[^\n]*?(?:比赛|竞赛|活动|培训)[^\n]*?(?=\n|$)/gi,
    /(?:备赛|训练)[^\n]*?(?:需要|因此)[^\n]*?(?=\n|$)/gi,
    /赛程[^\n]*?紧张[^\n]*?(?=\n|$)/gi,
    /新大陆杯[^\n]*?(?=\n|$)/gi,
    /2026\s*江苏省\s*大学生\s*计算机[^\n]*?(?=\n|$)/gi,
    /计算机设计[^\n]*?(?=\n|$)/gi,
    /设计大赛[^\n]*?(?=\n|$)/gi,
    /部分成员[^\n]*?(?=\n|$)/gi,
  ];

  for (const pattern of descriptionsToRemove) {
    cleaned = cleaned.replace(pattern, ' ');
  }

  // 4.2 去除宿舍-床位编号
  cleaned = cleaned.replace(/\d{3,4}-\d{1,3}(?:-\d{1,2})?/g, ' ');

  // 4.3 增强班级前缀去除
  cleaned = cleaned.replace(/[一-龥]{2,8}\d{4}/g, ' ');

  // 4.4 去除残留的孤立冒号和顿号（保留换行，防止状态标题行与首个人名行合并）
  cleaned = cleaned.replace(/[^\S\n]*[：:、][^\S\n]*/g, ' ');

  // 4.5 去除引导语本身
  cleaned = cleaned.replace(/(?:具体)?\s*人员[如]?[下]?[是为]?[：:\n]*/gi, '\n');
  cleaned = cleaned.replace(/(?:名单|人员)[：:\n]*/gi, '\n');
  cleaned = cleaned.replace(/(?:以下|下列)[是为]?\s*(?:人员|名单|同学|学生)[：:\n]*/gi, '\n');

  // 4.6 去除落款和日期
  cleaned = cleaned.replace(/\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*[日号]?/g, ' ');
  cleaned = cleaned.replace(/(?:预备)?\s*阿\s*[sS][iI][rR]\s*(?:自媒体)?\s*工作室/gi, ' ');
  cleaned = cleaned.replace(/(?:数据)?\s*分析\s*工作室/gi, ' ');
  cleaned = cleaned.replace(/网络安全工作室/gi, ' ');
  cleaned = cleaned.replace(/(情况说明|尊敬的大队老师|大队老师)/gi, ' ');
  cleaned = cleaned.replace(/落款[：:\n]?/gi, ' ');

  // 4.7 去除//包裹的标记
  cleaned = cleaned.replace(/\/(事假|请假离校|请假外出|外出|离校)\//g, '$1');

  // 4.8 标准化分隔符
  cleaned = cleaned.replace(/[\/\\、，；;|]/g, ' ');

  // ===== 阶段5: 去重处理 =====
  const lines = cleaned.split('\n').map(l => l.trim()).filter(l => l);
  const seenLines = new Set();
  const uniqueLines = [];

  const reasonKeywordsSet = new Set([
    '数分', '数分工作室', '数据分析工作室', '数据分析', 'data',
    '网安', '网安工作室', '网络安全工作室', '网络安全',
    '阿sir', '啊sir', '啊SIR', '预备阿sir', '自媒体工作室',
    '预备阿sir自媒体工作室', '自媒体', 'sir', '阿SIR', '阿Sir',
    '数据实战', '数据实战工作室', '数实战', '网管', '网管工作室',
    '分团委', '学生会', '合唱团', '运动会', '警乐团', '羽毛球', '篮球队', '篮球', '篮球队假单',
    '辩论队', '辩队', '备赛', '比赛', '竞赛', '复习', '学习', '自习',
    '校督', '校督促', '请假离校', '离校', '回家', '请假外出', '外出', '出门', '事假'
  ]);

  for (const line of lines) {
    const namesInLine = line.match(/[一-龥]{2,4}/g) || [];
    const filteredNames = namesInLine.filter(n => !reasonKeywordsSet.has(n));

    if (filteredNames.length === 0) {
      uniqueLines.push(line);
      continue;
    }

    const lineSignature = filteredNames.slice().sort().join(',');
    if (!seenLines.has(lineSignature)) {
      seenLines.add(lineSignature);
      uniqueLines.push(line);
    }
  }

  cleaned = uniqueLines.join('\n');

  // ===== 阶段6: 最终清理 =====
  cleaned = cleaned.replace(/[^\S\n]+/g, ' ');
  cleaned = cleaned.replace(/\n+/g, '\n');
  cleaned = cleaned.split('\n').map(line => line.trim()).join('\n').trim();

  // ===== 阶段7: 添加事由标记 =====
  if (hasStudioMarker && studioType && cleaned) {
    const lns = cleaned.split('\n');
    const firstLine = lns[0].trim();

    const isFirstLinePureReason = (function(token) {
      return reasonKeywordsSet.has(token) && (function(line) {
        return (line.match(/[一-龥]{2,4}/g) || []).filter(n => !reasonKeywordsSet.has(n)).length === 0;
      })(firstLine);
    })(firstLine);

    if (!isFirstLinePureReason) {
      cleaned = studioType + '\n' + cleaned;
    }
  }

  return cleaned;
}

/**
 * 从文本中提取日期范围（7 种中文日期格式）
 * @param {string} text
 * @returns {{start: string|null, end: string|null}}
 */
function extractDateRangeFromText(text) {
  const currentYear = new Date().getFullYear();
  let year = currentYear;

  const yearMatches = text.matchAll(/(\d{4})年/g);
  for (const match of yearMatches) {
    const y = parseInt(match[1]);
    if (y >= 2020 && y <= 2030) {
      year = y;
      break;
    }
  }

  const pad = (n) => n.toString().padStart(2, '0');

  // 模式1: 4月29日至5月3日
  let m = text.match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日\s*至\s*(\d{1,2})月(\d{1,2})日/);
  if (m) {
    const y = m[1] ? parseInt(m[1]) : year;
    return { start: `${y}-${pad(m[2])}-${pad(m[3])}`, end: `${y}-${pad(m[4])}-${pad(m[5])}` };
  }

  // 模式2: 4月29日到5月3日
  m = text.match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日\s*到\s*(\d{1,2})月(\d{1,2})日/);
  if (m) {
    const y = m[1] ? parseInt(m[1]) : year;
    return { start: `${y}-${pad(m[2])}-${pad(m[3])}`, end: `${y}-${pad(m[4])}-${pad(m[5])}` };
  }

  // 模式3: 4.29-5.3
  m = text.match(/(\d{1,2})\.(\d{1,2})\s*[至到-]\s*(\d{1,2})\.(\d{1,2})/);
  if (m) {
    return { start: `${year}-${pad(m[1])}-${pad(m[2])}`, end: `${year}-${pad(m[3])}-${pad(m[4])}` };
  }

  // 模式4: 4月29日至5.3（混合格式）
  m = text.match(/(\d{1,2})月(\d{1,2})日\s*至\s*(\d{1,2})\.(\d{1,2})/);
  if (m) {
    return { start: `${year}-${pad(m[1])}-${pad(m[2])}`, end: `${year}-${pad(m[3])}-${pad(m[4])}` };
  }

  // 模式5: 4月29日到5.3（混合格式）
  m = text.match(/(\d{1,2})月(\d{1,2})日\s*到\s*(\d{1,2})\.(\d{1,2})/);
  if (m) {
    return { start: `${year}-${pad(m[1])}-${pad(m[2])}`, end: `${year}-${pad(m[3])}-${pad(m[4])}` };
  }

  return null;
}
