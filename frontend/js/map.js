/**
 * Water of Leith WebMap - Map JS
 */
// ============================================================
// Configuration
// ============================================================
const parts = window.location.pathname.split('/').filter(Boolean);
const BASE = new URL('.', window.location.href).pathname.replace(/\/$/, '');
const API_BASE_URL = `${BASE}/api`;

// global variables
let map;
let layers = {
    studyArea: null,
    postcode: null,
    simd: null,
    greenspaces: null,
    floodZones: null,
    floodDamage: null
};
let layerOrder = ['studyArea', 'postcode', 'simd', 'floodZones', 'greenspaces', 'floodDamage'];
let categoryChart = null;
let greenspaceChart = null;
let greenspaceData = [];
let currentHighlight = null;
let postcodeData = null; // Store postcode data for querying
let floodDamageData = null;  // Store building loss data for postcode statistics

// ============================================================
// initialization
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
    initMap();
    initSidebars();
    initLayerControls();
    initLayerDragSort();
    initModals();
    initPostcodeSearch();
    loadAllData();
});

function initMap() {
    map = L.map('map', {
        center: [55.92, -3.25],
        zoom: 12,
        zoomControl: true
    });
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap contributors © CARTO',
        maxZoom: 19
    }).addTo(map);
    
    // scale bar
    L.control.scale({
        position: 'bottomleft',
        metric: true,
        imperial: false
    }).addTo(map);
    
    // compass
    var NorthArrow = L.Control.extend({
        options: { position: 'bottomleft' },
        onAdd: function(map) {
            var container = L.DomUtil.create('div', 'leaflet-control-north');
            container.innerHTML = '<div style="width:36px;height:36px;background:white;border-radius:4px;box-shadow:0 1px 5px rgba(0,0,0,0.3);display:flex;flex-direction:column;align-items:center;justify-content:center;font-weight:bold;color:#333;border:2px solid rgba(0,0,0,0.2);margin-bottom:5px;"><span style="font-size:11px;line-height:1;">N</span><span style="font-size:16px;line-height:1;color:#c0392b;">&#9650;</span></div>';
            return container;
        }
    });
    new NorthArrow().addTo(map);
}

// ============================================================
// Postcode quiry
// ============================================================
function initPostcodeSearch() {
    const input = document.getElementById('postcodeInput');
    const btn = document.getElementById('postcodeSearchBtn');
    
    btn.addEventListener('click', () => searchPostcode());
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchPostcode();
    });
}

async function searchPostcode() {
    const input = document.getElementById('postcodeInput');
    const resultDiv = document.getElementById('postcodeResult');
    const postcode = input.value.trim().toUpperCase();
    
    if (!postcode) {
        showPostcodeResult('Please enter a postcode', 'error');
        return;
    }
    
    resultDiv.innerHTML = 'Searching...';
    resultDiv.className = 'search-result show';
    
    try {
        // Query the building loss corresponding to the postcode
        const response = await fetch(`${API_BASE_URL}/postcode/search?postcode=${encodeURIComponent(postcode)}`);
        const data = await response.json();
        
        if (data.error) {
            showPostcodeResult(data.error, 'error');
            return;
        }
        
        if (!data.found) {
            showPostcodeResult(`Postcode "${postcode}" not found in study area`, 'warning');
            return;
        }
        
        if (data.affected_buildings === 0) {
            // Unaffected buildings
            showPostcodeResult(`
                <div class="result-title">✅ ${postcode}</div>
                <div class="result-stats">
                    <span>Good news! No buildings in this postcode are affected by flooding.</span>
                </div>
            `, 'success');
            
            //Jump to the postcode area
            if (data.bounds) {
                map.fitBounds(data.bounds, { padding: [50, 50] });
            }
        } else {
            // Affected buildings
            showPostcodeResult(`
                <div class="result-title">⚠️ ${postcode}</div>
                <div class="result-stats">
                    <span>Affected Buildings: <strong>${data.affected_buildings}</strong></span>
                    <span>Total Damage: <strong>£${formatNumber(data.total_damage)}</strong></span>
                    <span>Protection Value: <strong>£${formatNumber(data.protection_value)}</strong></span>
                </div>
                <span class="jump-link" onclick="zoomToPostcode('${postcode}')">📍 View on Map</span>
            `, 'warning');
            
            // Show detailed statistics
            showPostcodeStats(data);
        }
        
        // Highlight the postcode area
        highlightPostcodeArea(postcode);
        
    } catch (error) {
        console.error('Postcode search error:', error);
        showPostcodeResult('Search failed. Please try again.', 'error');
    }
}

