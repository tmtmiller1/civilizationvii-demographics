function classListApi(owner) {
  const parse = () => new Set(String(owner.className || "").split(/\s+/).filter(Boolean));
  const write = (set) => {
    owner.className = Array.from(set).join(" ");
  };
  return {
    add: (...tokens) => {
      const set = parse();
      for (const t of tokens) if (t) set.add(String(t));
      write(set);
    },
    contains: (token) => parse().has(String(token)),
    remove: (...tokens) => {
      const set = parse();
      for (const t of tokens) set.delete(String(t));
      write(set);
    }
  };
}

function nodeMatchesClass(node, className) {
  if (!node || typeof node.className !== "string") return false;
  const parts = node.className.split(/\s+/).filter(Boolean);
  return parts.includes(className);
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || "div").toUpperCase();
    this.children = [];
    this.parentNode = null;
    const styleMap = {};
    this.style = new Proxy(styleMap, {
      get(t, k) {
        if (k === "setProperty") return (prop, val) => { styleMap[prop] = val; };
        if (k === "cssText") return styleMap.__cssText || "";
        return styleMap[k];
      },
      set(t, k, v) {
        if (k === "cssText") styleMap.__cssText = v;
        else styleMap[k] = v;
        return true;
      }
    });
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = "";
    this.classList = classListApi(this);
    this.textContent = "";
    this.title = "";
    this._rect = { width: 120, height: 80 };
  }

  get firstChild() {
    return this.children.length > 0 ? this.children[0] : null;
  }

  get childElementCount() {
    return this.children.length;
  }

  get parentElement() {
    return this.parentNode;
  }

  get isConnected() {
    return !!this.parentNode;
  }

  appendChild(node) {
    if (!node) return node;
    node.parentNode = this;
    this.children.push(node);
    return node;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  removeChild(node) {
    const i = this.children.indexOf(node);
    if (i >= 0) this.children.splice(i, 1);
    node.parentNode = null;
    return node;
  }

  insertBefore(newNode, refNode) {
    if (!refNode) return this.appendChild(newNode);
    const i = this.children.indexOf(refNode);
    if (i < 0) return this.appendChild(newNode);
    newNode.parentNode = this;
    this.children.splice(i, 0, newNode);
    return newNode;
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }

  getAttribute(name) {
    return this.attributes.get(String(name));
  }

  addEventListener(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(fn);
  }

  dispatch(name, ev = {}) {
    const list = this.listeners.get(name) || [];
    for (const fn of list) {
      fn({
        stopPropagation: () => {},
        ...ev
      });
    }
  }

  querySelector(selector) {
    if (typeof selector !== "string" || !selector.startsWith(".")) return null;
    const className = selector.slice(1);
    const queue = [...this.children];
    while (queue.length > 0) {
      const node = queue.shift();
      if (nodeMatchesClass(node, className)) return node;
      queue.push(...(node.children || []));
    }
    return null;
  }

  querySelectorAll(selector) {
    if (typeof selector !== "string") return [];
    const classes = selector
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.startsWith("."))
      .map((s) => s.slice(1));
    if (classes.length === 0) return [];
    const out = [];
    const queue = [...this.children];
    while (queue.length > 0) {
      const node = queue.shift();
      if (classes.some((c) => nodeMatchesClass(node, c))) out.push(node);
      queue.push(...(node.children || []));
    }
    return out;
  }

  getBoundingClientRect() {
    if (this.style && typeof this.style.width === "string" && this.style.width.endsWith("rem")) {
      const v = Number(this.style.width.replace("rem", ""));
      return { width: Number.isFinite(v) ? v * 16 : 16, height: this._rect.height || 0 };
    }
    return { width: this._rect.width || 0, height: this._rect.height || 0 };
  }
}

export function createFakeDocument() {
  const body = new FakeElement("body");
  const doc = {
    body,
    createElement: (tag) => {
      const el = new FakeElement(tag);
      if (String(tag).toLowerCase() === "canvas") {
        el.getContext = () => ({
          canvas: el,
          measureText: (s) => ({ width: String(s).length * 6 })
        });
      }
      return el;
    },
    createTextNode: (text) => ({
      nodeType: 3,
      textContent: String(text || ""),
      parentNode: null
    }),
    createElementNS: (_ns, tag) => new FakeElement(tag)
  };
  return { document: doc, FakeElement };
}
