// assets/js/upload.js — 上传页逻辑（图片 OCR + 文档解析）

// ============================================
// 图片上传（AI OCR）相关
// ============================================

let imageItems = [];
const loadingTexts = [
  "kimi 识别文字中……",
  "deepseek 排版中……",
  "kimi 临时抱佛鞋中……",
  "token没了请联系开发者充值",
  "不要忘了唐杨曦师姐！",
  "kimi有点儿认不出这个字",
  "deepseek 搬运文字中",
  "有反馈/BUG欢迎联系开发者:D",
  "deepseek被kimi撞倒了QAQ",
  "开发者加入女工的实际原因很诡异",
  "Hello world！",
  "vibe coding 改变世界",
  "kimi溜去喝咖啡了:D",
  "deepseek开小差中……",
  "强化强化，强强又化化",
  "又是一个晚上我不知道自己在哪",
  "Sorry for the long wait",
  "警局第二天才发现尸体，因为王警官认为第一天才是他",
  "\"丢死人了！\"王老汉一边喊一边把尸体从楼上丢下来",
  "广告位招租……",
  "中偏中偏中 = 12.5",
  "A楼快递代拿，从楼下送到宿舍门口。0.2元/件，欢迎联系"
];
let carouselInterval = null;
let shuffledTexts = [];
let currentTextIndex = 0;

function selectImage() {
  document.getElementById('imageInput').click();
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function startLoadingCarousel() {
  shuffledTexts = shuffleArray([...loadingTexts]);
  currentTextIndex = 0;
  updateCarouselUI();
  if (carouselInterval) clearInterval(carouselInterval);
  carouselInterval = setInterval(() => {
    const textEl = document.getElementById('loadingCarouselText');
    if (textEl) textEl.style.opacity = 0;
    setTimeout(() => {
      currentTextIndex = (currentTextIndex + 1) % shuffledTexts.length;
      updateCarouselUI();
      if (textEl) textEl.style.opacity = 1;
    }, 500);
  }, 6000);
}

function updateCarouselUI() {
  const textEl = document.getElementById('loadingCarouselText');
  if (textEl) textEl.textContent = shuffledTexts[currentTextIndex];
}

function stopLoadingCarousel() {
  if (carouselInterval) clearInterval(carouselInterval);
  carouselInterval = null;
}

function handleImages(files) {
  if (!files || files.length === 0) return;

  const imageFiles = [];
  const docFiles = [];

  Array.from(files).forEach(file => {
    if (file.type.startsWith('image/')) {
      imageFiles.push(file);
    } else {
      docFiles.push(file);
    }
  });

  if (docFiles.length > 0) {
    handleDocs(docFiles);
  }

  if (imageFiles.length === 0) return;

  if (imageFiles.length > 20) {
    showToast('最多只能选择20张图片');
    imageFiles = imageFiles.slice(0, 20);
  }

  const startId = imageItems.length > 0 ? Math.max(...imageItems.map(i => i.id)) + 1 : 0;
  const newItems = imageFiles.map((file, idx) => ({
    id: startId + idx,
    file: file,
    url: URL.createObjectURL(file),
    status: 'pending',
    text: null
  }));

  imageItems = imageItems.concat(newItems);

  document.getElementById('imageUploadEmpty').style.display = 'none';
  document.getElementById('imageGrid').style.display = 'grid';
  renderImageGrid();
  updateContinueButton();

  const loading = document.getElementById('ocrLoading');
  loading.classList.add('active');
  startLoadingCarousel();
  processQueue();
}

function renderImageGrid() {
  const grid = document.getElementById('imageGrid');
  const statusLabels = {
    pending: '等待识别',
    processing: '识别中',
    done: '完成',
    error: '失败'
  };
  grid.innerHTML = imageItems.map(item => `
    <div class="image-card ${item.status === 'error' ? 'error' : ''}" data-id="${item.id}">
      <img src="${item.url}" alt="图片">
      <div class="status-badge ${item.status}">${statusLabels[item.status]}</div>
      <button class="delete-btn" onclick="event.stopPropagation(); removeImage(${item.id})" title="删除">
        <i class="fas fa-times"></i>
      </button>
      ${item.status === 'error' ? '<button class="retry-btn" onclick="event.stopPropagation(); retryImage(' + item.id + ')">重试</button>' : ''}
    </div>
  `).join('');
}

function removeImage(id) {
  const item = imageItems.find(i => i.id === id);
  if (item && item.url) URL.revokeObjectURL(item.url);
  imageItems = imageItems.filter(i => i.id !== id);
  if (imageItems.length === 0) {
    document.getElementById('imageUploadEmpty').style.display = 'flex';
    document.getElementById('imageGrid').style.display = 'none';
  }
  renderImageGrid();
  updateContinueButton();
}

async function retryImage(id) {
  const item = imageItems.find(i => i.id === id);
  if (!item) return;
  item.status = 'processing';
  renderImageGrid();
  const loading = document.getElementById('ocrLoading');
  loading.classList.add('active');
  startLoadingCarousel();
  try {
    const text = await processSingleImage(item.file);
    item.text = text;
    item.status = text ? 'done' : 'error';
  } catch (e) {
    item.status = 'error';
  }
  renderImageGrid();
  loading.classList.remove('active');
  stopLoadingCarousel();
  updateContinueButton();
}

async function processQueue() {
  for (let i = 0; i < imageItems.length; i++) {
    const item = imageItems[i];
    if (item.status !== 'pending') continue;
    item.status = 'processing';
    renderImageGrid();
    try {
      const text = await processSingleImage(item.file);
      item.text = text;
      item.status = text ? 'done' : 'error';
    } catch (error) {
      console.error('OCR 请求失败:', error);
      item.status = 'error';
    }
    renderImageGrid();
  }
  document.getElementById('ocrLoading').classList.remove('active');
  stopLoadingCarousel();
  updateContinueButton();
}

function fetchWithTimeout(url, options, timeout = 18000) {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('请求超时')), timeout)
    )
  ]);
}

