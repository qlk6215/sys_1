// 에브리타임 시간표 캡처에서 수업 블록 위치를 찾아 요일/시간으로 바꾼다. 브라우저 안에서만 처리(서버 전송 없음).
//
// 블록 위치로 요일·시간을 구하고, 과목명·강의실은 아래 readNames(Tesseract OCR)로 채운다.
// 가정:
// - 위쪽에 요일 헤더 행, 왼쪽에 시간 열이 있는 격자
// - 가로 격자선 간격 = 1시간
// - 첫 시간 행은 firstHour (에브리타임 기본값 9시)
(function () {
  const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  const DAY_KO = "월화수목금토일";
  const SNAP = 5;        // 분 단위 반올림
  const MAX_SIDE = 2400; // 큰 이미지는 축소해서 처리

  class ExtractionError extends Error {}

  const median = (arr) => {
    if (!arr.length) return NaN;
    const s = Float64Array.from(arr).sort();
    const k = s.length >> 1;
    return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
  };
  const nanMedian = (arr) => median(arr.filter((v) => !Number.isNaN(v)));

  // true 구간들의 [시작, 끝) 목록
  function runs(mask) {
    const out = [];
    let start = -1;
    for (let i = 0; i <= mask.length; i++) {
      const on = i < mask.length && mask[i];
      if (on && start < 0) start = i;
      else if (!on && start >= 0) { out.push([start, i]); start = -1; }
    }
    return out;
  }
  const centers = (mask) => runs(mask).map(([a, b]) => Math.floor((a + b - 1) / 2));

  const hueDist = (a, b) => { const d = Math.abs(a - b); return Math.min(d, 180 - d); };

  // OpenCV와 같은 스케일의 HSV(H 0~180, S/V 0~255)와 흑백값
  function toChannels(rgba, n) {
    const hue = new Float32Array(n), sat = new Uint8Array(n), val = new Uint8Array(n), gray = new Uint8Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b), diff = max - min;
      val[i] = max;
      sat[i] = max ? Math.round((diff * 255) / max) : 0;
      let h = 0;
      if (diff) {
        if (max === r) h = (60 * (g - b)) / diff;
        else if (max === g) h = 120 + (60 * (b - r)) / diff;
        else h = 240 + (60 * (r - g)) / diff;
        if (h < 0) h += 360;
      }
      hue[i] = h / 2;
      gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }
    return { hue, sat, val, gray };
  }

  // 격자선(무채색, 배경보다 약간 어둡거나 밝은 선) 위치
  function findGrid(gray, sat, w, h) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
    let bg = 0;
    for (let acc = 0, half = gray.length / 2; bg < 256; bg++) { acc += hist[bg]; if (acc >= half) break; }

    const colCount = new Uint32Array(w), rowCount = new Uint32Array(h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, d = Math.abs(gray[i] - bg);
        if (d >= 6 && d <= 90 && sat[i] < 30) { colCount[x]++; rowCount[y]++; }
      }
    }
    return {
      vLines: centers(Array.from(colCount, (c) => c / h > 0.35)),
      hLines: centers(Array.from(rowCount, (c) => c / w > 0.35)),
    };
  }

  function dayColumns(vLines) {
    if (vLines.length < 3) throw new ExtractionError("요일 칸을 찾지 못했습니다. 에브리타임 시간표 화면을 캡처해 주세요.");
    const spans = [];
    for (let i = 1; i < vLines.length; i++) if (vLines[i] - vLines[i - 1] > 20) spans.push([vLines[i - 1], vLines[i]]);
    const width = median(spans.map(([a, b]) => b - a));
    return spans.filter(([a, b]) => b - a > width * 0.7); // 시간 열처럼 좁은 칸은 제외
  }

  // [첫 시간 행의 위쪽 y, 1시간 높이 px]
  function hourRows(hLines) {
    if (hLines.length < 3) throw new ExtractionError("시간 줄을 찾지 못했습니다. 시간표 전체가 보이게 캡처해 주세요.");
    const gaps = hLines.slice(1).map((y, i) => y - hLines[i]);
    const hour = median(gaps.filter((g) => g > 20));
    // 다음 줄과 간격이 1시간인 첫 가로선 = 첫 시간 행 위쪽 (그 위는 요일 헤더)
    for (let i = 0; i < gaps.length; i++) if (Math.abs(gaps[i] - hour) < hour * 0.15) return [hLines[i], hour];
    return [hLines[0], hour];
  }

  // 세로로 붙은 서로 다른 색 블록을 나눈다.
  // 글자 가장자리 잡음을 피하려고 경계 위/아래 minLen 행씩의 대표 색을 비교한다.
  function splitByColor(hueRows, y0, minLen) {
    const n = hueRows.length, segs = [];
    let start = 0, i = minLen;
    while (i <= n - minLen) {
      const above = nanMedian(hueRows.slice(i - minLen, i));
      const below = nanMedian(hueRows.slice(i, i + minLen));
      if (!Number.isNaN(above) && !Number.isNaN(below) && hueDist(above, below) > 10
          && hueDist(hueRows[i - 1], hueRows[i]) > 6) {
        segs.push([y0 + start, y0 + i]);
        start = i;
        i += minLen;
      } else {
        i += 1;
      }
    }
    segs.push([y0 + start, y0 + n]);
    return segs;
  }

  const fmt = (minutes) => {
    const m = Math.round(minutes / SNAP) * SNAP;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  };

  // 픽셀 데이터 → { classes: [{name, day, start, end, location}], warnings: [] }
  function analyze(rgba, w, h, firstHour = 9) {
    const { hue, sat, val, gray } = toChannels(rgba, w * h);
    const { vLines, hLines } = findGrid(gray, sat, w, h);
    const columns = dayColumns(vLines);
    const [gridTop, hourPx] = hourRows(hLines);

    const classes = [], warnings = [], boxes = new Map(); // 수업 → 이미지 속 블록 위치 (과목명 OCR용)
    columns.slice(0, 7).forEach(([x0, x1], ci) => {
      // 칸 가운데 60%만 보고, 행마다 색칠 비율로 블록 구간을 찾는다 (글자 때문에 생기는 구멍 무시)
      const m = Math.floor((x1 - x0) / 5), bx0 = x0 + m, bx1 = x1 - m, bw = bx1 - bx0;
      const filled = new Array(h).fill(false), rowHue = new Float32Array(h);
      for (let y = 0; y < h; y++) {
        const hues = [];
        for (let x = bx0; x < bx1; x++) {
          const i = y * w + x;
          if (sat[i] > 50 && val[i] > 70) hues.push(hue[i]);
        }
        filled[y] = y >= gridTop && hues.length / bw > 0.15; // 굵은 흰 글자 줄도 블록으로 인정
        rowHue[y] = median(hues);
      }
      for (const [a, b] of runs(filled)) {
        for (const [ya, yb] of splitByColor(Array.from(rowHue.subarray(a, b)), a, Math.max(4, Math.floor(hourPx * 0.15)))) {
          if (yb - ya < hourPx * 0.25) continue; // 15분 미만은 잡음
          const start = firstHour * 60 + ((ya - gridTop) / hourPx) * 60;
          const end = firstHour * 60 + ((yb - gridTop) / hourPx) * 60;
          const c = { name: "", day: DAYS[ci], start: fmt(start), end: fmt(end), location: null };
          classes.push(c);
          boxes.set(c, { x0, x1, y0: ya, y1: yb });
          if (yb >= h - 3) {
            warnings.push(`${fmt(start)}에 시작하는 ${DAY_KO[ci]}요일 수업이 이미지 아래에서 잘려 끝나는 시각이 정확하지 않을 수 있습니다.`);
          }
        }
      }
    });

    if (!classes.length) throw new ExtractionError("수업 블록을 찾지 못했습니다. 에브리타임 시간표 캡처인지 확인해 주세요.");
    classes.sort((p, q) => DAYS.indexOf(p.day) - DAYS.indexOf(q.day) || p.start.localeCompare(q.start));
    classes.forEach((c, i) => { c.name = `수업 ${i + 1}`; });
    return { classes, warnings, boxes };
  }

  // ---- 과목명/강의실 OCR (Tesseract.js, 무료·브라우저 내 실행) ----------------

  const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
  const ROOM_RE = /\d+-\d/; // 강의실 코드 (예: N14-404, S1-4-201). 과목명에는 '숫자-숫자'가 거의 없다
  const workers = {};       // "kor+eng" 기본 인식, "kor" 영문+한글 섞인 단어 보정용

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("OCR 라이브러리를 불러오지 못했습니다."));
      document.head.appendChild(s);
    });
  }

  function getWorker(langs, onProgress) {
    const key = langs.join("+");
    workers[key] ??= (async () => {
      if (!window.Tesseract) await loadScript(TESSERACT_URL);
      return Tesseract.createWorker(langs, 1, {
        logger: (m) => { if (m.status && onProgress) onProgress(m.status, m.progress); },
      });
    })().catch((e) => { delete workers[key]; throw e; });
    return workers[key];
  }

  // 블록 영역을 잘라 흰 글자 → 검은 글자, 나머지 → 흰 배경으로 바꾼 캔버스.
  // 블록 색이 밝든 어둡든 통하도록, 블록 대표색과 흰색 사이 중간보다 밝은 픽셀을 글자로 본다.
  function blockToCanvas(src, box) {
    const pad = 4;
    const sx = box.x0 + pad, sy = box.y0 + 2, sw = box.x1 - box.x0 - pad * 2, sh = box.y1 - box.y0 - 4;
    const scale = Math.max(1, Math.min(3, 320 / sw)); // 글자가 작으면 키워서 인식률 올림 (너무 키우면 오히려 나빠짐)
    const c = document.createElement("canvas");
    c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height), p = img.data;
    const lum = (i) => 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    const sample = [];
    for (let i = 0; i < p.length; i += 4 * 97) sample.push(lum(i));
    const bg = median(sample); // 블록 대부분은 배경색이므로 중앙값 = 블록 밝기
    const cut = bg + (255 - bg) * 0.55;
    for (let i = 0; i < p.length; i += 4) p[i] = p[i + 1] = p[i + 2] = lum(i) > cut ? 0 : 255;
    ctx.putImageData(img, 0, 0);
    return c;
  }

  const clean = (s) => s.replace(/[^가-힣A-Za-z0-9()\-·&+.,/ ]/g, "").trim();

  // Tesseract 결과 → 줄 목록 [{ text, x0, x1, h, words: [{ text, x0, x1, y0, y1 }] }]
  async function ocrRows(worker, canvas) {
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    return (data.blocks || [])
      .flatMap((b) => b.paragraphs.flatMap((p) => p.lines))
      .map((l) => ({
        text: clean(l.text).replace(/\s+/g, " "), x0: l.bbox.x0, x1: l.bbox.x1, h: l.bbox.y1 - l.bbox.y0,
        words: l.words.map((w) => ({
          text: clean(w.text), ...w.bbox,
          symbols: (w.symbols || []).map((s) => ({ text: s.text, x0: s.bbox.x0, x1: s.bbox.x1 })),
        })).filter((w) => w.text),
      }))
      .filter((r) => r.text);
  }

  const isRoom = (row) => ROOM_RE.test(row.text.replace(/\s/g, ""));

  // 한국어+영어 모델은 "MIS강독" 같은 단어를 통째로 영문("MISZE")으로 읽는 경향이 있다.
  // 한국어 모델로 같은 자리를 읽어 한글이 나오면, 한글이 시작되는 위치 앞의 영문 글자만 남기고 뒤를 한글로 바꾼다.
  function fixMixedWords(rows, korRows) {
    const korWords = korRows.flatMap((r) => r.words);
    for (const row of rows) {
      if (isRoom(row)) break;
      for (const w of row.words) {
        if (!/^[A-Za-z0-9]+$/.test(w.text)) continue;
        const hits = korWords
          .filter((k) => /[가-힣]/.test(k.text) && Math.min(w.x1, k.x1) > Math.max(w.x0, k.x0)
            && Math.min(w.y1, k.y1) > Math.max(w.y0, k.y0))
          .sort((a, b) => a.x0 - b.x0);
        if (!hits.length) continue;
        const hangulSyms = hits.flatMap((k) => k.symbols.length ? k.symbols : [{ text: k.text, x0: k.x0, x1: k.x1 }])
          .filter((s) => /[가-힣]/.test(s.text));
        if (!hangulSyms.length) continue;
        const startX = hangulSyms[0].x0;
        const latin = w.symbols.length
          ? w.symbols.filter((s) => (s.x0 + s.x1) / 2 < startX).map((s) => s.text).join("")
          : "";
        const fixed = latin + hangulSyms.map((s) => s.text).join("").replace(/[^가-힣]/g, "");
        row.text = row.text.replace(w.text, fixed);
        w.text = fixed;
      }
    }
  }

  // OCR 줄들 → { name, location }
  // 에브리타임은 블록 너비에서 글자 단위로 줄바꿈하고, 단어 사이 공백은 다음 줄 맨 앞으로 넘어간다.
  // 그래서 다음 줄이 들여 쓰여 있거나, 앞 줄이 오른쪽 끝까지 차지 않았으면 단어가 끝난 것으로 본다.
  function parseLines(rows) {
    const roomAt = rows.findIndex(isRoom);
    const nameRows = roomAt < 0 ? rows.slice(0, 3) : rows.slice(0, roomAt);
    const right = Math.max(...rows.map((r) => r.x1));
    let name = "";
    nameRows.forEach((r, i) => {
      const prev = nameRows[i - 1];
      const spaced = i > 0 && (r.x0 - nameRows[0].x0 > r.h * 0.25 || prev.x1 < right * 0.85);
      name += (spaced ? " " : "") + r.text;
    });
    const location = roomAt < 0 ? null : rows.slice(roomAt).map((r) => r.text.replace(/\s/g, "")).join("") || null;
    return { name: name.replace(/\s+/g, " ").trim(), location };
  }

  // classes 의 name/location 을 이미지 속 글자로 채운다. 실패한 블록은 "수업 N" 그대로 둔다.
  async function readNames(src, classes, boxes, onProgress) {
    const mixed = await getWorker(["kor", "eng"], onProgress);
    for (let i = 0; i < classes.length; i++) {
      onProgress?.("과목명 읽는 중", i / classes.length);
      try {
        const canvas = blockToCanvas(src, boxes.get(classes[i]));
        const rows = await ocrRows(mixed, canvas);
        const nameEnd = rows.findIndex(isRoom);
        const needsKor = rows.slice(0, nameEnd < 0 ? 3 : nameEnd)
          .some((r) => r.words.some((w) => /^[A-Za-z0-9]+$/.test(w.text)));
        if (needsKor) fixMixedWords(rows, await ocrRows(await getWorker(["kor"]), canvas));
        const { name, location } = parseLines(rows);
        if (/[가-힣A-Za-z]{2,}/.test(name)) classes[i].name = name.slice(0, 50);
        if (location) classes[i].location = location.slice(0, 50);
      } catch (e) {
        console.warn("OCR 실패", e);
      }
    }
  }

  // File/Blob → 결과.  readNames: true 면 과목명/강의실도 OCR로 읽는다.
  async function extractTimetable(file, firstHour = 9, { readNames: ocr = true, onProgress } = {}) {
    let bmp;
    try { bmp = await createImageBitmap(file); }
    catch { throw new ExtractionError("이미지를 열 수 없습니다. JPG나 PNG 파일인지 확인해 주세요."); }
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    const result = analyze(ctx.getImageData(0, 0, w, h).data, w, h, firstHour);
    if (ocr) {
      try { await readNames(canvas, result.classes, result.boxes, onProgress); }
      catch (e) { result.warnings.push(`과목명을 읽지 못해 "수업 1, 2…"로 넣었습니다. (${e.message})`); }
    }
    delete result.boxes;
    return result;
  }

  window.TP_TIMETABLE = { extractTimetable, analyze, readNames, parseLines, ExtractionError };
})();
