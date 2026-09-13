'use client';

/**
 * Studio DOM shell — ported from public/studio/index.html.
 * Behavior remains in /static/app.js + /static/whisk.js (loaded by the page).
 * Do not replace ids; app.js binds by getElementById.
 */
export default function StudioShell() {
  return (
    <div className="theme-flow-dark studio-next-root" style={{ height: '100dvh', width: '100%', maxWidth: '100%', overflow: 'hidden' }}>
<div className="flow-app-shell">
    
    {/* =================================================================== */}
    {/* TOP APPLICATION BAR (Official Google Flow)                          */}
    {/* =================================================================== */}
    <header className="flow-header">
      <div className="flow-header-left">
        <button
          type="button"
          className="flow-hdr-btn flow-mobile-nav-btn"
          id="flow-mobile-nav-btn"
          title="Open menu"
          aria-label="Open menu"
          aria-controls="flow-sidebar"
          aria-expanded="false"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <line x1="4" y1="7" x2="20" y2="7" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="17" x2="20" y2="17" />
          </svg>
        </button>
        {/* Back Arrow button to SaaS Dashboard */}
        <a href="/dashboard" className="flow-hdr-btn" id="header-back-btn" title="Back to Dashboard" style={{textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center"}}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
        </a>
        
        {/* Project Title ONLY (Clean, no 3-dots, no external link, no modal popups) */}
        <div className="flow-project-selector" style={{cursor: "default", pointerEvents: "none", padding: "4px 8px"}}>
          <span className="flow-project-title" id="header-project-name" style={{fontWeight: "600", fontSize: "14px", color: "#f1f5f9"}}>Default Project</span>
        </div>
      </div>

      {/* Centered Credits Display (Replaces Search Bar) */}
      <div className="flow-header-center">
        <div className="flow-credits-display" id="flow-credits-bar" style={{display: "inline-flex", alignItems: "center", gap: "12px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "9999px", padding: "6px 18px", fontFamily: "'Plus Jakarta Sans', sans-serif"}}>
          <div style={{display: "flex", alignItems: "center", gap: "6px", fontSize: "12px"}}>
            <span style={{display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", background: "#6366f1", boxShadow: "0 0 8px rgba(99,102,241,0.6)"}}></span>
            <span className="flow-credits-label" style={{color: "#94a3b8", fontWeight: "500"}}>Standard:</span>
            <span id="header-std-credits" style={{color: "#e0e7ff", fontWeight: "700"}}>--</span>
          </div>
          <div style={{width: "1px", height: "14px", background: "rgba(255,255,255,0.12)"}}></div>
          <div style={{display: "flex", alignItems: "center", gap: "6px", fontSize: "12px"}}>
            <span style={{display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", background: "#a855f7", boxShadow: "0 0 8px rgba(168,85,247,0.6)"}}></span>
            <span className="flow-credits-label" style={{color: "#94a3b8", fontWeight: "500"}}>Pro:</span>
            <span id="header-pro-credits" style={{color: "#f3e8ff", fontWeight: "700"}}>--</span>
          </div>
        </div>
      </div>

      {/* Right Action Items */}
      <div className="flow-header-right">
        {/* Settings Gear */}
        <button className="flow-hdr-action-btn" id="header-settings-btn" title="View mode & settings">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>

        <a href="/dashboard" className="flow-hdr-dashboard-link" title="Go to SaaS Dashboard">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <span className="flow-hdr-dashboard-text">Dashboard</span>
        </a>
        {/* Plan Badge (e.g. ULTRA / PRO) */}
        <div className="flow-hdr-plan-pill" id="header-plan-badge">PRO</div>
      </div>
    </header>

    <div className="flow-sidebar-backdrop hidden" id="flow-sidebar-backdrop" aria-hidden="true"></div>


    {/* Settings Popover (Screenshot 2) */}
    <div className="flow-settings-popover hidden" id="settings-popover">
      <div className="settings-popover-group">
        <span className="settings-popover-heading">View mode</span>
        <div className="segmented-pill-bar">
          <button className="seg-pill active" id="view-mode-grid-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            <span>Grid</span>
          </button>
          <button className="seg-pill" id="view-mode-batch-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="7"/><rect x="3" y="14" width="18" height="7"/></svg>
            <span>Batch</span>
          </button>
        </div>
      </div>

      <div className="settings-popover-group">
        <span className="settings-popover-heading">Grid size</span>
        <div className="segmented-pill-bar grid-size-bar">
          <button className="seg-pill" data-size="s" id="grid-size-s-btn">S</button>
          <button className="seg-pill active" data-size="m" id="grid-size-m-btn">M</button>
          <button className="seg-pill" data-size="l" id="grid-size-l-btn">L</button>
        </div>
      </div>

      <div className="settings-popover-group toggles-group">
        <div className="settings-toggle-line">
          <div className="toggle-text-wrap">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
            <span>Sound on hover</span>
          </div>
          <label className="flow-switch"><input type="checkbox" id="toggle-sound-hover" /><span className="flow-slider"></span></label>
        </div>

        <div className="settings-toggle-line">
          <div className="toggle-text-wrap">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
            <span>Return silent videos</span>
          </div>
          <label className="flow-switch"><input type="checkbox" id="toggle-silent-videos" /><span className="flow-slider"></span></label>
        </div>

        <div className="settings-toggle-line">
          <div className="toggle-text-wrap">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            <span>Show tile details</span>
          </div>
          <label className="flow-switch"><input type="checkbox" id="toggle-tile-details" defaultChecked /><span className="flow-slider"></span></label>
        </div>

        <div className="settings-toggle-line">
          <div className="toggle-text-wrap">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 14.66V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5.34"/><polygon points="18 2 22 6 12 16 8 16 8 12 18 2"/></svg>
            <span>Clear prompt on submit</span>
          </div>
          <label className="flow-switch"><input type="checkbox" id="toggle-clear-prompt" defaultChecked /><span className="flow-slider"></span></label>
        </div>
      </div>
    </div>

    {/* Card Context Menu (Screenshot 5) */}
    <div className="flow-card-context-menu hidden" id="card-context-menu">
      <button className="flow-ctx-item" id="ctx-favorite">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        <span>Favorite</span>
      </button>
      <button className="flow-ctx-item" id="ctx-extend">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
        <span>Extend</span>
      </button>
      <button className="flow-ctx-item" id="ctx-animate">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        <span>Animate</span>
      </button>
      <button className="flow-ctx-item" id="ctx-add-prompt">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span>Add to prompt</span>
      </button>
      <button className="flow-ctx-item" id="ctx-upscale">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 15 6 6m-6-6v4.8m0-4.8h4.8M9 9 3 3m6 6V4.2M9 9H4.2"/></svg>
        <span id="ctx-upscale-text">Upscale to 1080p</span>
      </button>
      <button className="flow-ctx-item" id="ctx-download">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        <span id="ctx-download-text">Download</span>
      </button>
      <button className="flow-ctx-item hidden" id="ctx-download-upscaled">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        <span style={{color: "#34d399", fontWeight: "600"}}>Download (1080p Upscaled)</span>
      </button>
      <div className="flow-ctx-divider"></div>
      <button className="flow-ctx-item danger" id="ctx-trash">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        <span>Move to trash</span>
      </button>
    </div>

    {/* =================================================================== */}
    {/* MAIN WORKSPACE: LEFT SIDEBAR + CANVAS VIEW                          */}
    {/* =================================================================== */}
    <div className="flow-workspace-layout">
      
      {/* Collapsible Left Sidebar (Screenshot 1) */}
      <aside className="flow-sidebar" id="flow-sidebar">
        <div className="flow-sidebar-top">
          <button className="flow-sidebar-item active" data-view="all" id="nav-all-media">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>
            <span className="flow-sidebar-label">All media</span>
          </button>
          
          <button className="flow-sidebar-item" data-view="images" id="nav-images">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            <span className="flow-sidebar-label">Images</span>
          </button>
          
          <button className="flow-sidebar-item" data-view="videos" id="nav-videos">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
            <span className="flow-sidebar-label">Videos</span>
          </button>
          
          <button className="flow-sidebar-item" data-view="characters" id="nav-characters">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <span className="flow-sidebar-label">Characters</span>
          </button>

          
          <button className="flow-sidebar-item" data-view="tools" id="nav-tools">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="19" r="1.5"/><circle cx="5" cy="12" r="1.5"/><circle cx="5" cy="5" r="1.5"/><circle cx="5" cy="19" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="19" cy="5" r="1.5"/><circle cx="19" cy="19" r="1.5"/></svg>
            <span className="flow-sidebar-label">Tools</span>
          </button>

          {/* Pinned tools (e.g. Whisk) — filled by app.js from localStorage */}
          <div className="flow-sidebar-pinned" id="sidebar-pinned-tools" aria-label="Pinned tools"></div>
        </div>

        <div className="flow-sidebar-bottom">
          <button className="flow-sidebar-item" data-view="trash" id="nav-trash">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            <span className="flow-sidebar-label">Trash</span>
          </button>
          
          <button className="flow-sidebar-item" id="sidebar-collapse-btn" title="Collapse sidebar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 19l-7-7 7-7m8 14l-7-7 7-7"/></svg>
            <span className="flow-sidebar-label">Collapse</span>
          </button>

          <div className="flow-sidebar-disclaimer">
            Google Flow can make mistakes, so double check it
          </div>
        </div>
      </aside>

      {/* Main Canvas View Area */}
      <main className="flow-canvas-viewport">
        
        {/* VIEW 1: Media Gallery Grid (Default: All media / Images / Videos) */}
        <section className="flow-view-pane active" id="view-gallery-pane">
          <div className="flow-gallery-container">
            {/* Dynamic Grid matching Screenshot 1 */}
            <div className="flow-media-grid grid-size-m" id="gallery-grid">
              {/* Asset cards injected dynamically by renderFlowGallery() */}
            </div>
          </div>
        </section>

        {/* VIEW 2: Characters Management (Screenshot navigation) */}
        <section className="flow-view-pane" id="view-characters-pane">
          <div className="characters-workspace">
            <div className="characters-page-header">
              <div>
                <h2 className="characters-page-title">Characters</h2>
                <p className="characters-page-sub">Create Google Flow character entities with portrait images & voice presets to feature in your creations.</p>
              </div>
              <div className="characters-header-actions">
                <button type="button" className="action-btn primary" id="sync-characters-btn" title="Sync characters from Google Flow">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                  <span>Sync with Flow</span>
                </button>
                <button className="refresh-proj-btn" id="refresh-characters-page-btn" type="button" title="Reload character catalog">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38"/></svg>
                </button>
              </div>
            </div>

            <div className="characters-page-layout">
              {/* Character Creation Panel */}
              <div className="card characters-create-panel">
                <label className="section-label">NEW CHARACTER</label>
                <div className="form-group">
                  <label className="setting-title" htmlFor="char-create-name-input">Character Name</label>
                  <input type="text" id="char-create-name-input" className="character-name-input" placeholder="e.g. Monkey King" autoComplete="off" />
                </div>
                
                <div className="form-group">
                  <label className="setting-title">Portrait Source</label>
                  <div className="char-source-toggle" id="char-source-toggle">
                    <button type="button" className="char-source-btn active" data-source="library" id="char-source-library-btn">From Library</button>
                    <button type="button" className="char-source-btn" data-source="upload" id="char-source-upload-btn">Upload Image</button>
                    <button type="button" className="char-source-btn" data-source="generate" id="char-source-generate-btn">Generate AI</button>
                  </div>
                </div>

                {/* 1. From Library & Uploads */}
                <div className="form-group" id="char-library-fields">
                  <label className="setting-title">Select from Library</label>
                  <div className="char-library-row">
                    <button type="button" className="action-btn" id="char-open-library-btn">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight: "6px"}}><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                      Browse Library & Uploads
                    </button>
                    <span className="char-library-filename" id="char-library-filename">No image selected from library</span>
                  </div>
                  <div className="char-selected-preview-card hidden" id="char-library-preview-card">
                    <div className="char-selected-thumb">
                      <img id="char-library-preview-img" alt="Selected portrait" />
                    </div>
                    <div className="char-selected-info">
                      <span className="char-selected-title" id="char-library-preview-title">Asset</span>
                      <span className="char-selected-badge" id="char-library-preview-badge">Library Image</span>
                      <div className="char-selected-actions">
                        <button type="button" className="btn-text-sm" id="char-change-library-btn">Change</button>
                        <button type="button" className="btn-text-sm danger" id="char-remove-library-btn">Remove</button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Direct Upload */}
                <div className="form-group hidden" id="char-upload-fields">
                  <label className="setting-title">Upload Image</label>
                  <div className="char-upload-row">
                    <input type="file" id="char-upload-file-input" accept="image/*" hidden={true} />
                    <button type="button" className="action-btn" id="char-pick-upload-btn">Choose Image</button>
                    <span className="char-upload-filename" id="char-upload-filename">No file selected</span>
                  </div>
                  <div className="char-upload-preview hidden" id="char-upload-preview">
                    <img id="char-upload-preview-img" alt="Preview" />
                  </div>
                </div>

                {/* 3. Generate AI Portrait */}
                <div className="form-group hidden" id="char-generate-fields">
                  <label className="setting-title" htmlFor="char-portrait-prompt-input">Portrait Prompt</label>
                  <textarea id="char-portrait-prompt-input" className="char-portrait-prompt" rows={3} placeholder="Describe appearance & costume (portraits use a plain white background by default)..."></textarea>
                  <div style={{display: "flex", gap: "8px", marginTop: "8px", alignItems: "center"}}>
                    <button type="button" className="action-btn" id="char-quick-generate-portrait-btn" style={{fontSize: "12px", padding: "6px 12px"}}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight: "5px"}}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                      Generate AI Preview
                    </button>
                    <span id="char-generate-status" style={{fontSize: "11.5px", color: "var(--text-muted)"}}></span>
                  </div>
                  <div className="char-generate-preview hidden" id="char-generate-preview" style={{marginTop: "10px"}}>
                    <div className="char-selected-preview-card">
                      <div className="char-selected-thumb">
                        <img id="char-generate-preview-img" alt="Generated AI preview" />
                      </div>
                      <div className="char-selected-info">
                        <span className="char-selected-title" id="char-generate-preview-title">Generated AI Portrait</span>
                        <span className="char-selected-badge">AI Ready</span>
                        <div className="char-selected-actions">
                          <button type="button" className="btn-text-sm danger" id="char-discard-generated-btn">Discard</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="form-group">
                  <label className="setting-title" htmlFor="char-create-voice-select">Voice Preset</label>
                  <select id="char-create-voice-select" className="character-voice-select" title="Voice preset">
                    <option value="">No voice</option>
                  </select>
                </div>

                <button className="action-btn primary create-character-btn" id="char-create-submit-btn" type="button">
                  <span id="char-create-submit-label">Create Character</span>
                </button>
              </div>

              {/* Character List Panel */}
              <div className="card characters-list-panel">
                <div className="characters-header" style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
                  <label className="section-label">FLOW CHARACTERS (<span id="characters-page-count">0</span>)</label>
                  <span id="characters-selected-count-badge" className="characters-selected-badge" style={{fontSize: "11px", fontWeight: "600", color: "#a78bfa", background: "rgba(167, 139, 250, 0.1)", border: "1px solid rgba(167, 139, 250, 0.25)", borderRadius: "12px", padding: "2px 8px"}}>0/4 selected in prompt</span>
                </div>
                <div className="characters-page-list" id="characters-page-list">
                  <div className="characters-empty">No characters found yet. Create one or sync with Flow.</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* VIEW 3: Scenes (Storyboard Timeline) */}
        <section className="flow-view-pane" id="view-scenes-pane">
          <div className="storyboard-workspace">
            <div className="storyboard-header">
              <div>
                <h2>Scenes & Storyboard</h2>
                <p>Sequence video clips to play in continuity.</p>
              </div>
              <div className="storyboard-actions">
                <button className="action-btn" id="storyboard-clear-btn">Clear Timeline</button>
                <button className="action-btn primary" id="storyboard-export-btn">Export Scene Manifest</button>
              </div>
            </div>
            
            <div className="timeline-container">
              <div className="timeline-tracks" id="storyboard-tracks">
                <div className="storyboard-empty" id="storyboard-empty-state">
                  <p>No clips in timeline. Click "Add to timeline" on video cards in the gallery.</p>
                </div>
              </div>
            </div>

            <div className="storyboard-preview-grid">
              <div className="card timeline-preview-card">
                <span className="section-label">SEQUENCED PLAYBACK</span>
                <video id="timeline-video-player" controls={true} loop={true} playsInline={true}></video>
              </div>
              <div className="card timeline-meta-card">
                <span className="section-label">SCENE DETAILS</span>
                <div id="timeline-clip-details">
                  <p className="subtle-text">Select a scene in the timeline to inspect.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* VIEW 4: Tools catalog (pin tools to sidebar) */}
        <section className="flow-view-pane" id="view-tools-pane">
          <div className="tools-workspace">
            <div className="tools-page-header">
              <div>
                <h2 className="tools-page-title">Tools</h2>
                <p className="tools-page-sub">Creator utilities. Pin favorites to the sidebar for quick access.</p>
              </div>
            </div>
            <div className="tools-catalog" id="tools-catalog">
              <article className="tool-card" id="tool-card-whisk" data-tool-id="whisk">
                <div className="tool-card-top">
                  <span className="tool-card-icon whisk-sidebar-icon" aria-hidden="true">W</span>
                  <span className="tool-card-lab">LAB</span>
                </div>
                <h3 className="tool-card-title">Whisk</h3>
                <p className="tool-card-desc">Mix subject, scene, and style ingredients into new images.</p>
                <div className="tool-card-actions">
                  <button type="button" className="tool-card-open-btn" id="tool-open-whisk">Open</button>
                  <button type="button" className="tool-card-pin-btn" id="tool-pin-whisk" data-tool-id="whisk" aria-pressed="true">Unpin</button>
                </div>
              </article>

              <article className="tool-card" id="tool-card-storyteller" data-tool-id="storyteller">
                <div className="tool-card-top">
                  <span className="tool-card-icon bvs-tool-icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="14" height="10" rx="2"/><rect x="8" y="3" width="14" height="10" rx="2"/></svg>
                  </span>
                </div>
                <h3 className="tool-card-title">Bulk Visual Storyteller</h3>
                <p className="tool-card-desc">Turn a multi-scene script into a cohesive image sequence with character refs and chain consistency.</p>
                <div className="tool-card-actions">
                  <button type="button" className="tool-card-open-btn" id="tool-open-storyteller">Open</button>
                  <button type="button" className="tool-card-pin-btn" id="tool-pin-storyteller" data-tool-id="storyteller" aria-pressed="true">Unpin</button>
                </div>
              </article>

              <article className="tool-card" id="tool-card-bulkt2v" data-tool-id="bulkt2v">
                <div className="tool-card-top">
                  <span className="tool-card-icon btv-tool-icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                  </span>
                </div>
                <h3 className="tool-card-title">Bulk Text to Video</h3>
                <p className="tool-card-desc">Parse a script into scenes and generate Veo videos in parallel with queue, Stop, and ZIP download.</p>
                <div className="tool-card-actions">
                  <button type="button" className="tool-card-open-btn" id="tool-open-bulkt2v">Open</button>
                  <button type="button" className="tool-card-pin-btn" id="tool-pin-bulkt2v" data-tool-id="bulkt2v" aria-pressed="true">Unpin</button>
                </div>
              </article>

              <article className="tool-card" id="tool-card-bulkt2i" data-tool-id="bulkt2i">
                <div className="tool-card-top">
                  <span className="tool-card-icon bti-tool-icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                  </span>
                </div>
                <h3 className="tool-card-title">Bulk Text to Image</h3>
                <p className="tool-card-desc">Parse a script into scenes and generate images in parallel with queue, Stop, and ZIP download.</p>
                <div className="tool-card-actions">
                  <button type="button" className="tool-card-open-btn" id="tool-open-bulkt2i">Open</button>
                  <button type="button" className="tool-card-pin-btn" id="tool-pin-bulkt2i" data-tool-id="bulkt2i" aria-pressed="true">Unpin</button>
                </div>
              </article>

              <article className="tool-card" id="tool-card-bulki2v" data-tool-id="bulki2v">
                <div className="tool-card-top">
                  <span className="tool-card-icon biv-tool-icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18"/><polygon points="17 8 22 12 17 16 17 8"/></svg>
                  </span>
                </div>
                <h3 className="tool-card-title">Bulk Image to Video</h3>
                <p className="tool-card-desc">Upload sequenced stills, map prompts 1:1, confirm, then generate Veo videos with queue, Stop, and ZIP download.</p>
                <div className="tool-card-actions">
                  <button type="button" className="tool-card-open-btn" id="tool-open-bulki2v">Open</button>
                  <button type="button" className="tool-card-pin-btn" id="tool-pin-bulki2v" data-tool-id="bulki2v" aria-pressed="true">Unpin</button>
                </div>
              </article>
            </div>
          </div>
          {/* Keep legacy log nodes hidden so older app.js bindings do not crash */}
          <div className="hidden" aria-hidden="true">
            <button type="button" id="studio-logs-refresh-btn" />
            <button type="button" id="studio-logs-clear-btn" />
            <div id="studio-logs-list" />
            <div id="studio-logs-card" />
            <div id="studio-logs-empty" />
            <span id="studio-logs-count" />
          </div>
        </section>

        {/* VIEW 5: Whisk Creative Laboratory (Google Labs Whisk Clean UI) */}
        <section className="flow-view-pane" id="view-whisk-pane">
          <div className="whisk-workspace">
            
            {/* Left Solid Whisk Yellow Dock (#F7D248) */}
            <aside className="whisk-sidebar" id="whisk-sidebar">
              {/* Collapsed Mini Strip (Matches Google Labs Whisk Screenshot) */}
              <div className="whisk-sidebar-mini-strip" id="whisk-sidebar-mini-strip">
                <button type="button" className="whisk-mini-expand-btn" id="whisk-mini-expand-btn" title="Show images dock">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </button>
                <div className="whisk-mini-slot" id="whisk-mini-slot-subject" data-cat="subject" title="Subject">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                  </svg>
                </div>
                <div className="whisk-mini-slot" id="whisk-mini-slot-scene" data-cat="scene" title="Scene">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                    <circle cx="12" cy="10" r="3"></circle>
                  </svg>
                </div>
                <div className="whisk-mini-slot" id="whisk-mini-slot-style" data-cat="style" title="Style">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 19l7-7 3 3-7 7-3-3z"></path>
                    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18"></path>
                    <path d="M2 2l7.5 7.5"></path>
                    <circle cx="11.5" cy="11.5" r="1.5"></circle>
                  </svg>
                </div>
              </div>

              {/* Full Expanded Sidebar Content */}
              <div className="whisk-sidebar-full-content" id="whisk-sidebar-full-content">
                {/* Top Header: Whisk Logo + EXPERIMENTAL Pill + Collapse Chevron */}
                <div className="whisk-sidebar-header">
                  <div className="whisk-brand-row">
                    <span className="whisk-brand-name">Whisk</span>
                    <span className="whisk-experimental-badge">EXPERIMENTAL</span>
                  </div>
                  <button type="button" className="whisk-sidebar-collapse-btn" id="whisk-collapse-chevron" title="Collapse images dock">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 18 9 12 15 6"></polyline>
                    </svg>
                  </button>
                </div>

                {/* 3 Categories Stack: SUBJECT, SCENE, STYLE */}
                <div className="whisk-categories-stack">
                  {/* 1. SUBJECT */}
                  <div className="whisk-cat-group" id="whisk-group-subject">
                    <div className="whisk-cat-title-row">
                      <span className="whisk-cat-label">SUBJECT</span>
                      <div className="whisk-cat-icons">
                        <input type="file" id="whisk-file-subject" accept="image/*" hidden={true} />
                        <button type="button" className="whisk-header-icon-btn" id="whisk-add-subject" title="Add Subject">
                          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="9"></circle>
                            <line x1="12" y1="8" x2="12" y2="16"></line>
                            <line x1="8" y1="12" x2="16" y2="12"></line>
                          </svg>
                        </button>
                      </div>
                    </div>
                    {/* Dynamic Stack of Subject Slots */}
                    <div className="whisk-cat-slots-stack" id="whisk-slots-subject">
                      <div className="whisk-card-slot" id="whisk-card-subject" data-cat="subject" data-index="0" title="Click to add Subject 1">
                        <div className="whisk-card-token-badge">Subject 1</div>
                        <div className="whisk-slot-placeholder-icon">
                          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                            <path d="M7 17 C7 9 17 9 17 17" />
                          </svg>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 2. SCENE */}
                  <div className="whisk-cat-group" id="whisk-group-scene">
                    <div className="whisk-cat-title-row">
                      <span className="whisk-cat-label">SCENE</span>
                      <div className="whisk-cat-icons">
                        <input type="file" id="whisk-file-scene" accept="image/*" hidden={true} />
                        <button type="button" className="whisk-header-icon-btn" id="whisk-add-scene" title="Add Scene">
                          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="9"></circle>
                            <line x1="12" y1="8" x2="12" y2="16"></line>
                            <line x1="8" y1="12" x2="16" y2="12"></line>
                          </svg>
                        </button>
                      </div>
                    </div>
                    {/* Dynamic Stack of Scene Slots */}
                    <div className="whisk-cat-slots-stack" id="whisk-slots-scene">
                      <div className="whisk-card-slot" id="whisk-card-scene" data-cat="scene" data-index="0" title="Click to add Scene 1">
                        <div className="whisk-card-token-badge">Scene 1</div>
                        <div className="whisk-slot-placeholder-icon">
                          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 21c-4.5-5.5-7-9.5-7-13a7 7 0 1 1 14 0c0 3.5-2.5 7.5-7 13z"/>
                            <circle cx="12" cy="8" r="2.2"/>
                          </svg>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 3. STYLE */}
                  <div className="whisk-cat-group" id="whisk-group-style">
                    <div className="whisk-cat-title-row">
                      <span className="whisk-cat-label">STYLE</span>
                      <div className="whisk-cat-icons">
                        <input type="file" id="whisk-file-style" accept="image/*" hidden={true} />
                        <button type="button" className="whisk-header-icon-btn" id="whisk-add-style" title="Add Style">
                          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="9"></circle>
                            <line x1="12" y1="8" x2="12" y2="16"></line>
                            <line x1="8" y1="12" x2="16" y2="12"></line>
                          </svg>
                        </button>
                      </div>
                    </div>
                    {/* Dynamic Stack of Style Slots */}
                    <div className="whisk-cat-slots-stack" id="whisk-slots-style">
                      <div className="whisk-card-slot" id="whisk-card-style" data-cat="style" data-index="0" title="Click to add Style 1">
                        <div className="whisk-card-token-badge">Style 1</div>
                        <div className="whisk-slot-placeholder-icon">
                          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 19l7-7 3 3-7 7-3-3z"/>
                            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18"/>
                            <path d="M2 2l7.5 7.5"/>
                            <circle cx="11.5" cy="11.5" r="1.5"/>
                          </svg>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </aside>

            {/* Main Stage Area (Cool Grey #DDE2E5) */}
            <main className="whisk-main-stage" id="whisk-main-stage">
              {/* Top-Right Floating Grid Scale Control */}
              <div className="whisk-top-controls">
                <span className="whisk-grid-icon-indicator" title="Grid column layout">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7"></rect>
                    <rect x="14" y="3" width="7" height="7"></rect>
                    <rect x="14" y="14" width="7" height="7"></rect>
                    <rect x="3" y="14" width="7" height="7"></rect>
                  </svg>
                </span>
                <input type="range" className="whisk-grid-slider-input" id="whisk-grid-slider" min="1" max="5" defaultValue="2" step="1" title="Adjust grid columns (1-5)" />
              </div>

              {/* Center Empty State (Exact Official Google Labs Whisk Doodle & Tagline) */}
              <div className="whisk-canvas-empty" id="whisk-canvas-empty">
                <div className="whisk-scribble-icon-wrap">
                  <svg width="68" height="68" viewBox="0 0 68 68" fill="none" stroke="#000000" strokeLinecap="round" strokeLinejoin="round">
                    {/* Confetti sparkles */}
                    <circle cx="51" cy="20" r="1.8" fill="#000000" stroke="none"/>
                    <path d="M53 36 L56 38 M53 40 L56 38" strokeWidth="2.5"/>
                    <path d="M21 44 L25 41 M25 41 L27 45" strokeWidth="2.5"/>
                    {/* Central ribbon loop={true} */}
                    <path d="M43 47 C40 45 37 42 34 38 C30 33 29 27 34 22 C39 18 46 21 46 27 C46 34 37 40 28 41 C24 41.5 21 39 21 35" strokeWidth="3.5"/>
                  </svg>
                </div>
                <div className="whisk-empty-instruction">ADD A SUBJECT, SCENE, OR STYLE TO WHISK!</div>
              </div>

              {/* Results Grid (shown when creations exist) */}
              <div className="whisk-gallery-grid hidden" id="whisk-gallery-grid"></div>

              {/* Floating Bottom Prompt Bar with Token Helper Tray */}
              <div className="whisk-floating-bar-wrap" style={{position: "absolute", bottom: "20px", left: "50%", transform: "translateX(-50%)", width: "90%", maxWidth: "780px", zIndex: "25", display: "flex", flexDirection: "column", alignItems: "center"}}>
                <div className="whisk-tokens-helper-tray" id="whisk-tokens-helper-tray"></div>
                <div className="whisk-floating-bar" id="whisk-floating-bar" style={{position: "relative", bottom: "auto", left: "auto", transform: "none", width: "100%"}}>
                  <button type="button" className="whisk-toggle-dock-chip" id="whisk-toggle-dock" title="Toggle images dock">
                    <span id="whisk-toggle-arrow">&lt;</span>
                    <span id="whisk-toggle-text">HIDE IMAGES</span>
                  </button>
                  <input type="text" className="whisk-prompt-field" id="whisk-prompt-input" placeholder="Describe your idea or Whisk your ingredients together..." autoComplete="off" />
                  <button type="button" className="whisk-submit-circle-btn" id="whisk-submit-btn" title="Whisk ingredients">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                      <polyline points="12 5 19 12 12 19"></polyline>
                    </svg>
                  </button>
                </div>
              </div>

            </main>
          </div>
        </section>

        {/* VIEW 6: Bulk Visual Storyteller */}
        <section className="flow-view-pane" id="view-storyteller-pane">
          <div className="bvs-workspace" id="bvs-workspace">
            <aside className="bvs-config" id="bvs-config">
              <h2 className="bvs-config-title">Configuration</h2>

              <label className="bvs-field">
                <span className="bvs-field-label">Model</span>
                <select id="bvs-model-select" className="bvs-select" defaultValue="GEM_PIX_2">
                  <option value="GEM_PIX_2">Nano Banana 2 Pro</option>
                  <option value="NARWHAL">Nano Banana 2</option>
                  <option value="HARBOR_SEAL">Nano Banana 2 Lite</option>
                </select>
              </label>

              <label className="bvs-field">
                <span className="bvs-field-label">Aspect Ratio</span>
                <select id="bvs-aspect-select" className="bvs-select" defaultValue="16:9">
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                  <option value="1:1">1:1</option>
                  <option value="4:3">4:3</option>
                  <option value="3:4">3:4</option>
                </select>
              </label>

              <div className="bvs-chain-row" id="bvs-chain-row">
                <div>
                  <div className="bvs-chain-title">Chain Consistency</div>
                  <div className="bvs-chain-sub">Send last 2 frames for consistency.</div>
                </div>
                <button type="button" className="bvs-chain-toggle is-on" id="bvs-chain-toggle" aria-pressed="true" title="Toggle chain consistency">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                </button>
              </div>

              <div className="bvs-section">
                <div className="bvs-section-title bvs-noselect">Characters (Visual References)</div>
                <div className="bvs-char-grid" id="bvs-char-grid"></div>
                <p className="bvs-char-note bvs-noselect">* Characters are only included if mentioned by name in your script!</p>
              </div>

              <label className="bvs-field">
                <span className="bvs-field-label bvs-noselect">Global Prompt</span>
                <span className="bvs-field-hint bvs-noselect">Base style &amp; setting</span>
                <input id="bvs-global-prompt" className="bvs-input" type="text" placeholder="e.g. 3D Pixar style, cinematic lighting..." autoComplete="off" />
              </label>

              <label className="bvs-field bvs-field-grow">
                <span className="bvs-field-label bvs-noselect">Script Editor</span>
                <span className="bvs-field-hint bvs-noselect">Scene / Script markers</span>
                <textarea
                  id="bvs-script-editor"
                  className="bvs-textarea"
                  rows={10}
                  placeholder={"Paste your script with scene markers, e.g.\n\nScene 1: Alice walking in city...\nScene 2: Alice finds a magic lamp...\n\nor\n\nPrompt 1: ...\nPrompt 2: ..."}
                ></textarea>
              </label>

              <div className="bvs-actions">
                <button type="button" className="bvs-btn-primary" id="bvs-generate-all-btn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
                  <span>Generate All</span>
                </button>
                <button type="button" className="bvs-btn-stop" id="bvs-stop-btn" disabled>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
                  <span>Stop</span>
                </button>
                <button type="button" className="bvs-btn-secondary" id="bvs-clear-grid-btn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  <span>Clear Grid</span>
                </button>
                <button type="button" className="bvs-btn-secondary" id="bvs-download-all-btn" disabled>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  <span>Download All</span>
                </button>
              </div>
              <p className="bvs-footer-note">Google Flow can make mistakes, so double check it. This Tool may consume credits.</p>
            </aside>

            <main className="bvs-sequence" id="bvs-sequence">
              <div className="bvs-sequence-header">
                <h2 className="bvs-sequence-title">SCRIPT SEQUENCE</h2>
                <button type="button" className="bvs-mobile-edit-btn" id="bvs-mobile-edit-btn">Edit config</button>
                <p className="bvs-sequence-status" id="bvs-sequence-status">0 scenes identified • 0 ready</p>
              </div>
              <div className="bvs-sequence-empty" id="bvs-sequence-empty">
                <div className="bvs-empty-icon" aria-hidden="true">
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="2" y="7" width="14" height="10" rx="2"/><rect x="8" y="3" width="14" height="10" rx="2"/></svg>
                </div>
                <p className="bvs-empty-title">Script scenes will appear here</p>
                <p className="bvs-empty-sub">Paste like &apos;Scene 1: … Scene 2: …&apos; or &apos;Prompt 1: … Prompt 2: …&apos; (also works with one scene per line).</p>
              </div>
              <div className="bvs-sequence-grid hidden" id="bvs-sequence-grid"></div>
            </main>
          </div>
        </section>

        {/* VIEW 7: Bulk Text to Video */}
        <section className="flow-view-pane" id="view-bulkt2v-pane">
          <div className="btv-workspace" id="btv-workspace">
            <aside className="btv-config" id="btv-config">
              <h2 className="btv-config-title">Configuration</h2>

              <label className="btv-field">
                <span className="btv-field-label">Model</span>
                <select id="btv-model-select" className="btv-select" defaultValue="VEO_3_1_LITE">
                  <option value="VEO_3_1_LITE">Veo 3.1 - Lite</option>
                  <option value="VEO_3_1_FAST">Veo 3.1 - Fast</option>
                  <option value="VEO_3_1_QUALITY">Veo 3.1 - Quality</option>
                  <option value="OMNI_1_1_FLASH">Omni 1.1 Flash</option>
                </select>
              </label>

              <label className="btv-field">
                <span className="btv-field-label">Aspect Ratio</span>
                <select id="btv-aspect-select" className="btv-select" defaultValue="16:9">
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                </select>
              </label>

              <label className="btv-field">
                <span className="btv-field-label">Duration</span>
                <select id="btv-duration-select" className="btv-select" defaultValue="8">
                  <option value="4">4 seconds</option>
                  <option value="6">6 seconds</option>
                  <option value="8">8 seconds</option>
                  <option value="10" id="btv-dur-10s-opt" hidden>10 seconds (Omni only)</option>
                </select>
              </label>

              <label className="btv-field btv-field-grow">
                <span className="btv-field-label btv-noselect">Script Editor</span>
                <span className="btv-field-hint btv-noselect">Scene / Script markers</span>
                <textarea
                  id="btv-script-editor"
                  className="btv-textarea"
                  rows={10}
                  placeholder={"Paste your script with scene markers, e.g.\n\nScene 1: Camera pans over the city...\nScene 2: Close-up of the hero...\n\nor\n\nPrompt 1: ...\nPrompt 2: ..."}
                ></textarea>
              </label>

              <div className="btv-actions">
                <button type="button" className="btv-btn-primary" id="btv-generate-all-btn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
                  <span>Generate All</span>
                </button>
                <button type="button" className="btv-btn-stop" id="btv-stop-btn" disabled>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
                  <span>Stop</span>
                </button>
                <button type="button" className="btv-btn-secondary" id="btv-clear-grid-btn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  <span>Clear Grid</span>
                </button>
                <button type="button" className="btv-btn-secondary" id="btv-download-all-btn" disabled>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  <span>Download All</span>
                </button>
              </div>
              <p className="btv-footer-note">Google Flow can make mistakes, so double check it. This Tool may consume credits.</p>
            </aside>

            <main className="btv-sequence" id="btv-sequence">
              <div className="btv-sequence-header">
                <h2 className="btv-sequence-title">VIDEO SEQUENCE</h2>
                <button type="button" className="btv-mobile-edit-btn" id="btv-mobile-edit-btn">Edit config</button>
                <p className="btv-sequence-status" id="btv-sequence-status">0 scenes identified • 0 ready</p>
              </div>
              <div className="btv-sequence-empty" id="btv-sequence-empty">
                <div className="btv-empty-icon" aria-hidden="true">
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
                </div>
                <p className="btv-empty-title">Video scenes will appear here</p>
                <p className="btv-empty-sub">Paste like &apos;Scene 1: … Scene 2: …&apos; or &apos;Prompt 1: … Prompt 2: …&apos; (also works with one scene per line).</p>
              </div>
              <div className="btv-sequence-grid hidden" id="btv-sequence-grid"></div>
            </main>
          </div>
        </section>

        {/* VIEW 8: Bulk Text to Image */}
        <section className="flow-view-pane" id="view-bulkt2i-pane">
          <div className="bti-workspace" id="bti-workspace">
            <aside className="bti-config" id="bti-config">
              <h2 className="bti-config-title">Configuration</h2>

              <label className="bti-field">
                <span className="bti-field-label">Model</span>
                <select id="bti-model-select" className="bti-select" defaultValue="GEM_PIX_2">
                  <option value="GEM_PIX_2">Nano Banana 2 Pro</option>
                  <option value="NARWHAL">Nano Banana 2</option>
                  <option value="HARBOR_SEAL">Nano Banana 2 Lite</option>
                </select>
              </label>

              <label className="bti-field">
                <span className="bti-field-label">Aspect Ratio</span>
                <select id="bti-aspect-select" className="bti-select" defaultValue="16:9">
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                </select>
              </label>

              <label className="bti-field bti-field-grow">
                <span className="bti-field-label bti-noselect">Script Editor</span>
                <span className="bti-field-hint bti-noselect">Scene / Script markers</span>
                <textarea
                  id="bti-script-editor"
                  className="bti-textarea"
                  rows={10}
                  placeholder={"Paste your script with scene markers, e.g.\n\nScene 1: Wide shot of the city...\nScene 2: Close-up of the hero...\n\nor\n\nPrompt 1: ...\nPrompt 2: ..."}
                ></textarea>
              </label>

              <div className="bti-actions">
                <button type="button" className="bti-btn-primary" id="bti-generate-all-btn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
                  <span>Generate All</span>
                </button>
                <button type="button" className="bti-btn-stop" id="bti-stop-btn" disabled>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
                  <span>Stop</span>
                </button>
                <button type="button" className="bti-btn-secondary" id="bti-clear-grid-btn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  <span>Clear Grid</span>
                </button>
                <button type="button" className="bti-btn-secondary" id="bti-download-all-btn" disabled>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  <span>Download All</span>
                </button>
              </div>
              <p className="bti-footer-note">Google Flow can make mistakes, so double check it. This Tool may consume credits.</p>
            </aside>

            <main className="bti-sequence" id="bti-sequence">
              <div className="bti-sequence-header">
                <h2 className="bti-sequence-title">IMAGE SEQUENCE</h2>
                <button type="button" className="bti-mobile-edit-btn" id="bti-mobile-edit-btn">Edit config</button>
                <p className="bti-sequence-status" id="bti-sequence-status">0 scenes identified • 0 ready</p>
              </div>
              <div className="bti-sequence-empty" id="bti-sequence-empty">
                <div className="bti-empty-icon" aria-hidden="true">
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                </div>
                <p className="bti-empty-title">Image scenes will appear here</p>
                <p className="bti-empty-sub">Paste like &apos;Scene 1: … Scene 2: …&apos; or &apos;Prompt 1: … Prompt 2: …&apos; (also works with one scene per line).</p>
              </div>
              <div className="bti-sequence-grid hidden" id="bti-sequence-grid"></div>
            </main>
          </div>
        </section>

        {/* VIEW 9: Bulk Image to Video */}
        <section className="flow-view-pane" id="view-bulki2v-pane">
          <div className="biv-workspace" id="biv-workspace">
            <aside className="biv-config" id="biv-config">
              <h2 className="biv-config-title">Configuration</h2>

              <label className="biv-field">
                <span className="biv-field-label">Model</span>
                <select id="biv-model-select" className="biv-select" defaultValue="VEO_3_1_LITE">
                  <option value="VEO_3_1_LITE">Veo 3.1 - Lite</option>
                  <option value="VEO_3_1_FAST">Veo 3.1 - Fast</option>
                  <option value="VEO_3_1_QUALITY">Veo 3.1 - Quality</option>
                  <option value="OMNI_1_1_FLASH">Omni 1.1 Flash</option>
                </select>
              </label>

              <label className="biv-field">
                <span className="biv-field-label">Aspect Ratio</span>
                <select id="biv-aspect-select" className="biv-select" defaultValue="16:9">
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                </select>
              </label>

              <label className="biv-field">
                <span className="biv-field-label">Duration</span>
                <select id="biv-duration-select" className="biv-select" defaultValue="8">
                  <option value="4">4 seconds</option>
                  <option value="6">6 seconds</option>
                  <option value="8">8 seconds</option>
                  <option value="10" id="biv-dur-10s-opt" hidden>10 seconds (Omni only)</option>
                </select>
              </label>

              <label className="biv-field">
                <span className="biv-field-label biv-noselect">Upload images</span>
                <span className="biv-field-hint biv-noselect">Filename sequence: 1.jpg, Scene2, Sc03…</span>
                <input id="biv-image-input" className="biv-input" type="file" accept="image/*" multiple />
                <button type="button" className="biv-btn-secondary" id="biv-clear-images-btn" style={{marginTop: 8}}>Clear images</button>
              </label>

              <label className="biv-field biv-field-grow">
                <span className="biv-field-label biv-noselect">Prompt script</span>
                <span className="biv-field-hint biv-noselect">One prompt per image (Scene / Prompt markers)</span>
                <textarea
                  id="biv-script-editor"
                  className="biv-textarea"
                  rows={8}
                  placeholder={"Prompt 1: Camera slowly pushes in…\nPrompt 2: Pan across the skyline…"}
                ></textarea>
              </label>

              <p className="biv-field-hint" id="biv-mapping-status">0 image(s) • 0 prompt(s)</p>

              <div className="biv-actions">
                <button type="button" className="biv-btn-primary" id="biv-generate-all-btn" disabled>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
                  <span>Generate All</span>
                </button>
                <button type="button" className="biv-btn-stop" id="biv-stop-btn" disabled>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
                  <span>Stop</span>
                </button>
                <button type="button" className="biv-btn-secondary" id="biv-clear-grid-btn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  <span>Clear Grid</span>
                </button>
                <button type="button" className="biv-btn-secondary" id="biv-download-all-btn" disabled>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  <span>Download All</span>
                </button>
              </div>
              <p className="biv-footer-note">Staged uploads are removed from Studio after the run finishes. This Tool may consume credits.</p>
            </aside>

            <main className="biv-sequence" id="biv-sequence">
              <div className="biv-sequence-header">
                <h2 className="biv-sequence-title">I2V SEQUENCE</h2>
                <button type="button" className="biv-mobile-edit-btn" id="biv-mobile-edit-btn">Edit config</button>
                <p className="biv-sequence-status" id="biv-sequence-status">0 scenes identified • 0 ready</p>
              </div>
              <div className="biv-sequence-empty" id="biv-sequence-empty">
                <div className="biv-empty-icon" aria-hidden="true">
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="3" y="3" width="18" height="18" rx="2"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
                </div>
                <p className="biv-empty-title">Image previews will appear here as you upload</p>
                <p className="biv-empty-sub">Upload sequenced stills, then paste matching prompts — cards update live. Generate when counts match.</p>
              </div>
              <div className="biv-sequence-grid hidden" id="biv-sequence-grid"></div>
            </main>
          </div>
        </section>

      </main>
    </div>

    {/* =================================================================== */}
    {/* FLOATING BOTTOM GENERATION BAR (Screenshots 1, 3, 4)                */}
    {/* =================================================================== */}
    <div className="flow-floating-prompt-bar" id="floating-prompt-bar">
      
      {/* Attachment Chips Tray (if reference image / frames / ingredients selected) */}
      <div className="floating-attachments-tray hidden" id="floating-attachments-tray"></div>

      {/* Main Input Box Pill */}
      <div className="floating-prompt-box">
        {/* Attached thumbnail preview row inside prompt box */}
        <div className="prompt-attached-previews" id="prompt-attached-previews">
          <div className="prompt-attached-chip hidden" id="prompt-attached-thumb-chip">
            <img id="prompt-attached-img" alt="Attached Asset" />
          </div>
        </div>

        {/* Inline Frames Button Group (Screenshot 2: Start ⇆ End) */}
        <div className="prompt-frames-inline hidden" id="prompt-frames-inline">
          <button type="button" className="prompt-frame-btn" id="prompt-start-frame-btn">
            <span id="prompt-start-frame-label">Start</span>
          </button>
          <button type="button" className="prompt-frame-swap-btn" id="prompt-swap-frames-btn" title="Swap Start and End frames">⇆</button>
          <button type="button" className="prompt-frame-btn" id="prompt-end-frame-btn">
            <span id="prompt-end-frame-label">End</span>
          </button>
        </div>

        <textarea id="prompt-input" className="floating-prompt-input" rows={1} placeholder="What do you want to create?"></textarea>

        {/* Prompt box top-right dismiss button (Screenshot 3) */}
        <button type="button" className="prompt-box-close-btn hidden" id="prompt-box-clear-attached-btn" title="Clear attached asset">✕</button>

        <div className="floating-prompt-controls">
          <div className="prompt-controls-left">
            {/* Attachment Button (+) (Screenshot 4) */}
            <div className="attach-btn-wrap" id="attach-btn-wrap">
              <button className="floating-circle-btn" id="prompt-attach-btn" title="Add reference image, frames, or character">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
            </div>

            {/* Agent — coming soon */}
            <button type="button" className="floating-agent-pill" id="agent-pill" disabled title="Coming soon" aria-disabled="true">
              <span>Agent</span>
              <span className="floating-agent-soon" role="tooltip">Coming soon</span>
            </button>
          </div>

          <div className="prompt-controls-right">
            {/* Parameter Summary Pill (Click opens Parameter Popover!) */}
            <button className="floating-param-summary-pill" id="parameter-pill" title="Configure model, aspect ratio, and duration">
              <span id="param-pill-text">Video · 8s ▭</span>
            </button>

            {/* Circular Generate Action Button (Screenshot 2: ➔ right arrow) */}
            <button type="button" className="floating-generate-action-btn" id="trigger-generate-btn" title="Generate media">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </button>
          </div>
        </div>
      </div>

      {/* =================================================================== */}
      {/* BOTTOM PARAMETER POPOVER (Screenshots 3 & 4)                        */}
      {/* =================================================================== */}
      <div className="flow-parameter-popover hidden" id="parameter-popover">
        
        {/* Row 1: Image / Video Segmented Tab */}
        <div className="popover-mode-segmented">
          <button className="popover-seg-tab" data-mode="image" id="popover-mode-image-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            <span>Image</span>
          </button>
          <button className="popover-seg-tab active" data-mode="video" id="popover-mode-video-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
            <span>Video</span>
          </button>
        </div>

        {/* Video Sub-Options: Frames & Ingredients (Screenshot 3) */}
        <div className="popover-submodes-row" id="popover-video-submodes">
          <button className="popover-submode-btn" id="param-sub-frames-btn" title="First & Last frame video generation">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4"/></svg>
            <span>Frames</span>
          </button>
          <button className="popover-submode-btn" id="param-sub-ingredients-btn" title="Synthesize video with reference ingredients">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            <span>Ingredients</span>
          </button>
        </div>

        {/* Aspect Ratio Row with Wireframe Icons (Only 16:9 & 9:16 for Video) */}
        <div className="popover-aspect-row" id="popover-aspect-row">
          <button className="popover-aspect-card active" data-aspect="16:9" id="popover-aspect-16-9">
            <div className="wireframe-rect ratio-16-9"></div>
            <span>16:9</span>
          </button>
          <button className="popover-aspect-card hidden" data-aspect="4:3" id="popover-aspect-4-3">
            <div className="wireframe-rect ratio-4-3"></div>
            <span>4:3</span>
          </button>
          <button className="popover-aspect-card hidden" data-aspect="1:1" id="popover-aspect-1-1">
            <div className="wireframe-rect ratio-1-1"></div>
            <span>1:1</span>
          </button>
          <button className="popover-aspect-card hidden" data-aspect="3:4" id="popover-aspect-3-4">
            <div className="wireframe-rect ratio-3-4"></div>
            <span>3:4</span>
          </button>
          <button className="popover-aspect-card" data-aspect="9:16" id="popover-aspect-9-16">
            <div className="wireframe-rect ratio-9-16"></div>
            <span>9:16</span>
          </button>
        </div>

        {/* Popover Divider (Screenshot 2) */}
        <div className="popover-divider"></div>

        {/* Model Selector Dropdown — All Original Google Flow Models */}
        <div className="popover-dropdown-row">
          <div className="custom-select-wrap">
            <select id="popover-model-select" className="popover-select" defaultValue="VEO_3_1_LITE">
              <optgroup label="Video Models" id="popover-optgroup-video">
                <option value="VEO_3_1_LITE">Veo 3.1 - Lite</option>
                <option value="VEO_3_1_FAST">Veo 3.1 - Fast</option>
                <option value="VEO_3_1_QUALITY">Veo 3.1 - Quality</option>
                <option value="OMNI_1_1_FLASH">Omni 1.1 Flash</option>
              </optgroup>
              <optgroup label="Image Models" id="popover-optgroup-image">
                <option value="GEM_PIX_2">Nano Banana 2 Pro</option>
                <option value="NARWHAL">Nano Banana 2</option>
                <option value="HARBOR_SEAL">Nano Banana 2 Lite</option>
              </optgroup>
            </select>
            <svg className="select-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
        </div>

        {/* Duration Row (Video only: 4s / 6s / 8s, and 10s with Omni only) */}
        <div className="popover-duration-row" id="popover-duration-row">
          <button className="popover-pill-btn" data-dur="4">4s</button>
          <button className="popover-pill-btn" data-dur="6">6s</button>
          <button className="popover-pill-btn active" data-dur="8">8s</button>
          <button className="popover-pill-btn" data-dur="10" id="popover-dur-10s-btn" style={{display: "none"}}>10s</button>
        </div>

        {/* Credit Cost Notice Footer */}
        <div className="popover-credits-footer">
          <span id="popover-credits-text">Generating will use <u id="credits-cost-number">0 credits</u></span>
        </div>

      </div>

      {/* Frames Sub-Drawer (Slide up when Frames button is toggled) */}
      <div className="floating-sub-drawer hidden" id="frame-controls-card">
        <div className="drawer-header">
          <span className="drawer-title">FIRST &amp; LAST FRAME TRANSITIONS</span>
          <button className="drawer-close-btn" id="close-frames-drawer-btn">✕</button>
        </div>
        <div className="frame-mode-toggle-group">
          <button type="button" className="submode-pill active" id="fmode-first-btn">First Frame Only</button>
          <button type="button" className="submode-pill" id="fmode-last-btn">Last Frame Only</button>
          <button type="button" className="submode-pill" id="fmode-both-btn">First &amp; Last (Interpolate)</button>
        </div>
        <div className="dual-frame-grid">
          <div className="frame-slot-card" id="first-frame-slot">
            <span className="slot-badge">START FRAME</span>
            <div className="frame-thumb-area" id="first-frame-empty">
              <button className="slot-pick-btn" id="pick-first-gallery-btn">Library</button>
              <button className="slot-pick-btn" id="pick-first-upload-btn">Upload</button>
              <input type="file" id="first-frame-file-input" hidden={true} accept="image/*" />
            </div>
            <div className="frame-preview-area hidden" id="first-frame-preview">
              <img id="first-frame-img" alt="First frame" />
              <span id="first-frame-name">Frame 1</span>
              <button className="frame-remove-btn" id="clear-first-frame-btn">✕</button>
            </div>
          </div>
          <div className="frame-slot-card" id="last-frame-slot">
            <span className="slot-badge">END FRAME</span>
            <div className="frame-thumb-area" id="last-frame-empty">
              <button className="slot-pick-btn" id="pick-last-gallery-btn">Library</button>
              <button className="slot-pick-btn" id="pick-last-upload-btn">Upload</button>
              <input type="file" id="last-frame-file-input" hidden={true} accept="image/*" />
            </div>
            <div className="frame-preview-area hidden" id="last-frame-preview">
              <img id="last-frame-img" alt="Last frame" />
              <span id="last-frame-name">Frame 2</span>
              <button className="frame-remove-btn" id="clear-last-frame-btn">✕</button>
            </div>
          </div>
        </div>
      </div>

      {/* Ingredients Sub-Drawer — retired; kept in DOM (hidden) for app.js ids */}
      <div className="floating-sub-drawer hidden" id="ingredients-card" aria-hidden="true" style={{ display: 'none' }}>
        <div className="drawer-header">
          <span className="drawer-title">INGREDIENT SYNTHESIS</span>
          <div className="drawer-actions">
            <button type="button" className="submode-pill active" id="ing-type-video-btn">Video</button>
            <button type="button" className="submode-pill" id="ing-type-image-btn">Image</button>
            <button className="drawer-close-btn" id="close-ingredients-drawer-btn">✕</button>
          </div>
        </div>
        <div className="ingredients-slots-grid" id="ingredients-slots-grid"></div>
        <div className="ingredients-footer-bar">
          <button type="button" className="action-btn small" id="add-ingredient-btn">+ Add Slot</button>
          <button type="button" className="action-btn small" id="pick-ingredient-library-btn">From Library</button>
          <input type="file" id="ingredient-file-input" hidden={true} accept="image/*" />
          <button type="button" className="action-btn small danger" id="clear-all-ingredients-btn">Clear All</button>
        </div>
      </div>

      {/* Live Generation Progress Card (Hidden — grey canvas used instead) */}
      <div className="flow-live-progress-card hidden" id="live-progress-card" aria-hidden="true">
        <div className="progress-meta-row">
          <div className="progress-indicator-spinner"></div>
          <span id="progress-stage-text">Generating media with Google Flow...</span>
          <span id="progress-timer" className="progress-timer-pill">00:00</span>
        </div>
        <div className="flow-progress-track">
          <div className="flow-progress-bar" id="progress-bar-fill"></div>
        </div>
      </div>

    </div>

    {/* Compatibility stubs for legacy app.js getElementById — must stay in DOM but invisible */}
    <div className="hidden" aria-hidden="true">
      <div id="header-project-chip"></div>
      <div id="duration-control-col"></div>
      <div id="count-control-col"></div>
      <input type="number" id="seed-input" defaultValue="-1" />
      <div id="stage-viewport"></div>
      <div id="studio-logs-card"></div>
      <div id="studio-logs-empty"></div>
      <button id="mode-video-btn"></button>
      <button id="mode-i2v-btn"></button>
      <button id="mode-i2i-btn"></button>
      <button id="mode-image-btn"></button>
      <button id="mode-ingredients-btn"></button>
      <div id="ref-image-card"></div>
      <button id="pick-ref-gallery-btn"></button>
      <button id="pick-ref-desktop-btn"></button>
      <button id="cancel-ref-picker-btn"></button>
      <input type="file" id="ref-desktop-file-input" />
      <button id="clear-ref-btn"></button>
      <div id="ref-placeholder"></div>
      <div id="ref-preview-wrapper"></div>
      <img id="ref-preview-img" />
      <span id="ref-title"></span>
      <span id="ref-id"></span>
      <span id="ref-ready-status"></span>
      <div id="multi-ref-tray"></div>
      <span id="multi-ref-count"></span>
      <div id="multi-ref-items"></div>
      <button id="add-more-ref-btn"></button>
      <div id="characters-card"></div>
      <div id="characters-list"></div>
      <div id="characters-empty"></div>
      <button id="refresh-characters-btn"></button>
      <button id="clear-characters-btn"></button>
      <span id="characters-selected-names"></span>
      <button id="open-characters-tab-btn"></button>
      <span id="generate-btn-text"></span>
      <div id="step-auth"></div>
      <div id="step-recaptcha"></div>
      <div id="step-submit"></div>
      <div id="step-render"></div>
      <div id="parallel-tasks-bar"></div>
      <span id="parallel-count"></span>
      <div id="parallel-tasks-list"></div>
      <span id="auth-user-email"></span>
      <span id="auth-token-exp"></span>
      <span id="header-credits-count"></span>
      <span id="header-history-count"></span>
      <div id="header-credits-chip"></div>
      <span id="header-credits-label"></span>
      <button id="tab-studio-btn"></button>
      <button id="tab-storyboard-btn"></button>
      <button id="tab-characters-btn"></button>
      <button id="tab-gallery-btn"></button>
      <span id="gallery-count-all"></span>
      <span id="gallery-count-video"></span>
      <span id="gallery-count-image"></span>
      <button id="sync-flow-media-btn"></button>
      <button id="clear-gallery-btn"></button>
      <span id="studio-logs-count"></span>
      <div id="count-col"></div>
      <div id="duration-col"></div>
      <div id="stage-card"></div>
      <div id="stage-placeholder"></div>
      <div id="video-stage-container"></div>
      <video id="stage-video"></video>
      <div id="image-stage-container"></div>
      <img id="stage-image" />
      <div id="stage-drawer"></div>
      <span id="stage-item-name"></span>
      <p id="stage-item-prompt"></p>
      <span id="stage-item-model"></span>
      <span id="stage-item-aspect"></span>
      <span id="stage-item-seed"></span>
      <button id="stage-extend-btn"></button>
      <button id="stage-animate-btn"></button>
      <button id="stage-remix-btn"></button>
      <a id="stage-open-flow-btn"></a>
      <button id="stage-download-btn"></button>
      <button id="stage-copy-prompt-btn"></button>
      <button id="fullscreen-stage-btn"></button>
      <button id="random-seed-btn"></button>
      <button id="enhance-prompt-btn"></button>
    </div>

    {/* =================================================================== */}
    {/* MODALS: AUTH, PROJECT, EXTEND, REF-PICKER, LIGHTBOX                */}
    {/* =================================================================== */}
    
    {/* Cookies & Session Auth Modal */}
    <div className="modal-overlay hidden" id="auth-modal">
      <div className="modal-card auth-modal-card">
        <div className="modal-header">
          <div className="modal-title-row">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            <div>
              <h3>Google Flow Session</h3>
              <p>Session is managed via Admin BiB login on flow.google.com — no cookie paste</p>
            </div>
          </div>
          <button className="modal-close-btn" id="close-auth-modal-btn">✕</button>
        </div>
        <div className="modal-body">
          <div className="auth-status-banner" id="auth-banner">
            <div className="status-indicator" id="modal-status-dot"></div>
            <div className="banner-text">
              <h4 id="modal-status-heading">Checking Connection...</h4>
              <p id="modal-status-detail">Validating session with Google Flow</p>
            </div>
            <button className="disconnect-btn hidden" id="disconnect-auth-btn" title="Disconnect account and clear all saved cookies">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
              <span>Disconnect</span>
            </button>
          </div>
          <div className="session-health hidden" id="session-health">
            <h4 id="session-health-title">Character creation status</h4>
            <p id="session-health-detail"></p>
            <p className="session-health-missing" id="session-health-missing"></p>
          </div>
          <div className="auth-quick-actions">
            {/* BiB-only: sync-chrome and cookie import removed — session is managed via Admin BiB login */}
            <button className="quick-btn" id="sync-local-btn">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
              <span>Sync from Local (~/.gflow/env)</span>
            </button>
          </div>
          <div className="form-group" style={{marginBottom: "14px"}}>
            <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px"}}>
              <label htmlFor="plan-tier-select" style={{marginBottom: "0"}}>ACCOUNT PLAN TIER OVERRIDE</label>
              <span id="detected-plan-badge" className="plan-badge-pill free" style={{fontSize: "11px"}}>Free Tier</span>
            </div>
            <select id="plan-tier-select" className="popover-select" style={{width: "100%", height: "38px", background: "rgba(255, 255, 255, 0.04)", border: "1px solid var(--border-subtle, rgba(255,255,255,0.12))", borderRadius: "8px", color: "var(--text-primary, #fff)", padding: "0 12px", fontSize: "13px"}}>
              <option value="auto">Auto-detect from Google Account</option>
              <option value="Ultra">Force Google AI Ultra (Veo 3.1 Advanced)</option>
              <option value="Pro">Force Google AI Pro (Veo 3.1 Intermediate)</option>
              <option value="Free">Force Free Tier (Omni 1.1 Flash)</option>
            </select>
            <p id="plan-tier-hint" style={{fontSize: "11px", color: "var(--text-muted, #999)", marginTop: "5px", lineHeight: "1.4"}}>
              Google API reported: <strong id="detected-plan-text" style={{color: "#60a5fa"}}>Free Tier (G1_FREEMIUM)</strong>. Google Flow restricts Veo 3.1 generation to active Pro/Ultra accounts. Free tier accounts can generate with Omni 1.1 Flash.
            </p>
          </div>
          {/* Cookie paste UI removed — BiB manages session automatically. Use Admin panel to log in. */}
        </div>
        <div className="modal-footer">
          <button className="action-btn danger hidden" id="disconnect-auth-footer-btn" title="Disconnect account and clear all saved cookies">Disconnect Account</button>
          <button className="action-btn" id="cancel-auth-btn">Cancel</button>
          {/* save-cookies-btn kept as no-op DOM hook; app.js will show toast instead */}
          <button className="action-btn primary hidden" id="save-cookies-btn"><span>Save &amp; Test Connection</span></button>
        </div>
      </div>
    </div>

    {/* Project Manager Modal */}
    <div className="modal-overlay hidden" id="project-modal">
      <div className="modal-card modal-container project-modal-container">
        <div className="modal-header">
          <div className="modal-title-group">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            <h3>Google Flow Project Manager</h3>
          </div>
          <button className="modal-close-btn" id="close-project-modal-btn">✕</button>
        </div>
        <div className="modal-body project-modal-body">
          <div className="active-project-card">
            <strong className="active-project-name" id="active-project-name-display">No project selected</strong>
            <a href="#" target="_blank" rel="noopener noreferrer" className="proj-url-val" id="active-project-url-display">https://flow.google.com/project/</a>
            <a href="#" target="_blank" rel="noopener noreferrer" className="active-flow-btn" id="active-project-flow-link">Open in Flow</a>
            <button className="copy-small-btn" id="copy-project-url-btn" title="Copy URL"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
          </div>
          <div className="create-project-row" style={{margin: "16px 0"}}>
            <input type="text" id="new-project-name-input" placeholder="New project name" className="project-name-input" />
            <button className="action-btn primary" id="submit-create-project-btn">Create &amp; Switch</button>
          </div>
          <div className="section-label-row">
            <label className="section-label">Your Projects</label>
            <button className="refresh-proj-btn" id="refresh-projects-btn" title="Refresh">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38"/></svg>
            </button>
          </div>
          <div className="projects-list-container" id="projects-list-container"></div>
        </div>
        <div className="modal-footer">
          <button className="action-btn" id="close-project-modal-footer-btn">Close</button>
        </div>
      </div>
    </div>

    {/* =================================================================== */}
    {/* LARGE MEDIA VIEWER POPUP (Video with Sound & controls={true} / Image)      */}
    {/* =================================================================== */}
    <div className="modal-overlay hidden" id="media-viewer-modal">
      <div className="modal-card modal-container flow-media-viewer-dialog">
        {/* Header */}
        <div className="viewer-dialog-header">
          <div className="viewer-header-left">
            <span className="viewer-type-badge" id="viewer-type-badge">VIDEO</span>
            <span className="viewer-prompt-title" id="viewer-title">Media Title</span>
          </div>
          <div className="viewer-header-right">
            <span className="viewer-hd-pill hidden" id="viewer-hd-badge">1080p Upscaled ✓</span>
            <div className="download-dropdown-wrap">
              <button type="button" className="viewer-action-icon-btn" id="viewer-download-btn" title="Download">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </button>
              <div className="viewer-download-menu hidden" id="viewer-download-menu">
                <button type="button" className="viewer-download-item" id="viewer-dl-720p">
                  <span>Download Original</span>
                  <span className="res-tag">720p</span>
                </button>
                <button type="button" className="viewer-download-item hd" id="viewer-dl-1080p">
                  <span>Download Upscaled</span>
                  <span className="res-tag">1080p</span>
                </button>
              </div>
            </div>
            <button type="button" className="modal-close-btn" id="close-media-viewer-btn" aria-label="Close viewer">✕</button>
          </div>
        </div>

        {/* Stage Body */}
        <div className="viewer-stage-container" id="viewer-stage-container">
          {/* Video Player with native controls={true} & audio enabled */}
          <video id="viewer-video" className="viewer-video hidden" controls={true} autoPlay={true} playsInline={true} preload="auto"></video>
          {/* High-res Image Preview */}
          <img id="viewer-image" className="viewer-image hidden" alt="Viewer Media" />
          {/* Video Upscale Loading Overlay */}
          <div className="viewer-upscale-overlay hidden" id="viewer-upscale-overlay">
            <div className="viewer-upscale-spinner"></div>
            <div className="viewer-upscale-title">Upscaling to 1080p Full HD...</div>
            <div className="viewer-upscale-desc">Enhancing video resolution and sharpness with Google Veo</div>
          </div>
        </div>

        {/* Footer / Metadata & Actions */}
        <div className="viewer-dialog-footer">
          <div className="viewer-footer-meta">
            <p className="viewer-prompt-text" id="viewer-prompt-text"></p>
            <div className="viewer-meta-pills" id="viewer-meta-pills">
              <span className="viewer-meta-pill" id="viewer-model-pill"></span>
              <span className="viewer-meta-pill" id="viewer-aspect-pill"></span>
              <span className="viewer-meta-pill" id="viewer-res-pill"></span>
            </div>
          </div>
          <div className="viewer-footer-actions">
            <button type="button" className="action-btn small viewer-upscale-btn hidden" id="viewer-upscale-btn" title="Upscale to 1K / 1080p resolution">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 15 6 6m-6-6v4.8m0-4.8h4.8M9 9 3 3m6 6V4.2M9 9H4.2"/></svg>
              <span id="viewer-upscale-label">Upscale to 1080p</span>
            </button>
            <button type="button" className="action-btn small" id="viewer-copy-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              <span>Copy Link</span>
            </button>
            <button type="button" className="action-btn small primary" id="viewer-animate-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              <span id="viewer-animate-label">Animate</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    {/* Extend Video Modal */}
    <div className="modal-overlay hidden" id="extend-modal">
      <div className="modal-container extend-modal-container">
        <div className="modal-header">
          <h3>Extend Video with Google Veo</h3>
          <button className="modal-close-btn" id="close-extend-modal-btn">✕</button>
        </div>
        <div className="modal-body">
          <div className="extend-video-preview-card">
            <video id="extend-modal-video" muted={true} loop={true} playsInline={true}></video>
            <span id="extend-modal-asset-id">Clip ID</span>
            <p id="extend-modal-prompt">Original prompt...</p>
          </div>
          <div className="form-group" style={{marginTop: "12px"}}>
            <textarea id="extend-prompt-input" rows={3} placeholder="Continuation prompt..."></textarea>
            <button className="enhance-btn sm" id="extend-enhance-prompt-btn" style={{display: "none"}}>Enhance</button>
          </div>
        </div>
        <div className="modal-footer">
          <button className="action-btn" id="cancel-extend-btn">Cancel</button>
          <button className="action-btn primary" id="submit-extend-btn">Extend Video</button>
        </div>
      </div>
    </div>

    {/* Google Flow 3-Column Asset Picker Modal (frame_005.jpg & frame_015.jpg) */}
    <div className="modal-overlay hidden" id="ref-picker-modal">
      <div className="modal-card modal-container flow-asset-picker-dialog">
        {/* Title Bar (frame_005.jpg) */}
        <div className="asset-picker-title-bar">
          <h3 className="asset-picker-title" id="ref-picker-dialog-title">Select a frame image</h3>
          <button className="modal-close-btn" id="close-ref-picker-btn" aria-label="Close dialog">✕</button>
        </div>

        {/* Filter controls={true} Bar */}
        <div className="asset-picker-header">
          <div className="asset-picker-header-left">
            <button type="button" className="picker-pill-dropdown" id="picker-project-btn" title="Current project">
              <span id="picker-project-name">API Create Check</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
          </div>
          <div className="asset-picker-header-search">
            <div className="picker-search-bar">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input type="text" id="picker-search-input" placeholder="Search assets" autoComplete="off" />
            </div>
          </div>
          <div className="asset-picker-header-right">
            <button type="button" className="picker-pill-dropdown" id="picker-sort-btn">
              <span>Recent</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
          </div>
        </div>

        {/* 3-Column Body */}
        <div className="asset-picker-body">
          {/* Col 1: Categories */}
          <div className="asset-picker-categories-col">
            <div className="picker-cat-nav">
              <button type="button" className="picker-cat-btn active" data-cat="all">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                <span>All</span>
              </button>
              <button type="button" className="picker-cat-btn" data-cat="image">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <span>Images</span>
              </button>
              <button type="button" className="picker-cat-btn" data-cat="character">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <span>Characters</span>
              </button>
              <button type="button" className="picker-cat-btn" data-cat="upload">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <span>Uploads</span>
              </button>
            </div>
            <div className="picker-upload-footer">
              <button type="button" className="picker-upload-action-btn" id="picker-upload-media-btn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <span id="picker-upload-media-label">Upload media</span>
              </button>
              <div id="picker-upload-progress" className="picker-upload-progress hidden" aria-live="polite">
                <div className="picker-upload-progress-row">
                  <span className="picker-upload-spinner" aria-hidden="true" />
                  <span id="picker-upload-progress-text">Uploading…</span>
                </div>
                <div className="picker-upload-track">
                  <div id="picker-upload-progress-bar" className="picker-upload-bar" style={{ width: '0%' }} />
                </div>
              </div>
              <input type="file" id="picker-direct-file-input" hidden={true} accept="image/*,video/*" />
            </div>
          </div>

          {/* Col 2: Middle Items List */}
          <div className="asset-picker-items-col">
            <div className="asset-picker-items-list" id="ref-library-grid">
              {/* Rendered items */}
            </div>
          </div>

          {/* Col 3: Right Preview & Action Stage */}
          <div className="asset-picker-stage-col">
            <div className="picker-stage-display-card" id="picker-stage-card">
              <video id="picker-stage-video" className="picker-stage-media hidden" loop={true} playsInline={true}></video>
              <img id="picker-stage-image" className="picker-stage-media hidden" alt="Asset preview" />
              <div id="picker-stage-empty" className="picker-stage-empty">
                <span>Select an asset to preview</span>
              </div>
            </div>

            {/* Video Player controls={true} */}
            <div className="picker-stage-controls" id="picker-stage-controls">
              <span className="picker-time-label" id="picker-current-time">00:00:00</span>
              <button type="button" className="picker-ctrl-btn" id="picker-play-pause-btn" title="Play / Pause">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              </button>
              <span className="picker-time-label" id="picker-duration-time">00:08:00</span>
              <button type="button" className="picker-ctrl-btn" id="picker-audio-toggle-btn" title="Toggle sound">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
              </button>
            </div>

            {/* Filmstrip Scrubber with Trim Handles */}
            <div className="picker-filmstrip-bar" id="picker-filmstrip-bar">
              <div className="filmstrip-trim-handle left-handle">
                <div className="trim-grip"></div>
              </div>
              <div className="filmstrip-frames-row" id="picker-filmstrip-frames">
                {/* Frame thumb elements */}
              </div>
              <div className="filmstrip-trim-handle right-handle">
                <div className="trim-grip"></div>
              </div>
            </div>

            {/* Add to prompt button */}
            <div className="picker-footer-action-wrap">
              <button type="button" className="picker-add-prompt-btn" id="picker-add-to-prompt-btn">Add to prompt</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* Lightbox Modal */}
    <div className="modal-overlay hidden" id="lightbox-modal">
      <div className="lightbox-container">
        <button className="lightbox-close-btn" id="close-lightbox-btn">✕</button>
        <div className="lightbox-media-wrapper" id="lightbox-media-target"></div>
      </div>
    </div>

    {/* Toast Notifications */}
    <div className="toast-container" id="toast-container"></div>

  </div>
    </div>
  );
}
