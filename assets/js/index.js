// assets/js/index.js — 查寝主页逻辑

// ============================================
// 搜索防抖定时器
// ============================================
let searchDebounceTimer = null;

// ============================================
// 全局状态管理
// ============================================
const state = {
  currentFloor: 5,
  currentGrade: 'all', // v17.5: 年级筛选
  activeFilters: new Set(['all']),
  viewMode: 'list',
  currentDorm: null,
  studentStatus: {},
  floorDorms: {},
  pendingStudent: null
};

// ============================================
// 从后端 API 加载宿舍数据
// ============================================
async function loadDormData() {
  try {
    const token = sessionStorage.getItem('authToken');
    if (!token) {
      showToast('未登录，请重新登录');
      setTimeout(() => { window.location.replace('login.html'); }, 1000);
      return;
    }

    let data;
    try {
      const pin = sessionStorage.getItem('access_password_value') || '';
      data = await getDormData(pin);
    } catch (e) {
      if (e.message.includes('401')) {
        sessionStorage.removeItem('authToken');
        sessionStorage.removeItem('loggedIn');
        showToast('登录已过期，请重新登录');
        hideDormLoading();
        setTimeout(() => { window.location.replace('login.html'); }, 1500);
        return;
      }
      throw e;
    }
    window.dormData = data.dormData;
    window.nameIndex = data.nameIndex;

    document.getElementById('loadingOverlay').classList.add('hidden');
    initApp();
  } catch (error) {
    console.error('加载宿舍数据失败:', error);
    hideDormLoading();
    document.getElementById('loadingError').classList.add('show');
  }
}

function hideDormLoading() {
  const spinner = document.querySelector('.loading-spinner-large');
  const text = document.querySelector('.loading-text');
  if (spinner) spinner.style.display = 'none';
  if (text) text.style.display = 'none';
}

function initApp() {
  restoreState();
  renderDormList();

  // v18: 网络恢复后处理离线同步队列
  if (typeof processSyncQueue === 'function') {
    processSyncQueue();
  }

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('applyLeaves') === '1') {
    applyPendingLeaves();
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  applyPendingLeaves();
}

// ============================================
// 核心工具函数
// ============================================

function getFloorByDorm(dormNumber) {
  const num = parseInt(dormNumber);
  if (num >= 100 && num < 200) return 1;
  if (num >= 400 && num < 500) return 4;
  if (num >= 500 && num < 600) return 5;
  if (num >= 600 && num < 700) return 6;
  return 5;
}

function getShortGrade(gradeStr) {
  return gradeStr.replace('级', '').slice(-2);
}

function getDormsOnFloor(floor) {
  if (floor === 'all') {
    const allDorms = new Set();
    for (const grade in dormData) {
      for (const className in dormData[grade]) {
        for (const dorm in dormData[grade][className]) {
          allDorms.add(dorm);
        }
      }
    }
    return Array.from(allDorms).sort((a, b) => parseInt(a) - parseInt(b));
  }

  if (state.floorDorms[floor]) return state.floorDorms[floor];
  const dorms = new Set();
  for (const grade in dormData) {
    for (const className in dormData[grade]) {
      for (const dorm in dormData[grade][className]) {
        if (getFloorByDorm(dorm) === floor) dorms.add(dorm);
      }
    }
  }
  const sorted = Array.from(dorms).sort((a, b) => parseInt(a) - parseInt(b));
  state.floorDorms[floor] = sorted;
  return sorted;
}

function getStudentsInDorm(dormNumber) {
  const students = [];
  for (const grade in dormData) {
    for (const className in dormData[grade]) {
      const dormInfo = dormData[grade][className][dormNumber];
      if (dormInfo) {
        dormInfo.forEach((name, index) => {
          if (name) {
            students.push({
              name: name,
              grade: grade,
              className: className,
              dorm: dormNumber,
              bed: index + 1
            });
          }
        });
      }
    }
  }
  return students.sort((a, b) => a.bed - b.bed);
}

function getAllStudentsByGrade() {
  const result = {};
  for (const grade in dormData) {
    result[grade] = [];
    for (const className in dormData[grade]) {
      for (const dorm in dormData[grade][className]) {
        dormData[grade][className][dorm].forEach((name, index) => {
          if (name) {
            result[grade].push({ name, grade, className, dorm, bed: index + 1 });
          }
        });
      }
    }
  }
  return result;
}

function matchesActiveFilters(studentName) {
  if (state.activeFilters.has('all')) return true;
  const st = state.studentStatus[studentName] || { status: 'in' };
  let match = false;
  state.activeFilters.forEach(f => {
    if (Array.isArray(st.status)) {
      if (st.status.includes(f)) match = true;
    } else {
      if (st.status === f) match = true;
    }
  });
  return match;
}

function getStatusDisplay(statusObj) {
  if (!statusObj || statusObj.status === 'in') return '在寝';

  const studioShortNames = {
    '数据分析工作室': '数分', '数据实战工作室': '数实战',
    '网安工作室': '网安', '舆情工作室': '舆情',
    '网管工作室': '网管', '阿sir工作室': '阿sir'
  };

  if (Array.isArray(statusObj.status)) {
    const statusTexts = [];
    if (statusObj.status.includes('leaveInside')) {
      const sub = statusObj.subReason;
      statusTexts.push((sub && studioShortNames[sub]) ? studioShortNames[sub] : (statusObj.reason || '事假'));
    }
    if (statusObj.status.includes('absent')) {
      statusTexts.push('未归');
    }
    return statusTexts.join('+');
  }

  switch (statusObj.status) {
    case 'leaveSchool': return '离校';
    case 'leaveInside': {
      const sub = statusObj.subReason;
      return (sub && studioShortNames[sub]) ? studioShortNames[sub] : (statusObj.reason || '事假');
    }
    case 'leaveOutside': return '外出';
    case 'absent': return '未归';
    default: return '在寝';
  }
}

// ============================================
// 报告生成函数
// ============================================

let currentReportMode = 'absent';
let gradeFilter = 'all';

// grade 字段格式为 "2023级"（由 year_code 构造），需映射为 grade_name 做白名单匹配
const GRADE_FILTER_MAP = {
  'all': null,
  'no-junior': ['大一', '大二', '大四'],
  'only-underclass': ['大一', '大二']
};

function gradeCodeToName(gradeCode) {
  const map = { '2025级': '大一', '2024级': '大二', '2023级': '大三', '2022级': '大四' };
  return map[gradeCode] || gradeCode;
}

function shouldIncludeGrade(gradeCode) {
  const allowed = GRADE_FILTER_MAP[gradeFilter];
  if (!allowed) return true;  // 'all' → 全部包含
  return allowed.includes(gradeCodeToName(gradeCode));
}

