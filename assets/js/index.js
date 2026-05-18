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
  currentFilter: 'all',
  viewMode: 'list',
  currentDorm: null,
  studentStatus: {},
  floorDorms: {},
  pendingStudent: null
};

// ============================================
// 从本地存储加载上次查寝状态
// ============================================
const savedState = localStorage.getItem('dormCheckState');
if (savedState) {
  try {
    const parsed = JSON.parse(savedState);
    state.studentStatus = parsed.studentStatus || {};
    console.log('已从本地恢复上次查寝状态，上次保存时间：', parsed.lastSaveTime);
  } catch (e) {
    console.error('恢复状态失败', e);
  }
}

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

    const response = await fetch('/api/dorm-data', {
      headers: { 'Authorization': 'Bearer ' + token }
    });

    if (response.status === 401) {
      sessionStorage.removeItem('authToken');
      sessionStorage.removeItem('loggedIn');
      showToast('登录已过期，请重新登录');
      hideDormLoading();
      setTimeout(() => { window.location.replace('login.html'); }, 1500);
      return;
    }

    if (!response.ok) {
      throw new Error('Network response was not ok');
    }

    const data = await response.json();
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
  renderDormList();

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

function getStatusDisplay(statusObj) {
  if (!statusObj || statusObj.status === 'in') return '在寝';

  if (Array.isArray(statusObj.status)) {
    const statusTexts = [];
    if (statusObj.status.includes('leaveInside')) {
      statusTexts.push(statusObj.reason || '事假');
    }
    if (statusObj.status.includes('absent')) {
      statusTexts.push('未归');
    }
    return statusTexts.join('+');
  }

  switch (statusObj.status) {
    case 'leaveSchool': return '离校';
    case 'leaveInside': return statusObj.reason ? statusObj.reason : '事假';
    case 'leaveOutside': return '外出';
    case 'absent': return '未归';
    default: return '在寝';
  }
}

// ============================================
// 报告生成函数
// ============================================

let currentReportMode = 'absent';
let internIncluded = false;

