(() => {
  'use strict';
  const lang = document.documentElement.lang === 'ja' ? 'ja' : 'en';
  const restoration = document.body.dataset.comparison === 'restoration';
  const root = new URL(lang === 'ja' ? './' : '../', document.baseURI);
  const manifestURL = new URL(restoration ? `${lang === 'en' ? 'en/' : ''}manifest.json` : 'data/comparison.json', root);
  const assetBase = restoration ? manifestURL : root;
  const $ = id => document.getElementById(id);
  const strings = {
    ja: {
      stages: { reference: '原画（LR 512 px・表示のみ4倍）', ground_truth: '高解像度参照画像', upscaled: 'AI拡大（4倍）', repaired: 'AIレタッチ', blend: 'ブレンド' },
      restorationStages: { ground_truth: '原画（評価用）', input: '劣化入力', result: '復元結果' },
      cleanInput: '正常画像（対照入力）',
      masks: { full: '全体', hard: '硬い境界', soft: '内側24 pxのぼかし' },
      loading: '画像を読み込んでいます…', ready: '同じ範囲・同じ倍率で表示中', error: '画像を読み込めませんでした。', retry: '再試行',
      left: '左', right: '右', fit: '全体に合わせる', width: '幅に合わせる', native: '原寸', whole: '全体',
      coordinates: size => `${size.join(' × ')} px画像の座標`,
      divider: '比較の境界。左右の矢印キーで移動', zoom: '表示倍率',
      dividerValue: value => `左 ${value}% / 右 ${100 - value}%`,
      roiLabel: (box, zoom) => `範囲 [${box.join(', ')}] · 表示 ${zoom}% · すべて同一座標`,
      processing: '保存された処理条件', records: '比較データ', metrics: '保存済み指標', audit: '保存画像・リンクの検証記録',
      comparisonOnly: '人工劣化と正常対照の保存結果を比較します。この表示だけで品質改善や実写への一般化を判断することはできません。',
      findings: {
        realistic: ['写真：輪郭と細部', '翅や花の細部に変化が見られ、元の形・質感を忠実に取り戻したとは判断できませんでした。輪郭と細い毛を拡大して比較できます。'],
        oil: ['油彩：形と筆跡', '花弁の輪郭や筆跡が変わりました。自然に見える質感があっても、元の絵の細部が戻ったことを意味しません。'],
        abstract: ['抽象画：直線と署名', '黒い水平帯の位置と線の形、署名に変化が見られました。幾何形状や文字を保つ用途では、特に確認が必要な結果です。']
      }
    },
    en: {
      stages: { reference: 'Original (LR 512 px · displayed at 4×)', ground_truth: 'High-resolution reference', upscaled: 'AI upscaling (4×)', repaired: 'AI retouch', blend: 'Blend' },
      restorationStages: { ground_truth: 'Original (evaluation reference)', input: 'Degraded input', result: 'Restored result' },
      cleanInput: 'Clean control input',
      masks: { full: 'Full image', hard: 'Hard boundary', soft: '24 px inward feather' },
      loading: 'Loading images…', ready: 'Showing the same region at the same scale', error: 'Images could not be loaded.', retry: 'Retry',
      left: 'Left', right: 'Right', fit: 'Fit to view', width: 'Fit width', native: 'native', whole: 'Full image',
      coordinates: size => `Coordinates in the ${size.join(' × ')} px image`,
      divider: 'Comparison divider. Move with the left and right arrow keys', zoom: 'Display scale',
      dividerValue: value => `Left ${value}% / right ${100 - value}%`,
      roiLabel: (box, zoom) => `Region [${box.join(', ')}] · Display ${zoom}% · Identical coordinates in all panels`,
      processing: 'Saved processing settings', records: 'Comparison data', metrics: 'Saved metrics', audit: 'Saved-image and link audit',
      comparisonOnly: 'Compare saved results for synthetic degradation and undegraded controls. This view alone does not establish quality improvement or generalization to real photographs.',
      findings: {
        realistic: ['Photograph: contours and fine detail', 'Details of the butterfly and flower changed. The result did not demonstrate faithful recovery of the original shapes and texture. Inspect the contours and fine hairs at higher magnification.'],
        oil: ['Oil painting: shapes and brushwork', 'Petal contours and brush marks changed. A plausible painted texture does not establish that the original details were recovered.'],
        abstract: ['Abstract painting: lines and signature', 'The position of a horizontal black band, line shapes, and the signature changed. These results need particular scrutiny when geometry or lettering must be preserved.']
      }
    }
  };
  const t = strings[lang];
  const stages = restoration ? t.restorationStages : t.stages;
  const state = { case: 'realistic', left: restoration ? 'input' : 'upscaled', right: restoration ? 'result' : 'repaired', roi: 'whole', zoom: 'fit', split: 50 };
  if (restoration) Object.assign(state, { condition: '', method: 'codiff' });
  else Object.assign(state, { mask: 'soft', strength: 25 });
  const imageIds = ['main-left', 'main-right', 'detail-reference', 'detail-left', 'detail-right'];
  const cache = new Map();
  let data, cases, entry, renderToken = 0, layoutToken = 0, currentScale = .25, eventsBound = false;

  function addOption(select, value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  function caseLabel(key = state.case) { return restoration ? cases[key].case_label : cases[key].label[lang]; }
  function size() { return restoration ? entry.size : data.canvas_size; }
  function rois() {
    if (!restoration) return cases[state.case].rois;
    return [{ id: 'whole', label: t.whole, box: [0, 0, ...size()] }, ...entry.rois];
  }
  function getROI() { return rois().find(roi => roi.id === state.roi); }
  function recordFor(stage) {
    if (restoration) return entry.sources[stage === 'ground_truth' ? 'gt' : stage];
    const sample = cases[state.case];
    return stage === 'blend' ? sample.variants[`${state.mask}-${state.strength}`] : sample.sources[stage];
  }
  function assetURL(record) { return new URL(record.url || record.path, assetBase).href; }
  function stageLabel(stage) {
    if (stage === 'blend') return `${stages.blend} · ${t.masks[state.mask]} · ${state.strength}%`;
    if (restoration && stage === 'input' && state.condition === 'normal-control') return t.cleanInput;
    return stage === 'result' ? `${stages.result} · ${entry.method_label}` : stages[stage];
  }
  function selectEntry() {
    if (!restoration) return;
    const available = data.entries.filter(item => item.case === state.case);
    const conditions = [...new Set(available.map(item => item.condition))];
    if (!conditions.includes(state.condition)) state.condition = conditions[0];
    const methods = available.filter(item => item.condition === state.condition);
    if (!methods.some(item => item.method === state.method)) state.method = (methods.find(item => item.method === 'codiff') || methods[0]).method;
    entry = methods.find(item => item.method === state.method);
    $('condition').replaceChildren();
    for (const condition of conditions) addOption($('condition'), condition, available.find(item => item.condition === condition).condition_label);
    $('method').replaceChildren();
    for (const method of methods) addOption($('method'), method.method, method.method_label);
  }
  function loadImage(record) {
    const url = assetURL(record);
    if (!cache.has(url)) {
      const pending = new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = url;
      });
      cache.set(url, pending);
      pending.catch(() => cache.delete(url));
    }
    return cache.get(url);
  }
  function updateURL() {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(state)) query.set(key, String(value));
    const url = new URL(location.href);
    url.search = query.toString();
    history.replaceState(null, '', url);
    const other = new URL(lang === 'ja' ? 'en/' : './', root);
    other.search = query.toString();
    $('language-link').href = other.href;
  }
  function updateRecords() {
    if ($('entry-note')) {
      $('entry-note').hidden = !restoration;
      $('entry-note').textContent = restoration ? `${t.processing}: ${Object.entries(entry.processing || {}).map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`).join(' · ')}` : '';
    }
    if (!$('records')) return;
    $('records').replaceChildren();
    const link = (label, href) => {
      const anchor = document.createElement('a');
      anchor.textContent = label;
      anchor.href = href;
      $('records').append(anchor);
    };
    for (const stage of Object.keys(stages)) link(stageLabel(stage), assetURL(recordFor(stage)));
    if (restoration) {
      for (const panel of entry.panels) link(panel.label, assetURL(panel));
      link(t.metrics, new URL('metrics.json', root).href);
      link(t.audit, new URL('output-audit.json', root).href);
    }
    link(t.records, manifestURL.href);
  }
  function syncControls() {
    const controls = restoration ? ['left', 'right', 'zoom', 'condition', 'method'] : ['left', 'right', 'zoom', 'mask', 'strength'];
    for (const key of controls) $(key).value = String(state[key]);
    if (restoration) for (const side of ['left', 'right']) $(side).querySelector('option[value="input"]').textContent = stageLabel('input');
    $('dataset-controls').hidden = !restoration;
    $('blend-controls').hidden = restoration || (state.left !== 'blend' && state.right !== 'blend');
    for (const button of $('cases').children) button.setAttribute('aria-pressed', String(button.dataset.case === state.case));
    $('left-label').textContent = `${t.left} · ${stageLabel(state.left)}`;
    $('right-label').textContent = `${t.right} · ${stageLabel(state.right)}`;
    $('detail-reference-label').textContent = stages.ground_truth;
    $('detail-left-label').textContent = `${t.left} · ${stageLabel(state.left)}`;
    $('detail-right-label').textContent = `${t.right} · ${stageLabel(state.right)}`;
    const finding = restoration ? [`${caseLabel()} · ${entry.condition_label} · ${entry.method_label}`, t.comparisonOnly] : t.findings[state.case];
    $('case-finding-title').textContent = finding[0];
    $('case-finding-text').textContent = finding[1];
    updateRecords();
    setSplit(state.split);
  }
  function positionGrip() {
    const grip = $('divider').querySelector('.divider-grip');
    if (!grip) return;
    const width = parseFloat($('main-stage').style.width) || $('main-stage').clientWidth;
    const x = width * state.split / 100;
    const margin = Math.min(20, width / 2);
    // Keep the 40 px grip inside the crop while the divider stays at the exact split.
    grip.style.left = `${Math.max(margin, Math.min(width - margin, x)) - x + $('divider').clientWidth / 2}px`;
  }
  function setSplit(value) {
    state.split = Math.max(0, Math.min(100, Math.round(value)));
    $('split').value = String(state.split);
    $('split-value').textContent = `${state.split}%`;
    $('right-layer').style.clipPath = `inset(0 0 0 ${state.split}%)`;
    $('divider').style.left = `${state.split}%`;
    $('divider').setAttribute('aria-valuenow', String(state.split));
    $('divider').setAttribute('aria-valuetext', t.dividerValue(state.split));
    positionGrip();
  }
  function layout(center = false) {
    if (!data) return;
    const token = ++layoutToken;
    const box = getROI().box;
    const width = box[2] - box[0], height = box[3] - box[1];
    const viewport = $('image-viewport');
    const widthScale = Math.max(1, viewport.clientWidth - 32) / width;
    currentScale = state.zoom === 'fit' ? Math.min(widthScale, Math.max(1, viewport.clientHeight - 32) / height) : state.zoom === 'width' ? widthScale : Number(state.zoom);
    for (const stage of document.querySelectorAll('.image-stage')) {
      stage.style.width = `${width * currentScale}px`;
      stage.style.height = `${height * currentScale}px`;
      for (const image of stage.querySelectorAll('img')) {
        image.style.width = `${size()[0] * currentScale}px`;
        image.style.height = `${size()[1] * currentScale}px`;
        image.style.left = `${-box[0] * currentScale}px`;
        image.style.top = `${-box[1] * currentScale}px`;
      }
    }
    const percent = Math.round(currentScale * 1000) / 10;
    $('coordinates').textContent = `${t.coordinates(size())}: [${box.join(', ')}]`;
    const fitLabel = state.zoom === 'fit' ? t.fit : state.zoom === 'width' ? t.width : '';
    $('scale-label').textContent = `${t.zoom}: ${percent}%${fitLabel ? ` · ${fitLabel}` : ''}`;
    $('detail-meta').textContent = t.roiLabel(box, percent);
    positionGrip();
    if (center) requestAnimationFrame(() => {
      if (token !== layoutToken) return;
      for (const scroller of document.querySelectorAll('.image-viewport, .detail-viewport')) {
        scroller.scrollLeft = Math.max(0, (scroller.scrollWidth - scroller.clientWidth) / 2);
        scroller.scrollTop = Math.max(0, (scroller.scrollHeight - scroller.clientHeight) / 2);
      }
    });
  }
  function showError(retry) {
    $('status').textContent = `${t.error} `;
    $('status').dataset.error = 'true';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = t.retry;
    button.addEventListener('click', retry);
    $('status').append(button);
  }
  async function render(center = false) {
    const token = ++renderToken;
    syncControls();
    updateURL();
    layout(center);
    $('comparison').classList.add('busy');
    document.body.dataset.loading = 'true';
    $('comparison').setAttribute('aria-busy', 'true');
    $('status').textContent = t.loading;
    $('status').dataset.error = 'false';
    for (const id of imageIds) $(id).removeAttribute('src');
    const selectedStages = [state.left, state.right, 'ground_truth', state.left, state.right];
    const labels = selectedStages.map(stageLabel);
    const label = caseLabel();
    try {
      const images = await Promise.all(selectedStages.map(stage => loadImage(recordFor(stage))));
      if (token !== renderToken) return;
      images.forEach((image, i) => { $(imageIds[i]).src = image.src; $(imageIds[i]).alt = `${label} · ${labels[i]}`; });
      $('status').textContent = t.ready;
    } catch (_) {
      if (token !== renderToken) return;
      for (const id of imageIds) $(id).removeAttribute('src');
      showError(() => render());
    } finally {
      if (token === renderToken) {
        $('comparison').classList.remove('busy');
        document.body.dataset.loading = 'false';
        $('comparison').setAttribute('aria-busy', 'false');
      }
    }
  }
  function populateROI() {
    const available = rois();
    if (!available.some(roi => roi.id === state.roi)) { state.roi = 'whole'; state.zoom = 'fit'; }
    $('roi').replaceChildren();
    for (const roi of available) addOption($('roi'), roi.id, restoration ? roi.label : roi.label[lang]);
    $('roi').value = state.roi;
  }
  function restoreQuery() {
    const query = new URLSearchParams(location.search);
    const values = { case: Object.keys(cases), left: Object.keys(stages), right: Object.keys(stages), zoom: ['fit', 'width', '0.25', '0.5', '1', '2'] };
    if (!restoration) Object.assign(values, { mask: data.mask_types, strength: data.strengths.map(String) });
    for (const [key, allowed] of Object.entries(values)) {
      const value = query.get(key);
      if (allowed.includes(value)) state[key] = key === 'strength' ? Number(value) : value;
    }
    const split = query.get('split');
    if (split !== null && split.trim() && Number.isFinite(Number(split))) state.split = Math.max(0, Math.min(100, Math.round(Number(split))));
    if (restoration) {
      state.condition = query.get('condition') || state.condition;
      state.method = query.get('method') || state.method;
      selectEntry();
    }
    const roi = query.get('roi');
    if (rois().some(item => item.id === roi)) state.roi = roi;
  }
  function events() {
    for (const key of restoration ? ['left', 'right', 'zoom'] : ['left', 'right', 'mask', 'strength', 'zoom']) $(key).addEventListener('change', () => {
      state[key] = key === 'strength' ? Number($(key).value) : $(key).value;
      render(key === 'zoom');
    });
    if (restoration) for (const key of ['condition', 'method']) $(key).addEventListener('change', () => {
      state[key] = $(key).value;
      selectEntry();
      populateROI();
      render(true);
    });
    $('roi').addEventListener('change', () => {
      state.roi = $('roi').value;
      state.zoom = state.roi === 'whole' ? 'fit' : String(restoration ? 1 : getROI().default_zoom || 1);
      render(true);
    });
    $('swap').addEventListener('click', () => { [state.left, state.right] = [state.right, state.left]; render(); });
    $('split').addEventListener('input', () => { setSplit(Number($('split').value)); updateURL(); });
    const divider = $('divider');
    divider.setAttribute('aria-label', t.divider);
    const move = event => {
      const rect = $('main-stage').getBoundingClientRect();
      if (rect.width) setSplit((event.clientX - rect.left) / rect.width * 100);
      updateURL();
    };
    divider.addEventListener('pointerdown', event => { divider.setPointerCapture(event.pointerId); move(event); event.preventDefault(); });
    divider.addEventListener('pointermove', event => { if (divider.hasPointerCapture(event.pointerId)) move(event); });
    divider.addEventListener('keydown', event => {
      const delta = event.shiftKey ? 10 : 1;
      const values = { ArrowLeft: state.split - delta, ArrowDown: state.split - delta, ArrowRight: state.split + delta, ArrowUp: state.split + delta, Home: 0, End: 100 };
      if (event.key in values) { event.preventDefault(); setSplit(values[event.key]); updateURL(); }
    });
    const panes = [...document.querySelectorAll('.detail-viewport')];
    for (const pane of panes) pane.addEventListener('scroll', () => {
      for (const other of panes) if (other !== pane) {
        if (other.scrollLeft !== pane.scrollLeft) other.scrollLeft = pane.scrollLeft;
        if (other.scrollTop !== pane.scrollTop) other.scrollTop = pane.scrollTop;
      }
    });
    window.addEventListener('resize', () => layout());
  }
  async function init() {
    try {
      const response = await fetch(manifestURL);
      if (!response.ok) throw new Error('data');
      data = await response.json();
      cases = restoration ? Object.fromEntries(data.entries.map(item => [item.case, item])) : data.cases;
      if (!cases || !Object.keys(cases).length) throw new Error('cases');
      if (!cases[state.case]) state.case = Object.keys(cases)[0];
      restoreQuery();
      for (const side of ['left', 'right']) {
        $(side).replaceChildren();
        for (const [key, label] of Object.entries(stages)) addOption($(side), key, label);
      }
      if (!restoration) {
        for (const key of data.mask_types) addOption($('mask'), key, t.masks[key]);
        for (const value of data.strengths) addOption($('strength'), String(value), `${value}%`);
      }
      $('cases').replaceChildren();
      $('cases').style.setProperty('--case-count', Object.keys(cases).length);
      for (const [key, sample] of Object.entries(cases)) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'case-button'; button.dataset.case = key;
        const image = document.createElement('img');
        image.src = assetURL(sample.thumbnail || sample.sources.gt); image.alt = ''; image.width = 56; image.height = 56;
        const label = document.createElement('span'); label.textContent = caseLabel(key);
        button.append(image, label);
        button.addEventListener('click', () => {
          state.case = key; state.roi = 'whole'; state.zoom = 'fit';
          selectEntry(); populateROI(); render(true);
        });
        $('cases').append(button);
      }
      populateROI();
      if (!eventsBound) { events(); eventsBound = true; }
      await render(true);
    } catch (_) {
      $('comparison').setAttribute('aria-busy', 'false');
      showError(init);
    }
  }
  init();
})();