function generateReportText() {
  const conflictNames = [];
  for (const name in state.studentStatus) {
    const statusObj = state.studentStatus[name];
    if (Array.isArray(statusObj.status)) {
      if (statusObj.status.includes('absent') && statusObj.status.includes('leaveInside')) {
        conflictNames.push(name);
      }
    }
  }

  if (conflictNames.length > 0) {
    showToast('无法生成报告：' + conflictNames.join('、') + ' 同时标记为未归和事假');
    return { overview: '【错误】存在冲突标记，请先修正', summary: '' };
  }

  const now = new Date();
  const month = now.getMonth() + 1;
  const date = now.getDate();

  const studentsByGrade = getAllStudentsByGrade();
  const gradeOrderDesc = ['2025级', '2024级', '2023级', '2022级'];
  const gradeOrderAsc = ['2022级', '2023级', '2024级', '2025级'];

  let totalShould = 0, totalActual = 0;
  let totalLeaveSchool = 0, totalBusiness = 0, totalNotReturn = 0, totalLeaveOut = 0;
  const gradeStats = {};

  gradeOrderDesc.forEach(grade => {
    if (!shouldIncludeGrade(grade)) return;
    const students = studentsByGrade[grade] || [];
    const should = students.length;

    const leaveSchool = [];
    const business = [];
    const notReturn = [];
    const leaveOut = [];

    students.forEach(s => {
      const st = state.studentStatus[s.name] || { status: 'in' };
      const statuses = Array.isArray(st.status) ? st.status : [st.status];
      if (statuses.includes('leaveSchool')) leaveSchool.push({...s, reason: st.reason});
      if (statuses.includes('leaveInside')) business.push({...s, reason: st.reason || '其他'});
      if (statuses.includes('leaveOutside')) leaveOut.push({...s, reason: st.reason});
      if (statuses.includes('absent')) notReturn.push({...s});
    });

    const inSchool = should - leaveSchool.length;
    const normalSleep = inSchool - business.length - leaveOut.length;
    const actual = normalSleep - notReturn.length;

    gradeStats[grade] = { should, actual, inSchool, normalSleep, leaveSchool, business, notReturn, leaveOut };

    totalShould += should;
    totalActual += actual;
    totalLeaveSchool += leaveSchool.length;
    totalBusiness += business.length;
    totalNotReturn += notReturn.length;
    totalLeaveOut += leaveOut.length;
  });

  let overview = '';
  overview += month + '月' + date + '日晚寝\n';
  overview += '女生情况:应到' + totalShould + ' 实到' + totalActual + '\n';
  overview += '合:' + totalLeaveSchool + '人请假离校 ' + totalBusiness + '人事假 ' + totalNotReturn + '人未返校 ' + totalLeaveOut + '人请假外出\n';

  gradeOrderDesc.forEach(grade => {
    if (!shouldIncludeGrade(grade)) return;
    const stats = gradeStats[grade];
    if (!stats) return;
    const shortGrade = getShortGrade(grade);

    overview += shortGrade + '级应到' + stats.should + ' 实到' + stats.actual + '\n';

    if (stats.business.length > 0) {
      const studioReasons = ['数分', '网安', '阿sir', '数实战', '网管', '舆情', '工作室', '数据分析工作室', '数据实战工作室', '网安工作室', '舆情工作室', '网管工作室', '阿sir工作室'];
      const reasonCount = {};
      stats.business.forEach(s => {
        let r = s.reason || '其他';
        if (studioReasons.includes(r) || (s.subReason && studioReasons.includes(s.subReason))) { r = '工作室'; }
        reasonCount[r] = (reasonCount[r] || 0) + 1;
      });
      const reasonOrder = ['工作室', '备赛', '辩论队', '复习', '学习', '校督', '分团委', '学生会', '合唱团', '运动会', '警乐团', '羽毛球', '篮球队', '其他'];
      const reasonStrParts = reasonOrder.filter(r => reasonCount[r]).map(r => reasonCount[r] + r);
      Object.keys(reasonCount).forEach(r => {
        if (!reasonOrder.includes(r)) { reasonStrParts.push(reasonCount[r] + r); }
      });
      overview += stats.business.length + '事假（' + reasonStrParts.join(' ') + '）\n';
      overview += stats.business.map(s => s.name).join(' ') + '\n';
    }

    if (stats.leaveSchool.length > 0) {
      overview += stats.leaveSchool.length + '请假离校\n';
      overview += stats.leaveSchool.map(s => s.name).join(' ') + '\n';
    }

    if (stats.leaveOut.length > 0) {
      overview += stats.leaveOut.length + '请假外出\n';
      overview += stats.leaveOut.map(s => s.name).join(' ') + '\n';
    }

    if (stats.notReturn.length > 0) {
      overview += stats.notReturn.length + '未返校\n';
      overview += stats.notReturn.map(s => s.name).join(' ') + '\n';
    }
  });

  let summary = '';
  gradeOrderAsc.forEach(grade => {
    if (!shouldIncludeGrade(grade)) return;
    const stats = gradeStats[grade];
    if (!stats) return;
    let line = grade + '应到' + stats.should + ' 在校' + stats.inSchool + ' 正常就寝' + stats.normalSleep;
    if (stats.leaveSchool.length > 0) { line += ' ' + stats.leaveSchool.length + '人请假离校'; }
    if (stats.business.length > 0) { line += ' ' + stats.business.length + '人事假'; }
    if (stats.leaveOut.length > 0) { line += ' ' + stats.leaveOut.length + '人请假外出'; }
    summary += line + '\n';
  });

  return { overview, summary };
}

