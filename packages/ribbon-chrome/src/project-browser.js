/**
 * Autodesk Revit-style Lateral Project Browser
 * Reusable component for navigating views, schedules, families, and model links.
 */

export function getDefaultProjectBrowserTree() {
  return [
    {
      id: 'views',
      label: 'Views (all)',
      type: 'category',
      expanded: true,
      children: [
        {
          id: 'views-3d',
          label: '3D Views',
          type: 'folder',
          expanded: true,
          children: [
            { id: 'view-3d-default', label: '{3D}', type: 'view' }
          ]
        },
        {
          id: 'views-plans',
          label: 'Plans',
          type: 'folder',
          expanded: true,
          children: [
            { id: 'view-plan-l1', label: 'Level 1', type: 'view' },
            { id: 'view-plan-l2', label: 'Level 2', type: 'view' }
          ]
        },
        {
          id: 'views-sections',
          label: 'Sections',
          type: 'folder',
          expanded: false,
          children: [
            { id: 'view-sec-1', label: 'Section 1', type: 'view' }
          ]
        }
      ]
    },
    {
      id: 'schedules',
      label: 'Schedules / Quantities',
      type: 'category',
      expanded: true,
      children: [
        { id: 'sch-takeoffs', label: 'Takeoffs', type: 'schedule' },
        { id: 'sch-tag-mappings', label: 'Tag mappings', type: 'schedule' }
      ]
    },
    {
      id: 'families',
      label: 'Families',
      type: 'category',
      expanded: true,
      children: [
        { id: 'fam-cable-trays', label: 'Cable Trays', type: 'family' },
        { id: 'fam-conduits', label: 'Conduits', type: 'family' }
      ]
    },
    {
      id: 'links',
      label: 'Revit / IFC Links',
      type: 'category',
      expanded: true,
      children: [
        {
          id: 'link-arch',
          label: 'Architecture.ifc',
          type: 'link',
          hasVisibility: true,
          visible: true
        },
        {
          id: 'link-struct',
          label: 'Structure.ifc',
          type: 'link',
          hasVisibility: true,
          visible: true
        }
      ]
    }
  ];
}

/**
 * Creates and mounts a Revit-style Project Browser in the given container.
 *
 * @param {HTMLElement} container
 * @param {Object} [options]
 * @returns {Object} ProjectBrowserApi
 */
