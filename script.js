function createPageSelector() {
  const form = document.createElement("form");
  form.name = "selecter";
  form.id = "page-selecter";

  form.innerHTML = `
    <select name="select1">
    <option value="none">-</option>
      <option value="index.html">jisu.today/photos</option>
      <option value="2026.html">2026</option>
    </select><input type="button" value="Go">
  `;

  document.body.prepend(form);

  form.querySelector("input").addEventListener("click", function () {
    const value = form.select1.value;
    if (value !== "none") {
      location.href = value;
    }
  });
}

createPageSelector();






console.log('JS is loaded');

const channel_title = 'photos-2026-na_mokplbj8';
const api = 'https://api.are.na/v3/channels/';

const thumbs_el = document.querySelector('#thumbs');
const viewer = document.querySelector('#viewer');
const viewer_img = document.querySelector('#viewer img');
const placeholder = document.querySelector('#placeholder');

let allImages = [];
let uniqueUrls = new Set();
let currentImageIndex = -1;
let currentPage = 1;
let isLoading = false;
let hasMore = true;

const MIN_REQUEST_INTERVAL = 1000;
let lastRequestTime = 0;

const loadingEl = document.querySelector('#loading');
loadingEl.innerHTML = '<p>camera roll is loading...</p>';

const imageObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const img = entry.target;

            if (img.dataset.src) {
                img.onload = () => img.classList.add('loaded');
                img.src = img.dataset.src;
                delete img.dataset.src;
            }

            imageObserver.unobserve(img);
        }
    });
}, { rootMargin: '200px' });

function getRandomColor() {
    const hue = Math.floor(Math.random() * 360);
    const saturation = 40 + Math.floor(Math.random() * 30);
    const lightness = 30 + Math.floor(Math.random() * 20);
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

async function rateLimitedFetch(url) {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;

    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
        await new Promise(resolve =>
            setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest)
        );
    }

    lastRequestTime = Date.now();

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Cache-Control': 'no-cache'
        }
    });

    if (response.status === 429) {
        console.warn('Rate limited. Retrying soon...');
        await new Promise(resolve => setTimeout(resolve, 60000));
        return rateLimitedFetch(url);
    }

    return response;
}

async function fetchPage(page = 1, per = 100) {
    try {
        // sort를 넣지 않아야 Are.na 채널의 블록 순서에 가깝게 가져옵니다.
        const url = `${api}${channel_title}/contents?page=${page}&per=${per}`;

        const response = await rateLimitedFetch(url);

        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching page:', error);
        loadingEl.innerHTML = '<p>failed to load</p>';
        return null;
    }
}

function sortByArenaPosition(blocks) {
    return blocks.slice().sort((a, b) => {
        if (typeof a.position === 'number' && typeof b.position === 'number') {
            return a.position - b.position;
        }

        return 0;
    });
}

function getImageUrls(item) {
    if (!item.image) return null;

    const small =
        item.image.small?.src ||
        item.image.thumb?.src ||
        item.image.display?.url ||
        item.image.original?.url;

    const large =
        item.image.large?.src ||
        item.image.original?.url ||
        item.image.display?.url ||
        small;

    const unique =
        item.image.original?.url ||
        item.image.large?.src ||
        item.image.medium?.src ||
        small;

    if (!small || !large || !unique) return null;

    return { small, large, unique };
}

function createThumbnail(item) {
    if (item.type !== 'Image') return;

    const urls = getImageUrls(item);
    if (!urls) return;

    if (uniqueUrls.has(urls.unique)) return;
    uniqueUrls.add(urls.unique);

    const thumb_el = document.createElement('div');
    thumb_el.classList.add('thumb', 'image');

    const bgColor = getRandomColor();

    thumb_el.innerHTML = `
        <img
            src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
            data-src="${urls.small}"
            data-large="${urls.large}"
            data-color="${bgColor}"
            alt=""
        >
    `;

    const img = thumb_el.querySelector('img');
    imageObserver.observe(img);

    thumb_el.addEventListener('click', () => {
        currentImageIndex = Array.from(thumbs_el.children).indexOf(thumb_el);
        showImage(currentImageIndex);
    });

    thumbs_el.appendChild(thumb_el);
    allImages.push(item);
}