function generatePresentReportText() {
  const conflictNames = [];
  for (const name in state.studentStatus) {
    const statusObj = state.studentStatus[name];
    if (Array.isArray(statusObj.status)) {
      if (statusObj.status.includes('absent') && statusObj.status.includes('leaveInside')) {
        conflictNames.push(name);
      }
    }
  }
  if (conflictNames.length > 0) {
    showToast('无法生成报告：' + conflictNames.join('、') + ' 同时标记为未归和事假');
    return { overview: '【错误】存在冲突标记，请先修正', summary: '' };
  }

  const now = new Date();
  const month = now.getMonth() + 1;
  const date = now.getDate();
  const studentsByGrade = getAllStudentsByGrade();
  const gradeOrderDesc = ['2025级', '2024级', '2023级', '2022级'];

  let totalShould = 0, totalPresent = 0;
  let totalLeaveSchool = 0, totalBusiness = 0, totalNotReturn = 0, totalLeaveOut = 0;
  const gradeStats = {};

  gradeOrderDesc.forEach(grade => {
    if (!shouldIncludeGrade(grade)) return;
    const students = studentsByGrade[grade] || [];
    const should = students.length;
    const leaveSchool = [], business = [], notReturn = [], leaveOut = [], present = [];

    students.forEach(s => {
      const st = state.studentStatus[s.name] || { status: 'in' };
      const statuses = Array.isArray(st.status) ? st.status : [st.status];
      if (statuses.includes('leaveSchool')) leaveSchool.push({...s, reason: st.reason});
      if (statuses.includes('leaveInside')) business.push({...s, reason: st.reason || '其他'});
      if (statuses.includes('leaveOutside')) leaveOut.push({...s, reason: st.reason});
      if (statuses.includes('absent')) notReturn.push({...s});
      if (statuses[0] === 'in') present.push({...s});
    });

    gradeStats[grade] = { should, presentCount: present.length, present, leaveSchool, business, notReturn, leaveOut };
    totalShould += should;
    totalPresent += present.length;
    totalLeaveSchool += leaveSchool.length;
    totalBusiness += business.length;
    totalNotReturn += notReturn.length;
    totalLeaveOut += leaveOut.length;
  });

  let overview = '';
  overview += month + '月' + date + '日晚寝\n';
  overview += '女生情况:应到' + totalShould + ' 实到' + totalPresent + '\n';
  overview += '合:' + totalLeaveSchool + '人请假离校 ' + totalBusiness + '人事假 ' + totalNotReturn + '人未返校 ' + totalLeaveOut + '人请假外出\n';

  gradeOrderDesc.forEach(grade => {
    if (!shouldIncludeGrade(grade)) return;
    const stats = gradeStats[grade];
    if (!stats) return;
    const shortGrade = getShortGrade(grade);
    overview += shortGrade + '级应到' + stats.should + ' 实到' + stats.presentCount + '\n';
    overview += stats.presentCount + '在校\n';
    if (stats.present.length > 0) {
      overview += stats.present.map(s => s.name).join(' ') + '\n';
    }
  });

  let summary = '';
  gradeOrderDesc.forEach(grade => {
    if (!shouldIncludeGrade(grade)) return;
    const stats = gradeStats[grade];
    if (!stats) return;
    const inSchool = stats.should - stats.leaveSchool.length;
    const normalSleep = inSchool - stats.business.length - stats.leaveOut.length;
    let line = grade + '应到' + stats.should + ' 在校' + inSchool + ' 正常就寝' + normalSleep;
    if (stats.leaveSchool.length > 0) { line += ' ' + stats.leaveSchool.length + '人请假离校'; }
    if (stats.business.length > 0) { line += ' ' + stats.business.length + '人事假'; }
    if (stats.leaveOut.length > 0) { line += ' ' + stats.leaveOut.length + '人请假外出'; }
    summary += line + '\n';
  });

  return { overview, summary };
}

function generateVacationReportText() {
  const conflictNames = [];
  for (const name in state.studentStatus) {
    const statusObj = state.studentStatus[name];
    if (Array.isArray(statusObj.status)) {
      if (statusObj.status.includes('absent') && statusObj.status.includes('leaveInside')) {
        conflictNames.push(name);
      }
    }
  }
  if (conflictNames.length > 0) {
    showToast('无法生成报告：' + conflictNames.join('、') + ' 同时标记为未归和事假');
    return { overview: '【错误】存在冲突标记，请先修正', summary: '' };
  }

  const studentsByGrade = getAllStudentsByGrade();
  const gradeOrder = ['2022级', '2023级', '2024级', '2025级'];
  let totalShould = 0, totalPresent = 0;
  const gradeStats = {};

  gradeOrder.forEach(grade => {
    if (!shouldIncludeGrade(grade)) return;
    const students = studentsByGrade[grade] || [];
    const should = students.length;
    const leaveSchoolCount = students.filter(s => {
      const st = state.studentStatus[s.name];
      if (!st) return false;
      const statuses = Array.isArray(st.status) ? st.status : [st.status];
      return statuses.includes('leaveSchool');
    }).length;
    const present = should - leaveSchoolCount;
    gradeStats[grade] = { should, present };
    totalShould += should;
    totalPresent += present;
  });

  let overview = '信息大队女生' + totalShould + '名，在校' + totalPresent + '名，正常就寝' + totalPresent + '名，其中：\n';
  gradeOrder.forEach((grade, index) => {
    if (!shouldIncludeGrade(grade)) return;
    const stats = gradeStats[grade];
    if (!stats) return;
    const shortGrade = grade.replace('级', '').slice(-2);
    const line = shortGrade + '级女生' + stats.should + '名，在校' + stats.present + '名，正常就寝' + stats.present + '名';
    if (index < gradeOrder.length - 1) {
      overview += line + '；\n';
    } else {
      overview += line + '\n';
    }
  });
  overview += '所有就寝学生已按要求熄灯。';
  let summary = '';
  gradeOrder.forEach(grade => {
    if (!shouldIncludeGrade(grade)) return;
    const stats = gradeStats[grade];
    if (!stats) return;
    summary += grade + '应到' + stats.should + ' 在校' + stats.present + ' 正常就寝' + stats.present + '\n';
  });
  return { overview, summary };
}

function switchReportMode(type) {
  currentReportMode = type;
  document.getElementById('btnAbsent').classList.toggle('active', type === 'absent');
  document.getElementById('btnPresent').classList.toggle('active', type === 'present');
  document.getElementById('btnVacation').classList.toggle('active', type === 'vacation');
  if (window.reportTabsInstance) window.reportTabsInstance.moveThumbToActive();

  let result;
  switch (type) {
    case 'absent': result = generateReportText(); break;
    case 'present': result = generatePresentReportText(); break;
    case 'vacation': result = generateVacationReportText(); break;
    default: result = generateReportText();
  }
  document.getElementById('reportOverview').textContent = result.overview;
  document.getElementById('reportSummary').textContent = result.summary || '';
}

function onGradeFilterChange() {
  gradeFilter = document.getElementById('gradeFilter').value;
  switchReportMode(currentReportMode);
}

// ============================================
// 搜索功能（含模糊匹配）
// ============================================

let searchKeyword = '';

function handleSearch(keyword) {
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }
  searchDebounceTimer = setTimeout(() => {
    searchKeyword = keyword.trim().toLowerCase();
    document.getElementById('clearSearch').style.display = searchKeyword ? 'flex' : 'none';

    const resultInfo = document.getElementById('searchResultInfo');
    if (searchKeyword) {
      const matchedCount = countMatchedPeople();
      resultInfo.textContent = '找到 ' + matchedCount + ' 人';
      resultInfo.classList.remove('hide');
    } else {
      resultInfo.classList.add('hide');
    }

    refreshView();
  }, 300);
}

function clearSearch() {
  document.getElementById('searchInput').value = '';
  handleSearch('');
}

function countMatchedPeople() {
  if (!searchKeyword) return 0;
  let count = 0;
  const dorms = getDormsOnFloor('all');
  dorms.forEach(dormNumber => {
    const students = getStudentsInDorm(dormNumber);
    students.forEach(s => {
      if (isSearchMatch(s)) count++;
    });
  });
  return count;
}

function isSearchMatch(student) {
  if (!searchKeyword) return true;
  const k = searchKeyword;
  if ((student.name && student.name.includes(k)) ||
      (student.className && student.className.includes(k)) ||
      (student.dorm && student.dorm.includes(k))) {
    return true;
  }
  return false;
}

// ============================================
// 视图渲染函数
// ============================================