function isInternStudent(student) {
  return student.grade === '2023级';
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
    return '【错误】存在冲突标记，请先修正';
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
    if (!internIncluded && grade === '2023级') return;
    const students = studentsByGrade[grade] || [];
    const should = students.length;

    const leaveSchool = [];
    const business = [];
    const notReturn = [];
    const leaveOut = [];

    students.forEach(s => {
      const st = state.studentStatus[s.name] || { status: 'in' };
      if (st.status === 'leaveSchool') leaveSchool.push({...s, reason: st.reason});
      else if (st.status === 'leaveInside') business.push({...s, reason: st.reason || '其他'});
      else if (st.status === 'leaveOutside') leaveOut.push({...s, reason: st.reason});
    });

    const inSchool = should - leaveSchool.length;
    const normalSleep = inSchool - business.length - leaveOut.length;
    const actual = normalSleep;

    gradeStats[grade] = { should, actual, inSchool, normalSleep, leaveSchool, business, notReturn, leaveOut };

    totalShould += should;
    totalActual += actual;
    totalLeaveSchool += leaveSchool.length;
    totalBusiness += business.length;
    totalNotReturn += notReturn.length;
    totalLeaveOut += leaveOut.length;
  });

  let report = '';
  report += month + '月' + date + '日晚寝\n';
  report += '女生情况:应到' + totalShould + ' 实到' + totalActual + '\n';
  report += '合:' + totalLeaveSchool + '人请假离校 ' + totalBusiness + '人事假 ' + totalNotReturn + '人未返校 ' + totalLeaveOut + '人请假外出\n';

  gradeOrderDesc.forEach(grade => {
    if (!internIncluded && grade === '2023级') return;
    const stats = gradeStats[grade];
    if (!stats) return;
    const shortGrade = getShortGrade(grade);

    report += shortGrade + '级应到' + stats.should + ' 实到' + stats.actual + '\n';

    if (stats.business.length > 0) {
      const studioReasons = ['数分', '网安', '阿sir', '数实战', '网管', '舆情', '工作室', '数据分析工作室', '数据实战工作室'];
      const reasonCount = {};
      stats.business.forEach(s => {
        let r = s.reason || '其他';
        if (studioReasons.includes(r)) { r = '工作室'; }
        reasonCount[r] = (reasonCount[r] || 0) + 1;
      });
      const reasonOrder = ['工作室', '备赛', '辩论队', '复习', '学习', '校督', '分团委', '学生会', '合唱团', '运动会', '警乐团', '羽毛球', '篮球队', '其他'];
      const reasonStrParts = reasonOrder.filter(r => reasonCount[r]).map(r => reasonCount[r] + r);
      Object.keys(reasonCount).forEach(r => {
        if (!reasonOrder.includes(r)) { reasonStrParts.push(reasonCount[r] + r); }
      });
      report += stats.business.length + '事假（' + reasonStrParts.join(' ') + '）\n';
      report += stats.business.map(s => s.name).join(' ') + '\n';
    }

    if (stats.leaveSchool.length > 0) {
      report += stats.leaveSchool.length + '请假离校\n';
      report += stats.leaveSchool.map(s => s.name).join(' ') + '\n';
    }

    if (stats.leaveOut.length > 0) {
      report += stats.leaveOut.length + '请假外出\n';
      report += stats.leaveOut.map(s => s.name).join(' ') + '\n';
    }

    if (stats.notReturn.length > 0) {
      report += stats.notReturn.length + '未返校\n';
      report += stats.notReturn.map(s => s.name).join(' ') + '\n';
    }
  });

  gradeOrderAsc.forEach(grade => {
    if (!internIncluded && grade === '2023级') return;
    const stats = gradeStats[grade];
    if (!stats) return;
    let line = grade + '应到' + stats.should + ' 在校' + stats.inSchool + ' 正常就寝' + stats.normalSleep;
    if (stats.leaveSchool.length > 0) { line += ' ' + stats.leaveSchool.length + '人请假离校'; }
    if (stats.business.length > 0) { line += ' ' + stats.business.length + '人事假'; }
    if (stats.leaveOut.length > 0) { line += ' ' + stats.leaveOut.length + '人请假外出'; }
    report += line + '\n';
  });

  return report;
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
    return '【错误】存在冲突标记，请先修正';
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
    if (!internIncluded && grade === '2023级') return;
    const students = studentsByGrade[grade] || [];
    const should = students.length;
    const leaveSchool = [], business = [], notReturn = [], leaveOut = [], present = [];

    students.forEach(s => {
      const st = state.studentStatus[s.name] || { status: 'in' };
      if (st.status === 'leaveSchool') leaveSchool.push({...s, reason: st.reason});
      else if (st.status === 'leaveInside') business.push({...s, reason: st.reason || '其他'});
      else if (st.status === 'leaveOutside') leaveOut.push({...s, reason: st.reason});
      else if (st.status === 'absent') notReturn.push({...s});
      else present.push({...s});
    });

    gradeStats[grade] = { should, presentCount: present.length, present, leaveSchool, business, notReturn, leaveOut };
    totalShould += should;
    totalPresent += present.length;
    totalLeaveSchool += leaveSchool.length;
    totalBusiness += business.length;
    totalNotReturn += notReturn.length;
    totalLeaveOut += leaveOut.length;
  });

  let report = '';
  report += month + '月' + date + '日晚寝\n';
  report += '女生情况:应到' + totalShould + ' 实到' + totalPresent + '\n';
  report += '合:' + totalLeaveSchool + '人请假离校 ' + totalBusiness + '人事假 ' + totalNotReturn + '人未返校 ' + totalLeaveOut + '人请假外出\n';

  gradeOrderDesc.forEach(grade => {
    if (!internIncluded && grade === '2023级') return;
    const stats = gradeStats[grade];
    if (!stats) return;
    const shortGrade = getShortGrade(grade);
    report += shortGrade + '级应到' + stats.should + ' 实到' + stats.presentCount + '\n';
    report += stats.presentCount + '在校\n';
    if (stats.present.length > 0) {
      report += stats.present.map(s => s.name).join(' ') + '\n';
    }
  });

  return report;
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
    return '【错误】存在冲突标记，请先修正';
  }

  const studentsByGrade = getAllStudentsByGrade();
  const gradeOrder = ['2022级', '2023级', '2024级', '2025级'];
  let totalShould = 0, totalPresent = 0;
  const gradeStats = {};

  gradeOrder.forEach(grade => {
    if (!internIncluded && grade === '2023级') return;
    const students = studentsByGrade[grade] || [];
    const should = students.length;
    const leaveSchoolCount = students.filter(s => {
      const st = state.studentStatus[s.name];
      return st && st.status === 'leaveSchool';
    }).length;
    const present = should - leaveSchoolCount;
    gradeStats[grade] = { should, present };
    totalShould += should;
    totalPresent += present;
  });

  let report = '信息大队女生' + totalShould + '名，在校' + totalPresent + '名，正常就寝' + totalPresent + '名，其中：\n';
  gradeOrder.forEach((grade, index) => {
    if (!internIncluded && grade === '2023级') return;
    const stats = gradeStats[grade];
    if (!stats) return;
    const shortGrade = grade.replace('级', '').slice(-2);
    const line = shortGrade + '级女生' + stats.should + '名，在校' + stats.present + '名，正常就寝' + stats.present + '名';
    if (index < gradeOrder.length - 1) {
      report += line + '；\n';
    } else {
      report += line + '\n';
    }
  });
  report += '所有就寝学生已按要求熄灯。';
  return report;
}