async function fetchNextPage() {
    if (isLoading || !hasMore) return;

    isLoading = true;

    const response = await fetchPage(currentPage, 100);

    if (!response) {
        isLoading = false;
        return;
    }

    let blocks = response.data || response.contents || [];

    // Are.na position 값이 있으면 채널 블록 순서대로 정렬
    blocks = sortByArenaPosition(blocks);

    blocks.forEach(block => {
        createThumbnail(block);
    });

    if (currentPage === 1) {
        const firstImage = blocks.find(item => item.type === 'Image' && item.image);
        const urls = firstImage ? getImageUrls(firstImage) : null;

        if (urls) {
            const favicon = document.createElement('link');
            favicon.rel = 'icon';
            favicon.href = urls.small;
            document.head.appendChild(favicon);
        }
    }

    hasMore = response.meta?.has_more_pages ?? blocks.length === 100;
    currentPage++;
    isLoading = false;

    if (!hasMore) {
        loadingEl.style.display = 'none';
        console.log(`Loaded ${allImages.length} images in Are.na channel order`);
    } else {
        setTimeout(fetchNextPage, MIN_REQUEST_INTERVAL);
    }
}

const sentinel = document.createElement('div');
sentinel.id = 'scroll-sentinel';
thumbs_el.after(sentinel);

const scrollObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
        fetchNextPage();
    }
}, { rootMargin: '400px' });

scrollObserver.observe(sentinel);

fetchNextPage();

const preloadedUrls = new Set();
let currentPlaceholderTimeout = null;

function preloadAdjacentImages(index) {
    const thumbs = Array.from(thumbs_el.children);

    [index - 2, index - 1, index + 1, index + 2].forEach(i => {
        if (i >= 0 && i < thumbs.length) {
            const img = thumbs[i].querySelector('img');

            if (img && img.dataset.large && !preloadedUrls.has(img.dataset.large)) {
                preloadedUrls.add(img.dataset.large);

                const preloadImg = new Image();
                preloadImg.src = img.dataset.large;
            }
        }
    });
}

function showImage(index) {
    const thumbs = Array.from(thumbs_el.children);

    if (index < 0 || index >= thumbs.length) return;

    const img = thumbs[index].querySelector('img');
    const wasViewerOpen = viewer.style.display === 'flex';

    if (currentPlaceholderTimeout) {
        clearTimeout(currentPlaceholderTimeout);
        currentPlaceholderTimeout = null;
    }

    viewer_img.classList.remove('loaded');
    placeholder.classList.remove('visible');
    viewer_img.src = '';

    void viewer_img.offsetWidth;
    void placeholder.offsetWidth;

    viewer.style.display = 'flex';
    currentImageIndex = index;

    if (!wasViewerOpen) {
        document.documentElement.classList.add('viewer-open');
        document.body.classList.add('viewer-open');
    }

    const color = img.dataset.color || '#ddd';

    placeholder.innerHTML = `
        <div style="
            width: calc(100vw - 40px);
            height: calc(100vh - 40px);
            background-color: ${color};
            margin: auto;
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
        "></div>
    `;

    placeholder.classList.add('visible');

    const loadStartTime = Date.now();
    const largeImg = new Image();

    largeImg.onload = () => {
        const loadTime = Date.now() - loadStartTime;
        const remainingTime = Math.max(0, 300 - loadTime);

        currentPlaceholderTimeout = setTimeout(() => {
            viewer_img.src = img.dataset.large;
            viewer_img.classList.add('loaded');

            setTimeout(() => {
                placeholder.classList.remove('visible');
            }, 50);
        }, remainingTime);
    };

    largeImg.src = img.dataset.large;

    preloadAdjacentImages(index);
}

function closeViewer() {
    viewer.style.display = 'none';
    viewer_img.src = '';
    viewer_img.classList.remove('loaded');
    placeholder.classList.remove('visible');
    currentImageIndex = -1;

    document.documentElement.classList.remove('viewer-open');
    document.body.classList.remove('viewer-open');
}

viewer.addEventListener('click', closeViewer);

document.addEventListener('keydown', (e) => {
    if (viewer.style.display !== 'flex') return;

    if (e.key === 'Escape') {
        closeViewer();
    }

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        showImage(currentImageIndex + 1);
    }

    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        showImage(currentImageIndex - 1);
    }
});

let touchStartX = 0;
let touchEndX = 0;
const minSwipeDistance = 50;

viewer.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
}, { passive: true });

viewer.addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].screenX;
    handleSwipe();
}, { passive: true });

function handleSwipe() {
    const swipeDistance = touchEndX - touchStartX;

    if (Math.abs(swipeDistance) < minSwipeDistance) return;

    if (swipeDistance > 0) {
        showImage(currentImageIndex - 1);
    } else {
        showImage(currentImageIndex + 1);
    }
}

