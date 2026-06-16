// 可配置的 API 地址：优先从 localStorage 读取，否则使用默认
const DEFAULT_API_BASE = 'https://boots-suffix-striving.ngrok-free.dev'; // 请替换为您的当前 ngrok 域名
let API_BASE = localStorage.getItem('apiBase') || DEFAULT_API_BASE;

// 提供手动更新 API_BASE 的函数（可在控制台调用）
window.updateApiBase = function(newUrl) {
    API_BASE = newUrl;
    localStorage.setItem('apiBase', newUrl);
    console.log('API_BASE 已更新为:', API_BASE);
    // 重新加载素材
    if (employeeToken) loadMaterials();
};

let employeeToken = null;
let currentEmployee = { id: null, username: '', nickname: '' };
let allMaterials = [];
let currentFilterCategory = 'all';
let currentSearchKeyword = '';
let activePreviewBlobUrl = null;
let activeMediaElement = null;
let thumbUrlMap = new Map();
let favoritesSet = new Set();

// ========== 工具函数 ==========
function escapeHtml(str) { if (!str) return ''; return str.replace(/[&<>]/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[m])); }
function formatSize(bytes) { if (!bytes) return '0 B'; if (bytes < 1024) return bytes + ' B'; if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'; return (bytes / (1048576)).toFixed(2) + ' MB'; }

async function apiCall(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
    const headers = { 'ngrok-skip-browser-warning': 'true', ...(options.headers || {}) };
    if (employeeToken) headers['Authorization'] = `Bearer ${employeeToken}`;
    if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    return fetch(url, { ...options, headers, mode: 'cors' });
}

// ========== 收藏 API ==========
async function loadFavorites() {
    try {
        const res = await apiCall('/api/favorites', { method: 'GET' });
        if (!res.ok) throw new Error();
        const data = await res.json();
        favoritesSet = new Set(data.map(item => item.id));
        return data;
    } catch (e) {
        favoritesSet = new Set();
        return [];
    }
}

async function toggleFavorite(materialId) {
    const isFav = favoritesSet.has(materialId);
    let res;
    if (isFav) {
        res = await apiCall(`/api/favorites/${materialId}`, { method: 'DELETE' });
        if (res.ok) {
            favoritesSet.delete(materialId);
            updatePreviewFavButton(materialId, false);
            return true;
        }
    } else {
        res = await apiCall('/api/favorites', {
            method: 'POST',
            body: JSON.stringify({ material_id: materialId })
        });
        if (res.ok) {
            favoritesSet.add(materialId);
            updatePreviewFavButton(materialId, true);
            return true;
        }
    }
    return false;
}

function updatePreviewFavButton(materialId, isFav) {
    const btn = document.getElementById('previewFavBtn');
    if (btn) {
        btn.classList.toggle('fav-active', isFav);
        btn.innerHTML = isFav ? '<i class="fas fa-heart"></i>' : '<i class="far fa-heart"></i>';
        btn.dataset.fav = isFav ? 'true' : 'false';
    }
}

// ========== 预览弹窗相关 ==========
function createPreviewModal() {
    if (document.getElementById('previewModalOverlay')) return;
    const modalHTML = `
        <div id="previewModalOverlay" class="preview-modal-overlay">
            <div class="preview-modal-box">
                <div class="preview-header">
                    <h3 id="previewTitle">素材预览</h3>
                    <button class="preview-close" id="previewCloseBtn">&times;</button>
                </div>
                <div class="preview-body" id="previewBody">
                    <div class="preview-content"></div>
                </div>
                <div class="preview-footer">
                    <button class="action-btn" id="previewFavBtn"><i class="far fa-heart"></i></button>
                    <button class="action-btn download-btn" id="previewDownloadBtn"><i class="fas fa-download"></i></button>
                    <button class="action-btn comment-btn" id="previewCommentBtn"><i class="fas fa-comment"></i></button>
                    <button class="action-btn share-btn" id="previewShareBtn"><i class="fas fa-share-alt"></i></button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    document.getElementById('previewCloseBtn').addEventListener('click', closePreviewAndStopMedia);
    document.getElementById('previewModalOverlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closePreviewAndStopMedia();
    });
}

function closePreviewAndStopMedia() {
    if (activeMediaElement) {
        activeMediaElement.pause();
        activeMediaElement = null;
    }
    const overlay = document.getElementById('previewModalOverlay');
    if (overlay) overlay.classList.remove('active');
    if (activePreviewBlobUrl) {
        URL.revokeObjectURL(activePreviewBlobUrl);
        activePreviewBlobUrl = null;
    }
}

async function openPreview(material) {
    createPreviewModal();
    const overlay = document.getElementById('previewModalOverlay');
    const previewBody = document.getElementById('previewBody');
    const previewTitle = document.getElementById('previewTitle');
    if (!overlay || !previewBody) return;

    if (activeMediaElement) { activeMediaElement.pause(); activeMediaElement = null; }
    if (activePreviewBlobUrl) { URL.revokeObjectURL(activePreviewBlobUrl); activePreviewBlobUrl = null; }

    previewTitle.innerText = material.original_name || '素材预览';

    // 刷新底部按钮状态并绑定事件
    const favBtn = document.getElementById('previewFavBtn');
    const downloadBtn = document.getElementById('previewDownloadBtn');
    const commentBtn = document.getElementById('previewCommentBtn');
    const shareBtn = document.getElementById('previewShareBtn');

    if (favBtn) {
        const isFav = favoritesSet.has(material.id);
        favBtn.classList.toggle('fav-active', isFav);
        favBtn.innerHTML = isFav ? '<i class="fas fa-heart"></i>' : '<i class="far fa-heart"></i>';
        favBtn.dataset.id = material.id;
        favBtn.dataset.fav = isFav ? 'true' : 'false';
        const newFavBtn = favBtn.cloneNode(true);
        favBtn.parentNode.replaceChild(newFavBtn, favBtn);
        newFavBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseInt(newFavBtn.dataset.id);
            toggleFavorite(id);
        });
    }

    if (downloadBtn) {
        const newDownload = downloadBtn.cloneNode(true);
        downloadBtn.parentNode.replaceChild(newDownload, downloadBtn);
        newDownload.addEventListener('click', (e) => {
            e.stopPropagation();
            downloadMaterial(material.id);
        });
    }

    if (commentBtn) {
        const newComment = commentBtn.cloneNode(true);
        commentBtn.parentNode.replaceChild(newComment, commentBtn);
        newComment.addEventListener('click', (e) => {
            e.stopPropagation();
            alert('评论功能即将上线，敬请期待！');
        });
    }

    if (shareBtn) {
        const newShare = shareBtn.cloneNode(true);
        shareBtn.parentNode.replaceChild(newShare, shareBtn);
        newShare.addEventListener('click', (e) => {
            e.stopPropagation();
            alert('分享功能即将上线，敬请期待！');
        });
    }

    const previewContentDiv = document.querySelector('#previewModalOverlay .preview-content');
    if (previewContentDiv) {
        previewContentDiv.innerHTML = `<div class="preview-loading"><i class="fas fa-spinner fa-pulse fa-2x"></i><p>加载文件中...</p></div>`;
    }
    overlay.classList.add('active');

    try {
        const blob = await fetchMaterialBlob(material.id);
        const mime = material.mime_type || blob.type;
        if (!isPreviewSupported(mime, material.original_name)) {
            if (previewContentDiv) {
                previewContentDiv.innerHTML = `
                    <div class="preview-unsupported">
                        <i class="fas fa-file-archive"></i>
                        <h4>不支持在线预览</h4>
                        <p>请下载后查看</p>
                        <button class="preview-download-btn" style="margin-top:16px; background:#3b82f6;" id="previewFallbackDownload"><i class="fas fa-download"></i> 下载文件</button>
                    </div>`;
                const fallbackBtn = document.getElementById('previewFallbackDownload');
                if (fallbackBtn) fallbackBtn.onclick = () => downloadMaterial(material.id);
            }
            return;
        }
        const blobUrl = URL.createObjectURL(blob);
        activePreviewBlobUrl = blobUrl;
        let contentHtml = '';
        if (mime.startsWith('image/')) {
            contentHtml = `<img src="${blobUrl}" alt="预览" class="preview-media-element">`;
        } else if (mime.startsWith('video/')) {
            contentHtml = `<video controls autoplay id="previewVideo" class="preview-media-element"><source src="${blobUrl}" type="${mime}"></video>`;
        } else if (mime.startsWith('audio/')) {
            contentHtml = `<audio controls autoplay id="previewAudio" class="preview-audio-element"><source src="${blobUrl}" type="${mime}"></audio>`;
        } else if (mime === 'application/pdf') {
            contentHtml = `<embed src="${blobUrl}" type="application/pdf">`;
        } else if (mime.startsWith('text/')) {
            const text = await blob.text();
            contentHtml = `<pre class="preview-text">${escapeHtml(text)}</pre>`;
        } else {
            contentHtml = `<div class="preview-unsupported">无法预览此格式</div>`;
        }
        if (previewContentDiv) previewContentDiv.innerHTML = contentHtml;
        const videoElem = document.getElementById('previewVideo');
        const audioElem = document.getElementById('previewAudio');
        if (videoElem) activeMediaElement = videoElem;
        else if (audioElem) activeMediaElement = audioElem;
    } catch (err) {
        console.error('预览加载失败:', err);
        if (previewContentDiv) previewContentDiv.innerHTML = `<div class="preview-unsupported">预览失败: ${err.message}</div>`;
    }
}

function isPreviewSupported(mimeType, fileName = '') {
    if (!mimeType) return false;
    const ext = fileName.split('.').pop().toLowerCase();
    const officeDocs = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar', '7z', 'gz', 'tar'];
    if (officeDocs.includes(ext)) return false;
    if (mimeType.startsWith('image/')) return true;
    if (mimeType.startsWith('video/')) return true;
    if (mimeType.startsWith('audio/')) return true;
    if (mimeType === 'application/pdf') return true;
    if (mimeType.startsWith('text/')) return true;
    return false;
}

async function fetchMaterialBlob(materialId) {
    const res = await apiCall(`/api/materials/${materialId}/download`, { method: 'GET' });
    if (!res.ok) {
        const text = await res.text();
        console.error('下载失败:', res.status, text);
        throw new Error(`下载失败 (${res.status}): ${text}`);
    }
    return await res.blob();
}

async function downloadMaterial(id) {
    try {
        const res = await apiCall(`/api/materials/${id}/download`);
        if (!res.ok) throw new Error();
        const blob = await res.blob();
        let filename = `material_${id}`;
        const disp = res.headers.get('Content-Disposition');
        if (disp && disp.includes('filename=')) {
            const match = disp.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            if (match && match[1]) filename = match[1].replace(/['"]/g, '');
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) { alert('下载失败'); }
}

// ========== 素材列表渲染（缩略图优化） ==========
async function getThumbnailUrl(material) {
    if (!material.thumbnail_path) {
        // 没有缩略图，若是图片则下载完整图片
        if (material.mime_type?.startsWith('image/')) {
            if (thumbUrlMap.has(material.id)) return thumbUrlMap.get(material.id);
            try {
                const blob = await fetchMaterialBlob(material.id);
                const url = URL.createObjectURL(blob);
                thumbUrlMap.set(material.id, url);
                return url;
            } catch (e) {
                console.warn('获取图片缩略图失败:', e);
                return null;
            }
        }
        return null;
    }

    let path = material.thumbnail_path.replace(/\\/g, '/').replace(/^\/+/, '');
    
    // 🔥 统一处理：确保路径以 uploads/ 开头
    if (!path.startsWith('uploads/')) {
        // 如果是视频缩略图（thumbnails/xxx），需要加上 uploads/
        if (path.startsWith('thumbnails/')) {
            path = `uploads/${path}`;
        } else {
            // 其他情况也加上 uploads/
            path = `uploads/${path}`;
        }
    }
    
    return `${API_BASE}/${path}`;
}

function clearThumbCache() {
    for (let url of thumbUrlMap.values()) URL.revokeObjectURL(url);
    thumbUrlMap.clear();
}

async function renderFilteredMaterials() {
    const container = document.getElementById('materialList');
    if (!container) return;
    let filtered = [...allMaterials];
    if (currentFilterCategory !== 'all') filtered = filtered.filter(m => (m.category?.trim() || '未分类') === currentFilterCategory);
    if (currentSearchKeyword.trim()) {
        const kw = currentSearchKeyword.trim().toLowerCase();
        filtered = filtered.filter(m => m.original_name?.toLowerCase().includes(kw));
    }
    const isFilterActive = (currentFilterCategory !== 'all' || currentSearchKeyword.trim() !== '');
    const badge = document.getElementById('filterActiveBadge');
    if (badge) badge.style.display = isFilterActive ? 'inline-block' : 'none';

    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-filter"></i><p>没有匹配的素材</p></div>';
        return;
    }
    container.innerHTML = '';
    for (let mat of filtered) {
        const card = document.createElement('div');
        card.className = 'card';
        const categoryDisplay = (mat.category?.trim() || '未分类');
        const isImage = mat.mime_type?.startsWith('image/');
        const isVideo = mat.mime_type?.startsWith('video/');
        card.innerHTML = `
            <div class="file-icon" id="thumb-${mat.id}"><i class="fas fa-spinner fa-pulse"></i></div>
            <div class="file-name" title="${escapeHtml(mat.original_name)}">${escapeHtml(mat.original_name)}</div>
            <div class="file-meta"><span><i class="fas fa-database"></i> ${formatSize(mat.size)}</span><span><i class="far fa-calendar-alt"></i> ${new Date(mat.upload_time).toLocaleDateString()}</span></div>
            <div class="file-category"><i class="fas fa-tag"></i> ${escapeHtml(categoryDisplay)}</div>
        `;
        getThumbnailUrl(mat).then(url => {
            const div = document.getElementById(`thumb-${mat.id}`);
            if (div) {
                if (url) {
                    div.innerHTML = `<img src="${url}" alt="缩略图" class="thumb-img">`;
                } else {
                    if (isImage) div.innerHTML = `<i class="fas fa-image fa-3x" style="color:#3b82f6;"></i>`;
                    else if (isVideo) div.innerHTML = `<i class="fas fa-video fa-3x" style="color:#ef4444;"></i>`;
                    else div.innerHTML = `<i class="fas fa-file-alt fa-3x" style="color:#5b6e8c;"></i>`;
                }
            }
        }).catch(() => {});
        card.addEventListener('click', () => {
            openPreview({ id: mat.id, original_name: mat.original_name, mime_type: mat.mime_type });
        });
        container.appendChild(card);
    }
}

// ========== 收藏弹窗 ==========
function openFavoritesModal() {
    const overlay = document.getElementById('favoritesModalOverlay');
    if (!overlay) return;
    overlay.classList.add('active');
    renderFavoritesList();
}
function closeFavoritesModal() {
    const overlay = document.getElementById('favoritesModalOverlay');
    if (overlay) overlay.classList.remove('active');
}

async function renderFavoritesList() {
    const body = document.getElementById('favoritesBody');
    if (!body) return;
    try {
        const res = await apiCall('/api/favorites', { method: 'GET' });
        if (!res.ok) throw new Error();
        const favorites = await res.json();
        if (favorites.length === 0) {
            body.innerHTML = `<div class="favorites-empty"><i class="far fa-heart"></i><p>还没有收藏任何素材</p></div>`;
            return;
        }
        let html = `<div class="favorites-grid">`;
        for (let item of favorites) {
            const thumbUrl = await getThumbnailUrl(item);
            let thumbHtml = '';
            if (thumbUrl) {
                thumbHtml = `<img src="${thumbUrl}" alt="缩略图">`;
            } else {
                if (item.mime_type?.startsWith('image/')) thumbHtml = `<i class="fas fa-image"></i>`;
                else if (item.mime_type?.startsWith('video/')) thumbHtml = `<i class="fas fa-video"></i>`;
                else thumbHtml = `<i class="fas fa-file-alt"></i>`;
            }
            const categoryDisplay = (item.category?.trim() || '未分类');
            html += `
                <div class="favorite-item" data-id="${item.id}">
                    <div class="file-icon-small">${thumbHtml}</div>
                    <div class="fav-name" title="${escapeHtml(item.original_name)}">${escapeHtml(item.original_name)}</div>
                    <div class="fav-meta"><span>${formatSize(item.size)}</span><span>${new Date(item.upload_time).toLocaleDateString()}</span></div>
                    <span class="fav-category">${escapeHtml(categoryDisplay)}</span>
                    <button class="remove-fav-btn" data-id="${item.id}" title="取消收藏"><i class="fas fa-times"></i></button>
                </div>
            `;
        }
        html += `</div>`;
        body.innerHTML = html;
        body.querySelectorAll('.remove-fav-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = parseInt(btn.dataset.id);
                const res = await apiCall(`/api/favorites/${id}`, { method: 'DELETE' });
                if (res.ok) {
                    favoritesSet.delete(id);
                    renderFavoritesList();
                    const previewFavBtn = document.getElementById('previewFavBtn');
                    if (previewFavBtn && parseInt(previewFavBtn.dataset.id) === id) {
                        updatePreviewFavButton(id, false);
                    }
                } else {
                    alert('取消收藏失败');
                }
            });
        });
        body.querySelectorAll('.favorite-item').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.closest('.remove-fav-btn')) return;
                const id = parseInt(el.dataset.id);
                const material = allMaterials.find(m => m.id === id);
                if (material) {
                    closeFavoritesModal();
                    openPreview(material);
                }
            });
        });
    } catch (e) {
        body.innerHTML = `<div class="favorites-empty"><i class="fas fa-exclamation-triangle"></i><p>加载收藏失败</p></div>`;
    }
}

// ========== 素材加载与筛选 ==========
async function loadMaterials() {
    const container = document.getElementById('materialList');
    if (!container) return;
    container.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-pulse"></i> 加载素材中...</div>';
    try {
        const res = await apiCall('/api/materials');
        if (!res.ok) { if (res.status === 401) logoutEmployee(); throw new Error(); }
        const materials = await res.json();
        allMaterials = materials;
        await loadFavorites();
        buildCategoryOptions();
        syncMobileModalOptions();
        clearThumbCache();
        await renderFilteredMaterials();
    } catch (e) { container.innerHTML = '<div class="empty-state">加载失败，请刷新</div>'; }
}

function buildCategoryOptions() {
    const select = document.getElementById('categorySelect');
    if (!select) return;
    const cats = new Set();
    allMaterials.forEach(m => cats.add(m.category?.trim() || '未分类'));
    let opts = '<option value="all">全部分类</option>';
    Array.from(cats).sort().forEach(c => opts += `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`);
    select.innerHTML = opts;
    if (currentFilterCategory !== 'all' && cats.has(currentFilterCategory)) select.value = currentFilterCategory;
    else select.value = 'all';
}

function syncMobileModalOptions() {
    const modalSelect = document.getElementById('modalCategorySelect');
    if (!modalSelect) return;
    const cats = new Set();
    allMaterials.forEach(m => cats.add(m.category?.trim() || '未分类'));
    let opts = '<option value="all">全部分类</option>';
    Array.from(cats).sort().forEach(c => opts += `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`);
    modalSelect.innerHTML = opts;
    modalSelect.value = currentFilterCategory;
    document.getElementById('modalSearchInput').value = currentSearchKeyword;
}

function bindFilterEvents() {
    const catSel = document.getElementById('categorySelect');
    const search = document.getElementById('searchKeyword');
    const reset = document.getElementById('resetFilterBtn');
    if (catSel) catSel.addEventListener('change', (e) => { currentFilterCategory = e.target.value; renderFilteredMaterials(); syncMobileModalOptions(); });
    if (search) search.addEventListener('input', (e) => { currentSearchKeyword = e.target.value; renderFilteredMaterials(); syncMobileModalOptions(); });
    if (reset) reset.addEventListener('click', () => { if (catSel) catSel.value = 'all'; if (search) search.value = ''; currentFilterCategory = 'all'; currentSearchKeyword = ''; renderFilteredMaterials(); syncMobileModalOptions(); });
}

function initMobileFilterModal() {
    const modal = document.getElementById('filterModal');
    const openBtn = document.getElementById('mobileFilterBtn');
    const closeBtn = document.getElementById('closeModalBtn');
    const resetBtn = document.getElementById('modalResetBtn');
    const applyBtn = document.getElementById('modalApplyBtn');
    if (!openBtn || !modal) return;
    openBtn.onclick = () => { syncMobileModalOptions(); modal.classList.add('active'); };
    const close = () => modal.classList.remove('active');
    closeBtn.onclick = close;
    modal.onclick = (e) => { if (e.target === modal) close(); };
    resetBtn.onclick = () => {
        document.getElementById('modalCategorySelect').value = 'all';
        document.getElementById('modalSearchInput').value = '';
        if (document.getElementById('categorySelect')) document.getElementById('categorySelect').value = 'all';
        if (document.getElementById('searchKeyword')) document.getElementById('searchKeyword').value = '';
        currentFilterCategory = 'all';
        currentSearchKeyword = '';
        renderFilteredMaterials();
        close();
    };
    applyBtn.onclick = () => {
        const newCat = document.getElementById('modalCategorySelect').value;
        const newKw = document.getElementById('modalSearchInput').value;
        if (document.getElementById('categorySelect')) document.getElementById('categorySelect').value = newCat;
        if (document.getElementById('searchKeyword')) document.getElementById('searchKeyword').value = newKw;
        currentFilterCategory = newCat;
        currentSearchKeyword = newKw;
        renderFilteredMaterials();
        close();
    };
}

// ========== 登录/登出 ==========
function updateAvatarAndDropdown() {
    const avatarIcon = document.getElementById('avatarIcon');
    const dropdownNick = document.getElementById('dropdownNickname');
    const dropdownUser = document.getElementById('dropdownUsername');
    let displayName = (currentEmployee.nickname?.trim() || currentEmployee.username);
    let firstChar = displayName ? displayName.charAt(0).toUpperCase() : 'U';
    avatarIcon.innerText = firstChar;
    if (dropdownNick) dropdownNick.innerHTML = `<i class="fas fa-user-circle"></i> ${escapeHtml(currentEmployee.nickname || '未设置昵称')}`;
    if (dropdownUser) dropdownUser.innerHTML = `<i class="fas fa-id-card"></i> 账号：${escapeHtml(currentEmployee.username)}`;
}

async function fetchEmployeeProfile() {
    if (!employeeToken) return;
    try {
        const res = await apiCall('/api/employee/profile');
        if (res.ok) {
            const profile = await res.json();
            currentEmployee = { ...currentEmployee, ...profile };
            localStorage.setItem('empInfo', JSON.stringify(currentEmployee));
            updateAvatarAndDropdown();
        } else if (res.status === 401) logoutEmployee();
    } catch (e) {}
}

async function employeeLogin(username, password) {
    const res = await fetch(`${API_BASE}/api/employee/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
        body: JSON.stringify({ username, password })
    });
    if (res.ok) {
        const data = await res.json();
        employeeToken = data.token;
        currentEmployee = { id: data.id, username: data.username, nickname: data.nickname || '' };
        localStorage.setItem('empToken', employeeToken);
        localStorage.setItem('empInfo', JSON.stringify(currentEmployee));
        return true;
    } else {
        const err = await res.json();
        throw new Error(err.error || '登录失败');
    }
}

