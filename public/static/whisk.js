/**
 * WHISK: Official Google Labs Experimental Creative Laboratory
 * 
 * Features:
 *   - Auto-named ingredients: Subject 1, Subject 2, Scene 1, Style 1, etc.
 *   - Multiple ingredients per category with dynamic card slots
 *   - 3 Ways to Add: Upload Own Image, Choose from Studio Library, Generate with AI
 *   - Direct Prompt Referencing: "Subject 1 in Scene 1 with style 1"
 *   - Multi-reference Image Synthesis: Passes exact image media IDs to Nano Banana 2
 *   - Full UI matching Google Labs Whisk with yellow checkmark badges and cool grey canvas
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Whisk State Machine
  // ---------------------------------------------------------------------------
  const WhiskState = {
    categories: {
      subject: {
        slots: [], // Array of ingredient objects: { token: 'Subject 1', imageUrl, mediaId, stagedId, name, ... }
        deck: [],
        deckOrder: [],
        deckIndex: 0,
      },
      scene: {
        slots: [],
        deck: [],
        deckOrder: [],
        deckIndex: 0,
      },
      style: {
        slots: [],
        deck: [],
        deckOrder: [],
        deckIndex: 0,
      },
    },
    gridCols: 2,
    isWhisking: false,
    customPrompt: '',
    selectedModel: 'GEM_PIX_2', // Nano Banana 2 Pro (FE default; wire remapped)
    aspectRatio: '16:9',
    results: [],
    dockCollapsed: false,
    activeModalContext: null, // { catKey, slotIndex }
    initialized: false,
  };

  // Outline icons for empty slots
  const EMPTY_ICONS = {
    subject: `
      <div class="whisk-slot-placeholder-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <path d="M7 17 C7 9 17 9 17 17" />
        </svg>
      </div>`,
    scene: `
      <div class="whisk-slot-placeholder-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 21c-4.5-5.5-7-9.5-7-13a7 7 0 1 1 14 0c0 3.5-2.5 7.5-7 13z"/>
          <circle cx="12" cy="8" r="2.2"/>
        </svg>
      </div>`,
    style: `
      <div class="whisk-slot-placeholder-icon">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 19l7-7 3 3-7 7-3-3z"/>
          <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18"/>
          <path d="M2 2l7.5 7.5"/>
          <circle cx="11.5" cy="11.5" r="1.5"/>
        </svg>
      </div>`,
  };

  // ---------------------------------------------------------------------------
  // Deck helpers (curated static decks / roll-dice removed)
  // ---------------------------------------------------------------------------
  function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  // ---------------------------------------------------------------------------
  // Whisk Database Persistence & All Media Sync
  // ---------------------------------------------------------------------------
  let _whiskSaveTimer = null;

  function saveWhiskToDatabase() {
    clearTimeout(_whiskSaveTimer);
    _whiskSaveTimer = setTimeout(async () => {
      try {
        const activeProjId = window.state ? window.state.activeProjectId : '';
        const payload = {
          projectId: activeProjId,
          state: {
            categories: {
              subject: { slots: WhiskState.categories.subject.slots },
              scene: { slots: WhiskState.categories.scene.slots },
              style: { slots: WhiskState.categories.style.slots },
            },
            customPrompt: WhiskState.customPrompt || '',
            aspectRatio: WhiskState.aspectRatio || '16:9',
            selectedModel: WhiskState.selectedModel || 'GEM_PIX_2',
            results: (WhiskState.results || []).filter(r => !r.isOptimistic).slice(0, 30),
          },
        };
        await fetch('/api/whisk/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        console.warn('Could not persist Whisk state to database:', err);
      }
    }, 400);
  }

  async function loadWhiskFromDatabase() {
    try {
      const activeProjId = window.state ? window.state.activeProjectId : '';
      const url = activeProjId ? `/api/whisk/state?projectId=${encodeURIComponent(activeProjId)}` : '/api/whisk/state';
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.state) {
        const s = data.state;
        if (s.categories) {
          ['subject', 'scene', 'style'].forEach(catKey => {
            if (s.categories[catKey] && Array.isArray(s.categories[catKey].slots) && s.categories[catKey].slots.length) {
              WhiskState.categories[catKey].slots = s.categories[catKey].slots;
            }
          });
        }
        if (s.customPrompt) {
          WhiskState.customPrompt = s.customPrompt;
          const promptInput = document.getElementById('whisk-prompt-input');
          if (promptInput) promptInput.value = s.customPrompt;
          const submitBtn = document.getElementById('whisk-submit-btn');
          if (submitBtn) submitBtn.classList.toggle('has-content', Boolean(s.customPrompt.trim()));
        }
        if (s.aspectRatio) WhiskState.aspectRatio = s.aspectRatio;
        if (s.selectedModel) WhiskState.selectedModel = s.selectedModel;
        if (Array.isArray(s.results) && s.results.length) {
          WhiskState.results = s.results.filter(r => !r.isOptimistic);
        }
      }
    } catch (err) {
      console.warn('Could not load saved Whisk state from database:', err);
    }
  }

  async function saveWhiskAssetToStudio(assetData) {
    try {
      const activeProjId = window.state ? window.state.activeProjectId : '';
      const res = await fetch('/api/whisk/save-asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjId,
          url: assetData.url,
          name: assetData.name || 'Whisk Ingredient',
          category: assetData.category || 'whisk',
          token: assetData.token || null,
        }),
      });
      if (res.ok) {
        // Refresh studio library so All Media immediately shows the new Whisk creation!
        if (typeof window.loadAssets === 'function') {
          window.loadAssets();
        }
      }
    } catch (err) {
      console.warn('Could not sync Whisk asset to Studio library:', err);
    }
  }

  function whiskReset() {
    ['subject', 'scene', 'style'].forEach(catKey => {
      WhiskState.categories[catKey].slots = [{
        token: `${capitalize(catKey)} 1`,
        category: catKey,
        index: 1,
        imageUrl: '',
      }];
    });
    WhiskState.results = [];
    WhiskState.customPrompt = '';
    const promptInput = document.getElementById('whisk-prompt-input');
    if (promptInput) promptInput.value = '';
    const submitBtn = document.getElementById('whisk-submit-btn');
    if (submitBtn) submitBtn.classList.remove('has-content');
    renderAllSlots();
    renderMiniSlots();
    updateTokenHelperTray();
    renderWhiskResults();
    saveWhiskToDatabase();
  }

  // ---------------------------------------------------------------------------
  // Dynamic Multi-Ingredient Slot Rendering
  // ---------------------------------------------------------------------------
  function renderAllSlots() {
    ['subject', 'scene', 'style'].forEach(catKey => {
      const container = document.getElementById(`whisk-slots-${catKey}`);
      if (!container) return;

      const cat = WhiskState.categories[catKey];
      // Ensure at least 1 slot object exists
      if (!cat.slots.length) {
        cat.slots = [{
          token: `${capitalize(catKey)} 1`,
          category: catKey,
          index: 1,
          imageUrl: '',
        }];
      }

      container.innerHTML = '';

      cat.slots.forEach((slot, slotIdx) => {
        const slotEl = document.createElement('div');
        const tokenLabel = slot.token || `${capitalize(catKey)} ${slotIdx + 1}`;
        slot.token = tokenLabel;
        slot.index = slotIdx + 1;

        if (slot.imageUrl) {
          // Loaded slot with image, token pill, delete button, and yellow checkmark badge
          slotEl.className = 'whisk-card-slot has-image';
          slotEl.title = `Click to inspect / refine ${tokenLabel}`;
          slotEl.innerHTML = `
            <div class="whisk-card-token-badge">${tokenLabel}</div>
            <button type="button" class="whisk-card-delete-btn" title="Remove ${tokenLabel}">✕</button>
            <img class="whisk-slot-img" src="${slot.imageUrl}" alt="${slot.name || tokenLabel}" />
            <div class="whisk-card-selected-badge" title="${tokenLabel} Active">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
          `;

          // Delete button
          const delBtn = slotEl.querySelector('.whisk-card-delete-btn');
          if (delBtn) {
            delBtn.onclick = (e) => {
              e.stopPropagation();
              removeSlot(catKey, slotIdx);
            };
          }

          // Click card to open Refine or replace modal
          slotEl.onclick = () => openRefineModal(catKey, slotIdx);
        } else {
          // Empty slot with dashed border, token pill, and category icon
          slotEl.className = 'whisk-card-slot';
          slotEl.title = `Click to add ${tokenLabel}`;
          slotEl.innerHTML = `
            <div class="whisk-card-token-badge">${tokenLabel}</div>
            ${EMPTY_ICONS[catKey] || ''}
          `;
          slotEl.onclick = () => openSourcePickerModal(catKey, slotIdx);
        }

        container.appendChild(slotEl);
      });
    });

    renderMiniSlots();
    updateTokenHelperTray();
  }

  // ---------------------------------------------------------------------------
  // Collapsed Narrow Strip Mini Slots (Matches Google Labs Whisk Screenshot)
  // ---------------------------------------------------------------------------
  function renderMiniSlots() {
    ['subject', 'scene', 'style'].forEach(catKey => {
      const el = document.getElementById(`whisk-mini-slot-${catKey}`);
      if (!el) return;

      const cat = WhiskState.categories[catKey];
      const slot = (cat.slots && cat.slots[0]) || null;

      if (slot && slot.imageUrl) {
        el.className = 'whisk-mini-slot has-image';
        el.title = `${slot.token || catKey}: ${slot.name}`;
        el.innerHTML = `
          <img src="${slot.imageUrl}" alt="${slot.name || catKey}" />
          <div class="whisk-mini-slot-check">
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
        `;
      } else {
        el.className = 'whisk-mini-slot';
        el.title = `Add ${catKey}`;
        if (catKey === 'subject') {
          el.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
        } else if (catKey === 'scene') {
          el.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>`;
        } else {
          el.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"></path><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18"></path><path d="M2 2l7.5 7.5"></path><circle cx="11.5" cy="11.5" r="1.5"></circle></svg>`;
        }
      }

      el.onclick = () => {
        toggleImagesDock(false); // Expand sidebar
      };
    });

    const expandBtn = document.getElementById('whisk-mini-expand-btn');
    if (expandBtn) {
      expandBtn.onclick = () => toggleImagesDock(false);
    }
  }

  function removeSlot(catKey, slotIdx) {
    const cat = WhiskState.categories[catKey];
    if (!cat || !cat.slots.length) return;

    if (cat.slots.length === 1) {
      // Just clear image
      cat.slots[0].imageUrl = '';
      cat.slots[0].mediaId = null;
      cat.slots[0].stagedId = null;
      cat.slots[0].name = '';
      cat.slots[0].description = '';
    } else {
      // Remove slot and re-index remaining slots
      cat.slots.splice(slotIdx, 1);
      cat.slots.forEach((s, idx) => {
        s.index = idx + 1;
        s.token = `${capitalize(catKey)} ${idx + 1}`;
      });
    }

    renderAllSlots();
    renderMiniSlots();
    updateTokenHelperTray();
    saveWhiskToDatabase();
  }

  function addSlot(catKey) {
    const cat = WhiskState.categories[catKey];
    if (!cat) return;

    // If existing slot 0 is empty, open source picker for slot 0
    if (cat.slots.length === 1 && !cat.slots[0].imageUrl) {
      openSourcePickerModal(catKey, 0);
      return;
    }

    // Add new slot (e.g. Subject 2)
    const newIdx = cat.slots.length;
    const newSlot = {
      token: `${capitalize(catKey)} ${newIdx + 1}`,
      category: catKey,
      index: newIdx + 1,
      imageUrl: '',
    };
    cat.slots.push(newSlot);
    renderAllSlots();
    renderMiniSlots();
    saveWhiskToDatabase();

    // Open source picker for this new slot immediately
    openSourcePickerModal(catKey, newIdx);
  }

  // ---------------------------------------------------------------------------
  // Modal Manager & Helpers
  // ---------------------------------------------------------------------------
  function getOrCreateModal() {
    let modal = document.getElementById('whisk-modal-backdrop');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'whisk-modal-backdrop';
      modal.className = 'whisk-modal-backdrop';
      modal.innerHTML = `<div class="whisk-modal-card" id="whisk-modal-card"></div>`;
      document.body.appendChild(modal);

      modal.onclick = e => {
        if (e.target === modal) closeModal();
      };
    }
    return modal;
  }

  function closeModal() {
    const modal = document.getElementById('whisk-modal-backdrop');
    if (modal) modal.style.display = 'none';
    WhiskState.activeModalContext = null;
  }

  // ---------------------------------------------------------------------------
  // 1. Source Picker Modal: Upload vs Library vs AI
  // ---------------------------------------------------------------------------
  function openSourcePickerModal(catKey, slotIndex) {
    WhiskState.activeModalContext = { catKey, slotIndex };
    const modal = getOrCreateModal();
    const card = modal.querySelector('#whisk-modal-card');
    card.className = 'whisk-modal-card';

    const catName = capitalize(catKey);
    const token = `${catName} ${slotIndex + 1}`;

    card.innerHTML = `
      <button type="button" class="whisk-modal-close-btn" id="whisk-modal-close" title="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>

      <div class="whisk-modal-main-col">
        <div class="whisk-modal-header-title">ADD ${token.toUpperCase()}</div>

        <div class="whisk-source-options-grid">
          <!-- 1. Upload Own Image -->
          <div class="whisk-source-option-card" id="whisk-opt-upload">
            <div class="whisk-source-icon-wrap">📁</div>
            <div class="whisk-source-name">Upload Image</div>
            <div class="whisk-source-desc">Select an image from your computer to use as ${token}</div>
          </div>

          <!-- 2. Choose from Library -->
          <div class="whisk-source-option-card" id="whisk-opt-library">
            <div class="whisk-source-icon-wrap">🖼️</div>
            <div class="whisk-source-name">Choose from Library</div>
            <div class="whisk-source-desc">Browse studio media history and project gallery</div>
          </div>

          <!-- 3. Generate with AI -->
          <div class="whisk-source-option-card" id="whisk-opt-generate">
            <div class="whisk-source-icon-wrap">✨</div>
            <div class="whisk-source-name">Generate with AI</div>
            <div class="whisk-source-desc">Describe what you want to create with Nano Banana 2</div>
          </div>
        </div>
      </div>
    `;

    card.querySelector('#whisk-modal-close').onclick = closeModal;

    // 1. Upload
    card.querySelector('#whisk-opt-upload').onclick = () => {
      closeModal();
      triggerUploadForSlot(catKey, slotIndex);
    };

    // 2. Library
    card.querySelector('#whisk-opt-library').onclick = () => {
      openLibraryPickerModal(catKey, slotIndex);
    };

    // 3. Generate
    card.querySelector('#whisk-opt-generate').onclick = () => {
      openGenerateModal(catKey, slotIndex);
    };

    modal.style.display = 'flex';
  }

  // ---------------------------------------------------------------------------
  // 2. Studio Library Picker Modal
  // ---------------------------------------------------------------------------
  async function openLibraryPickerModal(catKey, slotIndex) {
    WhiskState.activeModalContext = { catKey, slotIndex };
    const modal = getOrCreateModal();
    const card = modal.querySelector('#whisk-modal-card');
    card.className = 'whisk-modal-card';

    const catName = capitalize(catKey);
    const token = `${catName} ${slotIndex + 1}`;

    card.innerHTML = `
      <button type="button" class="whisk-modal-close-btn" id="whisk-modal-close" title="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>

      <div class="whisk-modal-main-col" style="width: 100%;">
        <div class="whisk-modal-header-title">CHOOSE ${token.toUpperCase()} FROM LIBRARY</div>
        <div class="whisk-library-grid" id="whisk-library-grid">
          <div style="font-size: 12px; color: #555; grid-column: 1 / -1; text-align: center; padding: 20px;">
            Loading studio media library...
          </div>
        </div>
      </div>
    `;

    card.querySelector('#whisk-modal-close').onclick = closeModal;
    modal.style.display = 'flex';

    // Fetch assets from library
    let assets = [];
    try {
      const res = await fetch('/api/assets?type=image');
      if (res.ok) {
        const data = await res.json();
        assets = data.assets || [];
      }
    } catch (e) {
      console.warn('Could not fetch studio assets:', e);
    }

    const combined = assets.filter(a => a.url || a.imageUrl);

    const gridEl = card.querySelector('#whisk-library-grid');
    if (!combined.length) {
      gridEl.innerHTML = `
        <div style="font-size: 12px; color: #555; grid-column: 1 / -1; text-align: center; padding: 20px;">
          No images in library yet. Upload an image or generate one!
        </div>
      `;
      return;
    }

    gridEl.innerHTML = '';
    combined.forEach(a => {
      const url = a.url || a.imageUrl;
      const name = a.name || a.title || token;
      const mediaId = a.id || a.mediaId;

      const itemEl = document.createElement('div');
      itemEl.className = 'whisk-library-item';
      itemEl.title = `Select ${name} as ${token}`;
      itemEl.innerHTML = `
        <img src="${url}" alt="${name}" loading="lazy" />
        <div class="whisk-library-item-title">${name}</div>
      `;

      itemEl.onclick = () => {
        applyImageToSlot(catKey, slotIndex, {
          name: name,
          imageUrl: url,
          mediaId: mediaId,
          source: 'library',
          description: name,
        });
        closeModal();
      };

      gridEl.appendChild(itemEl);
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Upload File Trigger
  // ---------------------------------------------------------------------------
  function triggerUploadForSlot(catKey, slotIndex) {
    let input = document.getElementById('whisk-dynamic-file-input');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.id = 'whisk-dynamic-file-input';
      input.accept = 'image/*';
      input.style.display = 'none';
      document.body.appendChild(input);
    }

    input.onchange = async (e) => {
      if (e.target.files && e.target.files[0]) {
        const file = e.target.files[0];
        const localUrl = URL.createObjectURL(file);
        const name = file.name.replace(/\.[^/.]+$/, '');
        const token = `${capitalize(catKey)} ${slotIndex + 1}`;

        // Stage file via /api/assets/stage
        let stagedId = null;
        try {
          const formData = new FormData();
          formData.append('file', file);
          const stageRes = await fetch('/api/assets/stage', {
            method: 'POST',
            body: formData,
          });
          if (stageRes.ok) {
            const stageData = await stageRes.json();
            stagedId = stageData.asset ? stageData.asset.id : null;
          }
        } catch (err) {
          console.warn('Could not stage uploaded file:', err);
        }

        applyImageToSlot(catKey, slotIndex, {
          name: name,
          imageUrl: localUrl,
          stagedId: stagedId,
          source: 'uploaded',
          description: name,
        });

        saveWhiskAssetToStudio({
          url: localUrl,
          name: `${capitalize(catKey)}: ${name}`,
          category: catKey,
          token: token,
        });
      }
      input.value = '';
    };

    input.click();
  }

  function applyImageToSlot(catKey, slotIndex, data) {
    const cat = WhiskState.categories[catKey];
    if (!cat) return;

    const token = `${capitalize(catKey)} ${slotIndex + 1}`;

    // Preserve and sanitize variants list
    let variants = [];
    if (data.variants && Array.isArray(data.variants) && data.variants.length) {
      variants = [...data.variants];
    } else if (cat.slots[slotIndex] && Array.isArray(cat.slots[slotIndex].variants) && cat.slots[slotIndex].variants.length) {
      variants = [...cat.slots[slotIndex].variants];
    } else if (data.imageUrl) {
      variants = [{
        id: data.mediaId || data.id || `var-${Date.now()}`,
        imageUrl: data.imageUrl,
        mediaId: data.mediaId || null,
        name: data.name || token,
        description: data.description || data.name || '',
      }];
    }

    // Filter out invalid/empty image URLs so no broken image icons ever show up
    variants = variants.filter(v => v && v.imageUrl && (v.imageUrl.startsWith('http') || v.imageUrl.startsWith('/') || v.imageUrl.startsWith('blob:') || v.imageUrl.startsWith('data:')));

    cat.slots[slotIndex] = {
      id: data.id || `slot-${Date.now()}`,
      token: token,
      category: catKey,
      index: slotIndex + 1,
      name: data.name || token,
      description: data.description || data.name || '',
      imageUrl: data.imageUrl || '',
      mediaId: data.mediaId || null,
      stagedId: data.stagedId || null,
      source: data.source || 'custom',
      variants: variants,
    };

    renderAllSlots();
    renderMiniSlots();
    updateTokenHelperTray();
    saveWhiskToDatabase();
  }

  // ---------------------------------------------------------------------------
  // 4. Generate with AI Modal (Screenshot 1)
  // ---------------------------------------------------------------------------
  function openGenerateModal(catKey, slotIndex) {
    WhiskState.activeModalContext = { catKey, slotIndex };
    const modal = getOrCreateModal();
    const card = modal.querySelector('#whisk-modal-card');
    card.className = 'whisk-modal-card';

    const catName = capitalize(catKey);
    const token = `${catName} ${slotIndex + 1}`;

    card.innerHTML = `
      <button type="button" class="whisk-modal-close-btn" id="whisk-modal-close" title="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>

      <div class="whisk-modal-main-col">
        <div class="whisk-modal-header-title">GENERATE A ${catName.toUpperCase()}</div>

        <div class="whisk-modal-inner-box">
          <div class="whisk-modal-inner-label">PROMPT</div>
          <textarea class="whisk-modal-textarea" id="whisk-modal-prompt" rows="6" placeholder="Describe a ${catKey} (e.g. 3d cartoon, underwater diver, isometric blueprint)...">${catKey === 'subject' ? '3d cartoon' : ''}</textarea>
        </div>

        <button type="button" class="whisk-modal-black-btn" id="whisk-modal-gen-action">
          <span>GENERATE</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"></line>
            <polyline points="12 5 19 12 12 19"></polyline>
          </svg>
        </button>
      </div>
    `;

    card.querySelector('#whisk-modal-close').onclick = closeModal;

    const genBtn = card.querySelector('#whisk-modal-gen-action');
    const promptInput = card.querySelector('#whisk-modal-prompt');

    promptInput.focus();
    promptInput.setSelectionRange(promptInput.value.length, promptInput.value.length);

    genBtn.onclick = async () => {
      const prompt = promptInput.value.trim() || `3d cartoon ${catKey}`;
      genBtn.disabled = true;
      genBtn.innerHTML = `<span>GENERATING WITH NANO BANANA 2...</span>`;

      const prevErr = card.querySelector('#whisk-gen-error');
      if (prevErr) prevErr.remove();

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 90000); // 90s cloud AI timeout
        const res = await fetch('/api/whisk/variants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ingredient: { name: prompt, category: catKey },
            caption: prompt,
            num_variants: 1,
            model: WhiskState.selectedModel || 'GEM_PIX_2',
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || `Generation failed: ${res.status}`);
        }

        const data = await res.json();
        const v = (data.variants && data.variants[0]) || null;
        if (!v || !v.imageUrl) {
          throw new Error('Google Flow did not return an image URL.');
        }

        const genItem = {
          name: prompt,
          imageUrl: v.imageUrl,
          mediaId: v.mediaId || v.id,
          description: prompt,
          source: 'generated',
          variants: [{
            id: v.mediaId || v.id || `var-${Date.now()}`,
            imageUrl: v.imageUrl,
            mediaId: v.mediaId || v.id,
            name: prompt,
            description: prompt,
          }],
        };

        applyImageToSlot(catKey, slotIndex, genItem);
        // Persist generated ingredient into Prisma Asset & studio gallery
        saveWhiskAssetToStudio({
          url: v.imageUrl,
          name: `${capitalize(catKey)}: ${prompt}`,
          category: catKey,
          token: `${capitalize(catKey)} ${slotIndex + 1}`,
        });
        saveWhiskToDatabase();
        openRefineModal(catKey, slotIndex);
      } catch (err) {
        console.error('Generation error:', err);
        genBtn.disabled = false;
        genBtn.innerHTML = `<span>GENERATE</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`;

        const mainCol = card.querySelector('.whisk-modal-main-col');
        const errEl = document.createElement('div');
        errEl.id = 'whisk-gen-error';
        errEl.className = 'whisk-modal-error-banner';
        errEl.textContent = `Generation error: ${err.message}`;
        mainCol.insertBefore(errEl, genBtn);
      }
    };

    modal.style.display = 'flex';
  }

  // ---------------------------------------------------------------------------
  // 5. Refine Modal (Screenshot 2)
  // ---------------------------------------------------------------------------
  function openRefineModal(catKey, slotIndex) {
    WhiskState.activeModalContext = { catKey, slotIndex };
    const cat = WhiskState.categories[catKey];
    const slot = (cat.slots && cat.slots[slotIndex]) || null;
    if (!slot || !slot.imageUrl) {
      openSourcePickerModal(catKey, slotIndex);
      return;
    }

    const modal = getOrCreateModal();
    const card = modal.querySelector('#whisk-modal-card');
    card.className = 'whisk-modal-card is-refine';

    const token = slot.token || `${capitalize(catKey)} ${slotIndex + 1}`;

    // Ensure slot.variants is populated with only valid image URLs
    if (slot.variants && Array.isArray(slot.variants)) {
      slot.variants = slot.variants.filter(v => v && v.imageUrl && (v.imageUrl.startsWith('http') || v.imageUrl.startsWith('/') || v.imageUrl.startsWith('blob:') || v.imageUrl.startsWith('data:')));
    } else {
      slot.variants = [];
    }

    if (!slot.variants.length && slot.imageUrl && (slot.imageUrl.startsWith('http') || slot.imageUrl.startsWith('/') || slot.imageUrl.startsWith('blob:') || slot.imageUrl.startsWith('data:'))) {
      slot.variants = [{
        id: slot.mediaId || slot.id || `var-${Date.now()}`,
        imageUrl: slot.imageUrl,
        mediaId: slot.mediaId || null,
        name: slot.name || token,
        description: slot.description || slot.name || '',
      }];
    }

    card.innerHTML = `
      <button type="button" class="whisk-modal-close-btn" id="whisk-modal-close" title="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>

      <!-- Left Variants Column -->
      <div class="whisk-modal-variants-col">
        <div class="whisk-modal-variants-title">VARIANTS</div>
        <div class="whisk-modal-variants-list" id="whisk-modal-variants-list"></div>
      </div>

      <!-- Right Main Column -->
      <div class="whisk-modal-main-col">
        <div class="whisk-modal-header-title">REFINE ${token.toUpperCase()}</div>

        <div class="whisk-modal-inner-box">
          <div class="whisk-modal-inner-label">IMAGE DESCRIPTION</div>
          <textarea class="whisk-modal-textarea" id="whisk-refine-desc" rows="6" placeholder="Describe modifications or refinements...">${slot.description || slot.name || ''}</textarea>
        </div>

        <button type="button" class="whisk-modal-black-btn" id="whisk-modal-refine-gen-btn">
          <span>GENERATE NEW VARIANT</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"></line>
            <polyline points="12 5 19 12 12 19"></polyline>
          </svg>
        </button>
      </div>
    `;

    card.querySelector('#whisk-modal-close').onclick = closeModal;

    const listContainer = card.querySelector('#whisk-modal-variants-list');
    const descInput = card.querySelector('#whisk-refine-desc');
    const refineBtn = card.querySelector('#whisk-modal-refine-gen-btn');

    function renderVariants() {
      listContainer.innerHTML = '';
      if (!slot.variants.length) {
        listContainer.innerHTML = '<div style="font-size: 11px; color: rgba(0,0,0,0.5); padding: 8px;">No variants yet</div>';
        return;
      }
      slot.variants.forEach((v, idx) => {
        if (!v || !v.imageUrl) return;
        const isSelected = v.imageUrl === slot.imageUrl;
        const itemEl = document.createElement('div');
        itemEl.className = `whisk-variant-card-item ${isSelected ? 'is-selected' : ''}`;
        itemEl.title = v.name || `Variant ${idx + 1}`;
        itemEl.innerHTML = `
          <img src="${v.imageUrl}" alt="${v.name || 'Variant'}" />
          ${isSelected ? `
            <div class="whisk-variant-check-badge">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
          ` : ''}
        `;

        itemEl.onclick = () => {
          slot.imageUrl = v.imageUrl;
          slot.mediaId = v.mediaId || null;
          slot.name = v.name || slot.name;
          slot.description = v.description || v.name || slot.description;
          descInput.value = slot.description;
          renderVariants();
          renderAllSlots();
          renderMiniSlots();
        };

        listContainer.appendChild(itemEl);
      });
    }

    renderVariants();

    refineBtn.onclick = async () => {
      const newPrompt = descInput.value.trim() || slot.name || token;
      refineBtn.disabled = true;
      refineBtn.innerHTML = `<span>GENERATING NEW VARIANT...</span>`;

      const prevErr = card.querySelector('#whisk-refine-error');
      if (prevErr) prevErr.remove();

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 90000); // 90s cloud AI timeout
        const res = await fetch('/api/whisk/variants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ingredient: { name: slot.name || token, category: catKey },
            caption: newPrompt,
            num_variants: 1,
            model: WhiskState.selectedModel || 'GEM_PIX_2',
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || `Variant generation failed: ${res.status}`);
        }

        const data = await res.json();
        const v = (data.variants && data.variants[0]) || null;
        if (!v || !v.imageUrl) {
          throw new Error('Google Flow did not return a variant image.');
        }

        const newVar = {
          id: v.mediaId || v.id || `var-${Date.now()}`,
          imageUrl: v.imageUrl,
          mediaId: v.mediaId || v.id,
          name: newPrompt,
          description: newPrompt,
        };

        slot.variants.unshift(newVar);
        slot.imageUrl = newVar.imageUrl;
        slot.mediaId = newVar.mediaId;
        slot.name = newPrompt;
        slot.description = newPrompt;

        renderVariants();
        renderAllSlots();
        renderMiniSlots();
        updateTokenHelperTray();
        // Persist variant image into Prisma Asset & studio gallery
        saveWhiskAssetToStudio({
          url: newVar.imageUrl,
          name: `${capitalize(catKey)}: ${newPrompt}`,
          category: catKey,
          token: token,
        });
        saveWhiskToDatabase();
      } catch (err) {
        console.error('Refine generation error:', err);
        const mainCol = card.querySelector('.whisk-modal-main-col');
        const errEl = document.createElement('div');
        errEl.id = 'whisk-refine-error';
        errEl.className = 'whisk-modal-error-banner';
        errEl.textContent = `Variant failed: ${err.message}`;
        mainCol.insertBefore(errEl, refineBtn);
      } finally {
        refineBtn.disabled = false;
        refineBtn.innerHTML = `<span>GENERATE NEW VARIANT</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`;
      }
    };

    modal.style.display = 'flex';
  }

  // ---------------------------------------------------------------------------
  // 6. Token Helper Tray (Chips above Prompt Bar)
  // ---------------------------------------------------------------------------
  function updateTokenHelperTray() {
    const tray = document.getElementById('whisk-tokens-helper-tray');
    if (!tray) return;

    const activeTokens = [];
    ['subject', 'scene', 'style'].forEach(catKey => {
      const cat = WhiskState.categories[catKey];
      cat.slots.forEach(s => {
        if (s.imageUrl) {
          activeTokens.push(s.token);
        }
      });
    });

    if (!activeTokens.length) {
      tray.innerHTML = '';
      tray.style.display = 'none';
      return;
    }

    tray.style.display = 'flex';
    tray.innerHTML = activeTokens.map(tok => `
      <button type="button" class="whisk-token-chip-btn" data-token="${tok}" title="Insert '${tok}' into prompt">
        <span>+</span> <span>${tok}</span>
      </button>
    `).join('');

    tray.querySelectorAll('.whisk-token-chip-btn').forEach(btn => {
      btn.onclick = () => {
        const token = btn.getAttribute('data-token');
        insertTokenIntoPrompt(token);
      };
    });
  }

  function insertTokenIntoPrompt(token) {
    const input = document.getElementById('whisk-prompt-input');
    if (!input) return;

    const cur = input.value.trim();
    if (!cur) {
      input.value = `${token} in `;
    } else {
      input.value = `${cur} ${token} `;
    }
    input.focus();
    WhiskState.customPrompt = input.value;
  }

  // ---------------------------------------------------------------------------
  // 7. Combinatorial Multi-Reference Composition
  // ---------------------------------------------------------------------------
  async function composeWhisk() {
    if (WhiskState.isWhisking) return;

    // Collect all active ingredients
    const activeSubjects = WhiskState.categories.subject.slots.filter(s => s.imageUrl);
    const activeScenes = WhiskState.categories.scene.slots.filter(s => s.imageUrl);
    const activeStyles = WhiskState.categories.style.slots.filter(s => s.imageUrl);
    const promptText = (WhiskState.customPrompt || '').trim();

    const allActive = [...activeSubjects, ...activeScenes, ...activeStyles];

    if (!allActive.length && !promptText) {
      if (window.showToast) {
        window.showToast('Add a Subject, Scene, Style, or type a prompt first', 'warning');
      }
      return;
    }

    WhiskState.isWhisking = true;
    updateSubmitButton();

    // Optimistic UI placeholder
    const tempId = `optimistic-${Date.now()}`;
    const optimisticCard = {
      id: tempId,
      name: promptText || 'Whisk Composition',
      isOptimistic: true,
    };

    WhiskState.results.unshift(optimisticCard);
    renderWhiskResults();

    try {
      // Direct prompt token parsing: map "Subject 1", "Scene 1", etc. to exact images
      const referencedIngredients = [];
      allActive.forEach(ing => {
        const tokenRegex = new RegExp(`\\b${ing.token}\\b`, 'i');
        if (tokenRegex.test(promptText) || !promptText) {
          referencedIngredients.push(ing);
        }
      });

      const payload = {
        subjects: activeSubjects,
        scenes: activeScenes,
        styles: activeStyles,
        referenced_ingredients: referencedIngredients.length ? referencedIngredients : allActive,
        custom_prompt: promptText || 'Subject 1 in Scene 1 with style 1',
        aspect_ratio: WhiskState.aspectRatio || '16:9',
        model: WhiskState.selectedModel || 'GEM_PIX_2',
        num_images: 2, // 2 images side-by-side matching Screenshot 4
      };

      const res = await fetch('/api/whisk/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Composition failed: ${res.status}`);
      }

      const data = await res.json();
      const assets = data.assets || [];

      WhiskState.results = WhiskState.results.filter(r => r.id !== tempId);

      if (assets.length) {
        assets.forEach(a => {
          WhiskState.results.unshift(a);
          if (a.url) {
            saveWhiskAssetToStudio({
              url: a.url,
              name: `Whisk: ${promptText || 'Composition'}`,
              category: 'composition',
            });
          }
        });
        saveWhiskToDatabase();
      } else {
        throw new Error('No images returned.');
      }
    } catch (err) {
      console.error('Composition error:', err);
      WhiskState.results = WhiskState.results.filter(r => r.id !== tempId);
      // Alert user directly with error detail instead of seeding fake images
      showWhiskToast(`Composition failed: ${err.message}`, 'error');
    } finally {
      WhiskState.isWhisking = false;
      updateSubmitButton();
      renderWhiskResults();
    }
  }

  function updateSubmitButton() {
    const btn = document.getElementById('whisk-submit-btn');
    if (!btn) return;
    if (WhiskState.isWhisking) {
      btn.disabled = true;
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="whisk-icon-spin"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"/></svg>`;
    } else {
      btn.disabled = false;
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`;
    }
  }

  function removeWhiskResult(resultId) {
    if (!resultId) return;
    WhiskState.results = WhiskState.results.filter((r) => r.id !== resultId);
    renderWhiskResults();
    saveWhiskToDatabase();
  }

  function renderWhiskResults() {
    const emptyEl = document.getElementById('whisk-canvas-empty');
    const gridEl = document.getElementById('whisk-gallery-grid');
    if (!gridEl) return;

    if (!WhiskState.results.length) {
      if (emptyEl) emptyEl.style.display = 'flex';
      gridEl.classList.add('hidden');
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    gridEl.classList.remove('hidden');

    gridEl.innerHTML = '';
    WhiskState.results.forEach(item => {
      if (item.isOptimistic) {
        const card = document.createElement('div');
        card.className = 'whisk-result-card is-whisking';
        card.innerHTML = `
          <button type="button" class="whisk-result-remove-btn" title="Remove" aria-label="Remove">✕</button>
          <div class="whisk-result-shimmer-body">
            <div style="font-size: 24px;">🥣</div>
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 800; letter-spacing: 1.2px; text-transform: uppercase;">Whisking ${item.name}...</div>
          </div>
        `;
        card.querySelector('.whisk-result-remove-btn').addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          removeWhiskResult(item.id);
        });
        gridEl.appendChild(card);
      } else {
        const card = document.createElement('div');
        card.className = 'whisk-result-card';
        card.innerHTML = `
          <button type="button" class="whisk-result-remove-btn" title="Remove image" aria-label="Remove image">✕</button>
          <img class="whisk-result-img" src="${item.url}" alt="${item.name || 'Whisk Creation'}" loading="lazy" />
          <div class="whisk-result-hover-overlay">
            <div class="whisk-result-title">${item.name || 'Whisk Creation'}</div>
            <a href="${item.url}" target="_blank" download class="whisk-result-download-btn">⬇ Download</a>
          </div>
        `;
        card.querySelector('.whisk-result-remove-btn').addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          removeWhiskResult(item.id);
        });
        gridEl.appendChild(card);
      }
    });
  }

  function toggleImagesDock(forceState) {
    if (typeof forceState === 'boolean') {
      WhiskState.dockCollapsed = forceState;
    } else {
      WhiskState.dockCollapsed = !WhiskState.dockCollapsed;
    }
    const sidebar = document.getElementById('whisk-sidebar');
    const arrowEl = document.getElementById('whisk-toggle-arrow');
    const textEl = document.getElementById('whisk-toggle-text');

    if (sidebar) {
      sidebar.classList.toggle('collapsed', WhiskState.dockCollapsed);
    }

    if (arrowEl && textEl) {
      if (WhiskState.dockCollapsed) {
        arrowEl.textContent = '>';
        textEl.textContent = 'SHOW IMAGES';
      } else {
        arrowEl.textContent = '<';
        textEl.textContent = 'HIDE IMAGES';
      }
    }

    renderMiniSlots();
  }

  function showWhiskToast(msg, type = 'info') {
    let toast = document.getElementById('whisk-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'whisk-toast';
      toast.className = 'whisk-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className = `whisk-toast is-${type} show`;
    setTimeout(() => {
      toast.classList.remove('show');
    }, 4500);
  }

  function setGridColumns(cols) {
    const val = Math.max(1, Math.min(5, parseInt(cols, 10) || 2));
    WhiskState.gridCols = val;
    document.documentElement.style.setProperty('--whisk-grid-cols', val);

    const slider = document.getElementById('whisk-grid-slider');
    if (slider && parseInt(slider.value, 10) !== val) {
      slider.value = val;
    }
  }

  // ---------------------------------------------------------------------------
  // Event Bindings
  // ---------------------------------------------------------------------------
  function bindWhiskEvents() {
    ['subject', 'scene', 'style'].forEach(catKey => {
      // Plus button ⊕ (add multiple ingredients!)
      const addBtn = document.getElementById(`whisk-add-${catKey}`);
      if (addBtn) {
        addBtn.onclick = e => {
          e.stopPropagation();
          addSlot(catKey);
        };
      }
    });

    // Toggle images dock (< HIDE IMAGES)
    const toggleDockBtn = document.getElementById('whisk-toggle-dock');
    if (toggleDockBtn) {
      toggleDockBtn.onclick = toggleImagesDock;
    }

    const chevronBtn = document.getElementById('whisk-collapse-chevron');
    if (chevronBtn) {
      chevronBtn.onclick = toggleImagesDock;
    }

    // Grid columns slider
    const gridSlider = document.getElementById('whisk-grid-slider');
    if (gridSlider) {
      gridSlider.oninput = e => {
        setGridColumns(e.target.value);
      };
    }

    // Bottom prompt input & enter key
    const promptInput = document.getElementById('whisk-prompt-input');
    const submitBtn = document.getElementById('whisk-submit-btn');

    if (promptInput) {
      promptInput.oninput = e => {
        WhiskState.customPrompt = e.target.value;
        if (submitBtn) {
          submitBtn.classList.toggle('has-content', Boolean(e.target.value.trim()));
        }
        saveWhiskToDatabase();
      };
      promptInput.onkeydown = e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          composeWhisk();
        }
      };
    }

    // Submit button ➔
    if (submitBtn) {
      submitBtn.onclick = composeWhisk;
    }
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------
  async function initWhisk() {
    if (WhiskState.initialized) return;
    WhiskState.initialized = true;

    await loadWhiskFromDatabase();
    bindWhiskEvents();

    renderAllSlots();
    renderMiniSlots();
    updateTokenHelperTray();
    setGridColumns(WhiskState.gridCols);
    renderWhiskResults();
  }

  // Export globally
  window.initWhisk = initWhisk;
  window.WhiskState = WhiskState;
  window.whiskAddSlot = addSlot;
  window.whiskRemoveSlot = removeSlot;
  window.whiskOpenSourcePicker = openSourcePickerModal;
  window.whiskOpenLibraryPicker = openLibraryPickerModal;
  window.whiskOpenGenerateModal = openGenerateModal;
  window.whiskOpenRefineModal = openRefineModal;
  window.whiskCompose = composeWhisk;
  window.whiskReset = whiskReset;
  window.saveWhiskToDatabase = saveWhiskToDatabase;
  window.loadWhiskFromDatabase = loadWhiskFromDatabase;

  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.getElementById('view-whisk-pane')) initWhisk();
    });
  } else {
    if (document.getElementById('view-whisk-pane')) initWhisk();
  }
})();