function renderDormList() {
  const container = document.getElementById('dormContainer');
  const searchActive = !!searchKeyword;
  const dorms = searchActive ? getDormsOnFloor('all') : getDormsOnFloor(state.currentFloor);

  if (dorms.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-building"></i><p>该楼层暂无宿舍数据</p></div>';
    updateStats(0, 0, 0, 0, 0);
    return;
  }

  let html = '';
  let totalCount = 0;
  let absentCount = 0, leaveSchoolCount = 0, leaveInsideCount = 0, leaveOutsideCount = 0;

  dorms.forEach(dormNumber => {
    const students = getStudentsInDorm(dormNumber);

    const filtered = students.filter(s => {
      if (!isSearchMatch(s)) return false;
      if (!matchesGradeFilter(s)) return false; // v17.5: 年级筛选
      if (searchActive) return true;
      return matchesActiveFilters(s.name);
    });

    filtered.forEach(s => {
      const st = state.studentStatus[s.name] || { status: 'in' };
      totalCount++;
      if (Array.isArray(st.status)) {
        if (st.status.includes('absent')) absentCount++;
        if (st.status.includes('leaveSchool')) leaveSchoolCount++;
        if (st.status.includes('leaveInside')) leaveInsideCount++;
        if (st.status.includes('leaveOutside')) leaveOutsideCount++;
      } else {
        if (st.status === 'absent') absentCount++;
        if (st.status === 'leaveSchool') leaveSchoolCount++;
        if (st.status === 'leaveInside') leaveInsideCount++;
        if (st.status === 'leaveOutside') leaveOutsideCount++;
      }
    });

    if (filtered.length === 0) return;
    html += renderDormCard(dormNumber, filtered, students.length);
  });

  requestAnimationFrame(() => {
    container.innerHTML = html || '<div class="empty-state"><i class="fas fa-filter"></i><p>没有符合条件的学生</p></div>';
    updateStats(totalCount, absentCount, leaveSchoolCount, leaveInsideCount, leaveOutsideCount);
  });
}

function renderSingleDorm() {
  const container = document.getElementById('dormContainer');
  const dorms = getDormsOnFloor(state.currentFloor);
  const currentIndex = dorms.indexOf(state.currentDorm);
  const prevDorm = currentIndex > 0 ? dorms[currentIndex - 1] : null;
  const nextDorm = currentIndex < dorms.length - 1 ? dorms[currentIndex + 1] : null;

  const students = getStudentsInDorm(state.currentDorm);
  const filtered = students.filter(s => isSearchMatch(s) && matchesActiveFilters(s.name) && matchesGradeFilter(s));
  let totalCount = filtered.length;
  let absentCount = 0, leaveSchoolCount = 0, leaveInsideCount = 0, leaveOutsideCount = 0;

  filtered.forEach(s => {
    const st = state.studentStatus[s.name] || { status: 'in' };
    if (st.status === 'absent' || (Array.isArray(st.status) && st.status.includes('absent'))) absentCount++;
    if (st.status === 'leaveSchool' || (Array.isArray(st.status) && st.status.includes('leaveSchool'))) leaveSchoolCount++;
    if (st.status === 'leaveInside' || (Array.isArray(st.status) && st.status.includes('leaveInside'))) leaveInsideCount++;
    if (st.status === 'leaveOutside' || (Array.isArray(st.status) && st.status.includes('leaveOutside'))) leaveOutsideCount++;
  });

  requestAnimationFrame(() => {
    container.innerHTML = '<div class="single-dorm-view"><div class="dorm-card">' +
      '<div class="dorm-nav">' +
        '<button class="dorm-nav-btn" ' + (!prevDorm ? 'disabled' : '') + ' onclick="goToDorm(\'' + (prevDorm || '') + '\')"><i class="fas fa-chevron-left"></i></button>' +
        '<div class="dorm-nav-current" onclick="backToList()">' + state.currentDorm + '宿舍</div>' +
        '<button class="dorm-nav-btn" ' + (!nextDorm ? 'disabled' : '') + ' onclick="goToDorm(\'' + (nextDorm || '') + '\')"><i class="fas fa-chevron-right"></i></button>' +
      '</div>' +
      '<div class="student-list">' + filtered.map(s => renderStudentItem(s)).join('') + '</div>' +
    '</div></div>';
    updateStats(totalCount, absentCount, leaveSchoolCount, leaveInsideCount, leaveOutsideCount);
  });
}

function renderDormCard(dormNumber, students, totalBeds) {
  const searchActive = !!searchKeyword;
  return '<div class="dorm-card' + (searchActive ? ' search-matched' : '') + '" onclick="enterDorm(\'' + dormNumber + '\')">' +
    '<div class="dorm-header">' +
      '<span class="dorm-title">' + dormNumber + '宿舍</span>' +
      '<span class="dorm-count">' + students.length + '人</span>' +
    '</div>' +
    '<div class="student-list">' + students.map(s => renderStudentItem(s)).join('') + '</div>' +
  '</div>';
}

