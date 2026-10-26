async (page) => {
  // Playwright CLI run-code expression. Uses the currently open local preview URL.
  const base = new URL(page.url());
  if (!['http:', 'https:', 'file:'].includes(base.protocol)) {
    throw new Error('Open the local Potato Android design preview before exporting.');
  }
  base.search = '';
  base.hash = '';
  await page.goto(new URL('?screen=today&export=1',base).href);
  await page.setViewportSize({ width: 412, height: 915 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => window.DESIGN_SCREENS && window.PAGES);

  const registry = await page.evaluate(() => {
    const result = [];
    const seen = new Set();
    const groups = window.DESIGN_SCREENS || {};
    const keys = [...new Set(['core', 'flow', ...Object.keys(groups)])];
    for (const group of keys) {
      const ids = Array.isArray(groups[group]) ? groups[group].flat(Infinity) : [];
      for (const id of ids) {
        if (typeof id !== 'string' || seen.has(id) || !window.PAGES[id]) continue;
        seen.add(id);
        result.push({ id, group });
      }
    }
    return result;
  });
  if (!registry.length) throw new Error('DESIGN_SCREENS contains no registered pages.');

  const scenes = [];
  for (const entry of registry) {
    const target = new URL(base.href);
    target.searchParams.set('screen', entry.id);
    await page.goto(target.href, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#phone');
    await page.evaluate(async () => {
      await document.fonts.ready;
      document.querySelectorAll('#phone *').forEach(el => {
        if (el.scrollTop) el.scrollTop = 0;
        if (el.scrollLeft) el.scrollLeft = 0;
      });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });

    const scene = await page.evaluate(({ id, group }) => {
      const phone = document.querySelector('#phone');
      const rootRect = phone.getBoundingClientRect();
      const round = n => Math.round((Number(n) || 0) * 100) / 100;
      const num = v => Number.parseFloat(v) || 0;
      const rgba = value => {
        if (!value || value === 'none' || value === 'transparent') return [0, 0, 0, 0];
        const m = value.match(/^rgba?\((.+)\)$/i);
        if (!m) return null;
        const parts = m[1].replace(/\//g, ',').split(/[\s,]+/).filter(Boolean);
        const channel = v => Math.round((v.endsWith('%') ? num(v) / 100 : num(v) / 255) * 10000) / 10000;
        return parts.slice(0, 3).map(channel)
          .concat(parts[3] === undefined ? 1 : round(parts[3].endsWith('%') ? num(parts[3]) / 100 : num(parts[3])));
      };
      const box = (rect, parent) => ({
        x: round(rect.left - parent.left), y: round(rect.top - parent.top),
        w: round(rect.width), h: round(rect.height)
      });
      const rectOf = r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
      const inside = (r, clips) => clips.every(c =>
        (!c.x || (r.right > c.left + .1 && r.left < c.right - .1)) &&
        (!c.y || (r.bottom > c.top + .1 && r.top < c.bottom - .1)));
      const clipped = (r, clips) => clips.some(c =>
        (c.x && (r.left < c.left - .5 || r.right > c.right + .5)) ||
        (c.y && (r.top < c.top - .5 || r.bottom > c.bottom + .5)));
      const font = cs => ({
        fontSize: round(num(cs.fontSize)), fontWeight: num(cs.fontWeight) || 400,
        fontFamily: cs.fontFamily, lineHeight: round(num(cs.lineHeight) || num(cs.fontSize) * 1.2),
        textAlign: cs.textAlign, color: rgba(cs.color),
        ...(num(cs.letterSpacing) ? { letterSpacing: round(num(cs.letterSpacing)) } : {}),
        ...(cs.textDecorationLine !== 'none' ? { decoration: cs.textDecorationLine } : {})
      });
      const radius = (value, rect) => value.includes('%')
        ? round(Math.min(rect.width, rect.height) * num(value) / 100) : round(num(value));
      const appearance = (cs, rect) => {
        const bg = rgba(cs.backgroundColor);
        const widths = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(v => round(num(v)));
        const colors = [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor].map(rgba);
        const radii = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(v => radius(v, rect));
        const value = {};
        if (bg && bg[3]) value.bg = bg;
        if (widths.some(Boolean)) {
          value.bw = Math.max(...widths);
          value.bc = colors[widths.findIndex(Boolean)];
          if (!widths.every(w => w === widths[0]) || !colors.every(c => JSON.stringify(c) === JSON.stringify(colors[0]))) {
            value.edges = widths;
            value.edgeColors = colors;
          }
          if (cs.borderTopStyle !== 'solid') value.borderStyle = cs.borderTopStyle;
        }
        if (radii.some(Boolean)) value.radius = radii.every(r => r === radii[0]) ? radii[0] : radii;
        if (num(cs.opacity) !== 1) value.opacity = num(cs.opacity);
        if (cs.boxShadow && cs.boxShadow !== 'none') value.shadow = cs.boxShadow;
        if (cs.transform && cs.transform !== 'none') value.transform = cs.transform;
        return value;
      };
      const makeText = (textNode, parentRect, clips, cs) => {
        if (!textNode.nodeValue || !textNode.nodeValue.trim()) return null;
        const range = document.createRange();
        range.selectNodeContents(textNode);
        const rect = range.getBoundingClientRect();
        range.detach();
        if (rect.width < .1 || rect.height < .1 || !inside(rect, clips)) return null;
        const preserve = /pre|break-spaces/.test(cs.whiteSpace);
        let text = preserve ? textNode.nodeValue : textNode.nodeValue.replace(/\s+/g, ' ');
        if (cs.textTransform === 'uppercase') text = text.toUpperCase();
        if (cs.textTransform === 'lowercase') text = text.toLowerCase();
        return { type: 'text', name: text.trim().slice(0, 50), text, ...box(rect, parentRect), ...font(cs),
          ...(preserve ? { whiteSpace: cs.whiteSpace } : {}), ...(clipped(rect, clips) ? { clipped: true } : {}) };
      };

      const pseudo = (el, selector, parentRect, clips) => {
        // Only simple, important CSS shapes; no guessed general pseudo-element layout.
        if (!((el.classList.contains('gesture') && selector === '::after') ||
          ((el.classList.contains('wifi') || el.classList.contains('battery')) && selector === '::after'))) return null;
        const cs = getComputedStyle(el, selector);
        if (cs.content === 'none' || cs.content === 'normal' || cs.display === 'none') return null;
        const host = getComputedStyle(el);
        const bw = num(cs.borderLeftWidth) + num(cs.borderRightWidth);
        const bh = num(cs.borderTopWidth) + num(cs.borderBottomWidth);
        const w = num(cs.width) + (cs.boxSizing === 'border-box' ? 0 : bw);
        const h = num(cs.height) + (cs.boxSizing === 'border-box' ? 0 : bh);
        if (w < .1 || h < .1) return null;
        let x = num(cs.left), y = num(cs.top);
        if (cs.left === 'auto') x = cs.right !== 'auto' ? parentRect.width - num(cs.right) - w : (host.justifyContent === 'center' ? (parentRect.width - w) / 2 : 0);
        if (cs.top === 'auto') y = cs.bottom !== 'auto' ? parentRect.height - num(cs.bottom) - h : (host.alignItems === 'center' ? (parentRect.height - h) / 2 : 0);
        const r = { left: parentRect.left + x, top: parentRect.top + y, right: parentRect.left + x + w, bottom: parentRect.top + y + h, width: w, height: h };
        if (!inside(r, clips)) return null;
        return { type: 'frame', name: selector, tag: 'pseudo', cls: selector, ...box(r, parentRect), ...appearance(cs, r) };
      };

      const walk = (el, parentRect, clips = []) => {
        if (!(el instanceof Element) || ['STYLE', 'SCRIPT', 'LINK', 'META', 'NOSCRIPT'].includes(el.tagName)) return null;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse' || num(cs.opacity) <= 0) return null;
        const rect = el.getBoundingClientRect();
        if (rect.width < .1 || rect.height < .1 || !inside(rect, clips)) return null;
        const cls = typeof el.className === 'string' ? el.className : el.getAttribute('class') || '';
        const tag = el.tagName.toLowerCase();
        const label = el.getAttribute('aria-label') || el.getAttribute('data-name') || el.id || '';
        const node = { type: 'frame', name: label || `${tag}${cls ? '.' + cls.trim().replace(/\s+/g, '.') : ''}`,
          tag, ...(cls ? { cls } : {}), ...box(rect, parentRect), ...appearance(cs, rect) };
        if (el.dataset.go) node.go = el.dataset.go;
        if (cs.position === 'absolute' || cs.position === 'fixed') node.position = cs.position;
        if (clipped(rect, clips)) node.clipped = true;
        if (label) node.label = label;

        const isMascot = el.classList.contains('potato');
        if (isMascot) {
          const px = num(cs.getPropertyValue('--px')) || num(cs.backgroundPositionX);
          const py = num(cs.getPropertyValue('--py')) || num(cs.backgroundPositionY);
          node.type = 'mascot';
          node.px = round(px); node.py = round(py);
          node.pose = Math.round(px * 3 / 100) + (py > 50 ? 4 : 0);
          node.bgSize = cs.backgroundSize;
          node.bgPosition = cs.backgroundPosition;
          return node;
        }

        if (tag === 'svg') {
          node.type = 'svg';
          if (el.dataset.icon) node.icon = el.dataset.icon;
          const copy = el.cloneNode(true);
          const originals = [el, ...el.querySelectorAll('*')];
          const copies = [copy, ...copy.querySelectorAll('*')];
          const paintProps = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'fill-opacity', 'stroke-opacity', 'stop-color', 'stop-opacity', 'color'];
          originals.forEach((source, i) => {
            const target = copies[i], style = getComputedStyle(source);
            target.removeAttribute('class');
            target.removeAttribute('style');
            for (const prop of paintProps) {
              let value = style.getPropertyValue(prop);
              if (!value) continue;
              value = value.replace(/currentColor/gi, style.color).replace(/url\(["']?[^)#]*#([^)'"\s]+)["']?\)/g, 'url(#$1)');
              target.setAttribute(prop, value);
            }
          });
          copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
          copy.setAttribute('width', String(round(rect.width)));
          copy.setAttribute('height', String(round(rect.height)));
          copy.querySelectorAll('style, script').forEach(n => n.remove());
          const texts = [];
          for (const textEl of el.querySelectorAll('text')) {
            const iterator = document.createTreeWalker(textEl, NodeFilter.SHOW_TEXT);
            let textNode;
            while ((textNode = iterator.nextNode())) {
              const value = makeText(textNode, rect, clips, getComputedStyle(textNode.parentElement));
              if (value) { value.source = 'svgText'; texts.push(value); }
            }
          }
          copy.querySelectorAll('text').forEach(n => n.remove());
          node.svg = copy.outerHTML.replace(/currentColor/gi, cs.color);
          if (texts.length) node.children = texts;
          return node;
        }

        node.layout = { display: cs.display, direction: cs.flexDirection, gap: round(num(cs.gap)),
          padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(v => round(num(v))),
          align: cs.alignItems, justify: cs.justifyContent };
        if (cs.display.includes('grid')) {
          node.layout.columns = cs.gridTemplateColumns;
          node.layout.rowGap = round(num(cs.rowGap));
          node.layout.columnGap = round(num(cs.columnGap));
        }
        if (cs.flexWrap !== 'nowrap') node.layout.wrap = cs.flexWrap;
        const overflowX = cs.overflowX, overflowY = cs.overflowY;
        const clipX = /hidden|clip|auto|scroll/.test(overflowX);
        const clipY = /hidden|clip|auto|scroll/.test(overflowY);
        const scrollX = /auto|scroll/.test(overflowX) && el.scrollWidth > el.clientWidth + 1;
        const scrollY = /auto|scroll/.test(overflowY) && el.scrollHeight > el.clientHeight + 1;
        let childClips = clips;
        if (clipX || clipY) {
          node.overflow = [overflowX, overflowY];
          if (/auto|scroll/.test(overflowX + ' ' + overflowY)) {
            node.scrollHeight = el.scrollHeight;
            node.scrollWidth = el.scrollWidth;
            node.viewport = { w: el.clientWidth, h: el.clientHeight };
          }
          // Retain offscreen scroll contents. Only an inner non-scroll clip can discard them.
          childClips = clips.map(c => ({ ...c, x: scrollX ? false : c.x, y: scrollY ? false : c.y }));
          childClips.push({ left: rect.left, top: rect.top,
            right: scrollX ? rect.left + el.scrollWidth : rect.right,
            bottom: scrollY ? rect.top + el.scrollHeight : rect.bottom, x: clipX, y: clipY });
        }
        const children = [];
        const before = pseudo(el, '::before', rect, childClips);
        if (before) children.push(before);
        if (tag === 'input' || tag === 'textarea' || tag === 'select') {
          const text = tag === 'select' ? (el.selectedOptions?.[0]?.textContent || el.value || '') : (el.value || el.getAttribute('placeholder') || '');
          if (text) {
            const left = num(cs.paddingLeft) + num(cs.borderLeftWidth);
            const top = num(cs.paddingTop) + num(cs.borderTopWidth);
            const w = Math.max(1, rect.width - left - num(cs.paddingRight) - num(cs.borderRightWidth));
            const lineHeight = num(cs.lineHeight) || num(cs.fontSize) * 1.2;
            children.push({ type: 'text', name: text.slice(0, 50), text, source: 'controlValue',
              x: round(left), y: round(top), w: round(w), h: round(Math.max(lineHeight, rect.height - top - num(cs.paddingBottom) - num(cs.borderBottomWidth))), ...font(cs) });
          }
        } else {
          for (const child of el.childNodes) {
            const value = child.nodeType === Node.TEXT_NODE ? makeText(child, rect, childClips, cs)
              : child.nodeType === Node.ELEMENT_NODE ? walk(child, rect, childClips) : null;
            if (value) children.push(value);
          }
        }
        const after = pseudo(el, '::after', rect, childClips);
        if (after) children.push(after);
        if (children.length) node.children = children;
        return node;
      };

      const rootStyle = getComputedStyle(document.documentElement);
      const tokens = {};
      for (const key of ['bg', 'paper', 'primary', 'primary-dark', 'ink', 'muted', 'line', 'soft', 'gold', 'danger', 'radius']) {
        tokens[key] = rootStyle.getPropertyValue('--' + key).trim();
      }
      tokens.fontFamily = rootStyle.fontFamily;
      const root = walk(phone, rootRect);
      root.x = 0; root.y = 0;
      return { id, title: window.PAGES[id]?.title || id, group, width: 412, height: 915, tokens, root };
    }, entry);
    scenes.push(scene);
  }
  return { scenes };
}
