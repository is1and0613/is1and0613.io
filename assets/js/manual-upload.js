// assets/js/manual-upload.js — 手动输入假单页逻辑

// ============================================
// 全局状态
// ============================================
const state = {
  groups: [],
  nameIndex: {},
  allNames: [],
  namePatterns: [],
  lastCleanedText: '',
  lastParseResult: null,
  collapsedStates: {},
  dateRange: null,
  enableFuzzyMatch: false
};

// ============================================
// 事由关键词映射
// ============================================
const reasonKeywords = {
  '数分': '数分', '数分工作室': '数分', '数据分析工作室': '数分',
  '数据分析': '数分', 'data': '数分',
  '网安': '网安', '网安工作室': '网安', '网络安全工作室': '网安', '网络安全': '网安',
  '阿sir': '阿sir', '啊sir': '阿sir', '啊SIR': '阿sir', '预备阿sir': '阿sir',
  '自媒体工作室': '阿sir', '预备阿sir自媒体工作室': '阿sir', '自媒体': '阿sir',
  'sir': '阿sir', '阿SIR': '阿sir', '阿Sir': '阿sir',
  '数据实战': '数实战', '数据实战工作室': '数实战', '数实战': '数实战',
  '舆情': '舆情', '舆情工作室': '舆情',
  '网管': '网管', '网管工作室': '网管',

  '分团委': '分团委', '学生会': '学生会', '合唱团': '合唱团',
  '运动会': '运动会', '警乐团': '警乐团', '羽毛球': '羽毛球',
  '篮球队': '篮球队', '篮球': '篮球队', '篮球队假单': '篮球队',

  '辩论队': '辩论队', '辩队': '辩论队',
  '备赛': '备赛', '比赛': '备赛', '竞赛': '备赛',
  '复习': '复习', '学习': '学习', '自习': '学习',
  '校督': '校督', '校督促': '校督',

  '请假离校': 'leaveSchool', '离校': 'leaveSchool', '回家': 'leaveSchool',
  '请假外出': 'leaveOutside', '外出': 'leaveOutside', '出门': 'leaveOutside',
  '事假': 'leaveInside', '假': 'leaveInside'
};

const subReasons = ['分团委', '学生会', '学习', '合唱团', '运动会', '警乐团', '羽毛球', '篮球队', '校督', '其他'];

// ============================================
// 初始化
// ============================================
document.addEventListener('DOMContentLoaded', function() {
  loadDormData();
});

// ============================================
// 从后端 API 加载宿舍数据
// ============================================
async function loadDormData() {
  try {
    const token = sessionStorage.getItem('authToken');
    if (!token) {
      window.location.replace('login.html');
      return;
    }

    const response = await fetch('/api/dorm-data', {
      headers: { 'Authorization': 'Bearer ' + token }
    });

    if (response.status === 401) {
      sessionStorage.removeItem('authToken');
      sessionStorage.removeItem('loggedIn');
      window.location.replace('login.html');
      return;
    }

    if (!response.ok) {
      throw new Error('Network response was not ok');
    }

    const data = await response.json();
    window.dormData = data.dormData;
    window.nameIndex = data.nameIndex;

    document.getElementById('loadingOverlay').classList.add('hidden');

    if (typeof initApp === 'function') {
      initApp();
    }
  } catch (error) {
    console.error('加载宿舍数据失败:', error);
    document.querySelector('.loading-spinner-large').style.display = 'none';
    document.querySelector('.loading-text').style.display = 'none';
    document.getElementById('loadingError').classList.add('show');
  }
}

function initApp() {
  buildNameIndex();
  setupCopyOnClick();

  const urlParams = new URLSearchParams(window.location.search);
  const urlText = urlParams.get('text');
  if (urlText) {
    updateToOCRPipelineUI();
    const inputText = document.getElementById('inputText');
    inputText.value = urlText;
    setTimeout(() => { parseInput(); }, 300);
  } else {
    checkOCRPipelineMode();
  }
}

// ============================================
// OCR 流水线模式检测与自动解析
// ============================================
function checkOCRPipelineMode() {
  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get('mode');
  if (mode === 'ocr-pipeline' || mode === 'text-pipeline') {
    const context = JSON.parse(localStorage.getItem('ocrContext') || '{}');

    if (mode === 'ocr-pipeline') {
      state.enableFuzzyMatch = true;
    } else {
      state.enableFuzzyMatch = context.isFileUpload !== true;
    }

    const ocrText = localStorage.getItem('ocrRawText');
    if (ocrText) {
      updateToOCRPipelineUI();
      const inputText = document.getElementById('inputText');
      inputText.value = ocrText;
      setTimeout(() => { parseInput(); }, 300);
    }
  }
}

function updateToOCRPipelineUI() {
  const mode = new URLSearchParams(window.location.search).get('mode');
  document.querySelector('.header h1').textContent = mode === 'text-pipeline' ? '文本解析结果确认' : '图片识别结果确认';

  const tipBanner = document.querySelector('.tip-banner');
  tipBanner.innerHTML = `
    <div class="content">
      <p><i class="fas fa-magic" style="color:#2C436F;"></i> 图片识别结果已自动导入</p>
      <p style="margin-top:8px; font-size:13px; color:#666;">请核对智能分组结果，确认无误后点击底部按钮</p>
    </div>
  `;
  tipBanner.style.background = '#EAF0E2';
  tipBanner.style.border = '1px solid #2C436F';

  document.querySelector('.format-guide').style.display = 'none';
  document.querySelector('.input-section .label').textContent = '提取到的文本（可编辑修正）：';

  const bottomActions = document.getElementById('bottomActions');
  const backBtnText = mode === 'text-pipeline' ? '<i class="fas fa-arrow-left"></i>返回上传' : '<i class="fas fa-redo"></i>返回重拍';
  bottomActions.innerHTML = `
    <button class="bottom-btn danger" onclick="goBackToUpload()" style="background:#fff1f0;color:#ff4d4f;border:1px solid #ffccc7;">
      ${backBtnText}
    </button>
    <button class="bottom-btn primary" onclick="confirmAndReturn()">
      <i class="fas fa-check"></i>确认并返回
    </button>
  `;
  bottomActions.style.display = 'flex';
}

