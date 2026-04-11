const API_BASE = 'http://127.0.0.1:5000';

// Renditta is predicted by the Flask backend ML model — no lookup table here.

// ─── DOM refs ─────────────────────────────────
const uploadZone   = document.getElementById('uploadZone');
const fileInput    = document.getElementById('fileInput');
const browseLink   = document.getElementById('browseLink');
const previewWrap  = document.getElementById('previewWrap');
const previewImg   = document.getElementById('previewImg');
const changeBtn    = document.getElementById('changeBtn');
const analyzeBtn   = document.getElementById('analyzeBtn');

const secUpload    = document.getElementById('sec-upload');
const secProcessing= document.getElementById('sec-processing');
const secResults   = document.getElementById('sec-results');
const secYield     = document.getElementById('sec-yield');

const annotatedImg = document.getElementById('annotatedImg');
const statTotal    = document.getElementById('statTotal');
const statQualified= document.getElementById('statQualified');
const statDefect   = document.getElementById('statDefect');
const statGrade    = document.getElementById('statGrade');

const donutGreen   = document.getElementById('donutGreen');
const donutRed     = document.getElementById('donutRed');
const donutPct     = document.getElementById('donutPct');
const dlGoodPct    = document.getElementById('dlGoodPct');
const dlBadPct     = document.getElementById('dlBadPct');
const insightText  = document.getElementById('insightText');
const insightBadge = document.getElementById('insightBadge');

const yieldDefect  = document.getElementById('yieldDefect');
const yieldWeight  = document.getElementById('yieldWeight');
const calcBtn      = document.getElementById('calcBtn');
const yieldOutput  = document.getElementById('yieldOutput');

const zoomBtn      = document.getElementById('zoomBtn');
const lightbox     = document.getElementById('lightbox');
const lbImg        = document.getElementById('lbImg');
const lbClose      = document.getElementById('lbClose');

// ─── Upload / Preview ─────────────────────────
browseLink.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('click', e => {
  if (e.target === changeBtn) return;
  if (previewWrap.style.display !== 'none') return;
  fileInput.click();
});
changeBtn.addEventListener('click', e => {
  e.stopPropagation();
  resetPreview();
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) handleFile(fileInput.files[0]);
});

// Drag & drop
uploadZone.addEventListener('dragover', e => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) handleFile(file);
});

function handleFile(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    previewImg.src = ev.target.result;
    previewWrap.style.display = 'block';
    analyzeBtn.disabled = false;
  };
  reader.readAsDataURL(file);
}

function resetPreview() {
  previewWrap.style.display = 'none';
  previewImg.src = '';
  fileInput.value = '';
  analyzeBtn.disabled = true;
  // Also hide results/yield sections
  secResults.style.display = 'none';
  secYield.style.display = 'none';
  yieldOutput.style.display = 'none';
}

// ─── Analyse ──────────────────────────────────
analyzeBtn.addEventListener('click', runAnalysis);

async function runAnalysis() {
  if (!fileInput.files.length) return;
  showProcessing(true);
  animateProcessingSteps();

  try {
    const formData = new FormData();
    formData.append('image', fileInput.files[0]);

    stepActivate(2);
    const res = await fetch(`${API_BASE}/classify`, { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Server error');
    }
    stepActivate(3);
    const data = await res.json();

    stepActivate(4);
    await new Promise(r => setTimeout(r, 600)); // brief pause for UX

    showProcessing(false);
    renderResults(data);

  } catch (err) {
    showProcessing(false);
    alert('Analysis failed: ' + err.message);
  }
}

// ─── Processing Steps ─────────────────────────
let currentStep = 1;
function stepActivate(n) {
  for (let i = 1; i < n; i++) {
    const el = document.getElementById(`ps${i}`);
    el.classList.remove('active');
    el.classList.add('done');
  }
  const cur = document.getElementById(`ps${n}`);
  if (cur) { cur.classList.add('active'); }
  currentStep = n;
}

function animateProcessingSteps() {
  currentStep = 1;
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById(`ps${i}`);
    el.classList.remove('active','done');
  }
  document.getElementById('ps1').classList.add('active');
}

function showProcessing(show) {
  secProcessing.style.display = show ? 'flex' : 'none';
  analyzeBtn.disabled = show;
}

// ─── Render Results ───────────────────────────
function renderResults(data) {
  const stats = data.stats;
  const imgUrl = API_BASE + data.image_url + '?t=' + Date.now();

  // Annotated image
  annotatedImg.src = imgUrl;
  lbImg.src = imgUrl;

  // Stat cards
  const qualPct  = parseFloat(stats['Qualified Cocoon %']);
  const defPct   = parseFloat(stats['Defect %']);
  const total    = stats['Total Detections'];
  const qualified= stats['Qualified Cocoon Count'];
  const defects  = stats['Defect Count'];
  const grade    = stats['Sample Grade'];

  statTotal.textContent     = total;
  statQualified.textContent = `${qualified} (${qualPct.toFixed(1)}%)`;
  statDefect.textContent    = `${defects} (${defPct.toFixed(1)}%)`;
  statGrade.textContent     = grade;

  // Donut chart
  animateDonut(qualPct, defPct);

  // AI Insight
  insightText.textContent = generateInsight(qualPct, grade, total);
  insightBadge.textContent = `Grade ${grade}`;
  insightBadge.style.color =
    grade === 'A' ? 'var(--green)' :
    grade === 'B' ? 'var(--gold)' : 'var(--red)';

  // Show sections
  secResults.style.display = 'block';
  secResults.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Auto-fill yield section
  yieldDefect.value = defPct.toFixed(2);
  secYield.style.display = 'block';
}