function renderStudentItem(student) {
  const st = state.studentStatus[student.name] || { status: 'in' };
  const statusText = getStatusDisplay(st);
  const hasAbsent = st.status === 'absent' || (Array.isArray(st.status) && st.status.includes('absent'));
  const hasLeaveInside = st.status === 'leaveInside' || (Array.isArray(st.status) && st.status.includes('leaveInside'));
  const displayName = searchKeyword ? highlightMatch(student.name, searchKeyword) : escapeHtml(student.name);
  const safeName = student.name.replace(/'/g, "\\'");

  return '<div class="student-item">' +
    '<div class="student-info" style="margin-left: 0;">' +
      '<div style="display: flex; align-items: center;">' +
        '<span class="student-name">' + displayName + '</span>' +
        '<button class="copy-name-btn" onclick="event.stopPropagation(); copyStudentName(\'' + safeName + '\', event)" title="复制姓名">' +
          '<i class="fas fa-copy"></i>' +
        '</button>' +
      '</div>' +
      '<span class="student-meta">' + student.grade + ' ' + student.className + ' | ' + student.bed + '号床 ' + (st.status !== 'in' ? '| ' + statusText : '') + '</span>' +
    '</div>' +
    '<div class="status-tags">' +
      '<button class="status-tag in ' + (st.status === 'in' ? 'active' : '') + '" onclick="event.stopPropagation(); setStatus(\'' + safeName + '\', \'in\')">在寝</button>' +
      '<button class="status-tag leaveSchool ' + (st.status === 'leaveSchool' ? 'active' : '') + '" onclick="event.stopPropagation(); setStatus(\'' + safeName + '\', \'leaveSchool\')">离校</button>' +
      '<button class="status-tag leaveInside ' + (hasLeaveInside ? 'active' : '') + '" onclick="event.stopPropagation(); setStatus(\'' + safeName + '\', \'leaveInside\')">事假</button>' +
      '<button class="status-tag leaveOutside ' + (st.status === 'leaveOutside' ? 'active' : '') + '" onclick="event.stopPropagation(); setStatus(\'' + safeName + '\', \'leaveOutside\')">外出</button>' +
      '<button class="status-tag absent ' + (hasAbsent ? 'active' : '') + '" onclick="event.stopPropagation(); toggleStatus(\'' + safeName + '\', \'absent\')">未归</button>' +
    '</div>' +
  '</div>';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function highlightMatch(text, keyword) {
  if (!keyword) return escapeHtml(text);
  const escaped = escapeHtml(text);
  const escapedKw = escapeHtml(keyword);
  const idx = escaped.toLowerCase().indexOf(escapedKw.toLowerCase());
  if (idx >= 0) {
    return escaped.substring(0, idx) + '<mark class="search-highlight">' + escaped.substring(idx, idx + escapedKw.length) + '</mark>' + escaped.substring(idx + escapedKw.length);
  }
  return escaped;
}

function updateStats(total, absent, leaveSchool, leaveInside, leaveOutside) {
  document.getElementById('bottomStats').innerHTML =
    '当前显示 <strong>' + total + '</strong> 人' +
    '（未归 <span class="highlight">' + absent + '</span>，' +
    '离校 ' + leaveSchool + '，' +
    '事假 ' + leaveInside + '，' +
    '外出 ' + leaveOutside + '）';
}

// ============================================
// 交互处理函数
// ============================================

function switchFloor(floor) {
  state.currentFloor = floor;
  state.viewMode = 'list';
  state.currentDorm = null;
  document.querySelectorAll('#floorTabs .neu-tab').forEach(tab => {
    if (floor === 'all') {
      tab.classList.toggle('active', tab.dataset.floor === 'all');
    } else {
      tab.classList.toggle('active', parseInt(tab.dataset.floor) === floor);
    }
  });
  if (window.floorTabsInstance) window.floorTabsInstance.moveThumbToActive();
  updateFilterInfo();
  renderDormList();
}

// v17.5: 年级筛选
function switchGrade(grade) {
  state.currentGrade = grade;
  document.querySelectorAll('#gradeTabs .neu-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.grade === grade);
  });
  if (window.gradeTabsInstance) window.gradeTabsInstance.moveThumbToActive();
  // 更新筛选信息
  updateFilterInfo();
  refreshView();
}

function matchesGradeFilter(student) {
  if (state.currentGrade === 'all') return true;
  return student.grade === state.currentGrade;
}

function updateFilterInfo() {
  const gradeMap = { '2022级': '大四', '2023级': '大三', '2024级': '大二', '2025级': '大一' };
  const gradeText = state.currentGrade === 'all' ? '全部年级' : (gradeMap[state.currentGrade] || state.currentGrade);
  const floorText = state.currentFloor === 'all' ? '全部楼层' : state.currentFloor + 'F';
  document.getElementById('currentFloor').textContent = floorText;
  document.getElementById('currentGrade').textContent = gradeText;
}

function switchFilter(filter) {
  if (filter === 'all') {
    state.activeFilters.clear();
  } else {
    state.activeFilters.delete('all');
    if (state.activeFilters.has(filter)) {
      state.activeFilters.delete(filter);
    } else {
      state.activeFilters.add(filter);
    }
  }
  // If no filters active, show all
  if (state.activeFilters.size === 0) {
    state.activeFilters.add('all');
  }

  updateFilterUI();
  if (state.viewMode === 'single' && state.currentDorm) renderSwipeDorm(state.currentDorm);
  else renderDormList();
}

function updateFilterUI() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    const f = btn.dataset.filter;
    btn.classList.toggle('active', state.activeFilters.has(f));
  });
  const names = { 'all': '全部', 'absent': '未归', 'leaveSchool': '离校', 'leaveInside': '事假', 'leaveOutside': '外出' };
  const activeNames = Array.from(state.activeFilters).map(f => names[f] || f);
  document.getElementById('currentFilter').textContent = activeNames.join('+') || '全部';
}

function enterDorm(dormNumber) {
  state.viewMode = 'single';
  state.currentDorm = dormNumber;
  renderSwipeDorm(dormNumber);
}

function backToList() {
  state.viewMode = 'list';
  state.currentDorm = null;
  renderDormList();
}

function goToDorm(dormNumber) {
  if (!dormNumber) return;
  state.viewMode = 'single';
  state.currentDorm = dormNumber;
  renderSwipeDorm(dormNumber);
}

function setStatus(name, status) {
  const current = state.studentStatus[name] || { status: 'in' };
  const oldEffective = Array.isArray(current.status)
    ? (current.status.length === 1 ? current.status[0] : current.status[current.status.length - 1])
    : current.status;

  if (status === 'leaveInside') {
    // 已有事由时再次点击事假 → 取消标记
    if (oldEffective === 'leaveInside' && current.reason) {
      state.studentStatus[name] = { status: 'in' };
      if (navigator.vibrate) navigator.vibrate(15);
      autoSaveState();
      syncToRoomIfMulti(name, 'in');
      showStatusChangeToast(name, 'leaveInside', 'in');
      refreshView();
      return;
    }
    showLeaveInsideOptions(name);
    return;
  }

  // 点击已激活状态 → 取消标记
  if (oldEffective === status && status !== 'in') {
    state.studentStatus[name] = { status: 'in' };
    if (navigator.vibrate) navigator.vibrate(15);
    autoSaveState();
    syncToRoomIfMulti(name, 'in');
    showStatusChangeToast(name, status, 'in');
    refreshView();
    return;
  }

  state.studentStatus[name] = { status: status };
  if (navigator.vibrate) navigator.vibrate(15);
  showStatusChangeToast(name, oldEffective, status);
  autoSaveState();
  syncToRoomIfMulti(name, status);
  refreshView();
}

function showStatusChangeToast(studentName, oldStatus, newStatus) {
  const statusMap = {
    'in': '在寝', 'absent': '未归', 'leaveSchool': '离校',
    'leaveInside': '事假', 'leaveOutside': '外出',
    null: '未确认', '': '未确认',
  };
  const oldLabel = statusMap[oldStatus] || '未确认';
  const newLabel = statusMap[newStatus] || '未确认';

  if (oldStatus === 'in' || oldStatus === null || oldStatus === '') {
    showToast(`已将 ${studentName} 标记为 ${newLabel}`, 'info', 2500);
  } else if (newStatus === 'in' || newStatus === null || newStatus === '') {
    showToast(`已取消 ${studentName} 的 ${oldLabel} 标记`, 'info', 2000);
  } else {
    showToast(`已将 ${studentName} 由 ${oldLabel} 更新为 ${newLabel}`, 'info', 2500);
  }
}

function toggleStatus(name, status) {
  const current = state.studentStatus[name] || { status: 'in' };

  if (current.status === 'in') {
    state.studentStatus[name] = { status: status };
    if (navigator.vibrate) navigator.vibrate(15);
    autoSaveState();
    syncToRoomIfMulti(name, status);
    showStatusChangeToast(name, 'in', status);
    refreshView();
    return;
  }

  if (Array.isArray(current.status)) {
    const index = current.status.indexOf(status);
    if (index > -1) {
      current.status.splice(index, 1);
      if (current.status.length === 0) {
        state.studentStatus[name] = { status: 'in' };
      }
    } else {
      current.status.push(status);
    }
  } else {
    if (current.status === status) {
      state.studentStatus[name] = { status: 'in' };
    } else {
      state.studentStatus[name] = { status: [current.status, status] };
    }
  }

  autoSaveState();
  syncToRoomIfMulti(name, status);
  refreshView();
}

