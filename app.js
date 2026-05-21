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
    cloudinaryUrl: 'cloudinary://336228551194777:BSnZaaXs7w2MhVCHdFqi236fbW8@di2q3lieh',
    cloudName: 'di2q3lieh',
    apiKey: '336228551194777',
    apiSecret: 'BSnZaaXs7w2MhVCHdFqi236fbW8',
    uploadPreset: 'ml_default',
    editPassword: ''
  },
  
  // Selected product for upload
  selectedProduct: null,
  isRegistrationMode: false,
  selectedFile: null,
  
  // Zoom view state
  viewerCode: null,
  viewerIndex: 0
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
  cloudinaryUrl: document.getElementById('cloudinary-url'),
  cloudinaryCloud: document.getElementById('cloudinary-cloud'),
  cloudinaryKey: document.getElementById('cloudinary-key'),
  cloudinarySecret: document.getElementById('cloudinary-secret'),
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
  toastMessage: document.getElementById('toast-message'),

  addProductBtn: document.getElementById('add-product-btn'),
  modalSkuSearchContainer: document.getElementById('modal-sku-search-container'),
  modalSkuSearchInput: document.getElementById('modal-sku-search-input'),
  modalSkuSearchStatus: document.getElementById('modal-sku-search-status'),
  modalSkuDetailHeader: document.getElementById('modal-sku-detail-header'),
  modalPhotoUploaderContainer: document.getElementById('modal-photo-uploader-container'),
  cameraCaptureBtn: document.getElementById('camera-capture-btn'),
  cameraInput: document.getElementById('camera-input')
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
          let urls = [];
          if (fields.imageUrls && fields.imageUrls.arrayValue && fields.imageUrls.arrayValue.values) {
            urls = fields.imageUrls.arrayValue.values.map(v => v.stringValue).filter(Boolean);
          } else if (fields.imageUrl && fields.imageUrl.stringValue) {
            urls = [fields.imageUrl.stringValue];
          }
          if (urls.length > 0) {
            map[code] = urls;
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
  
  // Build the list of registered products to display
  const registeredProducts = [];
  const registeredCodes = Object.keys(state.imageMap);
  
  for (const code of registeredCodes) {
    const sheetProduct = state.products.find(p => p.code.trim().toLowerCase() === code.trim().toLowerCase());
    registeredProducts.push({
      code: code,
      description: sheetProduct ? sheetProduct.description : 'Descrição não encontrada no Google Sheets',
      stock: sheetProduct ? sheetProduct.stock : '0',
      price: sheetProduct ? sheetProduct.price : 'R$ 0,00'
    });
  }
  
  // Filter registered products based on search query
  state.filteredList = registeredProducts.filter(product => {
    if (!query) return true;
    
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
  
  if (query) {
    elements.statsCount.textContent = `Encontrados: ${totalCount} de ${registeredProducts.length} produtos cadastrados`;
  } else {
    elements.statsCount.textContent = `Total: ${registeredProducts.length} produtos cadastrados`;
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
          <span style="font-size: 1rem; color: var(--text-secondary);">Nenhum produto cadastrado</span>
          <span style="font-size: 0.85rem; color: var(--text-muted);">Clique no botão "Cadastrar Produto" acima para começar a cadastrar.</span>
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
    const images = state.imageMap[product.code] || [];
    
    const card = document.createElement('div');
    card.className = 'product-card';
    card.dataset.code = product.code;
    
    let imageAreaHtml = '';
    if (images.length > 0) {
      const imagesHtml = images.map((url, idx) => `
        <img src="${getOptimizedImageUrl(url, 400)}" class="product-img ${idx === 0 ? 'active' : ''}" alt="${product.description}" data-index="${idx}" loading="lazy">
      `).join('');
      
      let navButtonsHtml = '';
      let dotsHtml = '';
      let counterHtml = '';
      
      if (images.length > 1) {
        navButtonsHtml = `
          <button class="carousel-nav-btn prev-btn" title="Foto Anterior" onclick="event.stopPropagation(); navigateCarousel('${product.code}', -1)">
            <i data-lucide="chevron-left"></i>
          </button>
          <button class="carousel-nav-btn next-btn" title="Próxima Foto" onclick="event.stopPropagation(); navigateCarousel('${product.code}', 1)">
            <i data-lucide="chevron-right"></i>
          </button>
        `;
        
        dotsHtml = `
          <div class="carousel-dots">
            ${images.map((_, idx) => `
              <span class="carousel-dot ${idx === 0 ? 'active' : ''}" data-index="${idx}" onclick="event.stopPropagation(); setCarouselIndex('${product.code}', ${idx})"></span>
            `).join('')}
          </div>
        `;
        
        counterHtml = `
          <div class="carousel-counter">
            <i data-lucide="layers" class="counter-icon" style="width: 12px; height: 12px; margin-right: 4px;"></i>
            <span>1 / ${images.length}</span>
          </div>
        `;
      }
      
      imageAreaHtml = `
        <div class="card-image-area" onclick="openImageViewer('${product.code}')">
          <div class="carousel-container">
            <div class="carousel-slides">
              ${imagesHtml}
            </div>
            ${navButtonsHtml}
            ${counterHtml}
            ${dotsHtml}
            
            <div class="image-overlay-actions">
              <button class="overlay-action-btn edit-photo-btn" title="Gerenciar Fotos" onclick="event.stopPropagation(); openUploadModal('${product.code}')">
                <i data-lucide="edit-3"></i>
              </button>
              <button class="overlay-action-btn delete-photo-btn" title="Excluir Produto" onclick="event.stopPropagation(); deleteSkuPhoto('${product.code}')">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
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

// Navigation of card carousels
window.navigateCarousel = function(code, direction) {
  const container = document.querySelector(`.product-card[data-code="${code}"]`);
  if (!container) return;
  
  const images = state.imageMap[code] || [];
  if (images.length <= 1) return;
  
  const activeImg = container.querySelector('.product-img.active');
  if (!activeImg) return;
  
  let currentIndex = parseInt(activeImg.dataset.index, 10);
  let nextIndex = currentIndex + direction;
  
  if (nextIndex < 0) {
    nextIndex = images.length - 1;
  } else if (nextIndex >= images.length) {
    nextIndex = 0;
  }
  
  window.setCarouselIndex(code, nextIndex);
}

window.setCarouselIndex = function(code, index) {
  const container = document.querySelector(`.product-card[data-code="${code}"]`);
  if (!container) return;
  
  const images = state.imageMap[code] || [];
  if (index < 0 || index >= images.length) return;
  
  // Update images active class
  const imgs = container.querySelectorAll('.product-img');
  imgs.forEach((img, idx) => {
    if (idx === index) {
      img.classList.add('active');
    } else {
      img.classList.remove('active');
    }
  });
  
  // Update dots active class
  const dots = container.querySelectorAll('.carousel-dot');
  dots.forEach((dot, idx) => {
    if (idx === index) {
      dot.classList.add('active');
    } else {
      dot.classList.remove('active');
    }
  });
  
  // Update counter text
  const counter = container.querySelector('.carousel-counter span');
  if (counter) {
    counter.textContent = `${index + 1} / ${images.length}`;
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

// Save mapping SKU -> Array of Cloudinary image URLs
async function saveSkuImages(code, imageUrls) {
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
          imageUrls: {
            arrayValue: {
              values: imageUrls.map(imgUrl => ({ stringValue: imgUrl }))
            }
          },
          uploadedAt: { stringValue: new Date().toISOString() }
        }
      })
    });
    
    if (!response.ok) throw new Error(`Save failed: ${response.status}`);
    
    // Update local state
    state.imageMap[code] = imageUrls;
  } catch (error) {
    console.error('Error saving image to Firestore:', error);
    throw error;
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

function parseCloudinaryUrl(urlStr) {
  if (!urlStr) return null;
  let cleanUrl = urlStr.trim();
  
  // Strip "CLOUDINARY_URL=" prefix if present
  cleanUrl = cleanUrl.replace(/^(export\s+)?CLOUDINARY_URL\s*=\s*/i, '');
  
  // Format: cloudinary://api_key:api_secret@cloud_name
  const regex = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/;
  const match = cleanUrl.match(regex);
  if (match) {
    return {
      apiKey: match[1],
      apiSecret: match[2],
      cloudName: match[3]
    };
  }
  return null;
}

async function generateSignature(params, apiSecret) {
  const sortedKeys = Object.keys(params).sort();
  const pairs = [];
  for (const key of sortedKeys) {
    pairs.push(`${key}=${params[key]}`);
  }
  const stringToSign = pairs.join('&') + apiSecret;
  
  const utf8 = new TextEncoder().encode(stringToSign);
  const hashBuffer = await crypto.subtle.digest('SHA-1', utf8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

async function uploadToCloudinary(file, code) {
  const cloudName = state.settings.cloudName;
  const apiKey = state.settings.apiKey;
  const apiSecret = state.settings.apiSecret;
  const preset = state.settings.uploadPreset;
  
  if (!cloudName) {
    showToast('Configure o Cloud Name nas configurações.', 'error');
    elements.saveUploadBtn.disabled = false;
    return;
  }
  
  const isSigned = !!(apiKey && apiSecret);
  if (!isSigned && !preset) {
    showToast('Configure o Upload Preset (para envio não assinado) ou API Key/Secret nas configurações.', 'error');
    elements.saveUploadBtn.disabled = false;
    return;
  }
  
  elements.progressContainer.classList.remove('hidden');
  elements.saveUploadBtn.disabled = true;
  elements.cancelUploadBtn.disabled = true;
  
  const url = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
  const formData = new FormData();
  formData.append('file', file);
  
  // Use unique timestamp to allow multiple images per SKU
  const publicId = `sku_${code}_${Date.now()}`;
  
  if (isSigned) {
    const timestamp = Math.round(new Date().getTime() / 1000);
    const params = {
      public_id: publicId,
      timestamp: timestamp
    };
    
    try {
      const signature = await generateSignature(params, apiSecret);
      formData.append('api_key', apiKey);
      formData.append('timestamp', timestamp);
      formData.append('public_id', publicId);
      formData.append('signature', signature);
    } catch (err) {
      console.error('Error generating signature:', err);
      showToast('Erro ao gerar assinatura de upload.', 'error');
      resetUploadModalProgress();
      return;
    }
  } else {
    // Unsigned upload
    formData.append('upload_preset', preset);
    formData.append('public_id', publicId);
  }
  
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
        
        const currentImages = state.imageMap[code] || [];
        const updatedImages = [...currentImages, imageUrl];
        
        await saveSkuImages(code, updatedImages);
        showToast('Foto salva com sucesso!', 'success');
        
        // If it was registration mode, switch to edit mode to allow managing/adding more photos
        if (state.isRegistrationMode) {
          state.isRegistrationMode = false;
          elements.modalSkuSearchContainer.classList.add('hidden');
          elements.modalSkuDetailHeader.classList.remove('hidden');
          elements.modalPhotoUploaderContainer.classList.remove('hidden');
          elements.modalTitle.textContent = 'Gerenciar Fotos Reference';
        }
        
        // Rerender gallery in modal
        renderModalExistingPhotos(code);
        
        // Clear preview area for next upload
        clearDropzone();
        
        // Reload list in background
        runSearch();
      } catch (err) {
        console.error('Error parsing upload response:', err);
        showToast('Erro ao processar resposta do envio.', 'error');
        resetUploadModalProgress();
      }
    } else {
      console.error('Cloudinary error response:', xhr.responseText);
      let errMsg = 'Falha no upload.';
      try {
        const errJson = JSON.parse(xhr.responseText);
        if (errJson.error && errJson.error.message) {
          errMsg += ` Detalhes: ${errJson.error.message}`;
        }
      } catch (e) {}
      showToast(errMsg, 'error');
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
  elements.cloudinaryUrl.value = state.settings.cloudinaryUrl || '';
  elements.cloudinaryCloud.value = state.settings.cloudName || '';
  elements.cloudinaryKey.value = state.settings.apiKey || '';
  elements.cloudinarySecret.value = state.settings.apiSecret || '';
  elements.cloudinaryPreset.value = state.settings.uploadPreset || '';
  elements.editPassword.value = state.settings.editPassword || '';
  elements.settingsDrawer.classList.add('active');
}

function closeSettingsDrawer() {
  elements.settingsDrawer.classList.remove('active');
}

function saveSettings() {
  state.settings.cloudinaryUrl = elements.cloudinaryUrl.value.trim();
  state.settings.cloudName = elements.cloudinaryCloud.value.trim();
  state.settings.apiKey = elements.cloudinaryKey.value.trim();
  state.settings.apiSecret = elements.cloudinarySecret.value.trim();
  state.settings.uploadPreset = elements.cloudinaryPreset.value.trim();
  state.settings.editPassword = elements.editPassword.value.trim();
  
  localStorage.setItem('centralux_settings', JSON.stringify(state.settings));
  showToast('Configurações salvas!', 'success');
  closeSettingsDrawer();
}

// Upload Modal
function openUploadModal(code = null) {
  // Check authorization password first if set
  if (state.settings.editPassword) {
    const password = prompt("Digite a senha de cadastro para prosseguir:");
    if (password !== state.settings.editPassword) {
      showToast("Senha incorreta. Acesso negado.", "error");
      return;
    }
  }
  
  // Clean dropzone and search inputs
  clearDropzone();
  elements.modalSkuSearchInput.value = '';
  elements.modalSkuSearchStatus.textContent = '';
  elements.modalSkuSearchStatus.className = 'field-note';
  
  if (code) {
    // Edit mode (for existing registered SKU)
    state.isRegistrationMode = false;
    
    // Find the product
    let product = state.products.find(p => p.code.trim().toLowerCase() === code.trim().toLowerCase());
    if (!product) {
      // If not in sheets, build a temporary product object
      product = {
        code: code,
        description: 'Descrição não encontrada no Google Sheets'
      };
    }
    
    state.selectedProduct = product;
    elements.modalSkuCode.textContent = product.code;
    elements.modalSkuDesc.textContent = product.description;
    
    elements.modalTitle.textContent = 'Gerenciar Fotos Reference';
    
    // Hide search field, show details and dropzone
    elements.modalSkuSearchContainer.classList.add('hidden');
    elements.modalSkuDetailHeader.classList.remove('hidden');
    elements.modalPhotoUploaderContainer.classList.remove('hidden');
    
    // Render existing photos
    renderModalExistingPhotos(code);
  } else {
    // Registration mode
    state.isRegistrationMode = true;
    state.selectedProduct = null;
    elements.modalTitle.textContent = 'Cadastrar Novo Produto';
    
    // Show search field, hide details and dropzone
    elements.modalSkuSearchContainer.classList.remove('hidden');
    elements.modalSkuDetailHeader.classList.add('hidden');
    elements.modalPhotoUploaderContainer.classList.add('hidden');
    
    // Hide existing photos grid
    const section = document.getElementById('modal-existing-photos-section');
    if (section) section.classList.add('hidden');
  }
  
  elements.uploadModal.classList.add('active');
}

function closeUploadModal() {
  elements.uploadModal.classList.remove('active');
  state.selectedProduct = null;
  state.isRegistrationMode = false;
}

function clearDropzone() {
  elements.fileInput.value = '';
  if (elements.cameraInput) elements.cameraInput.value = '';
  state.selectedFile = null;
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
  
  state.selectedFile = file;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    elements.previewImg.src = e.target.result;
    elements.dropzonePreview.classList.remove('hidden');
    elements.saveUploadBtn.disabled = false;
  };
  reader.readAsDataURL(file);
}

// Render list of existing photos inside upload modal
function renderModalExistingPhotos(code) {
  const images = state.imageMap[code] || [];
  const section = document.getElementById('modal-existing-photos-section');
  const grid = document.getElementById('modal-existing-photos-grid');
  
  if (!section || !grid) return;
  
  if (images.length === 0) {
    section.classList.add('hidden');
    grid.innerHTML = '';
    return;
  }
  
  section.classList.remove('hidden');
  grid.innerHTML = images.map((url, idx) => `
    <div class="existing-photo-thumb" data-index="${idx}">
      <img src="${getOptimizedImageUrl(url, 150)}" alt="Miniatura ${idx + 1}" loading="lazy">
      <button type="button" class="delete-thumb-btn" title="Excluir Foto" onclick="event.stopPropagation(); deleteSpecificPhoto('${code}', ${idx})">
        <i data-lucide="trash-2"></i>
      </button>
    </div>
  `).join('');
  
  // Recreate Lucide icons inside the grid
  lucide.createIcons();
}

// Delete a specific photo of an SKU by index
window.deleteSpecificPhoto = async function(code, index) {
  const images = state.imageMap[code] || [];
  if (index < 0 || index >= images.length) return;
  
  if (!confirm(`Deseja realmente excluir esta foto do SKU ${code}?`)) return;
  
  // Verify authorization password first
  if (state.settings.editPassword) {
    const password = prompt("Digite a senha de cadastro para excluir a foto:");
    if (password !== state.settings.editPassword) {
      showToast("Senha incorreta. Acesso negado.", "error");
      return;
    }
  }
  
  const updatedImages = [...images];
  updatedImages.splice(index, 1);
  
  try {
    if (updatedImages.length === 0) {
      // If no images left, delete the SKU document entirely from Firestore
      const url = `${FIRESTORE_BASE_URL}/${code}`;
      const response = await fetch(url, { method: 'DELETE' });
      if (!response.ok) throw new Error(`Delete failed: ${response.status}`);
      delete state.imageMap[code];
      showToast(`SKU ${code} removido pois não possui mais fotos.`, 'success');
      closeUploadModal();
    } else {
      // Otherwise update document in Firestore with remaining images
      await saveSkuImages(code, updatedImages);
      showToast(`Foto removida com sucesso!`, 'success');
      renderModalExistingPhotos(code);
    }
    
    // Rerender main list
    runSearch();
  } catch (error) {
    console.error('Error deleting specific photo:', error);
    showToast('Falha ao excluir foto no banco de dados.', 'error');
  }
};

// Image Viewer Modal
function openImageViewer(code) {
  const images = state.imageMap[code] || [];
  const product = state.products.find(p => p.code === code);
  if (images.length === 0 || !product) return;
  
  // Find current carousel index from the product card
  let activeIndex = 0;
  const container = document.querySelector(`.product-card[data-code="${code}"]`);
  if (container) {
    const activeImg = container.querySelector('.product-img.active');
    if (activeImg) {
      activeIndex = parseInt(activeImg.dataset.index, 10) || 0;
    }
  }
  
  state.viewerCode = code;
  state.viewerIndex = activeIndex;
  
  updateViewerImage();
  elements.viewerModal.classList.add('active');
}

function closeImageViewer() {
  elements.viewerModal.classList.remove('active');
  elements.viewerImg.src = '';
  state.viewerCode = null;
  state.viewerIndex = 0;
}

function updateViewerImage() {
  const code = state.viewerCode;
  const index = state.viewerIndex;
  const images = state.imageMap[code] || [];
  const product = state.products.find(p => p.code === code);
  if (!product || images.length === 0) return;
  
  const currentUrl = images[index];
  // Optimize fullscreen viewer image to w_1200 as requested
  elements.viewerImg.src = getOptimizedImageUrl(currentUrl, 1200);
  
  elements.viewerSkuCode.textContent = code;
  elements.viewerSkuDesc.textContent = product.description;
  
  const prevBtn = document.getElementById('viewer-prev-btn');
  const nextBtn = document.getElementById('viewer-next-btn');
  const counter = document.getElementById('viewer-counter');
  
  if (images.length > 1) {
    if (prevBtn) prevBtn.classList.remove('hidden');
    if (nextBtn) nextBtn.classList.remove('hidden');
    if (counter) {
      counter.classList.remove('hidden');
      counter.textContent = `${index + 1} / ${images.length}`;
    }
  } else {
    if (prevBtn) prevBtn.classList.add('hidden');
    if (nextBtn) nextBtn.classList.add('hidden');
    if (counter) counter.classList.add('hidden');
  }
}

window.navigateViewer = function(direction) {
  const code = state.viewerCode;
  const images = state.imageMap[code] || [];
  if (images.length <= 1) return;
  
  let nextIndex = state.viewerIndex + direction;
  if (nextIndex < 0) {
    nextIndex = images.length - 1;
  } else if (nextIndex >= images.length) {
    nextIndex = 0;
  }
  
  state.viewerIndex = nextIndex;
  updateViewerImage();
};

/* ==========================================================================
   Utilities
   ========================================================================== */

// Get optimized Cloudinary URL for faster loading
function getOptimizedImageUrl(url, width = 400) {
  if (!url || !url.includes('cloudinary.com')) return url;
  return url.replace('/image/upload/', `/image/upload/w_${width},c_limit,q_auto,f_auto/`);
}

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
      const parsed = JSON.parse(saved);
      // Clean up placeholder or empty credentials to allow new defaults to be used
      if (!parsed.cloudinaryUrl || parsed.cloudinaryUrl.includes('<your_')) {
        delete parsed.cloudinaryUrl;
      }
      if (!parsed.apiKey || parsed.apiKey.includes('<your_')) {
        delete parsed.apiKey;
      }
      if (!parsed.apiSecret || parsed.apiSecret.includes('<your_')) {
        delete parsed.apiSecret;
      }
      state.settings = { ...state.settings, ...parsed };
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
  
  elements.cloudinaryUrl.addEventListener('input', () => {
    const urlVal = elements.cloudinaryUrl.value.trim();
    const parsed = parseCloudinaryUrl(urlVal);
    if (parsed) {
      elements.cloudinaryCloud.value = parsed.cloudName;
      elements.cloudinaryKey.value = parsed.apiKey;
      elements.cloudinarySecret.value = parsed.apiSecret;
      showToast('Configurações extraídas da URL com sucesso!', 'success');
    }
  });
  
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

  // Add Product button in Header
  elements.addProductBtn.addEventListener('click', () => openUploadModal());

  // Modal SKU Search Input handler
  elements.modalSkuSearchInput.addEventListener('input', () => {
    const code = elements.modalSkuSearchInput.value.trim();
    if (!code) {
      elements.modalSkuSearchStatus.textContent = '';
      elements.modalSkuSearchStatus.className = 'field-note';
      elements.modalSkuDetailHeader.classList.add('hidden');
      elements.modalPhotoUploaderContainer.classList.add('hidden');
      state.selectedProduct = null;
      elements.saveUploadBtn.disabled = true;
      return;
    }
    
    const foundProduct = state.products.find(p => p.code.trim().toLowerCase() === code.toLowerCase());
    if (foundProduct) {
      state.selectedProduct = foundProduct;
      elements.modalSkuCode.textContent = foundProduct.code;
      elements.modalSkuDesc.textContent = foundProduct.description;
      
      const isAlreadyRegistered = !!state.imageMap[foundProduct.code];
      if (isAlreadyRegistered) {
        elements.modalSkuSearchStatus.textContent = 'SKU encontrado! (Já possui foto cadastrada, o envio irá substituí-la)';
        elements.modalSkuSearchStatus.className = 'field-note success';
      } else {
        elements.modalSkuSearchStatus.textContent = 'SKU encontrado!';
        elements.modalSkuSearchStatus.className = 'field-note success';
      }
      
      elements.modalSkuDetailHeader.classList.remove('hidden');
      elements.modalPhotoUploaderContainer.classList.remove('hidden');
      
      // Enable save button if a preview file is already loaded
      elements.saveUploadBtn.disabled = !state.selectedFile;
    } else {
      state.selectedProduct = null;
      elements.modalSkuSearchStatus.textContent = 'SKU não encontrado na planilha.';
      elements.modalSkuSearchStatus.className = 'field-note error';
      elements.modalSkuDetailHeader.classList.add('hidden');
      elements.modalPhotoUploaderContainer.classList.add('hidden');
      elements.saveUploadBtn.disabled = true;
    }
  });
  
  // File Dropzone interaction
  elements.dropzone.addEventListener('click', () => elements.fileInput.click());
  elements.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileSelect(e.target.files[0]);
    }
  });
  
  // Camera capture button interaction
  elements.cameraCaptureBtn.addEventListener('click', () => elements.cameraInput.click());
  elements.cameraInput.addEventListener('change', (e) => {
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
    const file = state.selectedFile;
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
