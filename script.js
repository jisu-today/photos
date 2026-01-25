console.log('JS is loaded');

// Get query string
const params = new Proxy(new URLSearchParams(window.location.search), {
    get: (searchParams, prop) => searchParams.get(prop),
});
let channel_title = 'photos-ixm1v55ma-g';

// Are.na's v3 API base url
const api = 'https://api.are.na/v3/channels/';

// Rate limiting configuration
// Free tier limit is 120 req/min, so we use 1 second minimum between requests
const MIN_REQUEST_INTERVAL = 1000;
let lastRequestTime = 0;

// Get grid element from index.html
const thumbs_el = document.querySelector('#thumbs');

// Create loading indicator
const loadingEl = document.createElement('div');
loadingEl.id = 'loading';
loadingEl.innerHTML = '<p>camera roll is loading...</p>';
document.body.appendChild(loadingEl);

let allImages = [];
let uniqueUrls = new Set();

// IntersectionObserver for lazy loading thumbnails
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

// Function to generate random color
function getRandomColor() {
    const hue = Math.floor(Math.random() * 360);
    const saturation = 40 + Math.floor(Math.random() * 30); // 40-70%
    const lightness = 30 + Math.floor(Math.random() * 20); // 30-50%
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

// Function to create and append thumbnail elements
function createThumbnail(item) {
    // v3 API uses 'type' instead of 'class', and image URLs are in .src format
    if (item.type === 'Image' && item.image && !uniqueUrls.has(item.image.medium.src)) {
        let thumb_el = document.createElement('div');
        thumb_el.classList.add('thumb');

        // Generate random color for this image (used in preview only)
        const bgColor = getRandomColor();

        // v3 API: small.src for thumb, large.src for full size
        // Use transparent 1x1 pixel as placeholder to avoid browser showing broken image border
        thumb_el.innerHTML = `<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-src="${item.image.small.src}" data-large="${item.image.large.src}" data-color="${bgColor}">`;
        thumb_el.classList.add('image');

        // Observe the image for lazy loading
        const img = thumb_el.querySelector('img');
        imageObserver.observe(img);

        // Add click listener immediately for each thumbnail
        thumb_el.addEventListener('click', () => {
            currentImageIndex = Array.from(thumbs_el.children).indexOf(thumb_el);
            showImage(currentImageIndex);
        });

        thumbs_el.appendChild(thumb_el);
        uniqueUrls.add(item.image.medium.src);
        allImages.push(item);
    }
}

// Rate-limited fetch with retry logic
async function rateLimitedFetch(url) {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;

    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
        await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
    }

    lastRequestTime = Date.now();

    const response = await fetch(url, {
        method: 'GET',
        headers: { 'Cache-Control': 'no-cache' }
    });

    // Handle rate limiting (429)
    if (response.status === 429) {
        const retryAfter = response.headers.get('X-RateLimit-Reset');
        const waitTime = retryAfter ? (parseInt(retryAfter) * 1000 - Date.now()) : 60000;
        console.warn(`Rate limited. Waiting ${Math.ceil(waitTime / 1000)}s before retry...`);
        await new Promise(resolve => setTimeout(resolve, Math.max(waitTime, MIN_REQUEST_INTERVAL)));
        return rateLimitedFetch(url);
    }

    return response;
}

// Function to fetch a page of contents
async function fetchPage(page = 1, per = 100) {
    try {
        const url = `${api}${channel_title}/contents?page=${page}&per=${per}&sort=created_at_desc`;
        const response = await rateLimitedFetch(url);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching page:', error);
        return null;
    }
}

// Infinite scroll state
let currentPage = 1;
let isLoading = false;
let hasMore = true;

// Create sentinel element for infinite scroll
const sentinel = document.createElement('div');
sentinel.id = 'scroll-sentinel';
thumbs_el.after(sentinel);

// Function to fetch next page
async function fetchNextPage() {
    if (isLoading || !hasMore) return;

    isLoading = true;
    const response = await fetchPage(currentPage, 100);

    if (!response) {
        isLoading = false;
        return;
    }

    // v3 API returns 'data' array instead of 'contents'
    const blocks = response.data || [];
    blocks.forEach(block => {
        createThumbnail(block);
    });

    // Set favicon using first image (only on first page)
    if (currentPage === 1 && blocks.length > 0) {
        const firstImage = blocks.find(item => item.type === 'Image' && item.image);
        if (firstImage) {
            const favicon = document.createElement('link');
            favicon.rel = 'icon';
            favicon.href = firstImage.image.small.src;
            document.head.appendChild(favicon);
        }
    }

    // v3 API provides has_more_pages in meta object
    hasMore = response.meta?.has_more_pages ?? blocks.length === 100;
    currentPage++;
    isLoading = false;

    // Hide loading element when no more content
    if (!hasMore) {
        loadingEl.style.display = 'none';
        console.log(`Loaded ${allImages.length} unique images`);
    } else {
        // Continue loading if there's more content
        // Small delay to prevent hammering the API
        setTimeout(() => fetchNextPage(), MIN_REQUEST_INTERVAL);
    }
}

