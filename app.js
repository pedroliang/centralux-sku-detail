/* ==========================================================================
   State & Constants
   ========================================================================== */

const GOOGLE_SHEETS_CSV_URL = 'https://docs.google.com/spreadsheets/d/1fRqUo8vH4awjCwV12U0fhR2bdBSRGFUVMlU8PozUsoQ/export?format=csv&gid=1556491081';
const FIRESTORE_BASE_URL = 'https://firestore.googleapis.com/v1/projects/centralux2026/databases/(default)/documents/skus';

// Application state
const state = {
  products: [],       // Raw product list loaded from Google Sheets
  imageMap: {},       // SKU Code -> Cloudinary Image URL map loaded from Firestore
  filteredList: [],   // Currently filtered products
  renderedCount: 0,   // Number of cards currently rendered
  itemsPerPage: 24,   // How many cards to render per page (lazy loading)
  activeFilter: 'all', // 'all', 'has-photo', 'no-photo'
  searchQuery: '',    // Current search string
  theme: 'dark',      // 'dark' or 'light'
  
  // Settings (stored in localStorage)
  settings: {
    cloudName: 'di2q3lieh',
    uploadPreset: 'ml_default',
    editPassword: ''
  },
  
  // Selected product for upload
  selectedProduct: null
};

// Intersection Observer for Infinite Scroll
let scrollObserver = null;

/* ==========================================================================
   DOM Elements
   ========================================================================== */

const elements = {
  themeToggle: document.getElementById('theme-toggle'),
  settingsToggle: document.getElementById('settings-toggle'),
  closeSettings: document.getElementById('close-settings'),
  settingsDrawer: document.getElementById('settings-drawer'),
  cloudinaryCloud: document.getElementById('cloudinary-cloud'),
  cloudinaryPreset: document.getElementById('cloudinary-preset'),
  editPassword: document.getElementById('edit-password'),
  saveSettingsBtn: document.getElementById('save-settings-btn'),
  
  searchInput: document.getElementById('search-input'),
  clearSearch: document.getElementById('clear-search'),
  filterChips: document.querySelectorAll('.filter-chip'),
  statsCount: document.getElementById('stats-count'),
  productsGrid: document.getElementById('products-grid'),
  sentinel: document.getElementById('sentinel'),
  syncBtn: document.getElementById('sync-btn'),
  syncIcon: document.getElementById('sync-icon'),
  syncStatusText: document.getElementById('sync-status-text'),
  
  uploadModal: document.getElementById('upload-modal'),
  closeUpload: document.getElementById('close-upload'),
  modalTitle: document.getElementById('modal-title'),
  modalSkuCode: document.getElementById('modal-sku-code'),
  modalSkuDesc: document.getElementById('modal-sku-desc'),
  dropzone: document.getElementById('dropzone'),
  fileInput: document.getElementById('file-input'),
  dropzonePreview: document.getElementById('dropzone-preview'),
  previewImg: document.getElementById('preview-img'),
  removePreviewBtn: document.getElementById('remove-preview-btn'),
  progressContainer: document.getElementById('upload-progress-container'),
  progressBar: document.getElementById('upload-progress-bar'),
  progressText: document.getElementById('upload-progress-text'),
  cancelUploadBtn: document.getElementById('cancel-upload-btn'),
  saveUploadBtn: document.getElementById('save-upload-btn'),
  
  viewerModal: document.getElementById('viewer-modal'),
  closeViewer: document.getElementById('close-viewer'),
  viewerImg: document.getElementById('viewer-img'),
  viewerSkuCode: document.getElementById('viewer-sku-code'),
  viewerSkuDesc: document.getElementById('viewer-sku-desc'),
  
  toast: document.getElementById('toast'),
  toastIcon: document.getElementById('toast-icon'),
  toastMessage: document.getElementById('toast-message')
};

/* ==========================================================================
   CSV Parser (Robust Custom State-Machine)
   ========================================================================== */