function showPostcodeResult(content, type) {
    const resultDiv = document.getElementById('postcodeResult');
    resultDiv.innerHTML = content;
    resultDiv.className = `search-result show ${type}`;
}

function showPostcodeStats(data) {
    const statsCard = document.getElementById('postcodeStats');
    const content = document.getElementById('postcodeStatsContent');
    
    let html = `
        <div class="stat-row">
            <span class="stat-label">Postcode</span>
            <span class="stat-value">${data.postcode}</span>
        </div>
        <div class="stat-row">
            <span class="stat-label">Affected Buildings</span>
            <span class="stat-value">${data.affected_buildings}</span>
        </div>
        <div class="stat-row">
            <span class="stat-label">Total Damage (2024)</span>
            <span class="stat-value">£${formatNumber(data.total_damage)}</span>
        </div>
        <div class="stat-row">
            <span class="stat-label">Protection Value</span>
            <span class="stat-value highlight">£${formatNumber(data.protection_value)}</span>
        </div>
    `;
    
    if (data.buildings && data.buildings.length > 0) {
        html += `<div class="building-list"><strong>Affected Buildings:</strong>`;
        data.buildings.forEach(b => {
            html += `
                <div class="building-item" onclick="zoomToBuilding(${b.damage_id})">
                    <span class="building-type">${b.building_category || 'Building'}</span><br>
                    <span>Damage: £${formatNumber(b.damage_2024_pound)}</span> | 
                    <span class="building-value">Protected: £${formatNumber(b.protection_value_pound)}</span>
                </div>
            `;
        });
        html += '</div>';
    }
    
    content.innerHTML = html;
    statsCard.style.display = 'block';
}

function highlightPostcodeArea(postcode) {
    if (!layers.postcode) return;
    
    layers.postcode.eachLayer(layer => {
        const pc = layer.feature?.properties?.Postcode;
        if (pc && pc.toUpperCase() === postcode.toUpperCase()) {
            layer.setStyle({
                weight: 4,
                color: '#2980b9',
                fillOpacity: 0.5
            });
            map.fitBounds(layer.getBounds(), { padding: [50, 50] });
            layer.openPopup();
        } else {
            // Reset other area styles
            layer.setStyle({
                weight: 1,
                color: '#3498db',
                fillOpacity: 0.2
            });
        }
    });
    
    // Ensure the layer is visible
    document.getElementById('layerPostcode').checked = true;
    toggleLayer('postcode', true);
}

function zoomToPostcode(postcode) {
    highlightPostcodeArea(postcode);
}

function zoomToBuilding(damageId) {
    if (!layers.floodDamage) return;
    
    layers.floodDamage.eachLayer(layer => {
        if (layer.feature?.properties?.damage_id === damageId) {
            layer.setStyle({
                weight: 4,
                color: '#e74c3c',
                fillOpacity: 0.9
            });
            map.fitBounds(layer.getBounds(), { padding: [100, 100], maxZoom: 18 });
            layer.openPopup();
            
            // Ensure the building layer is visible.
            document.getElementById('layerFloodDamage').checked = true;
            toggleLayer('floodDamage', true);
        }
    });
}


