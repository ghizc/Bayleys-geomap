// map.js

import { MAPBOX_TOKEN, MAP_STYLES, ADMIN_UUID } from './config.js';
import { state } from './store.js';
import { supabase } from './api.js';
import { log, showDetail, getPremiseDisplayData } from './ui.js';

mapboxgl.accessToken = MAPBOX_TOKEN;

// Default style tracking
if (!state.currentMapStyle) state.currentMapStyle = MAP_STYLES.CUSTOM;

export function initMap(container, center, zoom, pitch = 60, bearing = -17.6, overrideStyle = null) {
    if (state.mapInstance && state.mapInstance._container && state.mapInstance._container.id !== container) {
        state.mapInstance.remove();
        state.mapInstance = null;
    }
    if (state.mapInstance && state.mapInstance._container && state.mapInstance._container.id === container) {
        return state.mapInstance;
    }

    try {
        state.mapInstance = new mapboxgl.Map({
            container: container,
            style: overrideStyle || state.currentMapStyle,
            center: center,
            zoom: zoom,
            pitch: pitch,
            bearing: bearing,
            antialias: true
        });

        if (container !== 'loginMapBackground') {
            state.mapInstance.addControl(new mapboxgl.NavigationControl({ showZoom: false }), 'bottom-right');
            state.mapInstance.addControl(new StyleToggleControl(), 'bottom-right');
            
            if (state.currentUser && state.currentUser.id === ADMIN_UUID) {
                state.mapInstance.addControl(new AdminToolsControl(), 'bottom-right');
            }
        }
        return state.mapInstance;
    } catch (error) { 
        log('Map Init Error: ' + error.message, true); 
    }
}

export function addMarkers(list) {
    if (!state.mapInstance) return;
    
    // Remove existing markers
    const existingMarkers = document.querySelectorAll('.mapboxgl-marker');
    existingMarkers.forEach(m => m.remove());

    list.forEach(p => {
        if (p.lat && p.lng) {
            const { displayImage } = getPremiseDisplayData(p);
            const el = document.createElement('div');
            
            if (displayImage) { 
                el.className = 'marker-selected'; 
                el.innerHTML = `<img src="${displayImage}" onerror="this.style.display='none';this.parentElement.className='marker-dot'">`; 
            } else { 
                el.className = 'marker-dot'; 
            }
            
            el.onclick = () => showDetail(p);
            new mapboxgl.Marker(el).setLngLat([p.lng, p.lat]).addTo(state.mapInstance);
        }
    });
    
    if (list.length > 0 && list[0].lat && state.mapInstance) {
        state.mapInstance.flyTo({ center: [list[0].lng, list[0].lat], zoom: 14 });
    }
}

// Mapbox View Style Toggle Control
class StyleToggleControl {
    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
        
        this._btn = document.createElement('button');
        this._btn.className = 'icon-ctrl-btn';
        this._btn.type = 'button';
        this._btn.title = "Toggle Satellite/3D View";
        
        const icon3D = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00264b" stroke-width="2"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon><line x1="8" y1="2" x2="8" y2="18"></line><line x1="16" y1="6" x2="16" y2="22"></line></svg>`;
        const iconSat = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00264b" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>`;
        
        this._btn.innerHTML = state.currentMapStyle === MAP_STYLES.CUSTOM ? iconSat : icon3D;
        
        this._btn.onclick = () => {
            if (state.currentMapStyle === MAP_STYLES.CUSTOM) {
                state.currentMapStyle = MAP_STYLES.SATELLITE;
                this._btn.innerHTML = icon3D;
            } else {
                state.currentMapStyle = MAP_STYLES.CUSTOM;
                this._btn.innerHTML = iconSat;
            }
            this._map.setStyle(state.currentMapStyle, { diff: false });
        };
        
        this._container.appendChild(this._btn);
        return this._container;
    }
    onRemove() {
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }
}

// Mapbox Admin Sync Tools Control
class AdminToolsControl {
    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
        
        if (!state.currentUser || state.currentUser.id !== ADMIN_UUID) {
            this._container.style.display = 'none';
            return this._container;
        }
        