function goBackToUpload() {
  localStorage.removeItem('ocrRawText');
  localStorage.removeItem('ocrContext');
  window.location.href = 'upload.html';
}

function confirmAndReturn() {
  const updates = {};
  let count = 0;

  state.groups.forEach(group => {
    group.people.forEach(p => {
      if (!p.checked) return;
      let reason = '';
      if (group.leaveType === 'leaveInside') {
        reason = group.reason || '其他';
      }
      updates[p.name] = { status: group.leaveType, reason: reason };
      count++;
    });
  });

  if (count === 0) { showToast('请至少勾选一名人员'); return; }

  const dateRange = state.dateRange;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (dateRange && dateRange.start && dateRange.end) {
    const startDate = new Date(dateRange.start);
    const endDate = new Date(dateRange.end);
    if (endDate < today) {
      if (!confirm('该假单已过期，确认应用？')) return;
    }
    if (startDate > today) {
      if (!confirm('该假单尚未生效（开始日期为 ' + dateRange.start + '），是否仍要提前应用？')) return;
    }
  }

  if (navigator.vibrate) navigator.vibrate([30, 50, 30]);

  const pendingData = { dateRange: dateRange, records: updates };
  localStorage.setItem('pendingLeaveRecords', JSON.stringify(pendingData));
  showToast('已确认 ' + count + ' 人，正在应用假单...');

  setTimeout(() => {
    window.location.href = 'index.html?applyLeaves=1';
  }, 800);
}

// ============================================
// 构建姓名索引
// ============================================
function buildNameIndex() {
  for (const grade in window.dormData) {
    for (const className in window.dormData[grade]) {
      for (const dorm in window.dormData[grade][className]) {
        window.dormData[grade][className][dorm].forEach((name, index) => {
          if (name) {
            if (!state.nameIndex[name]) {
              state.nameIndex[name] = {
                name: name, grade: grade, className: className, dorm: dorm, bed: index + 1
              };
            }
            state.allNames.push(name);
            for (let i = 0; i < name.length; i++) {
              for (let len = 2; len <= 4 && i + len <= name.length; len++) {
                state.namePatterns.push(name.substr(i, len));
              }
            }
          }
        });
      }
    }
  }
  state.allNames = [...new Set(state.allNames)];
  state.namePatterns = [...new Set(state.namePatterns)];
}

// ============================================
// 模糊姓名匹配（页面特定版本）
// ============================================
function fuzzyMatchName(input) {
  if (!input || input.length < 2) return null;

  const candidates = state.allNames.filter(name => {
    return name[0] === input[0] || Math.abs(name.length - input.length) <= 2;
  });

  for (const name of candidates) {
    if (input === name) {
      return { matchedName: name, originalInput: input, matchType: 'exact', confidence: 'high', distance: 0 };
    }
  }

  if (!state.enableFuzzyMatch) {
    if (input.length >= 2 && /[一-龥].*[一-龥]/.test(input)) {
      return { matchedName: null, originalInput: input, matchType: 'none', confidence: 'low', distance: null };
    }
    return null;
  }

  const pickBest = (matches) => {
    return matches.sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      return b.name.length - a.name.length;
    })[0];
  };

  let matches = [];

  for (const name of candidates) {
    if (name.includes(input) && input.length >= 2) {
      matches.push({ name, distance: levenshteinDistance(input, name) });
    }
  }
  if (matches.length > 0) {
    const best = pickBest(matches);
    return { matchedName: best.name, originalInput: input, matchType: 'fuzzy', confidence: 'high', distance: best.distance };
  }

  for (const name of candidates) {
    if (input.includes(name) && name.length >= 2) {
      matches.push({ name, distance: levenshteinDistance(input, name) });
    }
  }
  if (matches.length > 0) {
    const best = pickBest(matches);
    return { matchedName: best.name, originalInput: input, matchType: 'fuzzy', confidence: 'high', distance: best.distance };
  }

  const getCommonChars = (a, b) => {
    const setA = new Set(a);
    let count = 0;
    for (const ch of b) { if (setA.has(ch)) { count++; setA.delete(ch); } }
    return count;
  };

  const meetsQualityThreshold = (input, name, distance) => {
    const maxLen = Math.max(input.length, name.length);
    const common = getCommonChars(input, name);
    if (common < Math.ceil(maxLen / 2)) return false;
    if (distance === 2 && Math.abs(input.length - name.length) > 1) return false;
    return true;
  };

  for (const name of candidates) {
    if (name[0] === input[0]) {
      const dist = levenshteinDistance(input, name);
      if (dist <= 2 && dist > 0 && meetsQualityThreshold(input, name, dist)) {
        matches.push({ name, distance: dist });
      }
    }
  }
  if (matches.length > 0) {
    const best = pickBest(matches);
    const common = getCommonChars(input, best.name);
    const maxLen = Math.max(input.length, best.name.length);
    const confidence = (best.distance >= 2 && common < maxLen * 0.6) ? 'low' : 'high';
    return { matchedName: best.name, originalInput: input, matchType: 'fuzzy', confidence, distance: best.distance };
  }

  for (const name of candidates) {
    if (name[0] === input[0] && name[name.length - 1] === input[input.length - 1] && Math.abs(name.length - input.length) <= 2) {
      const dist = levenshteinDistance(input, name);
      if (dist <= 1 && dist > 0) { matches.push({ name, distance: dist }); }
    }
  }
  if (matches.length > 0) {
    const best = pickBest(matches);
    return { matchedName: best.name, originalInput: input, matchType: 'fuzzy', confidence: 'high', distance: best.distance };
  }

  for (const name of candidates) {
    let hasSubstr = false;
    if (input.length >= 2) {
      for (let i = 0; i <= name.length - input.length; i++) {
        const substr = name.substr(i, input.length);
        if (levenshteinDistance(input, substr) <= 1) { hasSubstr = true; break; }
      }
    }
    if (hasSubstr) {
      const dist = levenshteinDistance(input, name);
      if (dist <= 3 && dist > 0 && meetsQualityThreshold(input, name, dist)) {
        matches.push({ name, distance: dist });
      }
    }
  }
  if (matches.length > 0) {
    const best = pickBest(matches);
    return { matchedName: best.name, originalInput: input, matchType: 'fuzzy', confidence: 'low', distance: best.distance };
  }

  if (input.length >= 2 && /[一-龥].*[一-龥]/.test(input)) {
    return { matchedName: null, originalInput: input, matchType: 'none', confidence: 'low', distance: null };
  }

  return null;
}

