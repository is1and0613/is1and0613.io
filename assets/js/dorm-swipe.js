// assets/js/dorm-swipe.js — Tinder 式宿舍卡片滑动切换

class DormSwipeController {
  constructor(options) {
    this.dorms = options.dorms || [];
    this.currentIndex = options.startIndex || 0;
    this.onDormChange = options.onDormChange || (() => {});
    this.buildDormHTML = options.buildDormHTML;

    this.threshold = window.innerWidth * 0.25;
    this.velocityThreshold = 0.6;

    this.isDragging = false;
    this.isAnimating = false;
    this.startX = 0;
    this.startY = 0;
    this.lastX = 0;
    this.lastTime = 0;
    this.deltaX = 0;
    this.velocity = 0;

    this.init();
  }

  init() {
    const container = document.getElementById('dormContainer');
    container.innerHTML = `
      <div class="dorm-swipe-viewport">
        <div class="dorm-card-stack" id="dorm-stack">
          <div class="dorm-card-peek" id="dorm-peek"></div>
          <div class="dorm-card-current" id="dorm-current"></div>
          <div class="swipe-hint left">‹</div>
          <div class="swipe-hint right">›</div>
        </div>
      </div>
    `;
    this.stackEl = document.getElementById('dorm-stack');
    this.currentEl = document.getElementById('dorm-current');
    this.peekEl = document.getElementById('dorm-peek');
    this.bindEvents();
    this.render(this.currentIndex);
  }

  bindEvents() {
    this.stackEl.addEventListener('touchstart', this.onStart.bind(this), { passive: false });
    this.stackEl.addEventListener('touchmove', this.onMove.bind(this), { passive: false });
    this.stackEl.addEventListener('touchend', this.onEnd.bind(this));
    this.stackEl.addEventListener('touchcancel', this.onEnd.bind(this));
  }

  onStart(e) {
    if (e.target.closest('.status-tags')) return;
    const touch = e.touches[0];
    this.isDragging = true;
    this.startX = touch.clientX;
    this.startY = touch.clientY;
    this.lastX = this.startX;
    this.lastTime = Date.now();
    this.deltaX = 0;

    this.currentEl.style.transition = 'none';
    this.currentEl.classList.add('is-dragging');
    this.preparePeek();
  }

  onMove(e) {
    if (!this.isDragging) return;
    const touch = e.touches[0];
    this.deltaX = touch.clientX - this.startX;
    const deltaY = touch.clientY - this.startY;

    if (Math.abs(this.deltaX) > Math.abs(deltaY) && Math.abs(this.deltaX) > 10) {
      e.preventDefault();
    }

    const direction = this.deltaX > 0 ? 'right' : 'left';
    this.currentEl.setAttribute('data-direction', direction);

    const rotate = this.deltaX * 0.03;
    const scale = 1 - Math.abs(this.deltaX) / window.innerWidth * 0.05;
    this.currentEl.style.transform = `translateX(${this.deltaX}px) rotate(${rotate}deg) scale(${scale})`;

    const peekOffset = this.deltaX > 0 ? -30 : 30;
    const peekOpacity = Math.min(Math.abs(this.deltaX) / 150, 0.5);
    this.peekEl.style.opacity = peekOpacity;
    this.peekEl.style.transform = `translateX(${peekOffset}px) scale(0.95)`;

    const now = Date.now();
    const dt = now - this.lastTime;
    if (dt > 0) {
      this.velocity = (touch.clientX - this.lastX) / dt;
    }
    this.lastX = touch.clientX;
    this.lastTime = now;
  }

  onEnd() {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.currentEl.classList.remove('is-dragging');
    this.currentEl.removeAttribute('data-direction');

    this.currentEl.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)';
    this.peekEl.style.transition = 'opacity 0.2s ease, transform 0.3s ease';

    const absX = Math.abs(this.deltaX);
    const fastSwipe = Math.abs(this.velocity || 0) > this.velocityThreshold;