        this._btnSyncLogos = document.createElement('button');
        this._btnSyncLogos.className = 'icon-ctrl-btn';
        this._btnSyncLogos.title = "Sync Client Logos";
        const logoIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00264b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`;
        this._btnSyncLogos.innerHTML = logoIcon;
        
        this._btnSync = document.createElement('button');
        this._btnSync.className = 'icon-ctrl-btn';
        this._btnSync.title = "Sync Report Covers";
        const imgIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00264b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
        this._btnSync.innerHTML = imgIcon;
        
        this._btnFix = document.createElement('button');
        this._btnFix.className = 'icon-ctrl-btn';
        this._btnFix.title = "Fix Missing Coordinates";
        const crosshairIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00264b" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>`;
        this._btnFix.innerHTML = crosshairIcon;
        
        const loadingIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00264b" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
        
        this._status = document.createElement('div');
        this._status.className = 'auto-fix-status';
        this._status.style.display = 'none';
        
        this._container.append(this._btnSyncLogos, this._btnSync, this._btnFix, this._status);

        // Events
        this._btnSyncLogos.onclick = async () => this._runTool("Syncing Logos...", async () => {
            const { data: files } = await supabase.storage.from('GEOMAP-Images').list('', { limit: 1000 });
            let count = 0;
            for (const client of state.clientsData) {
                const file = files.find(f => f.name.split('.')[0].trim().toLowerCase() === (client.name||'').trim().toLowerCase());
                if (file) {
                    const { data } = supabase.storage.from('GEOMAP-Images').getPublicUrl(file.name);
                    if (client.logo_url !== data.publicUrl) {
                        await supabase.from('clients').update({ logo_url: data.publicUrl }).eq('id', client.id);
                        count++;
                    }
                }
            }
            return `Synced ${count} logos.`;
        }, loadingIcon, logoIcon, this._btnSyncLogos);

        this._btnSync.onclick = async () => this._runTool("Syncing Storage...", async () => {
            const { data: files } = await supabase.storage.from('GEOMAP-JOB Covers').list('', { limit: 3000 });
            const jobImages = {};
            for (const file of files) {
                const match = file.name.match(/^(\d+)/);
                if (match) {
                    if (!jobImages[match[1]]) jobImages[match[1]] = [];
                    jobImages[match[1]].push(supabase.storage.from('GEOMAP-JOB Covers').getPublicUrl(file.name).data.publicUrl);
                }
            }
            let count = 0;
            for (const [jobNo, urls] of Object.entries(jobImages)) {
                await supabase.from('reports').update({ image_url: urls }).eq('job_number', jobNo);
                count++;
            }
            return `Synced images for ${count} reports.`;
        }, loadingIcon, imgIcon, this._btnSync);

        this._btnFix.onclick = async () => this._runTool("Fixing Coordinates...", async () => {
            const { data: missing } = await supabase.from('premises').select('*').is('lat', null);
            if (!missing || missing.length === 0) return "All Coordinates Found!";
            
            let count = 0;
            for (const p of missing) {
                const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(p.address)}.json?access_token=${MAPBOX_TOKEN}&country=nz&limit=1`);
                const json = await res.json();
                if (json.features?.length > 0) {
                    const [lng, lat] = json.features[0].center;
                    await supabase.from('premises').update({ lat, lng }).eq('id', p.id);
                    count++;
                    this._status.innerText = `Fixed ${count}/${missing.length}`;
                }
            }
            return `Update Complete!`;
        }, loadingIcon, crosshairIcon, this._btnFix);

        return this._container;
    }
    
    async _runTool(startMsg, taskFn, loadingIcon, defaultIcon, activeBtn) {
        if (!state.currentUser || state.currentUser.id !== ADMIN_UUID) return;
        this._disableBtns(true);
        activeBtn.innerHTML = loadingIcon;
        this._status.style.display = 'block';
        this._status.innerText = startMsg;
        try {
            const resultMsg = await taskFn();
            this._status.innerText = resultMsg;
            if (window.refreshAppAdminData) await window.refreshAppAdminData();
        } catch(e) {
            log("Tool Error: " + e.message, true);
            this._status.innerText = e.message;
        } finally {
            setTimeout(() => {
                this._disableBtns(false);
                activeBtn.innerHTML = defaultIcon;
            }, 4000);
        }
    }
    
    _disableBtns(disable) {
        this._btnFix.disabled = disable;
        this._btnSync.disabled = disable;
        this._btnSyncLogos.disabled = disable;
        if (!disable) this._status.style.display = 'none';
    }

    onRemove() {
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }
}