function switchReportMode(type) {
  currentReportMode = type;
  document.getElementById('btnAbsent').classList.toggle('active', type === 'absent');
  document.getElementById('btnPresent').classList.toggle('active', type === 'present');
  document.getElementById('btnVacation').classList.toggle('active', type === 'vacation');

  let reportText;
  switch (type) {
    case 'absent': reportText = generateReportText(); break;
    case 'present': reportText = generatePresentReportText(); break;
    case 'vacation': reportText = generateVacationReportText(); break;
    default: reportText = generateReportText();
  }
  document.getElementById('reportContent').textContent = reportText;
}

function toggleIntern() {
  internIncluded = !internIncluded;
  document.getElementById('internSwitch').classList.toggle('on', internIncluded);
  // Regenerate current report
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
  const dorms = getDormsOnFloor(state.currentFloor);
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
  try {
    const k = searchKeyword;
    // ClassName 和 dorm 保持简单 includes
    if ((student.className && student.className.toLowerCase().includes(k)) ||
        (student.dorm && student.dorm.includes(k))) {
      return true;
    }
    // 人名使用模糊匹配
    if (student.name) {
      // 先快速 includes 检查
      if (student.name.toLowerCase().includes(k)) return true;
      // 再用编辑距离模糊匹配
      if (typeof levenshteinDistance === 'function') {
        const dist = levenshteinDistance(k, student.name.toLowerCase());
        if (dist <= 2) return true;
      }
    }
    return false;
  } catch (e) {
    console.error('搜索匹配错误:', e, student);
    return false;
  }
}

// ============================================
// 视图渲染函数
// ============================================