    if (this.isAnimating) {
      this.snapBack();
    } else if (absX > this.threshold || fastSwipe) {
      if (this.deltaX > 0) this.prev();
      else this.next();
    } else {
      this.snapBack();
    }
  }

  snapBack() {
    this.currentEl.style.transform = 'translateX(0) rotate(0deg) scale(1)';
    this.peekEl.style.opacity = '0';
    this.peekEl.style.transform = 'translateX(0) scale(0.95)';
  }

  next() {
    if (this.isAnimating) { this.snapBack(); return; }
    if (this.currentIndex >= this.dorms.length - 1) {
      this.snapBack();
      if (typeof showToast === 'function') showToast('已经是最后一个宿舍');
      return;
    }
    this.isAnimating = true;
    this.currentEl.style.transform = 'translateX(-120%) rotate(-10deg) scale(0.85)';
    setTimeout(() => {
      this.currentIndex++;
      this.currentEl.style.transition = 'none';
      this.currentEl.style.transform = 'translateX(120%) rotate(10deg) scale(0.85)';
      this.render(this.currentIndex);
      void this.currentEl.offsetWidth;
      this.currentEl.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)';
      this.currentEl.style.transform = 'translateX(0) rotate(0deg) scale(1)';
      this.peekEl.style.opacity = '0';
      setTimeout(() => { this.isAnimating = false; }, 310);
    }, 300);
  }

  prev() {
    if (this.isAnimating) { this.snapBack(); return; }
    if (this.currentIndex <= 0) {
      this.snapBack();
      if (typeof showToast === 'function') showToast('已经是第一个宿舍');
      return;
    }
    this.isAnimating = true;
    this.currentEl.style.transform = 'translateX(120%) rotate(10deg) scale(0.85)';
    setTimeout(() => {
      this.currentIndex--;
      this.currentEl.style.transition = 'none';
      this.currentEl.style.transform = 'translateX(-120%) rotate(-10deg) scale(0.85)';
      this.render(this.currentIndex);
      void this.currentEl.offsetWidth;
      this.currentEl.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)';
      this.currentEl.style.transform = 'translateX(0) rotate(0deg) scale(1)';
      this.peekEl.style.opacity = '0';
      setTimeout(() => { this.isAnimating = false; }, 310);
    }, 300);
  }

  nextByButton() {
    if (this.isAnimating) return;
    if (this.currentIndex >= this.dorms.length - 1) {
      if (typeof showToast === 'function') showToast('已经是最后一个宿舍');
      return;
    }
    this.isAnimating = true;
    this.currentEl.style.transition = 'opacity 0.075s ease, transform 0.075s ease';
    this.currentEl.style.opacity = '0';
    this.currentEl.style.transform = 'translateX(-15px)';
    setTimeout(() => {
      this.currentIndex++;
      this.currentEl.style.transition = 'none';
      this.currentEl.style.transform = 'translateX(15px)';
      this.render(this.currentIndex);
      void this.currentEl.offsetWidth;
      this.currentEl.style.transition = 'opacity 0.075s ease, transform 0.075s ease';
      this.currentEl.style.opacity = '1';
      this.currentEl.style.transform = 'translateX(0)';
      setTimeout(() => { this.isAnimating = false; }, 80);
    }, 80);
  }

  prevByButton() {
    if (this.isAnimating) return;
    if (this.currentIndex <= 0) {
      if (typeof showToast === 'function') showToast('已经是第一个宿舍');
      return;
    }
    this.isAnimating = true;
    this.currentEl.style.transition = 'opacity 0.075s ease, transform 0.075s ease';
    this.currentEl.style.opacity = '0';
    this.currentEl.style.transform = 'translateX(15px)';
    setTimeout(() => {
      this.currentIndex--;
      this.currentEl.style.transition = 'none';
      this.currentEl.style.transform = 'translateX(-15px)';
      this.render(this.currentIndex);
      void this.currentEl.offsetWidth;
      this.currentEl.style.transition = 'opacity 0.075s ease, transform 0.075s ease';
      this.currentEl.style.opacity = '1';
      this.currentEl.style.transform = 'translateX(0)';
      setTimeout(() => { this.isAnimating = false; }, 80);
    }, 80);
  }

  render(index) {
    const dorm = this.dorms[index];
    if (!dorm) return;
    this.currentEl.innerHTML = this.buildDormHTML(dorm);
    this.onDormChange({ dorm, index, total: this.dorms.length });
  }

  preparePeek() {
    let peekIndex = this.currentIndex;
    if (this.deltaX > 0) peekIndex = this.currentIndex - 1;
    else if (this.deltaX < 0) peekIndex = this.currentIndex + 1;

    if (peekIndex >= 0 && peekIndex < this.dorms.length) {
      const dorm = this.dorms[peekIndex];
      const shortHTML = '<div class="dorm-card" style="pointer-events:none;"><div class="dorm-nav"><div class="dorm-nav-current">' + dorm + '宿舍</div></div></div>';
      this.peekEl.innerHTML = shortHTML;
    }
  }

  setDorms(dorms, startIndex) {
    this.dorms = dorms;
    this.currentIndex = startIndex || 0;
    this.render(this.currentIndex);
  }

  destroy() {
    this.stackEl = null;
    this.currentEl = null;
    this.peekEl = null;
  }
}