// ============================================================
// Sidebar Control
// ============================================================
function initSidebars() {
    const leftToggle = document.getElementById('leftToggle');
    const rightToggle = document.getElementById('rightToggle');
    const leftSidebar = document.getElementById('leftSidebar');
    const rightSidebar = document.getElementById('rightSidebar');
    
    leftToggle.addEventListener('click', () => {
        leftSidebar.classList.toggle('collapsed');
        leftToggle.textContent = leftSidebar.classList.contains('collapsed') ? '▶' : '◀';
        setTimeout(() => map.invalidateSize(), 300);
    });
    
    rightToggle.addEventListener('click', () => {
        rightSidebar.classList.toggle('collapsed');
        rightToggle.textContent = rightSidebar.classList.contains('collapsed') ? '◀' : '▶';
        setTimeout(() => map.invalidateSize(), 300);
    });
}

// ============================================================
// Layer control
// ============================================================
function initLayerControls() {
    // Layer switch
    document.getElementById('layerStudyArea').addEventListener('change', (e) => {
        toggleLayer('studyArea', e.target.checked);
    });
    document.getElementById('layerPostcode').addEventListener('change', (e) => {
        toggleLayer('postcode', e.target.checked);
    });
    document.getElementById('layerSimd').addEventListener('change', (e) => {
        toggleLayer('simd', e.target.checked);
    });
    document.getElementById('layerGreenspaces').addEventListener('change', (e) => {
        toggleLayer('greenspaces', e.target.checked);
    });
    document.getElementById('layerFloodZones').addEventListener('change', (e) => {
        toggleLayer('floodZones', e.target.checked);
    });
    document.getElementById('layerFloodDamage').addEventListener('change', (e) => {
        toggleLayer('floodDamage', e.target.checked);
    });
    
    // Expand/Collapse Options
    document.querySelectorAll('.layer-expand').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const options = btn.closest('.layer-item').querySelector('.layer-options');
            if (options) {
                options.classList.toggle('show');
                btn.classList.toggle('expanded');
            }
        });
    });
    
    // Postcode filtering
    document.getElementById('postcodeFilter').addEventListener('change', (e) => {
        loadPostcodes(e.target.value);
    });
    
    // SIMD filtering
    document.getElementById('simdFilter').addEventListener('change', (e) => {
        loadSIMDZones(e.target.value);
    });
    document.getElementById('applySimdRange').addEventListener('click', () => {
        const min = document.getElementById('simdMin').value;
        const max = document.getElementById('simdMax').value;
        loadSIMDZones(null, min, max);
    });
    
    // green space filtering
    document.getElementById('greenspaceFilter').addEventListener('change', (e) => {
        loadGreenspaces(e.target.value);
    });
    document.getElementById('applyGsRange').addEventListener('click', () => {
        const min = document.getElementById('gsMin').value;
        const max = document.getElementById('gsMax').value;
        loadGreenspaces(null, min, max);
    });
    
    // flood deepth filtering
    document.getElementById('floodDepthFilter').addEventListener('change', (e) => {
        loadFloodZones(e.target.value);
    });
    
    // Building type filtering
    document.getElementById('buildingTypeFilter').addEventListener('change', (e) => {
        loadFloodDamage(e.target.value);
    });
    document.getElementById('applyDmgRange').addEventListener('click', () => {
        const min = document.getElementById('dmgMin').value;
        const max = document.getElementById('dmgMax').value;
        const type = document.getElementById('buildingTypeFilter').value;
        loadFloodDamage(type, min, max);
    });
}

function toggleLayer(layerName, visible) {
    if (layers[layerName]) {
        if (visible) {
            layers[layerName].addTo(map);
        } else {
            map.removeLayer(layers[layerName]);
        }
    }
}

