import { bestFuzzy, escapeHtml } from './util.js';
export class CommandPalette {
    commands;
    options;
    backdrop;
    input;
    list;
    breadcrumb;
    resultCount;
    keepOpenInput = null;
    filtered = [];
    currentPath = [];
    activeIndex = 0;
    keepOpen;
    openFlag = false;
    previousFocus = null;
    running = false;
    constructor(options) {
        this.commands = options.commands;
        this.options = {
            placeholder: '',
            showKeepOpenToggle: false,
            ariaLabel: 'Quick menu',
            ...options,
        };
        this.keepOpen = options.keepOpenDefault ?? false;
    }
    setCommands(commands) {
        this.commands = commands;
        if (this.openFlag)
            this.render();
    }
    isOpen() {
        return this.openFlag;
    }
    open(prefill = '') {
        if (!this.backdrop)
            this.build();
        this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        this.openFlag = true;
        this.backdrop.hidden = false;
        document.body.classList.add('palette-open');
        this.input.value = prefill;
        if (this.keepOpenInput)
            this.keepOpenInput.checked = this.keepOpen;
        this.render();
        requestAnimationFrame(() => {
            this.input.focus();
            this.input.setSelectionRange(this.input.value.length, this.input.value.length);
            this.input.scrollIntoView({ block: 'nearest' });
        });
    }
    close() {
        if (!this.openFlag)
            return;
        this.openFlag = false;
        this.backdrop.hidden = true;
        document.body.classList.remove('palette-open');
        this.input.value = '';
        this.previousFocus?.focus();
        this.previousFocus = null;
        this.options.onClose?.();
    }
    childrenOf(command) {
        if (!command.children)
            return [];
        return typeof command.children === 'function' ? command.children() : command.children;
    }
    build() {
        const backdrop = document.createElement('div');
        backdrop.className = 'palette-backdrop';
        backdrop.hidden = true;
        backdrop.setAttribute('role', 'presentation');
        backdrop.innerHTML = `
      <div class="palette" role="dialog" aria-modal="true" aria-label="${escapeHtml(this.options.ariaLabel)}">
        <div class="palette-input-row">
          <span class="palette-prefix" aria-hidden="true">&gt;</span>
          <input class="palette-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false"
            placeholder="${escapeHtml(this.options.placeholder)}" aria-label="${escapeHtml(this.options.ariaLabel)}" />
          <span class="palette-result-count"></span>
          <kbd class="kbd">esc</kbd>
        </div>
        <div class="palette-breadcrumb"></div>
        <div class="palette-list" role="listbox"></div>
        <div class="palette-footer">
          <span class="palette-keys"><kbd class="kbd">↑</kbd><kbd class="kbd">↓</kbd> navigate <span class="palette-sep">·</span> <kbd class="kbd">↵</kbd> select <span class="palette-sep">·</span> <kbd class="kbd">esc</kbd> close</span>
          ${this.options.showKeepOpenToggle
            ? '<label class="palette-keep"><input type="checkbox" class="palette-keep-input" /> Keep open after applying</label>'
            : '<span class="palette-tip">Separate steps with <kbd class="kbd">&gt;</kbd></span>'}
        </div>
      </div>`;
        document.body.appendChild(backdrop);
        this.backdrop = backdrop;
        this.input = backdrop.querySelector('.palette-input');
        this.list = backdrop.querySelector('.palette-list');
        this.breadcrumb = backdrop.querySelector('.palette-breadcrumb');
        this.resultCount = backdrop.querySelector('.palette-result-count');
        if (this.options.showKeepOpenToggle) {
            this.keepOpenInput = backdrop.querySelector('.palette-keep-input');
            this.keepOpenInput?.addEventListener('change', () => {
                this.keepOpen = this.keepOpenInput?.checked ?? false;
            });
        }
        this.input.addEventListener('input', () => this.render());
        this.input.addEventListener('keydown', (event) => this.onKeyDown(event));
        this.list.addEventListener('click', (event) => {
            const target = event.target.closest('[data-index]');
            if (!target)
                return;
            const index = Number(target.dataset.index);
            if (!Number.isFinite(index))
                return;
            this.activeIndex = index;
            void this.choose();
        });
        this.list.addEventListener('mousemove', (event) => {
            const target = event.target.closest('[data-index]');
            if (!target)
                return;
            const index = Number(target.dataset.index);
            if (Number.isFinite(index) && index !== this.activeIndex) {
                this.activeIndex = index;
                this.updateActive();
            }
        });
        this.breadcrumb.addEventListener('click', (event) => {
            const target = event.target.closest('[data-crumb]');
            if (!target)
                return;
            const index = Number(target.dataset.crumb);
            if (!Number.isFinite(index))
                return;
            const prefix = this.currentPath
                .slice(0, index + 1)
                .map((command) => command.label)
                .join(' > ');
            this.input.value = `${prefix} > `;
            this.render();
            this.input.focus();
        });
        backdrop.addEventListener('mousedown', (event) => {
            if (event.target === backdrop)
                this.close();
        });
    }
    onKeyDown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            this.close();
            return;
        }
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (this.filtered.length) {
                this.activeIndex = (this.activeIndex + 1) % this.filtered.length;
                this.updateActive();
            }
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (this.filtered.length) {
                this.activeIndex = (this.activeIndex - 1 + this.filtered.length) % this.filtered.length;
                this.updateActive();
            }
            return;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();
            void this.choose();
        }
    }
    resolveInput() {
        const raw = this.input.value.replace(/^\s*>?\s*/, '');
        const segments = raw.split('>');
        let items = this.commands;
        const path = [];
        for (let i = 0; i < segments.length - 1; i++) {
            const segment = segments[i].trim();
            if (!segment)
                continue;
            const match = bestFuzzy(segment, items, (item) => [item.label, ...(item.keywords ?? [])]);
            if (!match)
                break;
            const children = this.childrenOf(match.item);
            if (children.length === 0)
                break;
            path.push(match.item);
            items = children;
        }
        return { path, items, query: (segments[segments.length - 1] ?? '').trim() };
    }
    render() {
        if (!this.openFlag)
            return;
        const { path, items, query } = this.resolveInput();
        this.currentPath = path;
        let scored;
        if (!query) {
            scored = items.map((item) => ({ item, score: 0 }));
        }
        else {
            scored = items
                .map((item) => {
                const match = bestFuzzy(query, [item], (candidate) => [
                    candidate.label,
                    ...(candidate.keywords ?? []),
                ]);
                return match ? { item, score: match.score } : null;
            })
                .filter((entry) => entry != null)
                .sort((a, b) => b.score - a.score);
        }
        this.filtered = scored.map((entry) => entry.item);
        this.activeIndex = Math.min(this.activeIndex, Math.max(0, this.filtered.length - 1));
        this.breadcrumb.innerHTML =
            path.length === 0
                ? '<span class="palette-crumb-hint">Type a property, then use <span class="palette-arrow">›</span> to choose a value</span>'
                : `${path
                    .map((command, index) => `<button type="button" class="palette-crumb" data-crumb="${index}">${escapeHtml(command.label)}</button>`)
                    .join('<span class="palette-crumb-sep">›</span>')}<span class="palette-crumb-sep">›</span><span class="palette-crumb-current">${escapeHtml(query || 'choose a value')}</span>`;
        if (this.filtered.length === 0) {
            this.list.innerHTML =
                '<div class="palette-empty">No matching property<span class="palette-empty-sub">Try a shorter alias, e.g. <code>Mat &gt; Con</code> or <code>Glo &gt; Y</code></span></div>';
            this.resultCount.textContent = '0';
            return;
        }
        this.list.innerHTML = this.filtered
            .map((command, index) => {
            const children = this.childrenOf(command);
            return `<div class="palette-item${index === this.activeIndex ? ' active' : ''}" data-index="${index}" role="option" aria-selected="${index === this.activeIndex}">
          <span class="palette-bullet" aria-hidden="true"></span>
          <span class="palette-label">${escapeHtml(command.label)}</span>
          ${command.hint ? `<span class="palette-hint">${escapeHtml(command.hint)}</span>` : ''}
          ${children.length ? '<span class="palette-chevron" aria-hidden="true">›</span>' : ''}
        </div>`;
        })
            .join('');
        this.resultCount.textContent = query ? `${this.filtered.length}` : '';
        this.updateActive();
    }
    updateActive() {
        const nodes = Array.from(this.list.querySelectorAll('[data-index]'));
        nodes.forEach((node, index) => {
            const active = index === this.activeIndex;
            node.classList.toggle('active', active);
            node.setAttribute('aria-selected', String(active));
            if (active)
                node.scrollIntoView({ block: 'nearest' });
        });
    }
    async choose() {
        if (this.running)
            return;
        const command = this.filtered[this.activeIndex];
        if (!command)
            return;
        const children = this.childrenOf(command);
        if (children.length > 0) {
            const prefix = [...this.currentPath, command].map((item) => item.label).join(' > ');
            this.input.value = `${prefix} > `;
            this.activeIndex = 0;
            this.render();
            this.input.focus();
            return;
        }
        if (!command.run)
            return;
        this.running = true;
        try {
            await command.run();
        }
        finally {
            this.running = false;
        }
        const shouldKeepOpen = command.keepOpen ?? this.keepOpen;
        if (shouldKeepOpen) {
            this.input.value = '';
            this.activeIndex = 0;
            this.render();
            this.input.focus();
        }
        else {
            this.close();
        }
    }
}
//# sourceMappingURL=palette.js.map