// ─── Donut Chart ──────────────────────────────
function animateDonut(qualPct, defPct) {
  const circumference = 2 * Math.PI * 60; // 376.99
  const gap = 4; // small gap between segments

  const greenLen = (qualPct / 100) * circumference - gap;
  const redLen   = (defPct  / 100) * circumference - gap;
  const redOffset= circumference - (qualPct / 100) * circumference;

  // Animate green arc
  donutGreen.style.transition = 'none';
  donutGreen.setAttribute('stroke-dasharray', `${circumference} ${circumference}`);
  donutGreen.setAttribute('stroke-dashoffset', circumference);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      donutGreen.style.transition = 'stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)';
      donutGreen.setAttribute('stroke-dashoffset', circumference - greenLen);
    });
  });

  // Animate red arc (offset so it starts where green ends)
  donutRed.style.transition = 'none';
  donutRed.setAttribute('stroke-dasharray', `${redLen} ${circumference}`);
  donutRed.setAttribute('stroke-dashoffset', circumference - redOffset + gap);
  donutRed.style.transition = 'stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1) 0.1s';

  // Counter animation for center %
  let start = 0;
  const target = qualPct;
  const duration = 1200;
  const startTime = performance.now();
  function tick(now) {
    const pct = Math.min((now - startTime) / duration, 1);
    const val = Math.round(easeOut(pct) * target);
    donutPct.textContent = `${val}%`;
    if (pct < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  dlGoodPct.textContent = `${qualPct.toFixed(1)}%`;
  dlBadPct.textContent  = `${defPct.toFixed(1)}%`;
}
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

// ─── AI Insight Generator ─────────────────────
function generateInsight(qualPct, grade, total) {
  if (qualPct >= 90)
    return `Exceptional batch quality detected. ${qualPct.toFixed(1)}% of ${total} cocoons meet Grade A standards — ideal for premium silk reeling. Minimal intervention required.`;
  if (qualPct >= 75)
    return `Good quality batch with ${qualPct.toFixed(1)}% qualified cocoons out of ${total}. Grade B classification achieved. Minor quality improvements could unlock premium yield potential.`;
  if (qualPct >= 50)
    return `Average batch detected. ${(100-qualPct).toFixed(1)}% defect rate across ${total} cocoons lowers overall yield efficiency. Review cocoon storage and harvesting protocols.`;
  return `High defect rate of ${(100-qualPct).toFixed(1)}% across ${total} cocoons detected. Grade C classification. Significant quality improvement is recommended before reeling.`;
}

// ─── Zoom / Lightbox ──────────────────────────
zoomBtn.addEventListener('click', () => lightbox.classList.add('open'));
lbClose.addEventListener('click', () => lightbox.classList.remove('open'));
lightbox.addEventListener('click', e => {
  if (e.target === lightbox) lightbox.classList.remove('open');
});

// ─── Yield Calculator ─────────────────────────
calcBtn.addEventListener('click', calcYield);

async function calcYield() {
  const defPct   = parseFloat(yieldDefect.value);
  const weight   = parseFloat(yieldWeight.value);
  const moisture = parseFloat(document.getElementById('yieldMoisture').value);

  if (isNaN(defPct) || isNaN(weight) || weight <= 0) {
    alert('Please enter a valid cocoon weight.');
    return;
  }
  if (isNaN(moisture) || moisture < 10 || moisture > 25) {
    alert('Moisture should be between 10% and 25% for realistic estimation.');
    return;
  }

  // Disable button while waiting
  calcBtn.disabled = true;
  calcBtn.querySelector('.btn-text').textContent = 'Calculating…';

  try {
    const res = await fetch(`${API_BASE}/yield`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        defect_pct:       defPct,
        cocoon_weight_kg: weight,
        moisture_pct:     moisture
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Yield estimation failed');
    }

    const d = await res.json();

    document.getElementById('yoSilk').textContent      = d.silk_produced_kg.toFixed(2);
    document.getElementById('yoRenditta').textContent  = d.renditta.toFixed(3);
    document.getElementById('yoDefectUsed').textContent = `${defPct.toFixed(2)}%`;
    document.getElementById('yoMoisture').textContent  = `${moisture}%`;
    document.getElementById('yoEffWeight').textContent = `${d.effective_weight_kg.toFixed(2)} kg`;
    document.getElementById('yoRatio').textContent     = `${d.silk_yield_ratio_pct.toFixed(2)}%`;
    document.getElementById('yoGrade').textContent     = `Grade ${d.grade}`;

    // Improvement insight
    const impBox  = document.getElementById('improvementBox');
    const impText = document.getElementById('improvementText');
    if (d.improvement_kg > 0) {
      const improved = (d.silk_produced_kg + d.improvement_kg).toFixed(2);
      impText.innerHTML = `Reducing defects to <strong>5%</strong> would yield an extra <strong>${d.improvement_kg.toFixed(2)} kg</strong> of silk — from ${d.silk_produced_kg.toFixed(2)} kg to <strong>${improved} kg</strong>.`;
      impBox.style.display = 'flex';
    } else {
      impBox.style.display = 'none';
    }

    yieldOutput.style.display = 'block';
    yieldOutput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  } catch (err) {
    alert('Yield estimation failed: ' + err.message);
  } finally {
    calcBtn.disabled = false;
    calcBtn.querySelector('.btn-text').textContent = 'Estimate Silk Yield';
  }
}

// ─── Scroll Reveal ────────────────────────────
const observer = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) e.target.classList.add('in-view');
  });
}, { threshold: 0.1 });
document.querySelectorAll('.section').forEach(s => {
  s.classList.add('reveal');
  observer.observe(s);
});