// ============================================================
// Drag and drop to sort layers
// ============================================================
function initLayerDragSort() {
    const layerList = document.getElementById('layerList');
    let draggedItem = null;
    
    layerList.querySelectorAll('.layer-item').forEach(item => {
        item.addEventListener('dragstart', (e) => {
            draggedItem = item;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        
        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            layerList.querySelectorAll('.layer-item').forEach(i => {
                i.classList.remove('drag-over-top', 'drag-over-bottom');
            });
            updateLayerOrder();
        });
        
        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (item === draggedItem) return;
            const rect = item.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            item.classList.remove('drag-over-top', 'drag-over-bottom');
            if (e.clientY < midY) {
                item.classList.add('drag-over-top');
            } else {
                item.classList.add('drag-over-bottom');
            }
        });
        
        item.addEventListener('dragleave', () => {
            item.classList.remove('drag-over-top', 'drag-over-bottom');
        });
        
        item.addEventListener('drop', (e) => {
            e.preventDefault();
            if (item === draggedItem) return;
            const rect = item.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            if (e.clientY < midY) {
                layerList.insertBefore(draggedItem, item);
            } else {
                layerList.insertBefore(draggedItem, item.nextSibling);
            }
            item.classList.remove('drag-over-top', 'drag-over-bottom');
        });
    });
}

function updateLayerOrder() {
    const items = document.querySelectorAll('#layerList .layer-item');
    layerOrder = Array.from(items).map(item => item.dataset.layer);
    applyLayerOrder();
}

function applyLayerOrder() {
    layerOrder.forEach(layerName => {
        if (layers[layerName] && map.hasLayer(layers[layerName])) {
            layers[layerName].bringToFront();
        }
    });
}


// ============================================================
// pop-up control
// ============================================================
function initModals() {
    document.getElementById('exportBtn').addEventListener('click', () => {
        document.getElementById('modalExport').classList.add('show');
    });
    document.getElementById('closeExport').addEventListener('click', () => {
        document.getElementById('modalExport').classList.remove('show');
    });
    
    document.getElementById('helpBtn').addEventListener('click', () => {
        document.getElementById('modalHelp').classList.add('show');
    });
    document.getElementById('closeHelp').addEventListener('click', () => {
        document.getElementById('modalHelp').classList.remove('show');
    });
    
    document.getElementById('close3D').addEventListener('click', close3DModal);
    document.getElementById('modal3D').addEventListener('click', (e) => {
        if (e.target === document.getElementById('modal3D')) close3DModal();
    });
    
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.getElementById('modalExport').classList.remove('show');
            document.getElementById('modalHelp').classList.remove('show');
            close3DModal();
        }
    });
    
    ['modalExport', 'modalHelp'].forEach(id => {
        document.getElementById(id).addEventListener('click', (e) => {
            if (e.target.id === id) e.target.classList.remove('show');
        });
    });
    
    document.querySelectorAll('.export-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            exportData(btn.dataset.type, btn.dataset.format);
        });
    });
}

function open3DModal(name, modelPath) {
    document.getElementById('modal3DTitle').textContent = `🏔️ ${name} - 3D Model`;
    document.getElementById('model3DIframe').src = modelPath;
    document.getElementById('modal3D').classList.add('show');
}

function close3DModal() {
    document.getElementById('modal3D').classList.remove('show');
    document.getElementById('model3DIframe').src = '';
}

function exportData(type, format) {
    const url = `${API_BASE_URL}/export/${type}?format=${format}`;
    window.open(url, '_blank');
}

// ============================================================
// Data loading
// ============================================================
async function loadAllData() {
    try {
        await Promise.all([
            loadStudyArea(),
            loadPostcodes(),
            loadSIMDZones(),
            loadGreenspaces(),
            loadFloodDamage(),
            loadSummary(),
            loadDamageByCategory(),
            loadGreenspaceRanking()
        ]);
        applyLayerOrder();
    } catch (error) {
        console.error('Error loading data:', error);
    }
}

async function loadStudyArea() {
    try {
        const response = await fetch(`${API_BASE_URL}/study_area`);
        const data = await response.json();
        
        if (layers.studyArea) map.removeLayer(layers.studyArea);
        
        layers.studyArea = L.geoJSON(data, {
            style: {
                fillColor: '#1e3a5f',
                fillOpacity: 0.1,
                color: '#1e3a5f',
                weight: 3,
                dashArray: '5, 5'
            }
        }).addTo(map);
        
        if (data.features && data.features.length > 0) {
            map.fitBounds(layers.studyArea.getBounds(), { padding: [20, 20] });
        }
    } catch (error) {
        console.error('Error loading study area:', error);
    }
}