function syncToRoomIfMulti(name, status) {
  if (roomState.mode !== 'multi' || !roomState.code) return;
  const st = state.studentStatus[name];
  // Resolve effective status from current state
  let effectiveStatus = status || 'in';
  if (st) {
    if (Array.isArray(st.status)) {
      effectiveStatus = st.status[st.status.length - 1] || 'in';
    } else {
      effectiveStatus = st.status || 'in';
    }
  }
  const statusMap = { in: 'present', absent: 'absent', leaveInside: 'leaveInside', leaveSchool: 'leaveSchool', leaveOutside: 'leaveOutside' };
  const roomStatus = statusMap[effectiveStatus] || 'present';
  const detail = (st && st.reason) || '';
  if (typeof updateRoomStudentState === 'function') {
    updateRoomStudentState(name, roomStatus, detail);
  }
}

function showLeaveInsideOptions(name) {
  state.pendingStudent = name;
  document.getElementById('reasonModal').classList.add('active');
}

function selectReason(reason) {
  if (!state.pendingStudent) return;

  if (reason === '其他') {
    const customReason = prompt('请输入其他事由：');
    if (customReason === null) return;
    reason = customReason.trim() || '其他';
  }

  const name = state.pendingStudent;
  const current = state.studentStatus[name];

  if (current && Array.isArray(current.status)) {
    if (current.status.includes('leaveInside')) {
      current.reason = reason;
    } else {
      current.status.push('leaveInside');
      current.reason = reason;
    }
  } else {
    state.studentStatus[name] = { status: 'leaveInside', reason: reason };
  }

  closeReasonModal();
  autoSaveState();
  syncToRoomIfMulti(name, 'leaveInside');
  refreshView();
}

function closeReasonModal() {
  document.getElementById('reasonModal').classList.remove('active');
  state.pendingStudent = null;
}

function toggleSubMenu(event) {
  event.stopPropagation();
  const subList = document.getElementById('subReasonList');
  const arrow = event.currentTarget.querySelector('.fa-chevron-down');
  if (subList.style.display === 'none') {
    subList.style.display = 'block';
    arrow.style.transform = 'rotate(180deg)';
  } else {
    subList.style.display = 'none';
    arrow.style.transform = 'rotate(0deg)';
  }
}

function toggleStudioSubMenu(event) {
  event.stopPropagation();
  const subList = document.getElementById('studioSubList');
  const arrow = document.getElementById('studioArrow');
  if (subList.style.display === 'none') {
    subList.style.display = 'block';
    arrow.style.transform = 'rotate(180deg)';
  } else {
    subList.style.display = 'none';
    arrow.style.transform = 'rotate(0deg)';
  }
}

function selectStudioReason(subReason) {
  // 存储明细，但对外显示"工作室"
  selectReasonWithSub('工作室', subReason);
}

function selectReasonWithSub(reason, subReason) {
  if (!state.pendingStudent) return;

  const name = state.pendingStudent;
  const current = state.studentStatus[name];

  const statusObj = { status: 'leaveInside', reason: reason };
  if (subReason) {
    statusObj.subReason = subReason;
  }

  if (current && Array.isArray(current.status)) {
    const idx = current.status.indexOf('leaveInside');
    if (idx > -1) {
      current.reason = reason;
      current.subReason = subReason || current.subReason;
    } else {
      current.status.push('leaveInside');
      current.reason = reason;
      current.subReason = subReason;
    }
  } else if (current && current.status === 'leaveInside') {
    current.reason = reason;
    current.subReason = subReason;
  } else {
    state.studentStatus[name] = statusObj;
  }

  closeReasonModal();
  autoSaveState();
  syncToRoomIfMulti(name, 'leaveInside');
  refreshView();
}

function getStateKey() {
  const username = sessionStorage.getItem('username') || 'default';
  const mode = roomState.mode || sessionStorage.getItem('checkMode') || 'single';
  let key = 'nightshift_state_' + username + '_' + mode;
  if (mode === 'multi' && roomState.code) {
    key += '_' + roomState.code;
  }
  return key;
}

async function restoreState() {
  const key = getStateKey();
  let restored = false;

  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      const result = {};
      for (const name in parsed.studentStatus) {
        if (window.nameIndex && window.nameIndex[name]) {
          result[name] = parsed.studentStatus[name];
        }
      }
      state.studentStatus = result;
      restored = Object.keys(result).length > 0;
    }

    // v21: D1 已废弃，移除云端恢复逻辑。状态仅存储在 localStorage。

    // Also migrate old dormCheckState if exists
    const old = localStorage.getItem('dormCheckState');
    if (old) {
      try {
        const oldParsed = JSON.parse(old);
        if (oldParsed.studentStatus) {
          for (const name in oldParsed.studentStatus) {
            if (window.nameIndex && window.nameIndex[name] && !state.studentStatus[name]) {
              state.studentStatus[name] = oldParsed.studentStatus[name];
            }
          }
          autoSaveState();
        }
      } catch (e) { /* ignore */ }
      localStorage.removeItem('dormCheckState');
    }

    // v21: D1 已废弃，移除云端恢复逻辑。状态仅存储在 localStorage。
  } catch (e) {
    console.error('恢复状态失败', e);
  }
}


// v21: D1 已废弃，移除所有 D1 同步相关代码（syncToD1、loadFromD1、getTodayDate 及定时器）

function autoSaveState() {
  const data = {
    studentStatus: state.studentStatus,
    lastSaveTime: new Date().toLocaleString()
  };
  localStorage.setItem(getStateKey(), JSON.stringify(data));
  // v21: D1 已废弃，状态仅保存在 localStorage
}

function clearSavedState() {
  if (confirm('确定要清除所有查寝记录，重新开始吗？')) {
    localStorage.removeItem(getStateKey());
    state.studentStatus = {};
    refreshView();
    showToast('已重置，可以开始新查寝');
  }
}

function refreshView() {
  if (state.viewMode === 'single' && state.currentDorm) renderSwipeDorm(state.currentDorm);
  else if (state.viewMode === 'card') renderCardView();
  else renderDormList();
}

// ============================================
// 卡片视图 + 滑动切换
// ============================================

let cardState = {
  cardIndex: 0,
  touchStartX: 0,
  touchStartY: 0,
  touchCurrentX: 0,
  isSwiping: false,
  isAnimating: false,
  dorms: [],
};

function toggleViewMode() {
  if (state.viewMode === 'card') {
    state.viewMode = 'list';
  } else {
    state.viewMode = 'card';
    cardState.dorms = getDormsOnFloor(state.currentFloor);
    cardState.cardIndex = Math.max(0, cardState.dorms.indexOf(state.currentDorm));
  }
  refreshView();
}