function logoutEmployee() {
    employeeToken = null;
    currentEmployee = { id: null, username: '', nickname: '' };
    allMaterials = [];
    currentFilterCategory = 'all';
    currentSearchKeyword = '';
    favoritesSet.clear();
    localStorage.removeItem('empToken');
    localStorage.removeItem('empInfo');
    document.getElementById('loginPanel')?.classList.remove('hidden');
    document.getElementById('materialPanel')?.classList.add('hidden');
    clearThumbCache();
    closePreviewAndStopMedia();
    closeFavoritesModal();
}

function bindLoginEvent() {
    const btn = document.getElementById('empLoginBtn');
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener('click', async () => {
        const username = document.getElementById('empUsername').value.trim();
        const password = document.getElementById('empPassword').value.trim();
        if (!username || !password) { document.getElementById('loginError').innerText = '请输入账号和密码'; return; }
        newBtn.disabled = true;
        newBtn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> 登录中...';
        try {
            await employeeLogin(username, password);
            document.getElementById('loginPanel').classList.add('hidden');
            document.getElementById('materialPanel').classList.remove('hidden');
            updateAvatarAndDropdown();
            await fetchEmployeeProfile();
            await loadMaterials();
            bindFilterEvents();
            initMobileFilterModal();
            createPreviewModal();
        } catch (err) { document.getElementById('loginError').innerText = err.message; } finally {
            newBtn.disabled = false;
            newBtn.innerHTML = '<i class="fas fa-arrow-right-to-bracket"></i> 登录素材库';
        }
    });
}