// ============================================================
// Postcode layer loading
// ============================================================
async function loadPostcodes(filter = null) {
    try {
        let url = `${API_BASE_URL}/postcodes`;
        if (filter) url += `?filter=${filter}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        postcodeData = data;
        
        if (layers.postcode) map.removeLayer(layers.postcode);
        
        layers.postcode = L.geoJSON(data, {
            style: (feature) => ({
                fillColor: '#3498db',
                fillOpacity: 0.2,
                color: '#3498db',
                weight: 1
            }),
            onEachFeature: (feature, layer) => {
                const p = feature.properties;
                layer.bindPopup(`
                    <div class="popup-content">
                        <div class="popup-title">📮 ${p.Postcode || 'Postcode'}</div>
                        <div class="popup-row">
                            <span class="popup-label">District:</span>
                            <span class="popup-value">${p.District || 'N/A'}</span>
                        </div>
                        <div class="popup-row">
                            <span class="popup-label">Sector:</span>
                            <span class="popup-value">${p.Sector || 'N/A'}</span>
                        </div>
                        <div class="popup-row">
                            <span class="popup-label">Affected:</span>
                            <span class="popup-value">${p.affected_count || 0} buildings</span>
                        </div>
                        <div class="popup-row">
                            <span class="popup-label">Total Damage:</span>
                            <span class="popup-value">£${formatNumber(p.total_damage || 0)}</span>
                        </div>
                    </div>
                `);
                
                layer.on('click', () => {
                    // Click on postcode to display statistics for that area.
                    if (p.Postcode) {
                        document.getElementById('postcodeInput').value = p.Postcode;
                        searchPostcode();
                    }
                });
            }
        });
        
        if (document.getElementById('layerPostcode').checked) {
            layers.postcode.addTo(map);
        }
    } catch (error) {
        console.error('Error loading postcodes:', error);
    }
}


// ============================================================
// SIMD layer loading
// ============================================================
async function loadSIMDZones(riskLevel = null, min = null, max = null) {
    try {
        let url = `${API_BASE_URL}/simd_zones`;
        const params = new URLSearchParams();
        if (riskLevel) params.append('risk_level', riskLevel);
        if (min) params.append('min', min);
        if (max) params.append('max', max);
        if (params.toString()) url += '?' + params.toString();
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (layers.simd) map.removeLayer(layers.simd);
        
        layers.simd = L.geoJSON(data, {
            style: (feature) => {
                const decile = feature.properties.simd_decile;
                return {
                    fillColor: getSIMDColor(decile),
                    fillOpacity: 0.6,
                    color: '#333',
                    weight: 1
                };
            },
            onEachFeature: (feature, layer) => {
                const p = feature.properties;
                layer.bindPopup(`
                    <div class="popup-content">
                        <div class="popup-title">${p.datazone_name || 'SIMD Zone'}</div>
                        <div class="popup-row">
                            <span class="popup-label">DataZone:</span>
                            <span class="popup-value">${p.datazone_code}</span>
                        </div>
                        <div class="popup-row">
                            <span class="popup-label">SIMD Decile:</span>
                            <span class="popup-value">${p.simd_decile || 'N/A'}</span>
                        </div>
                        <div class="popup-row">
                            <span class="popup-label">Vulnerability:</span>
                            <span class="popup-value">${getVulnerabilityLabel(p.simd_decile)}</span>
                        </div>
                    </div>
                `);
            }
        });
        
        if (document.getElementById('layerSimd').checked) {
            layers.simd.addTo(map);
        }
    } catch (error) {
        console.error('Error loading SIMD zones:', error);
    }
}

function getSIMDColor(decile) {
    if (!decile) return '#999';
    if (decile <= 3) return '#e74c3c';
    if (decile <= 7) return '#f39c12';
    return '#27ae60';
}

function getVulnerabilityLabel(decile) {
    if (!decile) return 'Unknown';
    if (decile <= 3) return 'High';
    if (decile <= 7) return 'Medium';
    return 'Low';
}

// ============================================================
// Greenspaces layer loading
// ============================================================
async function loadGreenspaces(type = null, minStorage = null, maxStorage = null) {
    const selectedGreenspaces = [
        'Spylaw Public Park', 'Colinton and Craiglockhart Dells', 'Hailes Quarry Park',
        'Saughton Allotments', 'Saughton Sports Complex', 'Saughton Rose Gardens',
        'Saughton Park and Gardens', 'Murray Field', 'Murrayfield', 'Roseburn Public Park'
    ];
    
    try {
        let url = `${API_BASE_URL}/greenspaces`;
        const params = new URLSearchParams();
        if (type && type !== 'selected') params.append('type', type);
        if (minStorage) params.append('min_storage', minStorage);
        if (maxStorage) params.append('max_storage', maxStorage);
        if (params.toString()) url += '?' + params.toString();
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (type === 'selected') {
            data.features = data.features.filter(f => {
                const name = f.properties.name;
                if (!name) return false;
                return selectedGreenspaces.some(sg => 
                    name.toLowerCase().includes(sg.toLowerCase()) ||
                    sg.toLowerCase().includes(name.toLowerCase())
                );
            });
        }
        
        if (layers.greenspaces) map.removeLayer(layers.greenspaces);
        
        layers.greenspaces = L.geoJSON(data, {
            style: (feature) => ({
                fillColor: feature.properties.is_key_greenspace ? '#27ae60' : '#82e0aa',
                fillOpacity: 0.7,
                color: '#1e8449',
                weight: 2
            }),
            onEachFeature: (feature, layer) => {
                const p = feature.properties;
                let popupContent = `
                    <div class="popup-content">
                        <div class="popup-title">🌳 ${p.name || 'Greenspace'}</div>
                        <div class="popup-row">
                            <span class="popup-label">Type:</span>
                            <span class="popup-value">${p.function_type || 'N/A'}</span>
                        </div>
                        <div class="popup-row">
                            <span class="popup-label">Storage:</span>
                            <span class="popup-value">${formatNumber(p.storage_volume_m3)} m³</span>
                        </div>
                `;
                if (p.has_3d_model && p.model_path) {
                    popupContent += `<button class="popup-3d-btn" onclick="open3DModal('${p.name}', '${p.model_path}')">🏔️ View 3D</button>`;
                }
                popupContent += '</div>';
                layer.bindPopup(popupContent);
                layer.greenspaceId = p.greenspace_id;
            }
        });
        
        if (document.getElementById('layerGreenspaces').checked) {
            layers.greenspaces.addTo(map);
        }
    } catch (error) {
        console.error('Error loading greenspaces:', error);
    }
}

// ============================================================
// FloodZones layer loading
// ============================================================
async function loadFloodZones(depth = null) {
    try {
        let url = `${API_BASE_URL}/flood_zones`;
        if (depth) url += `?depth=${depth}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (layers.floodZones) map.removeLayer(layers.floodZones);
        
        layers.floodZones = L.geoJSON(data, {
            style: () => ({
                fillColor: '#3498db',
                fillOpacity: 0.5,
                color: '#2980b9',
                weight: 1
            }),
            onEachFeature: (feature, layer) => {
                const p = feature.properties;
                layer.bindPopup(`
                    <div class="popup-content">
                        <div class="popup-title">🌊 Flood Zone</div>
                        <div class="popup-row">
                            <span class="popup-label">Probability:</span>
                            <span class="popup-value">${p.probability || 'N/A'}</span>
                        </div>
                        <div class="popup-row">
                            <span class="popup-label">Depth Band:</span>
                            <span class="popup-value">${p.depth_band || 'N/A'}</span>
                        </div>
                    </div>
                `);
            }
        });
        
        if (document.getElementById('layerFloodZones').checked) {
            layers.floodZones.addTo(map);
        }
    } catch (error) {
        console.error('Error loading flood zones:', error);
    }
}