// Global instance
window.dormSwipe = null;

function renderSwipeDorm(dormNumber) {
  const dorms = getDormsOnFloor(state.currentFloor);
  const startIndex = dorms.indexOf(dormNumber);
  if (startIndex < 0) return;

  if (window.dormSwipe) {
    window.dormSwipe.destroy();
  }

  window.dormSwipe = new DormSwipeController({
    dorms: dorms,
    startIndex: startIndex,
    buildDormHTML: function(dorm) {
      return buildSwipeDormCard(dorm);
    },
    onDormChange: function(result) {
      state.currentDorm = result.dorm;
      updateSwipeStats(result.dorm);
    }
  });
}

function buildSwipeDormCard(dormNumber) {
  const students = getStudentsInDorm(dormNumber);
  const filtered = students.filter(function(s) {
    return isSearchMatch(s) && matchesActiveFilters(s.name);
  });

  var html = '<div class="dorm-card"><div class="dorm-nav">' +
    '<button class="dorm-nav-btn" onclick="event.stopPropagation(); swipeToPrev()"><i class="fas fa-chevron-left"></i></button>' +
    '<div class="dorm-nav-current" onclick="backToList()">' + dormNumber + '宿舍</div>' +
    '<button class="dorm-nav-btn" onclick="event.stopPropagation(); swipeToNext()"><i class="fas fa-chevron-right"></i></button>' +
    '</div><div class="student-list">' +
    filtered.map(function(s) { return renderStudentItem(s); }).join('') +
    '</div></div>';
  return html;
}

function swipeToNext() {
  if (window.dormSwipe) window.dormSwipe.nextByButton();
}

function swipeToPrev() {
  if (window.dormSwipe) window.dormSwipe.prevByButton();
}

function updateSwipeStats(dormNumber) {
  var students = getStudentsInDorm(dormNumber);
  var filtered = students.filter(function(s) {
    return isSearchMatch(s) && matchesActiveFilters(s.name);
  });
  var absentCount = 0, leaveSchoolCount = 0, leaveInsideCount = 0, leaveOutsideCount = 0;

  filtered.forEach(function(s) {
    var st = state.studentStatus[s.name] || { status: 'in' };
    if (st.status === 'absent' || (Array.isArray(st.status) && st.status.includes('absent'))) absentCount++;
    if (st.status === 'leaveSchool' || (Array.isArray(st.status) && st.status.includes('leaveSchool'))) leaveSchoolCount++;
    if (st.status === 'leaveInside' || (Array.isArray(st.status) && st.status.includes('leaveInside'))) leaveInsideCount++;
    if (st.status === 'leaveOutside' || (Array.isArray(st.status) && st.status.includes('leaveOutside'))) leaveOutsideCount++;
  });

  updateStats(filtered.length, absentCount, leaveSchoolCount, leaveInsideCount, leaveOutsideCount);
}