export function createProjectBrowser(container, options = {}) {
  if (!container) {
    throw new Error('container element is required');
  }

  const doc = container.ownerDocument || globalThis.document;
  if (!doc) {
    throw new Error('Document context not found');
  }

  container.setAttribute('data-rc-host', '');

  let activeModel = options.activeModel || 'Active Model';
  let treeData = options.tree || getDefaultProjectBrowserTree();
  let selectedNodeId = options.initialSelection || null;
  const selectListeners = new Set();
  if (typeof options.onNodeSelect === 'function') {
    selectListeners.add(options.onNodeSelect);
  }

  // Root element
  const root = doc.createElement('div');
  root.className = 'rc-project-browser';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Project Browser');

  // 1. Title bar: "Project Browser - [Active Model]"
  const titlebar = doc.createElement('div');
  titlebar.className = 'rc-browser-titlebar';

  const titleText = doc.createElement('div');
  titleText.className = 'rc-browser-title';
  titleText.textContent = `Project Browser - [${activeModel}]`;
  titlebar.appendChild(titleText);

  const titleTools = doc.createElement('div');
  titleTools.className = 'rc-browser-tools';

  const dockBtn = doc.createElement('button');
  dockBtn.type = 'button';
  dockBtn.className = 'rc-browser-dock-btn';
  dockBtn.title = 'Dock / Undock';
  dockBtn.setAttribute('aria-label', 'Dock / Undock');
  dockBtn.innerHTML = `<svg class="rc-icon rc-icon-12" viewBox="0 0 16 16" fill="none" stroke="currentColor"><rect x="2" y="2" width="12" height="12" rx="1"/><line x1="2" y1="5" x2="14" y2="5"/></svg>`;
  titleTools.appendChild(dockBtn);

  const closeBtn = doc.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'rc-browser-close-btn';
  closeBtn.title = 'Close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.innerHTML = `<svg class="rc-icon rc-icon-12" viewBox="0 0 16 16" stroke="currentColor"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>`;
  closeBtn.addEventListener('click', () => {
    if (typeof options.onClose === 'function') {
      options.onClose();
    }
  });
  titleTools.appendChild(closeBtn);

  titlebar.appendChild(titleTools);
  root.appendChild(titlebar);

  // 2. Search filter bar ("Search...")
  const searchBar = doc.createElement('div');
  searchBar.className = 'rc-browser-search';

  const searchBox = doc.createElement('div');
  searchBox.className = 'rc-browser-search-box';

  const searchIcon = doc.createElement('span');
  searchIcon.className = 'rc-search-icon';
  searchIcon.setAttribute('aria-hidden', 'true');
  searchIcon.innerHTML = `<svg class="rc-icon rc-icon-12" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
  searchBox.appendChild(searchIcon);

  const searchInput = doc.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'rc-browser-search-input';
  searchInput.placeholder = 'Search...';
  searchInput.setAttribute('aria-label', 'Search Project Browser');
  searchBox.appendChild(searchInput);

  const clearBtn = doc.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'rc-search-clear-btn';
  clearBtn.title = 'Clear search';
  clearBtn.setAttribute('aria-label', 'Clear search');
  clearBtn.textContent = '✕';
  clearBtn.style.display = 'none';
  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearBtn.style.display = 'none';
    applySearchFilter('');
  });
  searchBox.appendChild(clearBtn);

  searchBar.appendChild(searchBox);
  root.appendChild(searchBar);

  searchInput.addEventListener('input', () => {
    const query = searchInput.value;
    clearBtn.style.display = query ? '' : 'none';
    applySearchFilter(query);
    if (typeof options.onSearch === 'function') {
      options.onSearch(query);
    }
  });

  // 3. Tree View
  const treeContainer = doc.createElement('div');
  treeContainer.className = 'rc-browser-tree';
  treeContainer.setAttribute('role', 'tree');
  treeContainer.setAttribute('aria-label', 'Project Browser Tree');
  root.appendChild(treeContainer);

  container.appendChild(root);

  // Tree lookup helpers
  function findNode(nodes, id) {
    for (const n of nodes) {
      if (n.id === id) return n;
      if (n.children) {
        const found = findNode(n.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  function findAncestors(nodes, targetId, path = []) {
    for (const n of nodes) {
      if (n.id === targetId) {
        return path;
      }
      if (n.children) {
        const found = findAncestors(n.children, targetId, [...path, n]);
        if (found) return found;
      }
    }
    return null;
  }

  // Active search filtering
  let currentSearchQuery = '';

  function nodeMatchesQuery(node, q) {
    if (!q) return true;
    if (node.label && node.label.toLowerCase().includes(q.toLowerCase())) {
      return true;
    }
    if (node.children) {
      return node.children.some(child => nodeMatchesQuery(child, q));
    }
    return false;
  }

  function applySearchFilter(query) {
    currentSearchQuery = (query || '').trim();
    renderTree();
  }

  // Render tree
  function renderTree() {
    treeContainer.replaceChildren();

    function renderNodeList(nodes, parentEl, level = 0) {
      for (const node of nodes) {
        const hasChildren = Array.isArray(node.children) && node.children.length > 0;
        const matches = currentSearchQuery ? nodeMatchesQuery(node, currentSearchQuery) : true;
        if (!matches) {
          continue;
        }

        const itemContainer = doc.createElement('div');
        itemContainer.className = 'rc-tree-item-group';

        const nodeRow = doc.createElement('div');
        const isExpanded = currentSearchQuery ? true : Boolean(node.expanded);
        nodeRow.className = `rc-tree-node ${isExpanded ? 'rc-expanded' : 'rc-collapsed'}${node.id === selectedNodeId ? ' rc-selected' : ''}`;
        nodeRow.setAttribute('data-node-id', node.id);
        nodeRow.setAttribute('role', 'treeitem');
        nodeRow.setAttribute('aria-expanded', String(isExpanded));
        nodeRow.style.paddingLeft = `${level * 16 + 4}px`;

        // Expander button (▼ / ▶) or spacer
        if (hasChildren) {
          const expanderBtn = doc.createElement('button');
          expanderBtn.type = 'button';
          expanderBtn.className = 'rc-tree-expander';
          expanderBtn.textContent = isExpanded ? '▼' : '▶';
          expanderBtn.setAttribute('aria-label', isExpanded ? 'Collapse' : 'Expand');

          expanderBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            node.expanded = !node.expanded;
            const nowExpanded = Boolean(node.expanded);
            expanderBtn.textContent = nowExpanded ? '▼' : '▶';
            expanderBtn.setAttribute('aria-label', nowExpanded ? 'Collapse' : 'Expand');
            nodeRow.className = `rc-tree-node ${nowExpanded ? 'rc-expanded' : 'rc-collapsed'}${node.id === selectedNodeId ? ' rc-selected' : ''}`;
            nodeRow.setAttribute('aria-expanded', String(nowExpanded));
            if (childrenContainer) {
              childrenContainer.style.display = nowExpanded ? 'block' : 'none';
            }
            if (typeof options.onNodeToggle === 'function') {
              options.onNodeToggle(node, nowExpanded);
            }
          });
          nodeRow.appendChild(expanderBtn);
        } else {
          const spacer = doc.createElement('span');
          spacer.className = 'rc-tree-expander-spacer';
          nodeRow.appendChild(spacer);
        }

        // Icon
        const iconSpan = doc.createElement('span');
        iconSpan.className = 'rc-tree-icon';
        iconSpan.setAttribute('aria-hidden', 'true');
        if (node.type === 'category') {
          iconSpan.innerHTML = `<svg class="rc-icon rc-icon-12" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`;
        } else if (node.type === 'link') {
          iconSpan.innerHTML = `<svg class="rc-icon rc-icon-12" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
        } else {
          iconSpan.innerHTML = `<svg class="rc-icon rc-icon-12" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
        }
        nodeRow.appendChild(iconSpan);

        // Label
        const labelSpan = doc.createElement('span');
        labelSpan.className = 'rc-tree-label';
        labelSpan.textContent = node.label;
        nodeRow.appendChild(labelSpan);

        // Visibility eye toggle for Revit / IFC links
        if (node.hasVisibility || node.type === 'link') {
          const visBtn = doc.createElement('button');
          visBtn.type = 'button';
          const isVisible = node.visible !== false;
          visBtn.className = `rc-tree-visibility-btn ${isVisible ? 'rc-visible' : 'rc-hidden'}`;
          visBtn.title = isVisible ? 'Hide element' : 'Show element';
          visBtn.setAttribute('aria-label', isVisible ? 'Hide element' : 'Show element');
          visBtn.innerHTML = `<svg class="rc-icon rc-icon-12" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;

          visBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            node.visible = !node.visible;
            const nowVis = Boolean(node.visible);
            visBtn.className = `rc-tree-visibility-btn ${nowVis ? 'rc-visible' : 'rc-hidden'}`;
            visBtn.title = nowVis ? 'Hide element' : 'Show element';
            visBtn.setAttribute('aria-label', nowVis ? 'Hide element' : 'Show element');
            if (typeof options.onVisibilityToggle === 'function') {
              options.onVisibilityToggle(node, nowVis);
            }
          });
          nodeRow.appendChild(visBtn);
        }

        // Click to select node
        nodeRow.addEventListener('click', () => {
          api.selectNode(node.id);
        });

        itemContainer.appendChild(nodeRow);

        // Children container
        let childrenContainer = null;
        if (hasChildren) {
          childrenContainer = doc.createElement('div');
          childrenContainer.className = 'rc-tree-children';
          childrenContainer.style.display = isExpanded ? 'block' : 'none';
          renderNodeList(node.children, childrenContainer, level + 1);
          itemContainer.appendChild(childrenContainer);
        }

        parentEl.appendChild(itemContainer);
      }
    }

    renderNodeList(treeData, treeContainer, 0);
  }

  // Initial render
  renderTree();

  // Public API
  const api = {
    /**
     * Updates tree data and re-renders tree.
     * @param {Array} tree
     */
    setTreeData(tree) {
      treeData = Array.isArray(tree) ? tree : [];
      renderTree();
    },

    /**
     * Selects a node by id, expanding its ancestors and highlighting it.
     * @param {string} id
     */
    selectNode(id) {
      selectedNodeId = id;
      const node = findNode(treeData, id);
      if (node) {
        // Expand ancestors
        const ancestors = findAncestors(treeData, id);
        if (ancestors) {
          for (const anc of ancestors) {
            anc.expanded = true;
          }
        }
      }

      // Update DOM selection classes
      const allNodeEls = treeContainer.querySelectorAll('.rc-tree-node');
      for (const el of allNodeEls) {
        if (el.getAttribute('data-node-id') === id) {
          el.classList.add('rc-selected');
        } else {
          el.classList.remove('rc-selected');
        }
      }

      // Re-render if ancestors were expanded
      if (node) {
        renderTree();
      }

      if (node) {
        for (const listener of selectListeners) {
          try {
            listener(node);
          } catch (err) {
            console.error(err);
          }
        }
      }

      return node;
    },

    /**
     * Registers a callback invoked when a node is selected.
     * @param {Function} cb
     * @returns {Function} Unsubscribe function
     */
    onNodeSelect(cb) {
      if (typeof cb === 'function') {
        selectListeners.add(cb);
      }
      return () => {
        selectListeners.delete(cb);
      };
    },

    /**
     * Updates the active model title text.
     * @param {string} name
     */
    setActiveModel(name) {
      activeModel = name || 'Active Model';
      titleText.textContent = `Project Browser - [${activeModel}]`;
    },

    /**
     * Gets the active model name.
     */
    getActiveModel() {
      return activeModel;
    },

    /**
     * Filters the tree by search query.
     * @param {string} query
     */
    filter(query) {
      searchInput.value = query || '';
      clearBtn.style.display = query ? '' : 'none';
      applySearchFilter(query);
    },

    /**
     * Returns current tree data.
     */
    getTreeData() {
      return treeData;
    },

    /**
     * Returns node by id.
     * @param {string} id
     */
    getNode(id) {
      return findNode(treeData, id);
    },

    /**
     * Root element of the project browser.
     */
    root,

    /**
     * Cleans up DOM.
     */
    destroy() {
      root.remove();
      selectListeners.clear();
    }
  };

  return api;
}
