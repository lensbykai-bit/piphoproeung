(() => {
  const db = window.dvSupabase;
  const searchInput = document.getElementById('searchInput');
  const movieGrid = document.getElementById('movieGrid');
  const popularGrid = document.getElementById('popularGrid');
  const topList = document.getElementById('topList');
  const movieCount = document.getElementById('movieCount');
  const modal = document.getElementById('movieModal');
  const closeBtn = document.getElementById('movieModalClose');
  const paymentModal = document.getElementById('paymentModal');
  const paymentCloseBtn = document.getElementById('paymentModalClose');
  const telegramMain = document.getElementById('telegramMain');

  let movies = [];
  let activeFilter = 'all';
  let previousFocus = null;
  let fallbackMode = false;
  let paymentPoller = null;
  let paymentCountdownTimer = null;
  let activePayment = null;

  function esc(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function checkoutErrorMessage(error) {
    const code = String(error?.code || '').trim();
    const message = String(error?.message || '').trim();
    const details = String(error?.details || '').trim();
    const hint = String(error?.hint || '').trim();
    const rpcMessage = String(error?.rpcError?.message || '').trim();
    const lower = [message, details, hint, rpcMessage].join(' ').toLowerCase();

    if (
      code === 'PGRST202' ||
      lower.includes('could not find the function') ||
      lower.includes('create_checkout_order')
    ) {
      return `Checkout backend មិនទាន់មាន RPC/Edge Function ដែលអាចបង្កើត Order បាន${code ? ` (${code})` : ''}។`;
    }

    if (
      code === '42501' ||
      lower.includes('permission denied') ||
      lower.includes('row-level security') ||
      lower.includes('rls')
    ) {
      return `Supabase មិនអនុញ្ញាតឱ្យបង្កើត Order${code ? ` (${code})` : ''}។ សូមពិនិត្យ RPC permission/RLS។`;
    }

    if (
      lower.includes('failed to fetch') ||
      lower.includes('network') ||
      lower.includes('load failed')
    ) {
      return 'មិនអាចភ្ជាប់ទៅ Supabase បានទេ។ សូមពិនិត្យ Internet និង Supabase project។';
    }

    const readable = message || details || 'Unknown checkout error';
    return `Checkout error${code ? ` (${code})` : ''}: ${readable}`;
  }

  function isMissingRpcError(error) {
    const code = String(error?.code || '').trim();
    const text = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ').toLowerCase();
    return code === 'PGRST202' || code === '42883' ||
      text.includes('could not find the function') ||
      text.includes('function public.create_checkout_order') ||
      text.includes('create_checkout_order');
  }

  function isPermissionError(error) {
    const code = String(error?.code || '').trim();
    const text = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ').toLowerCase();
    return code === '42501' ||
      text.includes('permission denied') ||
      text.includes('row-level security') ||
      text.includes('rls');
  }

  function normalizeOrderPayload(data) {
    const order = Array.isArray(data) ? data[0] : data;
    if (!order?.order_id || !order?.access_token) return null;
    return order;
  }

  async function createCheckoutOrder(movie) {
    const { data, error } = await db.functions.invoke('bakong-order', {
      body: { action: 'create', movieId: movie.id }
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    const order = normalizeOrderPayload(data);
    if (!order) throw new Error('មិនអាចបង្កើត Order + KHQR បានទេ។');
    return order;
  }

  function khrMoney(value) {
    return new Intl.NumberFormat('km-KH').format(Number(value || 0)) + '៛';
  }

  async function getCheckoutDetails(orderId, accessToken) {
    const { data, error } = await db.functions.invoke('bakong-order', {
      body: { action: 'details', orderId, accessToken }
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    if (!data?.order_id) throw new Error('រកមិនឃើញ Order នេះទេ។');
    return data;
  }

  async function drawPaymentQr(payload) {
    const canvas = document.getElementById('paymentQrCanvas');
    const empty = document.getElementById('paymentQrEmpty');
    if (!canvas || !empty) return;

    if (!payload || !window.QRCode?.toCanvas) {
      canvas.hidden = true;
      empty.hidden = false;
      empty.textContent = 'មិនអាចបង្ហាញ KHQR បានទេ។';
      return;
    }

    canvas.hidden = false;
    empty.hidden = true;
    await window.QRCode.toCanvas(canvas, payload, {
      width: 230,
      margin: 2,
      errorCorrectionLevel: 'M'
    });
  }

  function stopPaymentTimers() {
    if (paymentPoller) clearInterval(paymentPoller);
    if (paymentCountdownTimer) clearInterval(paymentCountdownTimer);
    paymentPoller = null;
    paymentCountdownTimer = null;
  }

  function startPaymentCountdown(expiresAt) {
    if (paymentCountdownTimer) clearInterval(paymentCountdownTimer);
    const el = document.getElementById('paymentCountdown');

    const tick = () => {
      if (!el || !expiresAt) return;
      const left = new Date(expiresAt).getTime() - Date.now();
      if (left <= 0) {
        el.textContent = 'Order បានផុតកំណត់';
        clearInterval(paymentCountdownTimer);
        return;
      }
      const m = Math.floor(left / 60000);
      const s = Math.floor((left % 60000) / 1000);
      el.textContent = `ផុតកំណត់ក្នុង ${m}:${String(s).padStart(2, '0')}`;
    };

    tick();
    paymentCountdownTimer = setInterval(tick, 1000);
  }

  function setPaymentStatus(status, watchUrl = null) {
    const badge = document.getElementById('paymentStatus');
    const message = document.getElementById('paymentStatusMessage');
    const refresh = document.getElementById('paymentRefresh');
    const telegram = document.getElementById('paymentTelegram');

    const labels = {
      pending: 'កំពុងរង់ចាំ',
      paid: 'ទូទាត់ជោគជ័យ',
      expired: 'ផុតកំណត់',
      cancelled: 'បានបោះបង់'
    };

    if (badge) {
      badge.className = `payment-status ${status || 'pending'}`;
      badge.textContent = labels[status] || status || 'កំពុងរង់ចាំ';
    }

    if (status === 'paid') {
      if (message) message.textContent = '✓ បានទទួលការទូទាត់រួចរាល់។ អ្នកអាចចូលមើលរឿងពេញបាន។';
      if (refresh) refresh.hidden = true;
      if (telegram && watchUrl) {
        telegram.href = watchUrl;
        telegram.hidden = false;
      }
      stopPaymentTimers();
      return;
    }

    if (telegram) {
      telegram.hidden = true;
      telegram.removeAttribute('href');
    }
    if (refresh) refresh.hidden = status === 'expired' || status === 'cancelled';

    if (message) {
      message.textContent = status === 'pending'
        ? 'សូមស្កេន KHQR ហើយបង់តាមចំនួនទឹកប្រាក់ខាងលើ។ ប្រព័ន្ធនឹងពិនិត្យដោយស្វ័យប្រវត្តិ។'
        : 'Order នេះមិនអាចទូទាត់បន្តបានទេ។';
    }
  }

  async function checkPaymentStatus(silent = true) {
    if (!activePayment || activePayment.status !== 'pending') return;
    const refresh = document.getElementById('paymentRefresh');

    if (!silent && refresh) {
      refresh.disabled = true;
      refresh.textContent = 'កំពុងពិនិត្យ...';
    }

    try {
      const { data, error } = await db.functions.invoke('bakong-order', {
        body: {
          action: 'status',
          orderId: activePayment.orderId,
          accessToken: activePayment.accessToken
        }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      activePayment.status = data?.status || 'pending';
      setPaymentStatus(activePayment.status, data?.watch_url || null);
    } catch (error) {
      console.warn('Payment status check failed:', error);
      if (!silent) {
        const message = document.getElementById('paymentStatusMessage');
        if (message) message.textContent = error?.message || 'មិនអាចពិនិត្យការទូទាត់បានទេ។';
      }
    } finally {
      if (!silent && refresh && activePayment?.status === 'pending') {
        refresh.disabled = false;
        refresh.textContent = 'ពិនិត្យការទូទាត់';
      }
    }
  }

  async function openPaymentModal(movie, order) {
    stopPaymentTimers();
    activePayment = {
      movie,
      orderId: order.order_id,
      accessToken: order.access_token,
      status: 'pending'
    };

    const title = document.getElementById('paymentMovieTitle');
    const amount = document.getElementById('paymentAmount');
    const code = document.getElementById('paymentOrderCode');
    const message = document.getElementById('paymentStatusMessage');
    const refresh = document.getElementById('paymentRefresh');
    const telegram = document.getElementById('paymentTelegram');

    if (title) title.textContent = movie.title || 'PiPhop Roeung';
    if (amount) amount.textContent = khrMoney(movie.priceKhr || 0);
    if (code) code.textContent = order.order_code || '—';
    if (message) message.textContent = 'កំពុងរៀបចំ KHQR...';
    if (refresh) {
      refresh.hidden = false;
      refresh.disabled = false;
      refresh.textContent = 'ពិនិត្យការទូទាត់';
    }
    if (telegram) {
      telegram.hidden = true;
      telegram.removeAttribute('href');
    }

    modal?.classList.remove('show');
    paymentModal?.classList.add('show');
    document.body.style.overflow = 'hidden';
    paymentCloseBtn?.focus();

    try {
      const details = await getCheckoutDetails(order.order_id, order.access_token);
      activePayment.status = details.status || 'pending';
      if (amount) amount.textContent = khrMoney(details.amount_khr || movie.priceKhr || 0);
      if (code) code.textContent = details.order_code || order.order_code || '—';
      await drawPaymentQr(details.khqr_payload);
      setPaymentStatus(activePayment.status, details.watch_url || null);

      if (activePayment.status === 'pending') {
        startPaymentCountdown(details.expires_at);
        paymentPoller = setInterval(() => checkPaymentStatus(true), 5000);
      }
    } catch (error) {
      console.error('Payment modal load failed:', error);
      if (message) message.textContent = error?.message || 'មិនអាចបង្ហាញ KHQR បានទេ។';
    }
  }

  function closePaymentModal() {
    stopPaymentTimers();
    paymentModal?.classList.remove('show');
    activePayment = null;
    modal?.classList.add('show');
    document.body.style.overflow = 'hidden';
    document.getElementById('modalWatch')?.focus();
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
        const order = await createCheckoutOrder(movie);
        await openPaymentModal(movie, order);
      } catch (error) {
        console.error('Checkout create order failed:', {
          code: error?.code,
          message: error?.message,
          details: error?.details,
          hint: error?.hint,
          error
        });
        const checkoutMessage = document.getElementById('checkoutMessage');
        if (checkoutMessage) {
          checkoutMessage.textContent = checkoutErrorMessage(error);
          checkoutMessage.dataset.errorCode = String(error?.code || '');
          checkoutMessage.title = [error?.details, error?.hint].filter(Boolean).join(' · ');
        }
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
        setTimeout(() => (copyBtn.textContent = '🔗 ចម្លងតំណ'), 1200);
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
    } else {
      if (telegramMain) telegramMain.hidden = true;
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

  paymentCloseBtn?.addEventListener('click', closePaymentModal);
  paymentModal?.addEventListener('click', event => {
    if (event.target === paymentModal) closePaymentModal();
  });
  document.getElementById('paymentRefresh')?.addEventListener('click', () => checkPaymentStatus(false));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && paymentModal?.classList.contains('show')) {
      closePaymentModal();
      return;
    }
    if (event.key === 'Escape') closeMovie();
    if (event.key === 'Tab' && paymentModal?.classList.contains('show')) {
      const items = [...paymentModal.querySelectorAll('button:not(:disabled),a[href]')].filter(el => !el.hidden);
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      return;
    }
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