function compressImage(file, maxWidth = 1024, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      if (width > maxWidth) {
        height = Math.round(height * maxWidth / width);
        width = maxWidth;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(new File([blob], file.name, { type: 'image/jpeg' }));
        } else {
          reject(new Error('压缩失败'));
        }
      }, 'image/jpeg', quality);
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = URL.createObjectURL(file);
  });
}

async function processSingleImage(file) {
  try {
    const compressed = await compressImage(file);
    const formData = new FormData();
    formData.append('image', compressed);

    const response = await fetchWithTimeout('/api/ocr', { method: 'POST', body: formData }, 18000);
    const data = await response.json();
    if (data.success && data.formattedText && data.formattedText.trim().length > 10) {
      return data.formattedText;
    }
    return null;
  } catch (error) {
    console.error('OCR 请求失败:', error);
    return null;
  }
}

function updateContinueButton() {
  const successCount = imageItems.filter(i => i.status === 'done').length;
  const total = imageItems.length;
  const btn = document.querySelector('.bottom-actions .bottom-btn.primary');
  if (total > 0) {
    btn.innerHTML = '<div class="btn-main"><i class="fas fa-arrow-right"></i>解析并继续</div><div class="btn-sub">成功 ' + successCount + '/' + total + '</div>';
  } else {
    btn.innerHTML = '<div class="btn-main"><i class="fas fa-arrow-right"></i>解析并继续</div>';
  }
}

// ============================================
// 文档上传相关
// ============================================

function selectDocs() {
  document.getElementById('docInput').click();
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getDocIconClass(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  if (ext === 'pdf') return { icon: 'fa-file-pdf', cls: 'pdf' };
  if (ext === 'docx' || ext === 'doc') return { icon: 'fa-file-word', cls: 'word' };
  if (ext === 'xlsx' || ext === 'xls') return { icon: 'fa-file-excel', cls: 'excel' };
  return { icon: 'fa-file-alt', cls: 'txt' };
}

function updateDocEmptyState() {
  const fileList = document.getElementById('docFileList');
  const emptyState = document.getElementById('docEmptyState');
  if (fileList.children.length === 0) {
    fileList.style.display = 'none';
    emptyState.style.display = 'flex';
  } else {
    fileList.style.display = 'flex';
    emptyState.style.display = 'none';
  }
}

function removeDoc(btn) {
  const card = btn.closest('.doc-card');
  const fileName = card.dataset.filename || '';
  card.classList.add('removing');
  setTimeout(() => {
    card.remove();
    const pasteText = document.getElementById('pasteText');
    const blocks = pasteText.value.split('\n\n');
    const filtered = blocks.filter(block => !block.includes('/* ' + fileName + ' */'));
    pasteText.value = filtered.join('\n\n');
    updateDocEmptyState();
  }, 300);
}

// ============================================
// 文档解析（PDF/Word/Excel/TXT）
// ============================================

async function parseFileByType(file) {
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'pdf') {
    const arrayBuffer = await file.arrayBuffer();
    return await parsePDF(arrayBuffer);
  } else if (ext === 'docx') {
    const arrayBuffer = await file.arrayBuffer();
    return await parseWord(arrayBuffer);
  } else if (ext === 'xlsx' || ext === 'xls') {
    const arrayBuffer = await file.arrayBuffer();
    return await parseExcel(arrayBuffer);
  } else if (ext === 'txt') {
    return await parseTXT(file);
  }
  throw new Error('不支持的格式');
}

async function parsePDF(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = '';
  for (let i = 1; i <= Math.min(pdf.numPages, 5); i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(' ') + '\n';
  }
  return text;
}

async function parseWord(arrayBuffer) {
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

async function parseExcel(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  let text = '';
  workbook.SheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    rows.forEach(row => {
      const line = row.filter(cell => cell != null).join(' ');
      if (line.trim()) text += line + '\n';
    });
  });
  return text;
}

async function parseTXT(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(e);
    reader.readAsText(file, 'UTF-8');
  });
}