function renderDormList() {
  const container = document.getElementById('dormContainer');
  const dorms = getDormsOnFloor(state.currentFloor);

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
      const st = state.studentStatus[s.name] || { status: 'in' };
      if (state.currentFilter === 'all') return true;
      if (Array.isArray(st.status)) {
        return st.status.includes(state.currentFilter);
      }
      return st.status === state.currentFilter;
    });

    students.forEach(s => {
      if (!isSearchMatch(s)) return;
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
  let totalCount = 0;
  let absentCount = 0, leaveSchoolCount = 0, leaveInsideCount = 0, leaveOutsideCount = 0;

  students.forEach(s => {
    if (!isSearchMatch(s)) return;
    const st = state.studentStatus[s.name] || { status: 'in' };
    totalCount++;
    if (st.status === 'absent') absentCount++;
    if (st.status === 'leaveSchool') leaveSchoolCount++;
    if (st.status === 'leaveInside') leaveInsideCount++;
    if (st.status === 'leaveOutside') leaveOutsideCount++;
  });

  requestAnimationFrame(() => {
    container.innerHTML = '<div class="single-dorm-view"><div class="dorm-card">' +
      '<div class="dorm-nav">' +
        '<button class="dorm-nav-btn" ' + (!prevDorm ? 'disabled' : '') + ' onclick="goToDorm(\'' + (prevDorm || '') + '\')"><i class="fas fa-chevron-left"></i></button>' +
        '<div class="dorm-nav-current" onclick="backToList()">' + state.currentDorm + '宿舍</div>' +
        '<button class="dorm-nav-btn" ' + (!nextDorm ? 'disabled' : '') + ' onclick="goToDorm(\'' + (nextDorm || '') + '\')"><i class="fas fa-chevron-right"></i></button>' +
      '</div>' +
      '<div class="student-list">' + students.map(s => renderStudentItem(s)).join('') + '</div>' +
    '</div></div>';
    updateStats(totalCount, absentCount, leaveSchoolCount, leaveInsideCount, leaveOutsideCount);
  });
}

function renderDormCard(dormNumber, students, totalBeds) {
  return '<div class="dorm-card" onclick="enterDorm(\'' + dormNumber + '\')">' +
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

  return '<div class="student-item">' +
    '<div class="student-info" style="margin-left: 0;">' +
      '<div style="display: flex; align-items: center;">' +
        '<span class="student-name">' + student.name + '</span>' +
        '<button class="copy-name-btn" onclick="event.stopPropagation(); copyStudentName(\'' + student.name + '\', event)" title="复制姓名">' +
          '<i class="fas fa-copy"></i>' +
        '</button>' +
      '</div>' +
      '<span class="student-meta">' + student.grade + ' ' + student.className + ' | ' + student.bed + '号床 ' + (st.status !== 'in' ? '| ' + statusText : '') + '</span>' +
    '</div>' +
    '<div class="status-tags">' +
      '<button class="status-tag in ' + (st.status === 'in' ? 'active' : '') + '" onclick="event.stopPropagation(); setStatus(\'' + student.name + '\', \'in\')">在寝</button>' +
      '<button class="status-tag leaveSchool ' + (st.status === 'leaveSchool' ? 'active' : '') + '" onclick="event.stopPropagation(); setStatus(\'' + student.name + '\', \'leaveSchool\')">离校</button>' +
      '<button class="status-tag leaveInside ' + (hasLeaveInside ? 'active' : '') + '" onclick="event.stopPropagation(); setStatus(\'' + student.name + '\', \'leaveInside\')">事假</button>' +
      '<button class="status-tag leaveOutside ' + (st.status === 'leaveOutside' ? 'active' : '') + '" onclick="event.stopPropagation(); setStatus(\'' + student.name + '\', \'leaveOutside\')">外出</button>' +
      '<button class="status-tag absent ' + (hasAbsent ? 'active' : '') + '" onclick="event.stopPropagation(); toggleStatus(\'' + student.name + '\', \'absent\')">未归</button>' +
    '</div>' +
  '</div>';
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
  document.querySelectorAll('.floor-tab').forEach(tab => {
    if (floor === 'all') {
      tab.classList.toggle('active', tab.dataset.floor === 'all');
    } else {
      tab.classList.toggle('active', parseInt(tab.dataset.floor) === floor);
    }
  });
  document.getElementById('currentFloor').textContent = (floor === 'all') ? '全部楼层' : floor + 'F';
  renderDormList();
}

function switchFilter(filter) {
  state.currentFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  const filterText = { 'all': '全部', 'absent': '未归', 'leaveSchool': '离校', 'leaveInside': '事假', 'leaveOutside': '外出' }[filter];
  document.getElementById('currentFilter').textContent = filterText;
  if (state.viewMode === 'single' && state.currentDorm) renderSingleDorm();
  else renderDormList();
}

function enterDorm(dormNumber) {
  state.viewMode = 'single';
  state.currentDorm = dormNumber;
  renderSingleDorm();
}

function backToList() {
  state.viewMode = 'list';
  state.currentDorm = null;
  renderDormList();
}

function goToDorm(dormNumber) {
  if (!dormNumber) return;
  state.currentDorm = dormNumber;
  renderSingleDorm();
}

function setStatus(name, status) {
  if (status === 'leaveInside') {
    const current = state.studentStatus[name];
    if (current) {
      if (Array.isArray(current.status)) {
        if (current.status.includes('leaveInside') && current.reason) {
          // 已有事由，重新选择
        }
      } else {
        if (current.status === 'leaveInside' && current.reason) {
          // 已有事由，直接设置
        }
      }
    }
    showLeaveInsideOptions(name);
    return;
  } else {
    state.studentStatus[name] = { status: status };
  }

  if (navigator.vibrate) navigator.vibrate(15);
  autoSaveState();
  refreshView();
}

function toggleStatus(name, status) {
  const current = state.studentStatus[name] || { status: 'in' };

  if (current.status === 'in') {
    state.studentStatus[name] = { status: status };
    if (navigator.vibrate) navigator.vibrate(15);
    autoSaveState();
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
  refreshView();
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

function autoSaveState() {
  localStorage.setItem('dormCheckState', JSON.stringify({
    studentStatus: state.studentStatus,
    lastSaveTime: new Date().toLocaleString()
  }));
}

function clearSavedState() {
  if (confirm('确定要清除所有查寝记录，重新开始吗？')) {
    localStorage.removeItem('dormCheckState');
    state.studentStatus = {};
    refreshView();
    showToast('已重置，可以开始新查寝');
  }
}

function refreshView() {
  if (state.viewMode === 'single' && state.currentDorm) renderSingleDorm();
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
  const students = getStudentsInDorm(dormNumber);
  const prevDorm = cardState.cardIndex > 0;
  const nextDorm = cardState.cardIndex < dorms.length - 1;

  let totalCount = 0, absentCount = 0, leaveSchoolCount = 0, leaveInsideCount = 0, leaveOutsideCount = 0;
  students.forEach(s => {
    if (!isSearchMatch(s)) return;
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

  const container = document.getElementById('dormContainer');
  container.innerHTML = `
    <div class="card-view-container" id="cardViewContainer">
      <div class="card-nav-top">
        <button class="card-nav-arrow" ${!prevDorm ? 'disabled' : ''} onclick="goToPrevCard()"><i class="fas fa-chevron-left"></i></button>
        <div class="card-title-area">
          <div class="card-dorm-number">${dormNumber} 宿舍</div>
          <div class="card-page-indicator">${cardState.cardIndex + 1} / ${dorms.length}</div>
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

  const dx = cardState.touchCurrentX - cardState.touchStartX;
  const card = document.getElementById('fullDormCard');
  const threshold = window.innerWidth * 0.3;

  if (Math.abs(dx) > threshold || Math.abs(dx) > 80) {
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
  if (cardState.cardIndex > 0) {
    cardState.cardIndex--;
    renderCardView();
  }
}

function goToNextCard() {
  if (cardState.cardIndex < cardState.dorms.length - 1) {
    cardState.cardIndex++;
    renderCardView();
  }
}

// ============================================
// 报告模态框函数
// ============================================

function showReportModal() {
  if (!window.dormData) {
    showToast('宿舍数据尚未加载，请稍后重试');
    return;
  }
  currentReportMode = 'absent';
  document.getElementById('btnAbsent').classList.add('active');
  document.getElementById('btnPresent').classList.remove('active');
  document.getElementById('btnVacation').classList.remove('active');
  // Sync intern switch visual with current state
  document.getElementById('internSwitch').classList.toggle('on', internIncluded);

  const reportText = generateReportText();
  document.getElementById('reportContent').textContent = reportText;
  document.getElementById('reportModal').classList.add('active');
}

function closeReportModal() {
  document.getElementById('reportModal').classList.remove('active');
}

function copyReport() {
  const reportText = document.getElementById('reportContent').textContent;
  copyToClipboard(reportText);
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
    localStorage.removeItem('dormCheckState');
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
      if (state.studentStatus[name] || studentNameExists(name)) {
        state.studentStatus[name] = {
          status: record.status,
          reason: record.reason || ''
        };
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
// 事件监听初始化
// ============================================

document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.floor-tab').forEach(tab => {
    tab.addEventListener('click', function() {
      const floor = this.dataset.floor;
      switchFloor(floor === 'all' ? 'all' : parseInt(floor));
    });
  });

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
      showRoomLobby();
    }
  } else {
    showModeSelection();
  }
});