// ============================================================
// FloodDamage layer loading
// ============================================================
async function loadFloodDamage(type = null, minValue = null, maxValue = null) {
    try {
        let url = `${API_BASE_URL}/flood_damage`;
        const params = new URLSearchParams();
        if (type) params.append('type', type);
        if (minValue) params.append('min_value', minValue);
        if (maxValue) params.append('max_value', maxValue);
        if (params.toString()) url += '?' + params.toString();
        
        const response = await fetch(url);
        const data = await response.json();
        
        floodDamageData = data;
        const maxProtection = data.metadata?.max_protection_value || 500000;
        
        if (layers.floodDamage) map.removeLayer(layers.floodDamage);
        
        layers.floodDamage = L.geoJSON(data, {
            style: (feature) => {
                const value = feature.properties.protection_value_pound || 0;
                return {
                    fillColor: getProtectionColor(value, maxProtection),
                    fillOpacity: 0.8,
                    color: '#333',
                    weight: 1
                };
            },
            onEachFeature: (feature, layer) => {
                const p = feature.properties;
                layer.bindPopup(`
                    <div class="popup-content">
                        <div class="popup-title">🏠 ${p.building_category || 'Building'}</div>
                        <div class="popup-row">
                            <span class="popup-label">Flood Depth:</span>
                            <span class="popup-value">${p.flood_depth_m?.toFixed(2) || 0} m</span>
                        </div>
                        <div class="popup-row">
                            <span class="popup-label">Damage (2024):</span>
                            <span class="popup-value">£${formatNumber(p.damage_2024_pound)}</span>
                        </div>
                        <div class="popup-row">
                            <span class="popup-label">Protection Value:</span>
                            <span class="popup-value" style="color: #27ae60; font-weight: bold;">
                                £${formatNumber(p.protection_value_pound)}
                            </span>
                        </div>
                    </div>
                `);
                layer.buildingCategory = p.building_category;
            }
        });
        
        if (document.getElementById('layerFloodDamage').checked) {
            layers.floodDamage.addTo(map);
        }
    } catch (error) {
        console.error('Error loading flood damage:', error);
    }
}