// ============================================
// 从事由关键词判断
// ============================================
function isReasonKeyword(token) {
  if (reasonKeywords[token]) return true;
  const extendedReasons = {
    '数分': true, '网安': true, '阿sir': true, '辩论队': true,
    '备赛': true, '复习': true, '学习': true, '校督': true,
    '分团委': true, '学生会': true, '合唱团': true,
    '运动会': true, '警乐团': true, '羽毛球': true, '篮球队': true,
    '数实战': true, '网管': true,
    '请假离校': true, '离校': true, '事假': true, '外出': true,
    '请假外出': true, '回家': true, '出门': true
  };
  return extendedReasons[token] || false;
}

function getLeaveTypeByReason(reason) {
  const mapped = reasonKeywords[reason];
  if (mapped === 'leaveSchool') return 'leaveSchool';
  if (mapped === 'leaveOutside') return 'leaveOutside';
  return 'leaveInside';
}

function findName(token) {
  if (!token || token.length < 2) return null;
  const result = fuzzyMatchName(token);
  if (result && result.matchedName) {
    return { name: result.matchedName, originalInput: result.originalInput, matchType: result.matchType, confidence: result.confidence };
  }
  return null;
}

function detectReason(text) {
  const lower = text.toLowerCase();
  for (const [keyword, mapped] of Object.entries(reasonKeywords)) {
    if (lower.includes(keyword.toLowerCase())) {
      return {
        found: true,
        reason: mapped === 'leaveSchool' || mapped === 'leaveOutside' ?
          (mapped === 'leaveSchool' ? '请假离校' : '请假外出') : mapped,
        leaveType: mapped === 'leaveSchool' || mapped === 'leaveOutside' ? mapped : 'leaveInside',
        matchedKeyword: keyword
      };
    }
  }
  return { found: false };
}

function detectReasonInLine(line) {
  let result = { found: false, cleanLine: line };
  const parts = line.split(/\s+/);
  for (let i = 0; i < parts.length; i++) {
    const reasonCheck = detectReason(parts[i]);
    if (reasonCheck.found) {
      const cleanParts = parts.filter((_, idx) => idx !== i);
      return { found: true, reason: reasonCheck.reason, leaveType: reasonCheck.leaveType, cleanLine: cleanParts.join(' ') };
    }
  }
  return result;
}

function detectReasonInLineAdvanced(line) {
  const result = { found: false, reason: null, leaveType: 'leaveInside' };
  for (const [keyword, mapped] of Object.entries(reasonKeywords)) {
    if (line.includes(keyword)) {
      const isLeaveType = mapped === 'leaveSchool' || mapped === 'leaveOutside';
      return {
        found: true,
        reason: isLeaveType ? (mapped === 'leaveSchool' ? '请假离校' : '请假外出') : mapped,
        leaveType: isLeaveType ? mapped : 'leaveInside',
        matchedKeyword: keyword
      };
    }
  }
  return result;
}

function isTitleLine(current, prev, next) {
  if (current.length < 15 && detectReason(current).found) {
    if (next && (extractNamesFromLine(next).length > 0 || isDormFormat(next))) return true;
  }
  return false;
}

function isPureTitle(line) {
  if (line.length > 20) return false;
  const hasReason = detectReason(line).found;
  const hasName = extractNamesFromLine(line).length > 0;
  return hasReason && !hasName;
}

// ============================================
// 从清洗后的文本中提取人名
// ============================================
function extractNamesFromCleanedText(text) {
  const names = [];
  const foundNames = new Set();
  const candidates = text.match(/[一-龥]{2,4}/g) || [];
  for (const candidate of candidates) {
    if (isReasonKeyword(candidate)) continue;
    const result = fuzzyMatchName(candidate);
    if (result && result.matchedName && !foundNames.has(result.matchedName)) {
      names.push({ name: result.matchedName, originalInput: result.originalInput, matchType: result.matchType, confidence: result.confidence });
      foundNames.add(result.matchedName);
    }
  }
  return names;
}

// ============================================
// 从行中提取人名
// ============================================
function extractNamesFromLine(line) {
  const names = [];
  const cleaned = line.replace(/\d{3,4}-\d{1,2}(?:-\d{1,2})?/g, ' ');
  const parts = cleaned.split(/[\s,，、]+/).filter(p => p && p.length >= 2);
  parts.forEach(part => {
    const result = fuzzyMatchName(part);
    if (result && result.matchedName) {
      names.push({ name: result.matchedName, originalInput: result.originalInput, matchType: result.matchType, confidence: result.confidence });
    }
  });
  return dedupeNameObjects(names);
}

function extractNameFromMixed(text) {
  const cleaned = text.replace(/^\d{3,4}-\d{1,2}(?:-\d{1,2})?/, '');
  const matches = cleaned.match(/[一-龥]{2,4}/g);
  if (!matches) return null;
  for (const match of matches) {
    const result = fuzzyMatchName(match);
    if (result && result.matchedName) {
      return { name: result.matchedName, originalInput: result.originalInput, matchType: result.matchType, confidence: result.confidence };
    }
  }
  return null;
}

function isDormFormat(text) {
  return /^\d{3,4}[- ]*\d{1,2}(?:[- ]*\d{1,2})?$/.test(text);
}

function parseDormFormat(text) {
  const matches = text.match(/(\d{3,4})[- ]*(\d{1,2})(?:[- ]*(\d{1,2}))?/);
  if (matches) {
    return { dorm: matches[1], bed: parseInt(matches[2]), fullDorm: matches[1] + '-' + matches[2] };
  }
  return null;
}

