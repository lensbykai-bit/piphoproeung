(() => {
  const db = window.dvSupabase;
  const searchInput = document.getElementById('searchInput');
  const movieGrid = document.getElementById('movieGrid');
  const popularGrid = document.getElementById('popularGrid');
  const topList = document.getElementById('topList');
  const movieCount = document.getElementById('movieCount');
  const modal = document.getElementById('movieModal');
  const closeBtn = document.getElementById('movieModalClose');
  const telegramMain = document.getElementById('telegramMain');
  const socialTelegram = document.getElementById('socialTelegram');

  let movies = [];
  let activeFilter = 'all';
  let previousFocus = null;
  let fallbackMode = false;

  function esc(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function normalizeCategory(movie) {
    return (movie.category || []).map(v => String(v).toLowerCase());
  }

  function hasFilter(movie, filter) {
    if (filter === 'all') return true;
    return normalizeCategory(movie).includes(filter.toLowerCase());
  }

  function filteredMovies() {
    const q = (searchInput?.value || '').trim().toLowerCase();
    return movies.filter(movie => {
      const filterOk = hasFilter(movie, activeFilter);
      const textOk = !q || `${movie.title} ${movie.description || ''} ${(movie.category || []).join(' ')}`.toLowerCase().includes(q);
      return filterOk && textOk;
    });
  }

  function posterStyle(movie) {
    return movie.poster
      ? `style="background-image:linear-gradient(180deg,transparent 45%,rgba(4,8,13,.08) 54%,rgba(4,8,13,.93) 100%),url('${esc(movie.poster)}')"`
      : '';
  }

  function badgeClass(movie) {
    const badge = String(movie.badge || '').toLowerCase();
    if (badge === 'vip') return 'vip';
    if (badge === 'ai') return 'ai';
    return '';
  }

  function card(movie) {
    const first = (movie.title || 'D').trim().charAt(0) || 'D';
    return `
      <button type="button" class="movie-card" data-id="${esc(movie.id)}" aria-label="${esc(movie.title)}">
        <div class="movie-poster" ${posterStyle(movie)}>
          ${movie.poster ? '' : `<span class="poster-letter">${esc(first)}</span>`}
          <span class="movie-badge ${badgeClass(movie)}">${esc(movie.badge || 'NEW')}</span>
          <div class="movie-overlay"><div class="movie-title">${esc(movie.title)}</div></div>
        </div>
        <div class="movie-info">
          <span class="card-price">${esc(movie.price || '—')}</span>
          <div class="episode">${esc(movie.episode || 'រឿងពេញ')}</div>
        </div>
      </button>`;
  }

  function topItem(movie, index) {
    const style = movie.poster ? `style="background-image:url('${esc(movie.poster)}')"` : '';
    return `
      <div class="topitem" data-id="${esc(movie.id)}">
        <span class="rank ${index === 0 ? 'first' : ''}">${index + 1}</span>
        <span class="topthumb" ${style}></span>
        <span><div class="topname">${esc(movie.title)}</div><div class="topsmall">★ ${esc(movie.rating || '—')}</div></span>
      </div>`;
  }

  function render() {
    const list = filteredMovies();
    if (movieGrid) movieGrid.innerHTML = list.length ? list.map(card).join('') : '<div class="loading">រកមិនឃើញរឿងទេ។</div>';
    if (movieCount) movieCount.textContent = `${list.length} រឿង`;

    const popular = [...movies]
      .sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0))
      .slice(0, 6);

    if (popularGrid) popularGrid.innerHTML = popular.map(card).join('');
    if (topList) topList.innerHTML = popular.slice(0, 5).map(topItem).join('');
  }

  function setFilter(filter) {
    activeFilter = filter || 'all';
    document.querySelectorAll('[data-filter]').forEach(el => {
      el.classList.toggle('active', el.dataset.filter === activeFilter);
    });
    render();
    document.getElementById('latest')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function openMovie(movie) {
    if (!movie || !modal) return;
    previousFocus = document.activeElement;
    document.getElementById('checkoutMessage').textContent = fallbackMode ? 'កំពុងបង្ហាញទិន្នន័យគំរូ។ ការទូទាត់មិនទាន់អាចប្រើបានទេ។' : '';
    const poster = document.getElementById('modalPoster');
    document.getElementById('modalTitle').textContent = movie.title || 'DramaVerse';
    document.getElementById('modalBadge').textContent = movie.badge || 'DramaVerse';
    document.getElementById('modalRating').textContent = movie.rating ? `★ ${movie.rating}` : '';
    document.getElementById('modalEpisode').textContent = movie.episode || 'រឿងពេញ';
    document.getElementById('modalDescription').textContent = movie.description || '';
    document.getElementById('modalPrice').textContent = movie.price || '—';

    if (poster) {
      poster.style.backgroundImage = movie.poster
        ? `linear-gradient(180deg,transparent 45%,rgba(4,8,13,.1) 100%),url('${movie.poster}')`
        : 'linear-gradient(155deg,#2a1531,#182438 55%,#0d1926)';
    }

    const watchBtn = document.getElementById('modalWatch');
    watchBtn.disabled = fallbackMode || !db;
    watchBtn.textContent = fallbackMode ? 'ទិន្នន័យគំរូ · មិនអាចទិញបាន' : 'ទិញរឿងតាម KHQR';
    watchBtn.onclick = async () => {
      if (!db || fallbackMode) return;
      const original = watchBtn.textContent;
      watchBtn.disabled = true;
      watchBtn.textContent = 'កំពុងបង្កើត Order...';
      try {
        const { data, error } = await db.rpc('create_checkout_order', {
          p_movie_id: movie.id,
          p_customer_contact: null
        });
        if (error) throw error;
        const order = Array.isArray(data) ? data[0] : data;
        if (!order?.order_id || !order?.access_token) {
          throw new Error('មិនអាចបង្កើត Order បានទេ។');
        }
        location.href = `pay.html#${order.order_id}:${order.access_token}`;
      } catch (error) {
        console.error(error);
        document.getElementById('checkoutMessage').textContent = 'មិនអាចចាប់ផ្ដើមការទូទាត់បានទេ។ សូមសាកម្ដងទៀត។';
        watchBtn.disabled = false;
        watchBtn.textContent = original;
      }
    };

    const copyBtn = document.getElementById('modalCopy');
    copyBtn.onclick = async () => {
      const shareUrl = `${location.origin}${location.pathname}#${encodeURIComponent(movie.id)}`;
      try {
        await navigator.clipboard.writeText(shareUrl);
        copyBtn.textContent = '✓ Copied';
        setTimeout(() => (copyBtn.textContent = '🔗 Copy Link'), 1200);
      } catch (_) {}
    };

    modal.classList.add('show');
    closeBtn?.focus();
    document.body.style.overflow = 'hidden';
    history.replaceState(null, '', `#${encodeURIComponent(movie.id)}`);
  }

  function closeMovie() {
    modal?.classList.remove('show');
    previousFocus?.focus();
    document.body.style.overflow = '';
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  }

  function applySettings(settings) {
    if (!settings) return;
    if (telegramMain && settings.telegram_url) telegramMain.href = settings.telegram_url;
    if (socialTelegram && settings.telegram_url) socialTelegram.href = settings.telegram_url;
    const hot = document.querySelector('.dv-hot');
    const title = document.querySelector('.dv-hero h1');
    const description = document.querySelector('.dv-hero p');
    const button = document.querySelector('.dv-watch');
    if (hot && settings.hero_badge) hot.textContent = settings.hero_badge;
    if (title && settings.hero_title) title.innerHTML = esc(settings.hero_title).replaceAll('\n', '<br />');
    if (description && settings.hero_description) description.textContent = settings.hero_description;
    if (button && settings.hero_button_text) button.textContent = settings.hero_button_text;
    document.title = 'ពិភពរឿង — PiPhop Roeung';
  }

  function mapMovie(row) {
    return {
      id: row.id,
      title: row.title,
      category: row.category || [],
      badge: row.badge,
      price: row.price,
      priceKhr: row.price_khr || Number(String(row.price || '').replace(/[^0-9]/g, '')) || 2000,
      rating: row.rating,
      episode: row.episode,
      description: row.description,
      poster: row.poster_url || '',
      watchUrl: '#'
    };
  }

  async function loadFallback() {
    const res = await fetch('data/movies.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    movies = Array.isArray(data.movies) ? data.movies : [];
    fallbackMode = true;
    const notice = document.getElementById('catalogNotice');
    notice.hidden = false;
    notice.textContent = 'ទិន្នន័យគំរូ · មិនទាន់ភ្ជាប់បញ្ជីរឿងផ្ទាល់។ ការទូទាត់ត្រូវបានបិទសម្រាប់ទិន្នន័យនេះ។';
    if (data.settings?.telegramUrl && data.settings.telegramUrl !== 'https://t.me/') {
      if (telegramMain) telegramMain.href = data.settings.telegramUrl;
      if (socialTelegram) socialTelegram.href = data.settings.telegramUrl;
    } else {
      if (telegramMain) telegramMain.hidden = true;
      if (socialTelegram) socialTelegram.hidden = true;
    }
  }

  async function loadData() {
    try {
      if (!db) throw new Error('Supabase client unavailable');
      const [movieResult, settingsResult] = await Promise.all([
        db.from('movies')
          .select('id,title,category,badge,price,price_khr,rating,episode,description,poster_url,sort_order')
          .eq('is_published', true)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: false }),
        db.from('site_settings').select('*').eq('id', 1).maybeSingle()
      ]);

      if (movieResult.error) throw movieResult.error;
      movies = (movieResult.data || []).map(mapMovie);
      if (!settingsResult.error) applySettings(settingsResult.data);
    } catch (err) {
      console.warn('Supabase unavailable, using JSON fallback.', err);
      try {
        await loadFallback();
      } catch (fallbackError) {
        if (movieGrid) movieGrid.innerHTML = '<div class="loading">មិនអាចផ្ទុកទិន្នន័យរឿងបានទេ។</div>';
        console.error(fallbackError);
        return;
      }
    }

    render();
    let id = '';
    try { id = decodeURIComponent(location.hash.replace(/^#/, '')); } catch (_) {}
    if (id) openMovie(movies.find(m => m.id === id));
  }

  document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => setFilter(btn.dataset.filter));
  });

  searchInput?.addEventListener('input', render);

  document.addEventListener('click', event => {
    const target = event.target.closest('[data-id]');
    if (!target) return;
    const movie = movies.find(m => m.id === target.dataset.id);
    if (movie) openMovie(movie);
  });

  closeBtn?.addEventListener('click', closeMovie);
  modal?.addEventListener('click', event => {
    if (event.target === modal) closeMovie();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMovie();
    if (event.key === 'Tab' && modal?.classList.contains('show')) {
      const items = [...modal.querySelectorAll('button:not(:disabled),a[href]')].filter(el => !el.hidden);
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });

  document.documentElement.dataset.theme = 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#07101a');
  document.getElementById('year').textContent = new Date().getFullYear();
  loadData();
})();
