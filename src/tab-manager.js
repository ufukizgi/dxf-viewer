
import * as THREE from 'three';

export class TabManager {
    constructor(viewer, app) {
        this.viewer = viewer;
        this.app = app;
        this.tabs = [];
        this.activeTabId = null;
        this.tabCounter = 0;

        this.tabBar = document.getElementById('tab-list'); // Inner scroll container
        this.tabBarContainer = document.getElementById('tab-bar-container'); // Outer flex container
        this.viewportOverlay = document.getElementById('viewport-overlay'); // To show/hide help text
    }

    init() {
        // Initially show Start Page instead of an empty tab
        this.showStartPage();
    }

    showStartPage() {
        const startPage = document.getElementById('start-page');
        const viewportOverlay = document.getElementById('viewport-overlay');

        if (startPage) {
            startPage.classList.remove('hidden');
        }

        if (this.tabBarContainer) {
            this.tabBarContainer.classList.add('hidden');
        }

        if (viewportOverlay) {
            viewportOverlay.classList.add('hidden');
        }

        // Hide viewer content if any (though usually empty if we are here)
        if (this.viewer && this.viewer.dxfGroup) {
            this.viewer.dxfGroup.visible = false;
        }

        this.activeTabId = null;
        this.renderTabBar();
        this.updateUIForStartPage(true);

        // Update App Status
        if (this.app && this.app.updateStatus) {
            this.app.updateStatus("Welcome");
        }
    }

    hideStartPage() {
        const startPage = document.getElementById('start-page');
        if (startPage) {
            startPage.classList.add('hidden');
        }
        if (this.tabBarContainer) {
            this.tabBarContainer.classList.remove('hidden');
        }
        this.updateUIForStartPage(false);
    }

    updateUIForStartPage(isStartPage) {
        // Toggle Sidebar state
        const sidebar = document.getElementById('sidebar');
        const clipboardSidebar = document.getElementById('clipboard-sidebar');

        // Buttons in TabBar
        const sidebarToggle = document.getElementById('sidebar-toggle-btn');
        const clipboardToggle = document.getElementById('clipboard-toggle-btn');

        // Close buttons in Sidebars (still exist?)
        // sidebar-close-btn exists in sidebar
        // clipboard-close-btn exists in clipboard-sidebar

        if (isStartPage) {
            // Collapse Sidebars check if they exist
            if (sidebar) sidebar.classList.add('collapsed');
            if (clipboardSidebar) clipboardSidebar.classList.add('collapsed'); // Use collapsed class

            // Buttons are hidden implicitly by TabBar hiding, but ensure logic if needed
        } else {
            // Enter App Mode
            // Restore Left Sidebar to Open (User Preference: usually open on file load)
            if (sidebar) {
                sidebar.classList.remove('collapsed');
                // If Open, Hide Toggle Button
                if (sidebarToggle) sidebarToggle.classList.add('hidden');
            } else {
                // If sidebar missing??
                if (sidebarToggle) sidebarToggle.classList.remove('hidden');
            }

            // Keep Clipboard Closed
            // If Closed, Show Toggle Button
            if (clipboardSidebar) {
                // Ensure it is collapsed? Yes, default state.
                // If it was already open, should we close it? maybe yes for clean slate
                // But if user was working, maybe no?
                // TabManager.hideStartPage is called when Creating New Tab.
                // Usually we want to reset UI slightly.
                // Let's assume Clipboard stays closed.
                clipboardSidebar.classList.add('collapsed');
            }
            if (clipboardToggle) clipboardToggle.classList.remove('hidden');
        }
    }

    createNewTab(name = "New File", dxfData = null, file = null) {
        this.hideStartPage();

        const id = `tab-${Date.now()}-${this.tabCounter++}`;

        // Create Scene Group for this tab
        const group = new THREE.Group();
        group.name = `RootGroup-${id}`;

        // Initial State
        const tabState = {
            id: id,
            name: name,
            dxfGroup: group, // The scene content
            file: file, // Original file object if saved
            cameraState: {
                position: new THREE.Vector3(0, 0, 50),
                zoom: 1,
                target: new THREE.Vector3(0, 0, 0)
            },
            history: [], // Command history for undo/redo (could be more complex)
            historyIndex: -1,
            isModified: false
        };

        this.tabs.push(tabState);
        this.renderTabBar();
        this.switchToTab(id);

        // If dxfData is provided (from file load), populate it
        if (dxfData) {
            // This suggests we loaded a file *into* this new tab
            // Caller handles populating the group
        }

        return tabState;
    }