function parseCSV(csvText) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  
  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];
    
    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          cell += '"';
          i++; // skip next quote
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        row.push(cleanCell(cell));
        cell = '';
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && nextChar === '\n') {
          i++;
        }
        row.push(cleanCell(cell));
        rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += char;
      }
    }
  }
  
  if (cell || row.length > 0) {
    row.push(cleanCell(cell));
    rows.push(row);
  }
  
  return rows;
}

function cleanCell(val) {
  if (!val) return '';
  // Clean surrounding quotes and spaces
  return val.replace(/^"+|"+$/g, '').replace(/\\"/g, '"').trim();
}

/* ==========================================================================
   Data Sync & Fetching
   ========================================================================== */

// Load data from Google Sheets CSV
async function loadGoogleSheetsData() {
  try {
    const res = await fetch(GOOGLE_SHEETS_CSV_URL);
    if (!res.ok) throw new Error('Falha ao conectar com o Google Sheets.');
    const csvText = await res.text();
    const rows = parseCSV(csvText);
    
    if (rows.length < 2) throw new Error('Dados da planilha vazios ou inválidos.');
    
    // Parse products (Header: Cód, Estoque, Descrição, Preço Venda)
    // Find column indexes based on header
    const header = rows[0].map(h => h.toLowerCase());
    const idxCode = header.findIndex(h => h.includes('cód') || h.includes('cod'));
    const idxStock = header.findIndex(h => h.includes('est') || h.includes('saldo'));
    const idxDesc = header.findIndex(h => h.includes('desc'));
    const idxPrice = header.findIndex(h => h.includes('preço') || h.includes('preco') || h.includes('venda'));
    
    const parsedProducts = [];
    
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;
      
      const code = idxCode !== -1 ? row[idxCode] : row[0];
      const description = idxDesc !== -1 ? row[idxDesc] : row[2];
      const stock = idxStock !== -1 ? row[idxStock] : row[1];
      const price = idxPrice !== -1 ? row[idxPrice] : row[3];
      
      // We skip items without a code or a description
      if (!code || !description) continue;
      
      parsedProducts.push({
        code: code,
        description: description,
        stock: stock || '0',
        price: price || 'R$ 0,00'
      });
    }
    
    state.products = parsedProducts;
    localStorage.setItem('centralux_cached_products', JSON.stringify(parsedProducts));
    localStorage.setItem('centralux_cached_time', new Date().toISOString());
    return true;
  } catch (error) {
    console.error('Error loading Google Sheets:', error);
    // Attempt load from localStorage cache
    const cached = localStorage.getItem('centralux_cached_products');
    if (cached) {
      state.products = JSON.parse(cached);
      showToast('Usando dados offline da planilha (sem conexão).', 'warning');
      return true;
    }
    return false;
  }
}