function dedupeNameObjects(arr) {
  const seen = new Set();
  return arr.filter(obj => {
    const key = obj.name;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function matchNames(names) {
  return names.map(item => {
    const isObj = typeof item === 'object' && item !== null;
    const rawName = isObj ? item.name : item;
    const originalInput = isObj ? (item.originalInput || rawName) : rawName;
    let matchType = isObj ? (item.matchType || 'none') : (state.nameIndex[item] ? 'exact' : 'none');
    const confidence = isObj ? (item.confidence || 'high') : 'high';
    const info = state.nameIndex[rawName];
    return {
      name: rawName,
      matched: matchType !== 'none',
      matchType: matchType,
      originalInput: originalInput,
      confidence: confidence,
      info: info || { name: rawName, grade: '未知', className: '未知', dorm: '未知', bed: '-' },
      checked: matchType !== 'none'
    };
  });
}

// ============================================
// 智能格式解析器
// ============================================
function parseSmartFormat(originalText, cleanedText) {
  const sections = splitIntoSections(originalText);
  const allEntries = [];
  sections.forEach(section => {
    const entries = parseSection(section.lines, section.defaultReason, section.defaultLeaveType);
    allEntries.push(...entries);
  });
  const groups = {};
  allEntries.forEach(entry => {
    const key = entry.leaveType + ':' + entry.reason;
    if (!groups[key]) {
      groups[key] = { reason: entry.reason, leaveType: entry.leaveType, names: [] };
    }
    const nameKey = typeof entry.name === 'object' ? entry.name.name : entry.name;
    if (!groups[key].names.some(n => (typeof n === 'object' ? n.name : n) === nameKey)) {
      groups[key].names.push(entry.name);
    }
  });
  return Object.values(groups).map(g => ({
    ...g,
    people: matchNames(dedupeNameObjects(g.names)),
    name: g.reason
  }));
}

function splitIntoSections(text) {
  const sections = [];
  const lines = text.split('\n');
  let currentSection = null;
  lines.forEach(line => {
    line = line.trim();
    if (!line) return;
    const sectionHeader = parseSectionHeader(line);
    if (sectionHeader.isHeader) {
      if (currentSection && currentSection.lines.length > 0) sections.push(currentSection);
      currentSection = { lines: [], defaultReason: sectionHeader.reason, defaultLeaveType: sectionHeader.leaveType };
    } else {
      if (!currentSection) currentSection = { lines: [], defaultReason: null, defaultLeaveType: 'leaveInside' };
      currentSection.lines.push(line);
    }
  });
  if (currentSection && currentSection.lines.length > 0) sections.push(currentSection);
  return sections;
}

function parseSectionHeader(line) {
  const result = { isHeader: false, reason: null, leaveType: 'leaveInside' };
  let cleanLine = line.replace(/\//g, '').trim();
  const reasonInfo = detectReason(cleanLine);
  if (!reasonInfo.found) return result;
  const tokens = cleanLine.split(/[\s,，、]+/).filter(t => t.length >= 2);
  let hasName = false;
  for (const token of tokens) {
    if (isReasonKeyword(token)) continue;
    if (findName(token)) { hasName = true; break; }
  }
  if (!hasName) {
    result.isHeader = true;
    result.reason = reasonInfo.reason;
    result.leaveType = reasonInfo.leaveType;
  }
  return result;
}

function parseSection(lines, sectionDefaultReason, sectionDefaultLeaveType) {
  const entries = [];
  let currentDefaultReason = sectionDefaultReason;
  let currentDefaultLeaveType = sectionDefaultLeaveType;
  lines.forEach(line => {
    const lineEntries = parseLine(line, currentDefaultReason, currentDefaultLeaveType);
    entries.push(...lineEntries);
    const lineTokens = line.replace(/\d{3,4}-\d{1,3}(?:-\d{1,2})?/g, ' ')
      .replace(/[一-龥]+\d{4}/g, ' ')
      .trim()
      .split(/[\s,，、]+/).filter(t => t.length >= 2);
    if (lineTokens.length > 0) {
      const firstToken = lineTokens[0];
      if (isReasonKeyword(firstToken) && !findName(firstToken)) {
        currentDefaultReason = firstToken;
        currentDefaultLeaveType = getLeaveTypeByReason(currentDefaultReason);
      }
    }
  });
  return entries;
}

function parseLine(line, sectionDefaultReason, sectionDefaultLeaveType) {
  const entries = [];
  let cleanLine = line.replace(/\d{3,4}-\d{1,3}(?:-\d{1,2})?/g, ' ')
    .replace(/[一-龥]+\d{4}/g, ' ')
    .trim();
  if (!cleanLine) return entries;
  const tokens = cleanLine.split(/[\s,，、]+/).filter(t => t.length >= 2);
  const tokenInfos = tokens.map((token, idx) => ({
    idx, token,
    isReason: isReasonKeyword(token) && !findName(token),
    name: findName(token)
  }));
  let lineDefaultReason = sectionDefaultReason;
  let lineDefaultLeaveType = sectionDefaultLeaveType;
  if (tokenInfos.length > 0 && tokenInfos[0].isReason) {
    lineDefaultReason = tokenInfos[0].token;
    lineDefaultLeaveType = getLeaveTypeByReason(lineDefaultReason);
  }
  let i = 0;
  while (i < tokenInfos.length) {
    const info = tokenInfos[i];
    if (info.name) {
      let specificReason = null;
      let specificLeaveType = lineDefaultLeaveType;
      if (i + 1 < tokenInfos.length && tokenInfos[i + 1].isReason) {
        specificReason = tokenInfos[i + 1].token;
        specificLeaveType = getLeaveTypeByReason(specificReason);
        i += 2;
      } else if (i - 1 >= 0 && tokenInfos[i - 1].isReason) {
        specificReason = tokenInfos[i - 1].token;
        specificLeaveType = getLeaveTypeByReason(specificReason);
        i++;
      } else {
        specificReason = lineDefaultReason || '其他';
        specificLeaveType = lineDefaultLeaveType;
        i++;
      }
      entries.push({ name: info.name, reason: specificReason, leaveType: specificLeaveType });
    } else {
      i++;
    }
  }
  return entries;
}

// ============================================
// 备选解析策略
// ============================================
function parseStructuredFormat(originalText, cleanedText) {
  const groups = [];
  const lines = originalText.split('\n');
  let currentReason = '';
  let currentLeaveType = 'leaveInside';
  let currentBuffer = [];

  const flushBuffer = () => {
    if (currentBuffer.length > 0 && currentReason) {
      groups.push({ name: currentReason, reason: currentReason, leaveType: currentLeaveType, people: matchNames(currentBuffer) });
      currentBuffer = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) { flushBuffer(); continue; }
    const reasonInfo = detectReason(line);
    if (reasonInfo.found && isTitleLine(line, lines[i - 1], lines[i + 1])) {
      flushBuffer();
      currentReason = reasonInfo.reason;
      currentLeaveType = reasonInfo.leaveType;
      continue;
    }
    if (line.match(/^(\/+.*\/+|\+)/)) { flushBuffer(); continue; }
    const names = extractNamesFromLine(line);
    currentBuffer.push(...names);
  }
  flushBuffer();
  return groups;
}

function parseInlineFormat(originalText, cleanedText) {
  const groups = {};
  const lines = originalText.split('\n');
  lines.forEach(line => {
    line = line.trim();
    if (!line) return;
    if (isPureTitle(line)) return;
    const reasonInfo = detectReasonInLine(line);
    const cleanLine = reasonInfo.cleanLine || line;
    const names = extractNamesFromLine(cleanLine);
    if (names.length > 0 && reasonInfo.found) {
      const key = reasonInfo.leaveType + ':' + reasonInfo.reason;
      if (!groups[key]) groups[key] = { reason: reasonInfo.reason, leaveType: reasonInfo.leaveType, names: [] };
      groups[key].names.push(...names);
    }
  });
  return Object.values(groups).map(g => ({ ...g, people: matchNames(dedupeNameObjects(g.names)) }));
}

function parseMixedFormat(originalText, cleanedText) {
  const groups = {};
  const segments = originalText.split(/\n\s*\n/);
  segments.forEach(segment => {
    const lines = segment.split('\n').filter(l => l.trim());
    if (lines.length === 0) return;
    let segmentReason = null;
    let segmentLeaveType = 'leaveInside';
    const firstLineReason = detectReason(lines[0]);
    if (firstLineReason.found && lines[0].length < 20) {
      segmentReason = firstLineReason.reason;
      segmentLeaveType = firstLineReason.leaveType;
      lines.shift();
    }
    const allNames = [];
    lines.forEach(line => {
      const names = extractNamesFromLine(line);
      allNames.push(...names);
      if (!segmentReason) {
        const inlineReason = detectReasonInLine(line);
        if (inlineReason.found && allNames.length > 0) {
          const key = inlineReason.leaveType + ':' + inlineReason.reason;
          if (!groups[key]) groups[key] = { reason: inlineReason.reason, leaveType: inlineReason.leaveType, names: [] };
          groups[key].names.push(...allNames.splice(0));
        }
      }
    });
    if (segmentReason && allNames.length > 0) {
      const key = segmentLeaveType + ':' + segmentReason;
      if (!groups[key]) groups[key] = { reason: segmentReason, leaveType: segmentLeaveType, names: [] };
      groups[key].names.push(...allNames);
    }
  });
  return Object.values(groups).map(g => ({ ...g, people: matchNames(dedupeNameObjects(g.names)) }));
}

function parseLooseFormat(originalText, cleanedText) {
  const groups = {};
  const segments = originalText.split(/\n\s*\n/);
  segments.forEach(segment => {
    const lines = segment.split('\n').filter(l => l.trim());
    if (lines.length === 0) return;
    let segmentReason = null;
    let segmentLeaveType = 'leaveInside';
    const firstLineReason = detectReason(lines[0]);
    if (firstLineReason.found && lines[0].length < 20) {
      segmentReason = firstLineReason.reason;
      segmentLeaveType = firstLineReason.leaveType;
      lines.shift();
    }
    const allNames = [];
    lines.forEach(line => {
      const names = extractNamesFromLine(line);
      allNames.push(...names);
      if (!segmentReason) {
        const inlineReason = detectReasonInLine(line);
        if (inlineReason.found && allNames.length > 0) {
          const key = inlineReason.leaveType + ':' + inlineReason.reason;
          if (!groups[key]) groups[key] = { reason: inlineReason.reason, leaveType: inlineReason.leaveType, names: [] };
          groups[key].names.push(...allNames.splice(0));
        }
      }
    });
    if (segmentReason && allNames.length > 0) {
      const key = segmentLeaveType + ':' + segmentReason;
      if (!groups[key]) groups[key] = { reason: segmentReason, leaveType: segmentLeaveType, names: [] };
      groups[key].names.push(...allNames);
    }
  });
  return Object.values(groups).map(g => ({ ...g, people: matchNames(dedupeNameObjects(g.names)) }));
}

function parseFallback(originalText, cleanedText) {
  const allNames = extractNamesFromLine(originalText);
  if (allNames.length === 0) return [];
  let mainReason = '未分组';
  let mainLeaveType = 'leaveInside';
  const textLower = originalText.toLowerCase();
  for (const [keyword, mapped] of Object.entries(reasonKeywords)) {
    if (textLower.includes(keyword.toLowerCase())) {
      if (mapped === 'leaveSchool' || mapped === 'leaveOutside') {
        mainLeaveType = mapped;
        mainReason = mapped === 'leaveSchool' ? '请假离校' : '请假外出';
      } else {
        mainReason = mapped;
      }
      break;
    }
  }
  return [{ name: mainReason, reason: mainReason === '未分组' ? '' : mainReason, leaveType: mainLeaveType, people: matchNames(allNames) }];
}

// ============================================
// 智能解析入口
// ============================================
async function parseInput() {
  const text = document.getElementById('inputText').value.trim();
  if (!text) { showToast('请输入人名列表'); return; }

  if (navigator.vibrate) navigator.vibrate(15);

  state.groups = [];

  const preExtractedDate = extractDateRangeFromText(text);
  if (preExtractedDate) {
    state.dateRange = preExtractedDate;
  }

  const cleanedText = cleanInputText(text);
  state.lastCleanedText = cleanedText;

  showToast('正在智能分组...');

  try {
    const response = await fetch('/api/smart-group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleanedText })
    });
    const data = await response.json();

    if (!data.success || !data.groups || data.groups.length === 0) {
      throw new Error('智能分组失败');
    }

    state.groups = data.groups.map((g, idx) => {
      const isCustomReason = g.reason && !subReasons.includes(g.reason) && g.reason !== '其他';
      return {
        id: idx,
        name: g.reason,
        reason: g.reason,
        leaveType: g.leaveType,
        people: matchNames(g.people),
        showSubReasons: subReasons.includes(g.reason) || g.reason === '其他' || isCustomReason
      };
    });

    if (!preExtractedDate) {
      state.dateRange = data.dateRange || null;
    }

    state.lastParseResult = state.groups;
    updatePreviewPanel(text, cleanedText, state.groups);
    renderGroups();
    updateReport();
    updateDateRangeDisplay();

    document.getElementById('resultSection').classList.add('show');
    document.getElementById('previewSection').classList.add('show');
    document.getElementById('bottomActions').style.display = 'flex';
    document.getElementById('groupCount').textContent = state.groups.length;

    const totalMatched = state.groups.reduce((sum, g) => sum + g.people.filter(p => p.matched).length, 0);
    showToast('解析到 ' + state.groups.length + ' 组，共 ' + totalMatched + ' 人');
  } catch (error) {
    console.error('智能分组请求失败:', error);
    showToast('智能分组失败，正在使用本地解析...');
    fallbackParseInput(text, cleanedText);
  }
}

function fallbackParseInput(text, cleanedText) {
  const strategies = [parseSmartFormat, parseStructuredFormat, parseInlineFormat, parseMixedFormat, parseLooseFormat];
  let bestResult = null;
  let maxMatched = 0;

  for (const strategy of strategies) {
    const result = strategy(text, cleanedText);
    const matchedCount = result.reduce((sum, g) => sum + g.people.filter(p => p.matched).length, 0);
    if (matchedCount > maxMatched) { maxMatched = matchedCount; bestResult = result; }
    if (matchedCount >= 5) break;
  }

  if (!bestResult || bestResult.length === 0) {
    bestResult = parseFallback(text, cleanedText);
  }

  state.groups = bestResult.map((g, idx) => {
    const isCustomReason = g.reason && !subReasons.includes(g.reason) && g.reason !== '其他';
    return { ...g, id: idx, showSubReasons: subReasons.includes(g.reason) || g.reason === '其他' || isCustomReason };
  });

  state.lastParseResult = bestResult;
  updatePreviewPanel(text, cleanedText, bestResult);
  renderGroups();
  updateReport();
  updateDateRangeDisplay();

  document.getElementById('resultSection').classList.add('show');
  document.getElementById('previewSection').classList.add('show');
  document.getElementById('bottomActions').style.display = 'flex';
  document.getElementById('groupCount').textContent = state.groups.length;

  const totalMatched = state.groups.reduce((sum, g) => sum + g.people.filter(p => p.matched).length, 0);
  showToast('解析到 ' + state.groups.length + ' 组，共 ' + totalMatched + ' 人');
}

// ============================================
// 预览面板
// ============================================
function updatePreviewPanel(original, cleaned, result) {
  document.getElementById('originalPreview').textContent = original || '（空）';
  document.getElementById('cleanedPreview').textContent = cleaned || '（空）';

  let resultHtml = '';
  if (result && result.length > 0) {
    result.forEach((group) => {
      const matchedNames = group.people.filter(p => p.matched).map(p => p.name).join('、');
      const unmatchedNames = group.people.filter(p => !p.matched).map(p => p.name).join('、');
      const typeLabel = group.leaveType === 'leaveSchool' ? '[离校]' :
        group.leaveType === 'leaveOutside' ? '[外出]' : '[事假]';
      resultHtml += '【' + typeLabel + group.reason + '】\n';
      if (matchedNames) resultHtml += '  匹配: ' + matchedNames + '\n';
      if (unmatchedNames) resultHtml += '  未匹配: ' + unmatchedNames + '\n';
    });
  } else {
    resultHtml = '未识别到有效数据';
  }

  document.getElementById('resultPreview').innerHTML = resultHtml
    .replace(/【(.+?)】/g, '<span style="color:#2C436F;font-weight:600;">【$1】</span>')
    .replace(/匹配: (.+?)(?= 未匹配:|\n|$)/g, '匹配: <span style="color:#2C436F;">$1</span>')
    .replace(/未匹配: (.+?)(?=\n|$)/g, '未匹配: <span style="color:#ff8a00;">$1</span>')
    .replace(/\n/g, '<br>');
}

function togglePreview() {
  const section = document.getElementById('previewSection');
  section.classList.toggle('collapsed');
}

// ============================================
// UI 渲染
// ============================================
function renderGroups() {
  const container = document.getElementById('groupsContainer');

  container.innerHTML = state.groups.map(group => {
    const isCollapsed = state.collapsedStates[group.id] !== false;
    const isCustomReason = !subReasons.includes(group.reason) && group.reason !== '其他';
    const isSubReasonSelected = subReasons.includes(group.reason) && group.reason !== '其他';
    const subMenuBtnText = isSubReasonSelected
      ? '<i class="fas fa-chevron-down"></i> ' + group.reason
      : (group.showSubReasons || group.reason === '其他' || isCustomReason ? '<i class="fas fa-chevron-up"></i> 收起其他选项' : '<i class="fas fa-chevron-down"></i> 更多事由（分团委、学生会...）');
    const otherInputValue = isCustomReason ? group.reason : '';

    return `
    <div class="group-card ${isCollapsed ? 'collapsed' : ''}" data-group-id="${group.id}">
      <div class="group-header" onclick="toggleGroup(${group.id})">
        <div class="group-name">
          <i class="fas fa-chevron-down"></i>
          ${group.name} (${group.people.filter(p => p.matched && p.checked).length}/${group.people.filter(p => p.matched).length}人)
        </div>
        <div class="group-count">${group.people.filter(p => p.matched).length}人匹配</div>
      </div>
      <div class="group-body">
        <div class="type-section">
          <div class="label">请选择假单类型：</div>
          <div class="type-options">
            <label class="type-option ${group.leaveType === 'leaveSchool' ? 'selected' : ''}" onclick="setGroupType(${group.id}, 'leaveSchool')">
              <input type="radio" name="type_${group.id}" ${group.leaveType === 'leaveSchool' ? 'checked' : ''}>请假离校
            </label>
            <label class="type-option ${group.leaveType === 'leaveInside' ? 'selected' : ''}" onclick="setGroupType(${group.id}, 'leaveInside')">
              <input type="radio" name="type_${group.id}" ${group.leaveType === 'leaveInside' ? 'checked' : ''}>事假
            </label>
            <label class="type-option ${group.leaveType === 'leaveOutside' ? 'selected' : ''}" onclick="setGroupType(${group.id}, 'leaveOutside')">
              <input type="radio" name="type_${group.id}" ${group.leaveType === 'leaveOutside' ? 'checked' : ''}>请假外出
            </label>
          </div>
        </div>
        ${group.leaveType === 'leaveInside' ? `
        <div class="reason-section">
          <div class="label">事假事由：</div>
          <div class="reason-options" style="margin-bottom:8px;">
            ${['数分', '网安', '阿sir', '数实战', '网管', '篮球队', '辩论队', '备赛', '复习'].map(r => `
              <label class="reason-option ${group.reason === r ? 'selected' : ''}" onclick="setGroupReason(${group.id}, '${r}')">
                <input type="radio" name="reason_${group.id}" ${group.reason === r ? 'checked' : ''}>${r}
              </label>
            `).join('')}
          </div>
          <div class="reason-option has-children ${group.showSubReasons || group.reason === '其他' || isCustomReason ? 'selected' : ''}"
               onclick="toggleSubReasons(event, ${group.id})"
               style="width:100%; margin-bottom:8px; background:${group.showSubReasons || group.reason === '其他' || isCustomReason ? '#EAF0E2' : ''};">
            <span>${subMenuBtnText}</span>
          </div>
          ${group.showSubReasons || subReasons.includes(group.reason) || isCustomReason ? `
          <div class="sub-reason-menu" style="padding:12px; background:#EAF0E2; border-radius:8px; margin-bottom:12px; animation: slideDown 0.3s ease;">
            <div class="label" style="font-size:12px; color:#2C436F; margin-bottom:8px;">请选择具体事由：</div>
            <div class="reason-options">
              ${subReasons.map(r => `
                <label class="reason-option ${group.reason === r || (r === '其他' && isCustomReason) ? 'selected' : ''}"
                       onclick="setGroupReason(${group.id}, '${r}', true)"
                       style="${r === '其他' ? 'grid-column:span 2;' : ''}">
                  <input type="radio" name="reason_${group.id}" ${group.reason === r || (r === '其他' && isCustomReason) ? 'checked' : ''}>${r}
                </label>
              `).join('')}
            </div>
            <input type="text" class="reason-other-input ${group.reason === '其他' || isCustomReason ? 'show' : ''}"
                   placeholder="请输入其他事由" value="${otherInputValue}"
                   onchange="setGroupOtherReason(${group.id}, this.value)"
                   style="margin-top:8px; width:100%; padding:8px; border:1px solid #d9d9d9; border-radius:4px;">
          </div>
          ` : ''}
        </div>
        ` : ''}
        <div class="people-list">
          <div class="label">匹配结果（点击可取消勾选）：</div>
          ${group.people.filter(p => p.matched).map(p => `
            <div class="person-item ${p.matchType === 'fuzzy' ? 'fuzzy-match' : ''}" onclick="togglePerson(event, ${group.id}, '${p.name}')">
              <div class="person-checkbox ${p.checked ? 'checked' : ''}">${p.checked ? '<i class="fas fa-check"></i>' : ''}</div>
              <div class="person-info">
                <span class="person-name">${p.name}</span>
                ${p.matchType === 'fuzzy' ? '<i class="fas fa-exclamation-triangle fuzzy-warning" onclick="event.stopPropagation(); showToast(\'原识别为：' + p.originalInput + ' → 匹配为：' + p.name + '\')" title="点击查看原输入"></i>' : ''}
                <span class="person-location">${p.info.dorm}-${p.info.bed}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleGroup(groupId) {
  state.collapsedStates[groupId] = !state.collapsedStates[groupId];
  renderGroups();
}

function toggleSubReasons(event, groupId) {
  event.stopPropagation();
  event.preventDefault();
  const group = state.groups.find(g => g.id === groupId);
  if (group) {
    group.showSubReasons = !group.showSubReasons;
    renderGroups();
  }
}

function setGroupType(groupId, type) {
  const group = state.groups.find(g => g.id === groupId);
  if (group) {
    group.leaveType = type;
    if (type !== 'leaveInside') group.reason = '';
    renderGroups();
    updateReport();
  }
}

function setGroupReason(groupId, reason, isSub) {
  const group = state.groups.find(g => g.id === groupId);
  if (!group) return;
  group.reason = reason;
  if (isSub) group.showSubReasons = true;
  renderGroups();
  updateReport();
}

function setGroupOtherReason(groupId, value) {
  const group = state.groups.find(g => g.id === groupId);
  if (group && value.trim()) {
    group.reason = value.trim();
    group.name = value.trim();
    renderGroups();
    updateReport();
  }
}

function togglePerson(event, groupId, name) {
  const group = state.groups.find(g => g.id === groupId);
  if (!group) return;
  const person = group.people.find(p => p.name === name);
  if (!person) return;

  person.checked = !person.checked;
  if (navigator.vibrate) navigator.vibrate(10);

  const personItem = event.currentTarget;
  if (personItem) {
    const checkbox = personItem.querySelector('.person-checkbox');
    if (checkbox) {
      checkbox.classList.toggle('checked', person.checked);
      checkbox.innerHTML = person.checked ? '<i class="fas fa-check"></i>' : '';
      checkbox.classList.add('just-clicked');
      setTimeout(() => checkbox.classList.remove('just-clicked'), 200);
    }
  }

  const card = document.querySelector('.group-card[data-group-id="' + groupId + '"]');
  if (card) {
    const groupNameEl = card.querySelector('.group-name');
    if (groupNameEl) {
      const iEl = groupNameEl.querySelector('i');
      const iHtml = iEl ? iEl.outerHTML : '<i class="fas fa-chevron-down"></i>';
      groupNameEl.innerHTML = iHtml + ' ' + group.name + ' (' + group.people.filter(p => p.matched && p.checked).length + '/' + group.people.filter(p => p.matched).length + '人)';
    }
    const groupCountEl = card.querySelector('.group-count');
    if (groupCountEl) groupCountEl.textContent = group.people.filter(p => p.matched).length + '人匹配';
  }

  updateReport();
}

function updateDateRangeDisplay() {
  const el = document.getElementById('dateRangeDisplay');
  if (state.dateRange && state.dateRange.start && state.dateRange.end) {
    el.innerHTML = '请假时间：<span class="highlight">' + state.dateRange.start + ' 至 ' + state.dateRange.end + '</span>';
    el.classList.add('show');
  } else {
    el.classList.remove('show');
  }
}

function updateReport() {
  let report = '';
  const reasonGroups = {};
  const leaveSchoolList = [];
  const leaveOutsideList = [];

  state.groups.forEach(group => {
    group.people.forEach(p => {
      if (!p.checked) return;
      if (group.leaveType === 'leaveSchool') {
        leaveSchoolList.push(p);
      } else if (group.leaveType === 'leaveOutside') {
        leaveOutsideList.push(p);
      } else {
        const reason = group.reason || '未分组';
        if (!reasonGroups[reason]) reasonGroups[reason] = [];
        reasonGroups[reason].push(p);
      }
    });
  });

  const orderedReasons = ['数分', '网安', '阿sir', '数实战', '网管', '分团委', '学生会', '学习', '合唱团', '运动会', '警乐团', '羽毛球', '篮球队', '辩论队', '备赛', '复习', '校督', '其他'];
  orderedReasons.forEach(reason => {
    if (reasonGroups[reason] && reasonGroups[reason].length > 0) {
      report += reason + '：\n';
      reasonGroups[reason].forEach(p => {
        report += p.matched ? p.name + ' ' + p.info.dorm + '-' + p.info.bed + '\n' : p.name + '（未找到）\n';
      });
      report += '\n';
    }
  });

  Object.keys(reasonGroups).forEach(reason => {
    if (orderedReasons.includes(reason)) return;
    report += reason + '：\n';
    reasonGroups[reason].forEach(p => {
      report += p.matched ? p.name + ' ' + p.info.dorm + '-' + p.info.bed + '\n' : p.name + '（未找到）\n';
    });
    report += '\n';
  });

  if (leaveSchoolList.length > 0) {
    report += '请假离校：\n';
    leaveSchoolList.forEach(p => {
      report += p.matched ? p.name + ' ' + p.info.dorm + '-' + p.info.bed + '\n' : p.name + '（未找到）\n';
    });
    report += '\n';
  }

  if (leaveOutsideList.length > 0) {
    report += '请假外出：\n';
    leaveOutsideList.forEach(p => {
      report += p.matched ? p.name + ' ' + p.info.dorm + '-' + p.info.bed + '\n' : p.name + '（未找到）\n';
    });
    report += '\n';
  }

  document.getElementById('reportContent').textContent = report || '（暂无勾选人员）';
}

// ============================================
// 应用假单
// ============================================
function applyAll() {
  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get('mode');
  if (mode === 'ocr-pipeline' || mode === 'text-pipeline') {
    confirmAndReturn();
    return;
  }

  const updates = {};
  let count = 0;

  state.groups.forEach(group => {
    group.people.forEach(p => {
      if (!p.checked) return;
      let reason = '';
      if (group.leaveType === 'leaveInside') reason = group.reason || '其他';
      updates[p.name] = { status: group.leaveType, reason: reason };
      count++;
    });
  });

  if (count === 0) { showToast('请至少勾选一名人员'); return; }

  const dateRange = state.dateRange;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (dateRange && dateRange.start && dateRange.end) {
    const startDate = new Date(dateRange.start);
    const endDate = new Date(dateRange.end);
    if (endDate < today) { if (!confirm('该假单已过期，确认应用？')) return; }
    if (startDate > today) { if (!confirm('该假单尚未生效（开始日期为 ' + dateRange.start + '），是否仍要提前应用？')) return; }
  }

  if (navigator.vibrate) navigator.vibrate([30, 50, 30]);

  const pendingData = { dateRange: dateRange, records: updates };
  localStorage.setItem('pendingLeaveRecords', JSON.stringify(pendingData));
  showToast('成功设置 ' + count + ' 条假单');

  setTimeout(() => { window.location.href = 'index.html'; }, 1000);
}

// ============================================
// 导航
// ============================================
function goBack() {
  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get('mode');
  if (mode === 'ocr-pipeline' || mode === 'text-pipeline') {
    goBackToUpload();
    return;
  }
  window.location.href = 'index.html';
}

// ============================================
// 复制相关
// ============================================
function setupCopyOnClick() {
  const elements = [
    { id: 'originalPreview', label: '原始文本' },
    { id: 'cleanedPreview', label: '清洗后文本' },
    { id: 'resultPreview', label: '识别结果' },
    { id: 'reportContent', label: '报告预览' }
  ];

  elements.forEach(({ id, label }) => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('copyable');
      el.addEventListener('click', async () => {
        const text = el.textContent || '';
        try {
          await navigator.clipboard.writeText(text);
          showToast('已复制' + label);
        } catch (e) {
          fallbackCopy(text);
          showToast('已复制' + label);
        }
      });
    }
  });
}

function copyPromptText() {
  const text = '提取图片中人名并以空格间隔';
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showToast('已复制')).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}