async function handleDocs(files) {
  if (!files || files.length === 0) return;
  if (files.length > 9) {
    showToast('最多只能选择9个文件');
    return;
  }

  showToast('正在解析 ' + files.length + ' 个文件...');
  const texts = [];
  const fileList = document.getElementById('docFileList');

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      const text = await parseFileByType(file);
      if (text && text.trim()) {
        texts.push('/* ' + file.name + ' */\n' + text.trim());
        const iconInfo = getDocIconClass(file.name);
        const item = document.createElement('div');
        item.className = 'doc-card';
        item.dataset.filename = file.name;
        item.innerHTML = '<div class="doc-icon ' + iconInfo.cls + '"><i class="fas ' + iconInfo.icon + '"></i></div>' +
          '<div class="doc-info"><div class="doc-name">' + file.name + '</div>' +
          '<div class="doc-size">' + formatFileSize(file.size) + '</div></div>' +
          '<button class="doc-remove" onclick="removeDoc(this)" title="删除"><i class="fas fa-times"></i></button>';
        fileList.appendChild(item);
      }
    } catch (e) {
      console.error(e);
      showToast(file.name + ' 解析失败，请转换格式后重试');
      const iconInfo = getDocIconClass(file.name);
      const item = document.createElement('div');
      item.className = 'doc-card';
      item.dataset.filename = file.name;
      item.innerHTML = '<div class="doc-icon ' + iconInfo.cls + '"><i class="fas ' + iconInfo.icon + '"></i></div>' +
        '<div class="doc-info"><div class="doc-name">' + file.name + ' 解析失败</div>' +
        '<div class="doc-size">请转换格式后重试</div></div>' +
        '<button class="doc-remove" onclick="removeDoc(this)" title="删除"><i class="fas fa-times"></i></button>';
      fileList.appendChild(item);
    }
  }

  if (texts.length > 0) {
    const pasteText = document.getElementById('pasteText');
    const existing = pasteText.value.trim();
    const combined = existing ? existing + '\n\n' + texts.join('\n\n') : texts.join('\n\n');
    pasteText.value = combined;
    showToast('已提取 ' + texts.length + ' 个文件的内容');
  } else {
    showToast('没有提取到有效文本');
  }
  updateDocEmptyState();

  document.getElementById('docInput').value = '';
}

// ============================================
// 导航
// ============================================

function continueToParse() {
  const docText = document.getElementById('pasteText').value.trim();
  const successItems = imageItems.filter(i => i.status === 'done' && i.text);
  const imageText = successItems.map(i => i.text).join('\n\n');

  let finalText = '';
  if (docText && imageText) {
    finalText = docText + '\n\n' + imageText;
  } else if (docText) {
    finalText = docText;
  } else if (imageText) {
    finalText = imageText;
  }

  if (!finalText) {
    showToast('请先上传文件或图片');
    return;
  }

  localStorage.setItem('ocrRawText', finalText);
  localStorage.setItem('ocrContext', JSON.stringify({
    timestamp: Date.now(),
    hasImageOCR: successItems.length > 0,
    hasDocText: !!docText
  }));

  window.location.href = 'manual-upload.html?mode=text-pipeline';
}

function goBack() {
  window.location.href = 'index.html';
}

// ============================================
// 初始化
// ============================================

document.addEventListener('DOMContentLoaded', function() {
  updateDocEmptyState();

  // 图片区域拖拽
  const imageUploadArea = document.getElementById('imageUploadArea');
  imageUploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    imageUploadArea.classList.add('drag-over');
  });
  imageUploadArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!imageUploadArea.contains(e.relatedTarget)) {
      imageUploadArea.classList.remove('drag-over');
    }
  });
  imageUploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    imageUploadArea.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleImages(files);
    }
  });

  // 文档区域拖拽
  const docUploadArea = document.getElementById('docUploadArea');
  docUploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    docUploadArea.classList.add('drag-over');
  });
  docUploadArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!docUploadArea.contains(e.relatedTarget)) {
      docUploadArea.classList.remove('drag-over');
    }
  });
  docUploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    docUploadArea.classList.remove('drag-over');

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const docFiles = [];
    const imgFiles = [];

    files.forEach(f => {
      if (f.type.startsWith('image/')) {
        imgFiles.push(f);
      } else {
        docFiles.push(f);
      }
    });

    if (imgFiles.length > 0) {
      handleImages(imgFiles);
    }

    if (docFiles.length > 0) {
      const supported = docFiles.filter(f => {
        const ext = f.name.split('.').pop().toLowerCase();
        return ['pdf','docx','xlsx','xls','txt'].includes(ext);
      });
      const unsupported = docFiles.filter(f => {
        const ext = f.name.split('.').pop().toLowerCase();
        return !['pdf','docx','xlsx','xls','txt'].includes(ext);
      });
      if (unsupported.length > 0) {
        showToast(unsupported.length + ' 个文件格式不支持，已跳过');
      }
      if (supported.length > 0) {
        handleDocs(supported);
      }
    }
  });
});