    closeTab(id) {
        // Find index
        const index = this.tabs.findIndex(t => t.id === id);
        if (index === -1) return;

        // Dispose resources for this tab (meshes, materials)
        const tab = this.tabs[index];
        this.disposeGroup(tab.dxfGroup);

        // If closing active tab, switch to another
        if (this.activeTabId === id) {
            // Remove first
            this.tabs.splice(index, 1);

            if (this.tabs.length > 0) {
                // Switch to previous or next
                // If we removed at 'index', the next item is now at 'index' (unless it was the last one)
                // If we closed the last item, pick the new last item (index-1)
                let newIndex = index;
                if (newIndex >= this.tabs.length) {
                    newIndex = this.tabs.length - 1;
                }
                this.switchToTab(this.tabs[newIndex].id);
            } else {
                // No tabs left -> Show Start Page
                this.activeTabId = null;
                if (this.viewer && this.viewer.scene && this.viewer.dxfGroup) {
                    this.viewer.scene.remove(this.viewer.dxfGroup);
                    this.viewer.dxfGroup = null;
                }
                this.renderTabBar();
                this.showStartPage();
            }
        } else {
            // Closing inactive tab
            this.tabs.splice(index, 1);
            this.renderTabBar();
        }
    }

    switchToTab(id) {
        if (this.activeTabId === id) return;

        // Save current tab state (Camera, etc.)
        const currentTab = this.getActiveTab();
        if (currentTab) {
            currentTab.cameraState.position.copy(this.viewer.camera.position);
            currentTab.cameraState.zoom = this.viewer.camera.zoom;
            // Target? Controls target?
            if (this.viewer.controls) {
                currentTab.cameraState.target.copy(this.viewer.controls.target);
            }
            // Save Measurements
            if (this.app.measurementManager) {
                currentTab.measurementState = this.app.measurementManager.getMeasurementState();
            }
        }

        // Set New Active ID
        this.activeTabId = id;
        const newTab = this.getActiveTab();

        if (!newTab) return;

        // 1. Clear Viewer Scene (remove old group)
        if (this.viewer.dxfGroup) {
            this.viewer.scene.remove(this.viewer.dxfGroup);
        }

        // 2. Set new group
        this.viewer.dxfGroup = newTab.dxfGroup;
        this.viewer.scene.add(this.viewer.dxfGroup);

        // Restore Measurements
        if (this.app.measurementManager) {
            this.app.measurementManager.restoreMeasurementState(newTab.measurementState || []);
        }

        // 3. Restore Camera
        this.viewer.camera.position.copy(newTab.cameraState.position);
        this.viewer.camera.zoom = newTab.cameraState.zoom;
        if (this.viewer.controls) {
            this.viewer.controls.target.copy(newTab.cameraState.target);
            this.viewer.controls.update();
        }

        // Update projection matrix
        this.viewer.camera.updateProjectionMatrix();

        // 4. Update UI
        this.renderTabBar();

        // Clear Selection on tab switch
        if (this.app.clearSelection) {
            this.app.clearSelection();
        }

        // Trigger status update
        if (this.app.updateStatus) {
            this.app.updateStatus(`Switched to ${newTab.name}`);
        }

        // Handle "Help Overlay" visibility (only show on empty new tab?)
        // Check if tab has content
        const hasContent = newTab.dxfGroup.children.length > 0;
        if (this.viewportOverlay) {
            // Maybe we always hide it if any file is open, or show if empty?
            // For now, let's keep it simple.
            if (hasContent) {
                this.viewportOverlay.classList.add('hidden');
            } else {
                this.viewportOverlay.classList.remove('hidden');
            }
        }
    }

    getActiveTab() {
        return this.tabs.find(t => t.id === this.activeTabId);
    }

    updateTabName(id, name) {
        const tab = this.tabs.find(t => t.id === id);
        if (tab) {
            tab.name = name;
            this.renderTabBar();
        }
    }

    renderTabBar() {
        if (!this.tabBar) return;
        this.tabBar.innerHTML = '';

        this.tabs.forEach(tab => {
            const el = document.createElement('div');
            el.className = `tab-item ${tab.id === this.activeTabId ? 'active' : ''}`;

            const title = document.createElement('span');
            title.className = 'tab-title';
            title.textContent = tab.name;
            title.onclick = () => this.switchToTab(tab.id);

            const close = document.createElement('button');
            close.className = 'tab-close';
            close.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
            close.onclick = (e) => {
                e.stopPropagation();
                this.closeTab(tab.id);
            };

            el.appendChild(title);
            el.appendChild(close);
            this.tabBar.appendChild(el);
        });

        // Add "New Tab" button at end?
        /*
        const newBtn = document.createElement('button');
        newBtn.className = 'tab-new-btn';
        newBtn.innerHTML = '+';
        newBtn.onclick = () => this.createNewTab();
        this.tabBar.appendChild(newBtn);
        */
    }

    disposeGroup(group) {
        // Recursive dispose
        group.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
    }
}