// Fetch SKU image map from Firestore REST API
async function loadFirestoreImageMap() {
  const map = {};
  let pageToken = '';
  
  try {
    do {
      const url = pageToken ? `${FIRESTORE_BASE_URL}?pageSize=300&pageToken=${pageToken}` : `${FIRESTORE_BASE_URL}?pageSize=300`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Status: ${res.status}`);
      const data = await res.json();
      
      if (data.documents) {
        for (const doc of data.documents) {
          const parts = doc.name.split('/');
          const code = parts[parts.length - 1];
          const fields = doc.fields || {};
          const imageUrl = fields.imageUrl?.stringValue || '';
          if (imageUrl) {
            map[code] = imageUrl;
          }
        }
      }
      pageToken = data.nextPageToken || '';
    } while (pageToken);
    
    state.imageMap = map;
    return true;
  } catch (error) {
    console.error('Error loading images map:', error);
    showToast('Falha ao sincronizar fotos do Firestore.', 'error');
    return false;
  }
}

// Initialize all data
async function syncDatabase(force = false) {
  setLoadingState(true);
  
  // Animate sync button rotation
  if (force) elements.syncIcon.classList.add('spinning');
  
  const sheetSuccess = await loadGoogleSheetsData();
  const dbSuccess = await loadFirestoreImageMap();
  
  if (force) {
    setTimeout(() => elements.syncIcon.classList.remove('spinning'), 600);
  }
  
  setLoadingState(false);
  
  if (sheetSuccess && dbSuccess) {
    const timeStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    elements.syncStatusText.textContent = `Sincronizado às ${timeStr}`;
    showToast('Banco de dados sincronizado!', 'success');
  } else {
    elements.syncStatusText.textContent = 'Erro ao sincronizar dados.';
  }
  
  runSearch();
}

function setLoadingState(isLoading) {
  const indicator = document.querySelector('.status-indicator');
  if (isLoading) {
    indicator.className = 'status-indicator loading';
    elements.syncStatusText.textContent = 'Sincronizando dados...';
  } else {
    indicator.className = 'status-indicator online';
  }
}

/* ==========================================================================
   Search & Filter Logic
   ========================================================================== */

function runSearch() {
  const query = state.searchQuery.trim().toLowerCase();
  const queryWords = query.split(/\s+/).filter(Boolean);
  
  // Filter products based on search term & tab filter
  state.filteredList = state.products.filter(product => {
    // 1. Tab Filter (All, Has Photo, No Photo)
    const hasPhoto = !!state.imageMap[product.code];
    if (state.activeFilter === 'has-photo' && !hasPhoto) return false;
    if (state.activeFilter === 'no-photo' && hasPhoto) return false;
    
    if (!query) return true;
    
    // 2. Search query matching
    // Code match (any substring of the code)
    const codeMatch = product.code.toLowerCase().includes(query);
    
    // Multi-word description match in any order
    const descMatch = queryWords.every(word => 
      product.description.toLowerCase().includes(word)
    );
    
    return codeMatch || descMatch;
  });
  
  // Update stats
  const totalCount = state.filteredList.length;
  const withPhotoCount = state.products.filter(p => !!state.imageMap[p.code]).length;
  
  if (query || state.activeFilter !== 'all') {
    elements.statsCount.textContent = `Encontrados: ${totalCount} de ${state.products.length} (${withPhotoCount} com foto)`;
  } else {
    elements.statsCount.textContent = `Total: ${state.products.length} produtos (${withPhotoCount} com foto)`;
  }
  
  // Clear grid and render first page
  elements.productsGrid.innerHTML = '';
  state.renderedCount = 0;
  renderNextPage();
}

/* ==========================================================================
   Rendering & Infinite Scroll
   ========================================================================== */

function renderNextPage() {
  const start = state.renderedCount;
  const end = Math.min(start + state.itemsPerPage, state.filteredList.length);
  
  if (start >= state.filteredList.length) {
    elements.sentinel.classList.add('hidden');
    if (start === 0) {
      elements.productsGrid.innerHTML = `
        <div class="image-placeholder" style="grid-column: 1 / -1; height: 300px;">
          <i data-lucide="search-code"></i>
          <span style="font-size: 1rem; color: var(--text-secondary);">Nenhum produto encontrado</span>
          <span style="font-size: 0.85rem; color: var(--text-muted);">Tente refinar sua pesquisa com outros termos.</span>
        </div>
      `;
      lucide.createIcons();
    }
    return;
  }
  
  elements.sentinel.classList.remove('hidden');
  
  const fragment = document.createDocumentFragment();
  
  for (let i = start; i < end; i++) {
    const product = state.filteredList[i];
    const imageUrl = state.imageMap[product.code];
    
    const card = document.createElement('div');
    card.className = 'product-card';
    card.dataset.code = product.code;
    
    // Stock styling
    const stockVal = parseFloat(product.stock.replace('.', '').replace(',', '.'));
    const isOutOfStock = isNaN(stockVal) || stockVal <= 0;
    const stockClass = isOutOfStock ? 'out-stock' : 'in-stock';
    const stockText = isOutOfStock ? 'Sem Estoque' : `${product.stock} un`;
    
    let imageAreaHtml = '';
    if (imageUrl) {
      imageAreaHtml = `
        <div class="card-image-area" onclick="openImageViewer('${product.code}')">
          <img src="${imageUrl}" class="product-img" alt="${product.description}" loading="lazy">
          <div class="image-overlay-actions">
            <button class="overlay-action-btn edit-photo-btn" title="Substituir Foto" onclick="event.stopPropagation(); openUploadModal('${product.code}')">
              <i data-lucide="edit-3"></i>
            </button>
            <button class="overlay-action-btn delete-photo-btn" title="Excluir Foto" onclick="event.stopPropagation(); deleteSkuPhoto('${product.code}')">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </div>
      `;
    } else {
      imageAreaHtml = `
        <div class="card-image-area">
          <div class="image-placeholder">
            <i data-lucide="image-off"></i>
            <span>Nenhuma imagem cadastrada</span>
            <button class="upload-overlay-btn" onclick="openUploadModal('${product.code}')">
              <i data-lucide="plus-circle"></i>
              <span>Adicionar Foto</span>
            </button>
          </div>
        </div>
      `;
    }
    
    card.innerHTML = `
      <div class="card-header">
        <div class="sku-badge" onclick="copySkuToClipboard('${product.code}')" title="Clique para copiar SKU">
          <i data-lucide="copy"></i>
          <span>${product.code}</span>
        </div>
        <div class="card-metrics">
          <div class="metric-stock ${stockClass}">${stockText}</div>
          <div class="metric-price">${product.price}</div>
        </div>
      </div>
      ${imageAreaHtml}
      <div class="card-body">
        <h3 class="product-title" title="${product.description}">${product.description}</h3>
      </div>
    `;
    
    fragment.appendChild(card);
  }
  
  elements.productsGrid.appendChild(fragment);
  state.renderedCount = end;
  
  // Re-run Lucide to render newly appended card icons
  lucide.createIcons();
  
  // Hide sentinel if we've rendered all items
  if (state.renderedCount >= state.filteredList.length) {
    elements.sentinel.classList.add('hidden');
  }
}

// Initial skeletons before sync loads
function renderSkeletons() {
  elements.productsGrid.innerHTML = '';
  for (let i = 0; i < 12; i++) {
    const card = document.createElement('div');
    card.className = 'product-card skeleton-card';
    card.innerHTML = `
      <div class="card-header">
        <div class="skeleton-badge skeleton-anim"></div>
        <div class="card-metrics" style="align-items: flex-end; gap: 6px;">
          <div class="skeleton-text-sm skeleton-anim"></div>
          <div class="skeleton-text-md skeleton-anim"></div>
        </div>
      </div>
      <div class="card-image-area">
        <div class="skeleton-img skeleton-anim"></div>
      </div>
      <div class="card-body">
        <div class="skeleton-desc skeleton-anim"></div>
      </div>
    `;
    elements.productsGrid.appendChild(card);
  }
}

// Setup intersection observer for scrolling
function setupScrollObserver() {
  if (scrollObserver) scrollObserver.disconnect();
  
  scrollObserver = new IntersectionObserver((entries) => {
    const entry = entries[0];
    if (entry.isIntersecting && state.renderedCount < state.filteredList.length) {
      renderNextPage();
    }
  }, {
    rootMargin: '150px'
  });
  
  scrollObserver.observe(elements.sentinel);
}

/* ==========================================================================
   Firestore Actions
   ========================================================================== */

// Save mapping SKU -> Cloudinary image URL
async function saveSkuImage(code, imageUrl) {
  const url = `${FIRESTORE_BASE_URL}/${code}`;
  
  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          code: { stringValue: code },
          imageUrl: { stringValue: imageUrl },
          uploadedAt: { stringValue: new Date().toISOString() }
        }
      })
    });
    
    if (!response.ok) throw new Error(`Save failed: ${response.status}`);
    
    // Update local state and re-render
    state.imageMap[code] = imageUrl;
    showToast(`Foto salva com sucesso para o SKU ${code}!`, 'success');
    closeUploadModal();
    runSearch();
  } catch (error) {
    console.error('Error saving image to Firestore:', error);
    showToast('Falha ao salvar referência da foto no banco de dados.', 'error');
  }
}

// Delete SKU photo mapping
async function deleteSkuPhoto(code) {
  if (!confirm(`Deseja realmente remover a foto do SKU ${code}?`)) return;
  
  // Verify authorization password first
  if (state.settings.editPassword) {
    const password = prompt("Digite a senha de cadastro para excluir a foto:");
    if (password !== state.settings.editPassword) {
      showToast("Senha incorreta. Acesso negado.", "error");
      return;
    }
  }
  
  const url = `${FIRESTORE_BASE_URL}/${code}`;
  
  try {
    const response = await fetch(url, {
      method: 'DELETE'
    });
    
    if (!response.ok) throw new Error(`Delete failed: ${response.status}`);
    
    delete state.imageMap[code];
    showToast(`Foto do SKU ${code} removida com sucesso!`, 'success');
    runSearch();
  } catch (error) {
    console.error('Error deleting photo in Firestore:', error);
    showToast('Falha ao excluir foto no banco de dados.', 'error');
  }
}

/* ==========================================================================
   Cloudinary Direct Upload
   ========================================================================== */

function uploadToCloudinary(file, code) {
  const cloudName = state.settings.cloudName;
  const preset = state.settings.uploadPreset;
  
  if (!cloudName || !preset) {
    showToast('Configure o Cloud Name e o Upload Preset nas configurações.', 'error');
    elements.saveUploadBtn.disabled = false;
    return;
  }
  
  elements.progressContainer.classList.remove('hidden');
  elements.saveUploadBtn.disabled = true;
  elements.cancelUploadBtn.disabled = true;
  
  const url = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', preset);
  formData.append('public_id', `sku_${code}`); // Set friendly ID on Cloudinary
  
  const xhr = new XMLHttpRequest();
  xhr.open('POST', url, true);
  
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      const percent = Math.round((e.loaded / e.total) * 100);
      elements.progressBar.style.width = `${percent}%`;
      elements.progressText.textContent = `Enviando imagem (${percent}%)...`;
    }
  };
  
  xhr.onload = async () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        const responseData = JSON.parse(xhr.responseText);
        const imageUrl = responseData.secure_url;
        
        // Save the image URL in Firestore
        elements.progressText.textContent = 'Gravando dados de referência...';
        await saveSkuImage(code, imageUrl);
      } catch (err) {
        console.error('Error parsing upload response:', err);
        showToast('Erro ao processar resposta do envio.', 'error');
        resetUploadModalProgress();
      }
    } else {
      console.error('Cloudinary error response:', xhr.responseText);
      showToast('Falha no upload. Verifique as credenciais Cloudinary.', 'error');
      resetUploadModalProgress();
    }
  };
  
  xhr.onerror = () => {
    showToast('Erro de conexão ao enviar imagem.', 'error');
    resetUploadModalProgress();
  };
  
  xhr.send(formData);
}

function resetUploadModalProgress() {
  elements.progressContainer.classList.add('hidden');
  elements.progressBar.style.width = '0%';
  elements.progressText.textContent = 'Enviando imagem (0%)...';
  elements.saveUploadBtn.disabled = false;
  elements.cancelUploadBtn.disabled = false;
}

/* ==========================================================================
   Modals & Drawers Actions
   ========================================================================== */

// Settings Drawer
function openSettings() {
  elements.cloudinaryCloud.value = state.settings.cloudName;
  elements.cloudinaryPreset.value = state.settings.uploadPreset;
  elements.editPassword.value = state.settings.editPassword;
  elements.settingsDrawer.classList.add('active');
}

function closeSettingsDrawer() {
  elements.settingsDrawer.classList.remove('active');
}

function saveSettings() {
  state.settings.cloudName = elements.cloudinaryCloud.value.trim();
  state.settings.uploadPreset = elements.cloudinaryPreset.value.trim();
  state.settings.editPassword = elements.editPassword.value.trim();
  
  localStorage.setItem('centralux_settings', JSON.stringify(state.settings));
  showToast('Configurações salvas!', 'success');
  closeSettingsDrawer();
}

// Upload Modal
function openUploadModal(code) {
  // Check authorization password first if set
  if (state.settings.editPassword) {
    const password = prompt("Digite a senha de cadastro para prosseguir com o upload:");
    if (password !== state.settings.editPassword) {
      showToast("Senha incorreta. Acesso negado.", "error");
      return;
    }
  }
  
  const product = state.products.find(p => p.code === code);
  if (!product) return;
  
  state.selectedProduct = product;
  elements.modalSkuCode.textContent = product.code;
  elements.modalSkuDesc.textContent = product.description;
  
  const hasPhoto = !!state.imageMap[code];
  elements.modalTitle.textContent = hasPhoto ? 'Substituir Foto Reference' : 'Cadastrar Foto Reference';
  
  // Clean dropzone
  clearDropzone();
  
  elements.uploadModal.classList.add('active');
}

function closeUploadModal() {
  elements.uploadModal.classList.remove('active');
  state.selectedProduct = null;
}

function clearDropzone() {
  elements.fileInput.value = '';
  elements.dropzonePreview.classList.add('hidden');
  elements.previewImg.src = '';
  elements.saveUploadBtn.disabled = true;
  resetUploadModalProgress();
}

function handleFileSelect(file) {
  if (!file || !file.type.startsWith('image/')) {
    showToast('Arquivo inválido. Escolha uma imagem.', 'error');
    return;
  }
  
  const reader = new FileReader();
  reader.onload = (e) => {
    elements.previewImg.src = e.target.result;
    elements.dropzonePreview.classList.remove('hidden');
    elements.saveUploadBtn.disabled = false;
  };
  reader.readAsDataURL(file);
}

// Image Viewer Modal
function openImageViewer(code) {
  const imageUrl = state.imageMap[code];
  const product = state.products.find(p => p.code === code);
  if (!imageUrl || !product) return;
  
  elements.viewerImg.src = imageUrl;
  elements.viewerSkuCode.textContent = code;
  elements.viewerSkuDesc.textContent = product.description;
  elements.viewerModal.classList.add('active');
}

function closeImageViewer() {
  elements.viewerModal.classList.remove('active');
  elements.viewerImg.src = '';
}

/* ==========================================================================
   Utilities
   ========================================================================== */

// Copy text to clipboard
function copySkuToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast(`Código SKU ${text} copiado!`, 'success');
  }).catch(err => {
    console.error('Failed to copy text:', err);
  });
}

// Show feedback toasts
function showToast(message, type = 'success') {
  elements.toastMessage.textContent = message;
  elements.toast.className = `toast show ${type}`;
  
  const icon = type === 'success' ? 'check-circle' : (type === 'error' ? 'alert-triangle' : 'alert-circle');
  elements.toastIcon.setAttribute('data-lucide', icon);
  lucide.createIcons();
  
  setTimeout(() => {
    elements.toast.classList.remove('show');
  }, 3500);
}

// Toggle light/dark themes
function setupTheme() {
  const savedTheme = localStorage.getItem('centralux_theme') || 'dark';
  state.theme = savedTheme;
  
  if (savedTheme === 'light') {
    document.body.classList.add('light-theme');
    document.body.classList.remove('dark-theme');
  } else {
    document.body.classList.add('dark-theme');
    document.body.classList.remove('light-theme');
  }
}

function toggleTheme() {
  if (state.theme === 'dark') {
    state.theme = 'light';
    document.body.classList.add('light-theme');
    document.body.classList.remove('dark-theme');
  } else {
    state.theme = 'dark';
    document.body.classList.add('dark-theme');
    document.body.classList.remove('light-theme');
  }
  localStorage.setItem('centralux_theme', state.theme);
}

// Load configurations from localStorage
function loadLocalSettings() {
  const saved = localStorage.getItem('centralux_settings');
  if (saved) {
    try {
      state.settings = JSON.parse(saved);
    } catch (e) {
      console.error('Error parsing settings:', e);
    }
  }
}

// Debounce helper
function debounce(func, delay) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => func.apply(this, args), delay);
  };
}

/* ==========================================================================
   Event Listeners
   ========================================================================== */

function setupEventListeners() {
  // Theme Toggle
  elements.themeToggle.addEventListener('click', toggleTheme);
  
  // Settings Drawer Toggle
  elements.settingsToggle.addEventListener('click', openSettings);
  elements.closeSettings.addEventListener('click', closeSettingsDrawer);
  elements.settingsDrawer.addEventListener('click', (e) => {
    if (e.target === elements.settingsDrawer) closeSettingsDrawer();
  });
  elements.saveSettingsBtn.addEventListener('click', saveSettings);
  
  // Sync button
  elements.syncBtn.addEventListener('click', () => syncDatabase(true));
  
  // Search actions
  elements.searchInput.addEventListener('input', debounce((e) => {
    state.searchQuery = e.target.value;
    if (state.searchQuery) {
      elements.clearSearch.style.display = 'block';
    } else {
      elements.clearSearch.style.display = 'none';
    }
    runSearch();
  }, 300));
  
  elements.clearSearch.addEventListener('click', () => {
    elements.searchInput.value = '';
    state.searchQuery = '';
    elements.clearSearch.style.display = 'none';
    runSearch();
    elements.searchInput.focus();
  });
  
  // Filter Tabs
  elements.filterChips.forEach(chip => {
    chip.addEventListener('click', (e) => {
      elements.filterChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.activeFilter = chip.dataset.filter;
      runSearch();
    });
  });
  
  // Modal Upload Triggers
  elements.closeUpload.addEventListener('click', closeUploadModal);
  elements.cancelUploadBtn.addEventListener('click', closeUploadModal);
  elements.uploadModal.addEventListener('click', (e) => {
    if (e.target === elements.uploadModal) closeUploadModal();
  });
  
  // File Dropzone interaction
  elements.dropzone.addEventListener('click', () => elements.fileInput.click());
  elements.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileSelect(e.target.files[0]);
    }
  });
  
  elements.dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    elements.dropzone.classList.add('dragover');
  });
  
  elements.dropzone.addEventListener('dragleave', () => {
    elements.dropzone.classList.remove('dragover');
  });
  
  elements.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    elements.dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  });
  
  elements.removePreviewBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearDropzone();
  });
  
  elements.saveUploadBtn.addEventListener('click', () => {
    const file = elements.fileInput.files[0];
    if (file && state.selectedProduct) {
      uploadToCloudinary(file, state.selectedProduct.code);
    }
  });
  
  // Viewer Modal Trigger
  elements.closeViewer.addEventListener('click', closeImageViewer);
  elements.viewerModal.addEventListener('click', (e) => {
    if (e.target === elements.viewerModal) closeImageViewer();
  });
  
  // Global Esc Key modal closures
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSettingsDrawer();
      closeUploadModal();
      closeImageViewer();
    }
  });
}

/* ==========================================================================
   Initialization
   ========================================================================== */

document.addEventListener('DOMContentLoaded', async () => {
  setupTheme();
  loadLocalSettings();
  setupEventListeners();
  
  // Show skeletons loading state
  renderSkeletons();
  
  // Initial sync database loader
  await syncDatabase();
  
  // Setup infinite scroll observer
  setupScrollObserver();
});