function getProtectionColor(value, max) {
    const ratio = Math.min(value / max, 1);
    const colors = ['#ffffcc', '#c7e9b4', '#7fcdbb', '#41b6c4', '#2c7fb8', '#253494'];
    const index = Math.min(Math.floor(ratio * colors.length), colors.length - 1);
    return colors[index];
}

// ============================================================
// Statistical data loading
// ============================================================
async function loadSummary() {
    try {
        const response = await fetch(`${API_BASE_URL}/summary`);
        const data = await response.json();
        
        document.getElementById('statTotalProtection').textContent = '£' + formatNumber(data.total_protection_value);
        document.getElementById('statProtectionRate').textContent = data.protection_percentage + '%';
        document.getElementById('statBuildingCount').textContent = formatNumber(data.affected_buildings);
        document.getElementById('statStorage').textContent = formatNumber(data.total_storage_m3) + ' m³';
    } catch (error) {
        console.error('Error loading summary:', error);
    }
}

async function loadDamageByCategory() {
    try {
        const response = await fetch(`${API_BASE_URL}/damage_by_category`);
        const data = await response.json();
        
        const ctx = document.getElementById('categoryChart').getContext('2d');
        if (categoryChart) categoryChart.destroy();
        
        categoryChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map(d => d.category || 'Unknown'),
                datasets: [{
                    label: 'Protection Value (£M)',
                    data: data.map(d => (d.total_protection / 1000000).toFixed(2)),
                    backgroundColor: ['#3498db', '#e74c3c', '#f39c12', '#9b59b6'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: { legend: { display: false } },
                scales: {
                    x: { beginAtZero: true, title: { display: true, text: '£ Million' } }
                },
                onClick: (event, elements) => {
                    if (elements.length > 0) {
                        const category = data[elements[0].index].category;
                        filterBuildingsByCategory(category);
                    }
                }
            }
        });
    } catch (error) {
        console.error('Error loading damage by category:', error);
    }
}