function renderCardView() {
  const dorms = getDormsOnFloor(state.currentFloor);
  cardState.dorms = dorms;

  if (dorms.length === 0) {
    document.getElementById('dormContainer').innerHTML = '<div class="empty-state"><i class="fas fa-building"></i><p>该楼层暂无宿舍数据</p></div>';
    return;
  }

  if (cardState.cardIndex >= dorms.length) cardState.cardIndex = dorms.length - 1;
  if (cardState.cardIndex < 0) cardState.cardIndex = 0;

  const dormNumber = dorms[cardState.cardIndex];
  const allStudents = getStudentsInDorm(dormNumber);
  const students = allStudents.filter(s => isSearchMatch(s) && matchesActiveFilters(s.name) && matchesGradeFilter(s));
  const prevDorm = cardState.cardIndex > 0;
  const nextDorm = cardState.cardIndex < dorms.length - 1;

  let totalCount = students.length;
  let absentCount = 0, leaveSchoolCount = 0, leaveInsideCount = 0, leaveOutsideCount = 0;
  students.forEach(s => {
    const st = state.studentStatus[s.name] || { status: 'in' };
    if (Array.isArray(st.status)) {
      if (st.status.includes('absent')) absentCount++;
      if (st.status.includes('leaveSchool')) leaveSchoolCount++;
      if (st.status.includes('leaveInside')) leaveInsideCount++;
      if (st.status.includes('leaveOutside')) leaveOutsideCount++;
    } else {
      if (st.status === 'absent') absentCount++;
      if (st.status === 'leaveSchool') leaveSchoolCount++;
      if (st.status === 'leaveInside') leaveInsideCount++;
      if (st.status === 'leaveOutside') leaveOutsideCount++;
    }
  });

  const container = document.getElementById('dormContainer');
  container.innerHTML = `
    <div class="card-view-container" id="cardViewContainer">
      <div class="card-nav-top">
        <button class="card-nav-arrow" ${!prevDorm ? 'disabled' : ''} onclick="goToPrevCard()"><i class="fas fa-chevron-left"></i></button>
        <div class="card-title-area">
          <div class="card-dorm-number">${dormNumber} 宿舍</div>
        </div>
        <button class="card-nav-arrow" ${!nextDorm ? 'disabled' : ''} onclick="goToNextCard()"><i class="fas fa-chevron-right"></i></button>
      </div>
      <div class="card-wrapper" id="cardWrapper">
        ${renderDormCardFull(dormNumber, students)}
      </div>
    </div>`;

  // Attach touch events
  const wrapper = document.getElementById('cardWrapper');
  wrapper.addEventListener('touchstart', onCardTouchStart, { passive: true });
  wrapper.addEventListener('touchmove', onCardTouchMove, { passive: false });
  wrapper.addEventListener('touchend', onCardTouchEnd);

  updateStats(totalCount, absentCount, leaveSchoolCount, leaveInsideCount, leaveOutsideCount);
}

function renderDormCardFull(dormNumber, students) {
  return `<div class="full-dorm-card" id="fullDormCard">
    <div class="full-card-students">
      ${students.map(s => renderStudentItem(s)).join('')}
    </div>
  </div>`;
}

function onCardTouchStart(e) {
  if (e.target.closest('.status-tags')) return;
  cardState.touchStartX = e.touches[0].clientX;
  cardState.touchStartY = e.touches[0].clientY;
  cardState.touchCurrentX = e.touches[0].clientX;
  cardState.isSwiping = false;
}

function onCardTouchMove(e) {
  const dx = e.touches[0].clientX - cardState.touchStartX;
  const dy = e.touches[0].clientY - cardState.touchStartY;

  if (!cardState.isSwiping) {
    // Determine if this is a horizontal swipe or vertical scroll
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
      cardState.isSwiping = true;
    } else if (Math.abs(dy) > Math.abs(dx)) {
      return; // Let vertical scroll happen
    }
  }

  if (cardState.isSwiping) {
    e.preventDefault();
    cardState.touchCurrentX = e.touches[0].clientX;
    const offset = cardState.touchCurrentX - cardState.touchStartX;
    const card = document.getElementById('fullDormCard');
    if (card) {
      card.style.transform = `translateX(${offset}px)`;
      card.style.transition = 'none';
    }
  }
}

function onCardTouchEnd(e) {
  if (!cardState.isSwiping) return;
  if (cardState.isAnimating) { cardState.isSwiping = false; return; }

  const dx = cardState.touchCurrentX - cardState.touchStartX;
  const card = document.getElementById('fullDormCard');
  const threshold = window.innerWidth * 0.3;

  if (Math.abs(dx) > threshold || Math.abs(dx) > 80) {
    // v18: 标准方向 — 手指向右滑 → 上一间(-1), 手指向左滑 → 下一间(+1)
    if (dx > 0) {
      goToPrevCard();
    } else {
      goToNextCard();
    }
  } else {
    // Snap back
    if (card) {
      card.style.transform = 'translateX(0)';
      card.style.transition = 'transform 0.3s ease';
    }
  }

  cardState.isSwiping = false;
  cardState.touchStartX = 0;
  cardState.touchCurrentX = 0;
}

function goToPrevCard() {
  if (cardState.isAnimating) return;
  if (cardState.cardIndex > 0) {
    cardState.isAnimating = true;
    cardState.cardIndex--;
    renderCardView();
    setTimeout(function() { cardState.isAnimating = false; }, 350);
  }
}

function goToNextCard() {
  if (cardState.isAnimating) return;
  if (cardState.cardIndex < cardState.dorms.length - 1) {
    cardState.isAnimating = true;
    cardState.cardIndex++;
    renderCardView();
    setTimeout(function() { cardState.isAnimating = false; }, 350);
  }
}

// ============================================
// 报告模态框函数
// ============================================

async function showReportModal() {
  if (!window.dormData) {
    showToast('宿舍数据尚未加载，请稍后重试');
    return;
  }
  currentReportMode = 'absent';
  document.getElementById('btnAbsent').classList.add('active');
  document.getElementById('btnPresent').classList.remove('active');
  document.getElementById('btnVacation').classList.remove('active');
  document.getElementById('gradeFilter').value = gradeFilter;

  const result = generateReportText();
  document.getElementById('reportOverview').textContent = result.overview;
  document.getElementById('reportSummary').textContent = result.summary || '';
  document.getElementById('reportModal').classList.add('active');

  // v18: session 完成标记已移除（数据按日期维度存储，无需关闭 session）
}

function closeReportModal() {
  document.getElementById('reportModal').classList.remove('active');
}

function copyReportOverview() {
  const text = document.getElementById('reportOverview').textContent;
  copyToClipboard(text);
}

function copyReportSummary() {
  const text = document.getElementById('reportSummary').textContent;
  copyToClipboard(text);
}

function copyStudentName(name, event) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  copyToClipboard(name);
}

function uploadLeaveNote() {
  window.location.href = 'upload.html';
}

function manualInput() {
  window.location.href = 'manual-upload.html';
}

function openWorkWechat() {
  const workWechatScheme = 'wxwork://';
  const workWechatUrl = 'https://work.weixin.qq.com/';
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  if (isMobile) {
    const startTime = Date.now();
    window.location.href = workWechatScheme;
    setTimeout(() => {
      if (Date.now() - startTime < 2500) {
        window.open(workWechatUrl, '_blank');
      }
    }, 2000);
  } else {
    window.open(workWechatUrl, '_blank');
  }
}