// IntersectionObserver to trigger loading more content
const scrollObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
        fetchNextPage();
    }
}, { rootMargin: '400px' });

scrollObserver.observe(sentinel);

// Fetch first page immediately
fetchNextPage();

// Add click listener for viewer to close it
const viewer = document.querySelector('#viewer');
const viewer_img = document.querySelector('#viewer img');
const placeholder = document.querySelector('#placeholder');

// Track current image index
let currentImageIndex = -1;

// Track already preloaded images to avoid duplicate requests
const preloadedUrls = new Set();

// Function to preload adjacent images for faster navigation
function preloadAdjacentImages(index) {
    const thumbs = Array.from(thumbs_el.children);
    // Preload 2 images in each direction
    const indicesToPreload = [
        index - 2, index - 1,
        index + 1, index + 2
    ];

    indicesToPreload.forEach(i => {
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

// Track current loading timeout
let currentPlaceholderTimeout = null;

// Function to show image at specific index
function showImage(index) {
    const thumbs = Array.from(thumbs_el.children);
    if (index >= 0 && index < thumbs.length) {
        const img = thumbs[index].querySelector('img');
        const wasViewerOpen = viewer.style.display === 'flex';

        // Clear any existing timeout
        if (currentPlaceholderTimeout) {
            clearTimeout(currentPlaceholderTimeout);
            currentPlaceholderTimeout = null;
        }

        // Clear the viewer state BEFORE showing it
        viewer_img.classList.remove('loaded');
        placeholder.classList.remove('visible');
        viewer_img.src = '';

        // Force reflow to ensure everything is cleared
        void viewer_img.offsetWidth;
        void placeholder.offsetWidth;

        // Now show the viewer
        viewer.style.display = 'flex';
        currentImageIndex = index;

        // Lock scrolling on first open
        if (!wasViewerOpen) {
            document.documentElement.classList.add('viewer-open');
            document.body.classList.add('viewer-open');
        }

        // Setup placeholder dimensions
        const color = img.dataset.color;
        const thumbWidth = img.naturalWidth || img.width;
        const thumbHeight = img.naturalHeight || img.height;
        const aspectRatio = thumbWidth && thumbHeight ? thumbWidth / thumbHeight : 1;

        const viewerWidth = viewer.clientWidth - 40;
        const viewerHeight = viewer.clientHeight - 40;
        const viewerRatio = viewerWidth / viewerHeight;

        let placeholderWidth, placeholderHeight;
        if (aspectRatio > viewerRatio) {
            placeholderWidth = viewerWidth;
            placeholderHeight = viewerWidth / aspectRatio;
        } else {
            placeholderHeight = viewerHeight;
            placeholderWidth = viewerHeight * aspectRatio;
        }

        placeholder.innerHTML = `<div style="width: ${placeholderWidth}px; height: ${placeholderHeight}px; background-color: ${color}; margin: auto; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);"></div>`;

        // Show placeholder immediately
        placeholder.classList.add('visible');

        // Track when image started loading
        const loadStartTime = Date.now();

        // Load the large image
        const largeImg = new Image();
        largeImg.onload = () => {
            // Calculate how long the image took to load
            const loadTime = Date.now() - loadStartTime;
            const remainingTime = Math.max(0, 400 - loadTime);

            // Ensure placeholder shows for at least 400ms
            setTimeout(() => {
                // Set the image source and show it
                viewer_img.src = img.dataset.large;
                viewer_img.classList.add('loaded');

                // Keep placeholder visible for an extra 50ms to ensure no gap
                setTimeout(() => {
                    placeholder.classList.remove('visible');
                }, 50);
            }, remainingTime);
        };
        largeImg.src = img.dataset.large;

        // Preload adjacent images for faster navigation
        preloadAdjacentImages(index);
    }
}

// Function to close viewer
function closeViewer() {
    viewer.style.display = 'none';
    viewer_img.src = '';
    viewer_img.classList.remove('loaded');
    placeholder.classList.remove('visible');
    currentImageIndex = -1;

    // Unlock scrolling
    document.documentElement.classList.remove('viewer-open');
    document.body.classList.remove('viewer-open');
}

// Add keyboard event listeners
document.addEventListener('keydown', (e) => {
    if (viewer.style.display === 'flex') {
        switch(e.key) {
            case 'Escape':
                closeViewer();
                break;
            case 'ArrowRight':
            case 'ArrowDown':
                showImage(currentImageIndex + 1);
                break;
            case 'ArrowLeft':
            case 'ArrowUp':
                showImage(currentImageIndex - 1);
                break;
        }
    }
});

// Update click handlers
viewer.addEventListener('click', closeViewer);

// Touch swipe support for mobile
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

    if (Math.abs(swipeDistance) < minSwipeDistance) {
        return; // Swipe too short, ignore
    }

    if (swipeDistance > 0) {
        // Swiped right - show previous image
        showImage(currentImageIndex - 1);
    } else {
        // Swiped left - show next image
        showImage(currentImageIndex + 1);
    }
}