async function loadGreenspaceRanking() {
    const selectedGreenspacesData = [
        { name: 'Saughton Park and Gardens', storage_volume_m3: 103265, is_key_greenspace: true },
        { name: 'Hailes Quarry Park', storage_volume_m3: 86560, is_key_greenspace: true },
        { name: 'Colinton and Craiglockhart Dells', storage_volume_m3: 41855, is_key_greenspace: true },
        { name: 'Spylaw Public Park', storage_volume_m3: 13518, is_key_greenspace: true },
        { name: 'Saughton Allotments', storage_volume_m3: 10478, is_key_greenspace: true },
        { name: 'Roseburn Public Park', storage_volume_m3: 6214, is_key_greenspace: true },
        { name: 'Murray Field', storage_volume_m3: 5431, is_key_greenspace: true }
    ];
    
    greenspaceData = selectedGreenspacesData;
    
    const ctx = document.getElementById('greenspaceChart').getContext('2d');
    if (greenspaceChart) greenspaceChart.destroy();
    
    greenspaceChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: selectedGreenspacesData.map(d => truncateText(d.name, 20)),
            datasets: [{
                label: 'Storage (m³)',
                data: selectedGreenspacesData.map(d => d.storage_volume_m3),
                backgroundColor: '#27ae60',
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: { legend: { display: false } },
            scales: {
                x: { beginAtZero: true, title: { display: true, text: 'm³' },
                    ticks: { callback: value => value.toLocaleString() } }
            },
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    highlightGreenspaceByName(greenspaceData[elements[0].index].name);
                }
            }
        }
    });
}


// ============================================================
// Chart Linkage Function
// ============================================================
function filterBuildingsByCategory(category) {
    const select = document.getElementById('buildingTypeFilter');
    const categoryLower = category.toLowerCase();
    
    for (let option of select.options) {
        if (option.value === categoryLower || (option.value && categoryLower.includes(option.value))) {
            select.value = option.value;
            break;
        }
    }
    
    loadFloodDamage(categoryLower);
    document.getElementById('layerFloodDamage').checked = true;
    toggleLayer('floodDamage', true);
}

function highlightGreenspaceByName(gsName) {
    if (currentHighlight) {
        currentHighlight.setStyle({ weight: 2 });
    }
    
    document.getElementById('layerGreenspaces').checked = true;
    toggleLayer('greenspaces', true);
    
    if (layers.greenspaces) {
        layers.greenspaces.eachLayer((layer) => {
            const name = layer.feature?.properties?.name;
            if (name && (name.toLowerCase().includes(gsName.toLowerCase()) || 
                gsName.toLowerCase().includes(name.toLowerCase()))) {
                layer.setStyle({ weight: 5, color: '#e74c3c' });
                currentHighlight = layer;
                map.fitBounds(layer.getBounds(), { padding: [50, 50] });
                layer.openPopup();
                showFeatureInfo(layer.feature.properties, 'Greenspace');
            }
        });
    }
}

function showFeatureInfo(properties, icon = '📍') {
    const container = document.getElementById('featureInfo');
    const details = document.getElementById('featureDetails');
    
    let html = '';
    for (const [key, value] of Object.entries(properties)) {
        if (key !== 'geom_json' && value !== null && value !== undefined) {
            const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            let displayValue = value;
            if (typeof value === 'number') {
                displayValue = value > 1000 ? formatNumber(value) : value.toFixed(2);
            }
            html += `<div class="info-row"><span class="info-label">${label}:</span><span class="info-value">${displayValue}</span></div>`;
        }
    }
    
    if (properties.has_3d_model && properties.model_path) {
        html += `<button class="view-3d-btn" onclick="open3DModal('${properties.name}', '${properties.model_path}')">🏔️ View 3D</button>`;
    }
    
    details.innerHTML = html;
    container.style.display = 'block';
}

// ============================================================
// Utility functions
// ============================================================
function formatNumber(num) {
    if (num === null || num === undefined) return '0';
    return Math.round(num).toLocaleString();
}

function truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}