function resetAllStatus() {
  if (confirm('确定要重置所有查寝记录吗？此操作将清空所有请假状态，所有人恢复为"在寝"。')) {
    state.studentStatus = {};
    // Clear both single and multi mode states for current account
    const username = sessionStorage.getItem('username') || 'default';
    localStorage.removeItem('nightshift_state_' + username + '_single');
    localStorage.removeItem('nightshift_state_' + username + '_multi');
    sessionStorage.removeItem('checkMode');
    refreshView();
    showToast('已重置，请选择查寝模式');
    showModeSelection();
  }
}

function studentNameExists(name) {
  for (const grade in dormData) {
    for (const className in dormData[grade]) {
      for (const dorm in dormData[grade][className]) {
        if (dormData[grade][className][dorm].includes(name)) {
          return true;
        }
      }
    }
  }
  return false;
}

function applyPendingLeaves() {
  const pendingData = localStorage.getItem('pendingLeaveRecords');
  if (!pendingData) return;

  // v19: 统一状态映射表
  const STATUS_MAP = {
    '在寝': 'in', '离校': 'leaveSchool', '请假离校': 'leaveSchool',
    '事假': 'leaveInside', '病假': 'leaveInside',
    '外出': 'leaveOutside', '请假外出': 'leaveOutside',
    '未归': 'absent', '晚归': 'absent'
  };

  try {
    let updates;
    let dateRange = null;
    const parsed = JSON.parse(pendingData);

    if (parsed && typeof parsed === 'object') {
      if (parsed.records && typeof parsed.records === 'object') {
        dateRange = parsed.dateRange || null;
        updates = parsed.records;
      } else {
        updates = parsed;
      }
    } else {
      updates = parsed;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (dateRange && dateRange.start && dateRange.end) {
      const startDate = new Date(dateRange.start);
      const endDate = new Date(dateRange.end);
      if (endDate < today) {
        const userConfirm = confirm('该假单已过期，确认应用？');
        if (!userConfirm) { localStorage.removeItem('pendingLeaveRecords'); return; }
      }
      if (startDate > today) {
        const userConfirm = confirm('该假单尚未生效（开始日期为 ' + dateRange.start + '），是否仍要提前应用？');
        if (!userConfirm) { localStorage.removeItem('pendingLeaveRecords'); return; }
      }
    }

    let count = 0;
    Object.keys(updates).forEach(name => {
      const record = updates[name];
      // v19: 标准化状态值（中文 → 英文 key）
      let normalizedStatus = record.status;
      if (STATUS_MAP[normalizedStatus]) {
        normalizedStatus = STATUS_MAP[normalizedStatus];
      }

      if (state.studentStatus[name] || studentNameExists(name)) {
        state.studentStatus[name] = {
          status: normalizedStatus,
          reason: record.reason || ''
        };
        // v19: 多人模式下同步到房间
        if (roomState.mode === 'multi' && roomState.code && typeof syncToRoomIfMulti === 'function') {
          const roomStatusMap = { in: 'present', absent: 'absent', leaveSchool: 'leaveSchool', leaveInside: 'leaveInside', leaveOutside: 'leaveOutside' };
          const roomStatus = roomStatusMap[normalizedStatus] || 'present';
          if (typeof updateRoomStudentState === 'function') {
            updateRoomStudentState(name, roomStatus, record.reason || '');
          }
        }
        count++;
      }
    });

    localStorage.removeItem('pendingLeaveRecords');

    if (count > 0) {
      if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
      showToast('已自动应用 ' + count + ' 条假单记录');
      autoSaveState();
      refreshView();
    }
  } catch (e) {
    console.error('应用假单数据失败:', e);
  }
}

// ============================================
// SmoothTabs — 选项卡滑块动效 (v16: left+width 精确定位)
// ============================================
class SmoothTabs {
  constructor(containerSelector) {
    this.container = document.querySelector(containerSelector);
    if (!this.container) return;
    this.thumb = this.container.querySelector('.tab-thumb');
    this.tabs = this.container.querySelectorAll('.neu-tab');
    this.init();
  }

  init() {
    if (!this.thumb) return;
    const activeTab = this.container.querySelector('.neu-tab.active');
    if (activeTab) this.moveThumb(activeTab);

    this.tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        this.tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.moveThumb(tab);
      });
    });

    window.addEventListener('resize', () => {
      const active = this.container.querySelector('.neu-tab.active');
      if (active) this.moveThumb(active);
    });
  }

  moveThumb(targetTab) {
    if (!this.thumb) return;
    const containerRect = this.container.getBoundingClientRect();
    const tabRect = targetTab.getBoundingClientRect();

    // 使用 left + width 精确定位，禁止 transform 偏移
    const left = tabRect.left - containerRect.left;
    const width = tabRect.width;

    this.thumb.style.left = left + 'px';
    this.thumb.style.width = width + 'px';
    this.thumb.style.transform = 'none';
  }

  moveThumbToActive() {
    const active = this.container.querySelector('.neu-tab.active');
    if (active) this.moveThumb(active);
  }
}

// ============================================
// 主题切换（实现在 utils.js，此处仅作注释说明）
// ============================================
// 事件监听初始化
// ============================================

document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('#floorTabs .neu-tab').forEach(tab => {
    tab.addEventListener('click', function() {
      const floor = this.dataset.floor;
      switchFloor(floor === 'all' ? 'all' : parseInt(floor));
    });
  });

  // v17.5: 年级筛选事件
  document.querySelectorAll('#gradeTabs .neu-tab').forEach(tab => {
    tab.addEventListener('click', function() {
      switchGrade(this.dataset.grade);
    });
  });

  // 初始化选项卡滑块动效
  window.floorTabsInstance = new SmoothTabs('#floorTabs');
  window.gradeTabsInstance = new SmoothTabs('#gradeTabs');
  window.reportTabsInstance = new SmoothTabs('#reportVersionTabs');

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      switchFilter(this.dataset.filter);
    });
  });

  document.getElementById('reportModal').addEventListener('click', function(e) {
    if (e.target === this) closeReportModal();
  });

  document.getElementById('reasonModal').addEventListener('click', function(e) {
    if (e.target === this) closeReasonModal();
  });

  // 点击列表空白处切换到卡片视图
  document.getElementById('dormContainer').addEventListener('click', function(e) {
    if (state.viewMode !== 'list') return;
    if (e.target === this || !e.target.closest('.dorm-card')) {
      toggleViewMode();
    }
  });

  // 模式记忆：刷新后直接进入上次选择的模式
  const savedMode = sessionStorage.getItem('checkMode');
  if (savedMode) {
    roomState.mode = savedMode;
    document.getElementById('modeOverlay').classList.remove('active');
    if (savedMode === 'single') {
      document.getElementById('loadingOverlay').classList.remove('hidden');
      loadDormData();
    } else if (savedMode === 'multi') {
      // 如果之前在房间中，尝试自动重新加入
      const savedRoomCode = sessionStorage.getItem('roomCode');
      if (savedRoomCode) {
        roomState.code = savedRoomCode;
        document.getElementById('loadingOverlay').classList.remove('hidden');
        loadDormData().then(() => {
          showRoomView().catch(() => {
            showRoomLobby();
          });
        });
      } else {
        showRoomLobby();
      }
    }
  } else {
    showModeSelection();
  }
});