async function autoLogin() {
    const token = localStorage.getItem('empToken');
    const info = localStorage.getItem('empInfo');
    if (token && info) {
        employeeToken = token;
        try {
            currentEmployee = JSON.parse(info);
            updateAvatarAndDropdown();
            const test = await apiCall('/api/materials');
            if (test.ok) {
                document.getElementById('loginPanel').classList.add('hidden');
                document.getElementById('materialPanel').classList.remove('hidden');
                await fetchEmployeeProfile();
                await loadMaterials();
                bindFilterEvents();
                initMobileFilterModal();
                createPreviewModal();
            } else logoutEmployee();
        } catch (e) { logoutEmployee(); }
    }
}

// ========== 下拉菜单 ==========
function initDropdown() {
    const avatarBtn = document.getElementById('avatarBtn');
    const dropdown = document.getElementById('dropdownMenu');
    if (!avatarBtn || !dropdown) return;
    avatarBtn.addEventListener('click', (e) => { e.stopPropagation(); dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block'; });
    document.addEventListener('click', (e) => { if (!avatarBtn.contains(e.target) && !dropdown.contains(e.target)) dropdown.style.display = 'none'; });
    document.getElementById('dropdownFavorites').addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.style.display = 'none';
        openFavoritesModal();
    });
    document.getElementById('dropdownLogout').addEventListener('click', (e) => { e.stopPropagation(); logoutEmployee(); dropdown.style.display = 'none'; });
}

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('favoritesCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeFavoritesModal);
    const overlay = document.getElementById('favoritesModalOverlay');
    if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) closeFavoritesModal(); });
});

(function start() {
    autoLogin().finally(() => {
        initDropdown();
        bindLoginEvent();
        // 可以暴露 API_BASE 修改函数到控制台
        window.updateApiBase = function(newBase) {
            API_BASE = newBase;
            localStorage.setItem('apiBase', newBase);
            console.log('API_BASE 已更新为:', API_BASE);
            if (employeeToken) loadMaterials();
        };
    });
})();